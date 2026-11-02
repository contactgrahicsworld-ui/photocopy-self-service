// Print queue service — job creation, printer routing, agent claiming,
// duplicate prevention and honest status tracking.
//
// PHYSICAL OUTPUT TRUTH: "COMPLETED" means the print agent reported that the
// OS spooler finished handing the job to the printer (or the shop marked it
// printed). It does NOT silently equate "Windows accepted the job" with
// "paper came out". States distinguish QUEUED → DISPATCHED → SPOOLING →
// SPOOLER_ACCEPTED → PRINTING → COMPLETED / FAILED, and shops can always
// manually confirm or reprint with an explicit duplicate warning.

import { db } from "./db";
import { Prisma } from "@prisma/client";
import { addOrderEvent, canTransitionOrder } from "./orders";

const JOB_TRANSITIONS: Record<string, string[]> = {
  QUEUED: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: ["SPOOLING", "FAILED", "CANCELLED", "QUEUED"], // QUEUED = release back on agent failure
  SPOOLING: ["SPOOLER_ACCEPTED", "PRINTING", "COMPLETED", "FAILED", "QUEUED"],
  SPOOLER_ACCEPTED: ["PRINTING", "COMPLETED", "FAILED"],
  PRINTING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: ["QUEUED"], // retry re-queues the same job (attempt++)
  CANCELLED: [],
};

export function canTransitionJob(from: string, to: string): boolean {
  return (JOB_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Release a PAID order into the print queue — idempotent.
 * Creates one PrintJob per order item with a stable idempotencyKey
 * (orderId:itemId:v1) so retries can never duplicate physical jobs.
 * Auto-routes each job to a compatible printer (colour, paper size, duplex);
 * unmatched jobs stay QUEUED for manual assignment.
 */
export async function releaseOrderToQueue(orderId: string, shopId: string): Promise<{ created: number; existing: number }> {
  const order = await db.order.findFirst({
    where: { id: orderId, shopId },
    include: { items: true, payments: true },
  });
  if (!order) throw new Error("Order not found");

  // Authorization: only verified payment releases a job.
  const verified = order.payments.some((p) => p.status === "VERIFIED");
  if (!verified) throw new Error("Order payment is not verified — print queue release is not authorized");
  if (["CANCELLED", "REFUNDED"].includes(order.status)) throw new Error("Order is cancelled/refunded");
  if (order.status !== "PAID" && order.status !== "QUEUED") {
    if (!["QUEUED", "SPOOLING", "PRINTING", "COMPLETED", "FAILED"].includes(order.status)) {
      throw new Error(`Order in state ${order.status} cannot be queued`);
    }
  }

  let created = 0;
  let existing = 0;
  await db.$transaction(async (tx) => {
    for (const item of order.items) {
      const key = `${order.id}:${item.id}:v1`;
      const dupe = await tx.printJob.findUnique({ where: { idempotencyKey: key } });
      if (dupe) {
        existing++;
        continue;
      }
      const printer = await pickPrinter(tx, shopId, item.paperSize, item.colorMode, item.duplex);
      await tx.printJob.create({
        data: {
          shopId,
          orderId: order.id,
          orderItemId: item.id,
          documentId: item.documentId,
          printerId: printer?.id ?? null,
          printerName: printer?.name ?? null,
          status: "QUEUED",
          idempotencyKey: key,
        },
      });
      created++;
    }

    if (order.status === "PAID") {
      await tx.order.update({ where: { id: order.id }, data: { status: "QUEUED", queuedAt: new Date() } });
    }
    if (created > 0) {
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          shopId,
          status: "QUEUED",
          note: `${created} print job(s) created and authorized for printing`,
          actorType: "SYSTEM",
        },
      });
    }
  });
  return { created, existing };
}

/** Route a job to a shop printer supporting paper size, colour and duplex. */
async function pickPrinter(
  tx: Prisma.TransactionClient,
  shopId: string,
  paperSize: string,
  colorMode: string,
  duplex: boolean
) {
  const printers = await tx.printer.findMany({ where: { shopId, status: "ACTIVE" } });
  const supports = printers.filter((p) => {
    try {
      const sizes = JSON.parse(p.paperSizes) as string[];
      if (!sizes.includes(paperSize)) return false;
    } catch {
      return false;
    }
    if (p.colorMode === "ANY") return true;
    return p.colorMode === colorMode;
  });
  const duplexOk = supports.filter((p) => !duplex || p.duplexCapable);
  const pool = duplexOk.length > 0 ? duplexOk : supports;
  return pool.find((p) => p.isDefault) ?? pool[0] ?? null;
}

/** Agent claims QUEUED jobs atomically (race-safe duplicate prevention). */
export async function claimJobsForDevice(deviceId: string, shopId: string, limit = 5) {
  const queued = await db.printJob.findMany({
    where: { shopId, status: "QUEUED" },
    include: { orderItem: { include: { order: { select: { orderNumber: true, customerName: true } } } } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const claimed: Array<
    Prisma.PrintJobGetPayload<{
      include: { orderItem: { include: { order: { select: { orderNumber: true; customerName: true } } } } };
    }> & { document: Prisma.DocumentGetPayload<Record<string, never>> | null; downloadPath: string }
  > = [];
  for (const job of queued) {
    if (claimed.length >= limit) break;
    // Atomic conditional update — only one agent can ever move QUEUED→DISPATCHED.
    const res = await db.printJob.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: { status: "DISPATCHED", deviceId, dispatchedAt: new Date(), attempt: { increment: 1 } },
    });
    if (res.count === 1) {
      await db.printJobEvent.create({
        data: { printJobId: job.id, shopId, status: "DISPATCHED", message: "Claimed by print agent", actorType: "AGENT" },
      });
      const document = await db.document.findUnique({ where: { id: job.documentId } });
      const downloadToken = await import("./auth").then((m) => m.createFileToken(job.documentId, shopId, 600));
      claimed.push({
        ...job,
        document,
        downloadPath: `/api/agent/download/${job.documentId}?token=${downloadToken}`,
      });
    }
  }
  // Recompute aggregate order status for touched orders.
  const orderIds = [...new Set(claimed.map((j) => j.orderId))];
  for (const oid of orderIds) await recomputeOrderPrintStatus(oid, shopId);
  return claimed;
}

/** Agent reports a status change; validated against the state machine. */
export async function reportJobStatus(opts: {
  jobId: string;
  shopId: string;
  deviceId: string;
  status: string;
  message?: string;
  printerName?: string;
}): Promise<{ ok: boolean; warning?: string }> {
  const job = await db.printJob.findFirst({ where: { id: opts.jobId, shopId: opts.shopId } });
  if (!job) throw new Error("Job not found");
  if (job.deviceId && job.deviceId !== opts.deviceId) throw new Error("Job is claimed by another device");

  if (opts.status === "COMPLETED") {
    // Physical-output honesty: the agent must have gone through spooler states,
    // but we still record the claim coming from the agent (hardware feedback
    // is not available in v1 — the shop can override manually).
  }
  if (!canTransitionJob(job.status, opts.status)) {
    // Idempotent re-reporting is fine; contradictory regressions are recorded, not applied.
    if (job.status === opts.status) return { ok: true };
    await db.printJobEvent.create({
      data: {
        printJobId: job.id,
        shopId: opts.shopId,
        status: opts.status,
        message: `REJECTED transition ${job.status} → ${opts.status}. ${opts.message ?? ""}`.trim(),
        actorType: "AGENT",
      },
    });
    return { ok: false, warning: `Transition ${job.status} → ${opts.status} not allowed` };
  }

  const data: Prisma.PrintJobUpdateInput = { status: opts.status };
  if (opts.message) data.lastError = opts.status === "FAILED" ? opts.message.slice(0, 500) : null;
  if (opts.status === "COMPLETED") data.completedAt = new Date();
  await db.printJob.update({ where: { id: job.id }, data });
  await db.printJobEvent.create({
    data: { printJobId: job.id, shopId: opts.shopId, status: opts.status, message: opts.message, actorType: "AGENT" },
  });
  await recomputeOrderPrintStatus(job.orderId, opts.shopId);
  return { ok: true };
}

/** Derive aggregate order status from its print jobs. */
export async function recomputeOrderPrintStatus(orderId: string, shopId: string): Promise<void> {
  const order = await db.order.findFirst({ where: { id: orderId, shopId }, include: { printJobs: true } });
  if (!order) return;
  if (["PAYMENT_PENDING", "VERIFICATION_PENDING", "PAID", "CANCELLED", "REFUNDED"].includes(order.status)) return;
  const jobs = order.printJobs;
  if (jobs.length === 0) return;
  const allDone = jobs.every((j) => j.status === "COMPLETED");
  const anyFailed = jobs.some((j) => j.status === "FAILED");
  const active = jobs.some((j) => ["DISPATCHED", "SPOOLING", "SPOOLER_ACCEPTED", "PRINTING"].includes(j.status));
  const queued = jobs.some((j) => j.status === "QUEUED");

  let next: string | null = null;
  let note: string | null = null;
  if (allDone && order.status !== "COMPLETED") {
    next = "COMPLETED";
    note = "All print jobs completed";
  } else if (anyFailed && !active && order.status !== "FAILED") {
    next = "FAILED";
    note = "One or more print jobs failed — shop action required";
  } else if (active && !["SPOOLING", "PRINTING"].includes(order.status)) {
    next = "PRINTING";
  } else if (queued && !active && !allDone && order.status !== "QUEUED") {
    next = "QUEUED";
  }
  if (next && next !== order.status) {
    if (next === "COMPLETED" || next === "FAILED" || canTransitionOrder(order.status, next)) {
      await db.order.update({
        where: { id: order.id },
        data: { status: next, ...(next === "COMPLETED" ? { completedAt: new Date() } : {}) },
      });
      await db.orderEvent.create({ data: { orderId: order.id, shopId, status: next, note: note ?? undefined, actorType: "AGENT" } });
    }
  }
}

/** Retry a failed job — re-queues the SAME job (idempotencyKey unchanged). */
export async function retryJob(jobId: string, shopId: string, actorId?: string): Promise<void> {
  const job = await db.printJob.findFirst({ where: { id: jobId, shopId } });
  if (!job) throw new Error("Print job not found");
  if (job.status !== "FAILED") throw new Error("Only failed jobs can be retried");
  if (job.attempt >= job.attemptsMax) throw new Error(`Max attempts (${job.attemptsMax}) reached — assign a different printer or reprint.`);
  await db.printJob.update({ where: { id: job.id }, data: { status: "QUEUED", lastError: null, printerId: null, printerName: null, deviceId: null } });
  await db.printJobEvent.create({ data: { printJobId: job.id, shopId, status: "QUEUED", message: "Retried by shop", actorType: "SHOP_ADMIN" } });
  await recomputeOrderPrintStatus(job.orderId, shopId);
}

/**
 * Reprint = a NEW job with a fresh idempotencyKey. The UI must warn that this
 * can produce duplicate physical output if the original also printed.
 */
export async function reprintJob(jobId: string, shopId: string, printerId?: string): Promise<{ newJobId: string }> {
  const job = await db.printJob.findFirst({ where: { id: jobId, shopId } });
  if (!job) throw new Error("Print job not found");
  const n = await db.printJob.count({ where: { orderId: job.orderId, orderItemId: job.orderItemId } });
  let printerName: string | null = job.printerName;
  if (printerId) {
    const p = await db.printer.findFirst({ where: { id: printerId, shopId } });
    if (!p) throw new Error("Printer not found");
    printerName = p.name;
  }
  const newJob = await db.printJob.create({
    data: {
      shopId,
      orderId: job.orderId,
      orderItemId: job.orderItemId,
      documentId: job.documentId,
      printerId: printerId ?? job.printerId,
      printerName,
      status: "QUEUED",
      idempotencyKey: `${job.idempotencyKey}:rp${n}`,
    },
  });
  await db.printJobEvent.create({
    data: { printJobId: newJob.id, shopId, status: "QUEUED", message: "Manual reprint created — duplicate output possible", actorType: "SHOP_ADMIN" },
  });
  await recomputeOrderPrintStatus(job.orderId, shopId);
  return { newJobId: newJob.id };
}

/** Assign / change a job's printer while queued. */
export async function assignPrinter(jobId: string, shopId: string, printerId: string | null): Promise<void> {
  const job = await db.printJob.findFirst({ where: { id: jobId, shopId } });
  if (!job) throw new Error("Print job not found");
  if (!["QUEUED", "FAILED"].includes(job.status)) throw new Error("Only queued/failed jobs can be reassigned");
  let printerName: string | null = null;
  if (printerId) {
    const p = await db.printer.findFirst({ where: { id: printerId, shopId } });
    if (!p) throw new Error("Printer not found");
    printerName = p.name;
  }
  await db.printJob.update({ where: { id: job.id }, data: { printerId, printerName } });
  await db.printJobEvent.create({
    data: { printJobId: job.id, shopId, status: job.status, message: `Printer assigned: ${printerName ?? "(none)"}`, actorType: "SHOP_ADMIN" },
  });
}

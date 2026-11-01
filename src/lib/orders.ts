// Order service — creation (with server-side pricing + snapshot), state
// transitions, and event history. Only verified payments can release an order
// to the print queue.

import { db } from "./db";
import { Prisma } from "@prisma/client";
import { calcItem, calcOrderTotals, parsePageRanges } from "./pricing";
import { buildUpiUri, paymentReference } from "./upi";
import { PAYMENT_WINDOW_MINUTES } from "./types";
import type { OrderItem, Order } from "@prisma/client";

export async function generateOrderNumber(shopId: string, tx?: Prisma.TransactionClient): Promise<string> {
  const client = tx ?? db;
  const shop = await client.shop.update({
    where: { id: shopId },
    data: { orderCounter: { increment: 1 } },
    select: { slug: true, orderCounter: true },
  });
  const prefix = shop.slug.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase() || "SHOP";
  return `${prefix}-${String(shop.orderCounter).padStart(6, "0")}`;
}

export interface CreateOrderItemInput {
  documentId: string;
  pageSelection?: string | null;
  copies: number;
  paperSize: string;
  colorMode: string;
  duplex: boolean;
  fitToPage?: boolean;
}

export interface CreateOrderInput {
  shopId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  items: CreateOrderItemInput[];
  baseUrl: string; // for UPI QR generation note (no redirect used)
}

export interface CreateOrderResult {
  order: Order;
  items: OrderItem[];
  paymentRef: string;
  upiUri: string;
  totalPaise: number;
}

/**
 * Create an order + its payment atomically.
 * - Pricing is computed server-side from the shop's CURRENT pricing rules and
 *   snapshotted (PricingVersion + per-item priceSnapshot) so later rate changes
 *   never rewrite confirmed order prices.
 * - Payment starts at CREATED and immediately moves to PAYMENT_PENDING with a
 *   UPI URI targeting the SHOP's own UPI ID.
 */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  if (!input.items || input.items.length === 0) throw new Error("Add at least one document to print");

  const shop = await db.shop.findUnique({ where: { id: input.shopId } });
  if (!shop) throw new Error("Shop not found");
  if (shop.status !== "ACTIVE") throw new Error("This shop is not accepting orders right now");
  if (!shop.upiId || !shop.upiPayeeName) throw new Error("This shop has not configured its payment details yet");

  const rules = await db.pricingRule.findMany({ where: { shopId: input.shopId, active: true } });
  if (rules.length === 0) throw new Error("This shop has not configured pricing yet");

  const documents = await db.document.findMany({
    where: { shopId: input.shopId, id: { in: input.items.map((i) => i.documentId) }, scanStatus: "OK" },
  });
  const docMap = new Map(documents.map((d) => [d.id, d]));
  for (const item of input.items) {
    const doc = docMap.get(item.documentId);
    if (!doc) throw new Error("A selected document is missing or was rejected. Please re-upload.");
  }

  // Server-side price calculation — client values are never trusted.
  const calculated = input.items.map((item) => {
    const doc = docMap.get(item.documentId)!;
    const calc = calcItem(
      {
        pageCount: doc.pageCount,
        pageSelection: item.pageSelection,
        copies: item.copies,
        paperSize: item.paperSize,
        colorMode: item.colorMode as "BW" | "COLOR",
        duplex: item.duplex,
      },
      rules
    );
    return { item, doc, calc };
  });

  const totals = calcOrderTotals(
    calculated.map((c) => c.calc.lineTotalPaise),
    shop.additionalChargePaise,
    shop.taxPercent
  );

  const accessCode = paymentReference("").split("-")[1] || Math.random().toString(36).slice(2, 8).toUpperCase();

  const result = await db.$transaction(async (tx) => {
    const pricingVersion = await tx.pricingVersion.create({
      data: {
        shopId: input.shopId,
        version: 1 + (await tx.pricingVersion.count({ where: { shopId: input.shopId } })),
        snapshot: JSON.stringify(rules),
      },
    });

    const orderNumber = await generateOrderNumber(input.shopId, tx);
    const order = await tx.order.create({
      data: {
        shopId: input.shopId,
        orderNumber,
        accessCode,
        customerName: input.customerName?.trim() || null,
        customerPhone: input.customerPhone?.trim() || null,
        status: "PAYMENT_PENDING",
        subtotalPaise: totals.subtotalPaise,
        additionalPaise: totals.additionalPaise,
        taxPaise: totals.taxPaise,
        totalPaise: totals.totalPaise,
        pricingVersionId: pricingVersion.id,
        pricingSnapshot: pricingVersion.snapshot,
      },
    });

    const items: OrderItem[] = [];
    for (const c of calculated) {
      // Validate page selection against the real document page count.
      const pages = parsePageRanges(c.item.pageSelection, c.doc.pageCount);
      const created = await tx.orderItem.create({
        data: {
          orderId: order.id,
          shopId: input.shopId,
          documentId: c.doc.id,
          fileName: c.doc.originalName,
          pageCount: c.doc.pageCount,
          pageSelection: c.item.pageSelection?.trim() || null,
          selectedPages: pages.length,
          copies: c.item.copies,
          paperSize: c.item.paperSize,
          colorMode: c.item.colorMode,
          duplex: c.item.duplex,
          fitToPage: c.item.fitToPage ?? true,
          sides: c.calc.sides,
          sheets: c.calc.sheets,
          lineTotalPaise: c.calc.lineTotalPaise,
          priceSnapshot: JSON.stringify({
            ratePaisePerSide: c.calc.ratePaisePerSide,
            printCostPaise: c.calc.printCostPaise,
            breakdown: c.calc.breakdown,
          }),
        },
      });
      await tx.document.update({ where: { id: c.doc.id }, data: { orderId: order.id } });
      items.push(created);
    }

    // Link anonymous customer record (no login required).
    if (input.customerPhone?.trim() || input.customerName?.trim()) {
      const customer = await tx.customer.create({
        data: { shopId: input.shopId, name: input.customerName?.trim() || null, phone: input.customerPhone?.trim() || null },
      });
      await tx.order.update({ where: { id: order.id }, data: { customerId: customer.id } });
    }

    const reference = paymentReference("PMT");
    const upiUri = buildUpiUri({
      payeeUpiId: shop.upiId,
      payeeName: shop.upiPayeeName,
      amountPaise: totals.totalPaise,
      reference,
      note: `${shop.name} ${orderNumber}`,
    });

    await tx.payment.create({
      data: {
        type: "PRINT_ORDER",
        shopId: input.shopId,
        orderId: order.id,
        reference,
        amountPaise: totals.totalPaise,
        payeeUpiId: shop.upiId,
        payeeName: shop.upiPayeeName,
        upiUri,
        status: "PAYMENT_PENDING",
        expiresAt: new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60000),
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        shopId: input.shopId,
        status: "PAYMENT_PENDING",
        note: `Order created. Payable ₹${(totals.totalPaise / 100).toFixed(2)} via UPI to ${shop.upiId}`,
        actorType: "CUSTOMER",
      },
    });

    return { order, items, paymentRef: reference, upiUri };
  });

  return {
    order: result.order,
    items: result.items,
    paymentRef: result.paymentRef,
    upiUri: result.upiUri,
    totalPaise: totals.totalPaise,
  };
}

export async function addOrderEvent(
  orderId: string,
  shopId: string,
  status: string,
  note?: string,
  actorType: string = "SYSTEM",
  actorId?: string
): Promise<void> {
  await db.orderEvent.create({
    data: { orderId, shopId, status, note, actorType, actorId },
  });
}

/** Allowed order status transitions (state machine). */
const ORDER_TRANSITIONS: Record<string, string[]> = {
  PAYMENT_PENDING: ["VERIFICATION_PENDING", "PAID", "CANCELLED", "EXPIRED_UNUSED"],
  VERIFICATION_PENDING: ["PAID", "PAYMENT_PENDING", "CANCELLED"],
  PAID: ["QUEUED", "REFUNDED"],
  QUEUED: ["SPOOLING", "PRINTING", "COMPLETED", "FAILED", "CANCELLED"],
  SPOOLING: ["PRINTING", "SPOOLER_ACCEPTED", "COMPLETED", "FAILED", "QUEUED"],
  PRINTING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: ["QUEUED", "COMPLETED", "CANCELLED"],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransitionOrder(from: string, to: string): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to);
}

export async function setOrderStatus(
  orderId: string,
  shopId: string,
  to: string,
  opts: { note?: string; actorType?: string; actorId?: string; force?: boolean } = {}
): Promise<void> {
  const order = await db.order.findFirst({ where: { id: orderId, shopId } });
  if (!order) throw new Error("Order not found");
  if (!opts.force && !canTransitionOrder(order.status, to)) {
    throw new Error(`Cannot change order from ${order.status} to ${to}`);
  }
  const data: Prisma.OrderUpdateInput = { status: to };
  if (to === "QUEUED") data.queuedAt = new Date();
  if (to === "COMPLETED") data.completedAt = new Date();
  await db.order.update({ where: { id: orderId }, data });
  await addOrderEvent(orderId, shopId, to, opts.note, opts.actorType ?? "SYSTEM", opts.actorId);
}

/** Expire stale unpaid orders + their payments (sweep). */
export async function sweepExpiredPayments(): Promise<number> {
  const stale = await db.payment.findMany({
    where: { status: "PAYMENT_PENDING", expiresAt: { lt: new Date() } },
    select: { id: true, orderId: true, shopId: true },
  });
  let count = 0;
  for (const p of stale) {
    await db.payment.update({ where: { id: p.id }, data: { status: "EXPIRED" } });
    if (p.orderId) {
      const order = await db.order.findFirst({ where: { id: p.orderId, shopId: p.shopId, status: "PAYMENT_PENDING" } });
      if (order) {
        await db.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
        await addOrderEvent(order.id, order.shopId, "CANCELLED", "Payment window expired", "SYSTEM");
      }
    }
    count++;
  }
  return count;
}

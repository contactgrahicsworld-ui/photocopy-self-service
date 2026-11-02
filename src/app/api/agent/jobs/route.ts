import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, ApiError, rateLimit } from "@/lib/guards";
import { hashDeviceToken } from "@/lib/auth";
import { claimJobsForDevice } from "@/lib/printqueue";

async function deviceFromRequest(req: NextRequest) {
  const token = req.headers.get("x-device-token")?.trim();
  if (!token) throw new ApiError(401, "Device token required");
  const device = await db.printDevice.findUnique({ where: { tokenHash: hashDeviceToken(token) } });
  if (!device || device.status !== "ACTIVE") throw new ApiError(401, "Device token invalid or revoked");
  return device;
}

// Agent poll: atomically claim authorized QUEUED jobs for its shop.
// Each claim is race-safe (QUEUED→DISPATCHED conditional update) so two
// devices — or the same device twice — can never double-print a job.
export const GET = handler(async (req: NextRequest) => {
  rateLimit(req, "agent-poll", 600, 60_000);
  const device = await deviceFromRequest(req);
  await db.printDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  const claimed = await claimJobsForDevice(device.id, device.shopId, 5);
  return NextResponse.json({
    jobs: claimed.map((j) => ({
      id: j.id,
      idempotencyKey: j.idempotencyKey,
      orderId: j.orderId,
      orderNumber: j.orderItem.order.orderNumber,
      fileName: j.document?.originalName ?? "(document missing)",
      documentId: j.documentId,
      downloadPath: j.downloadPath,
      downloadTokenTtlSeconds: 600,
      printerName: j.printerName,
      // print settings for the agent to apply
      pages: j.orderItem.pageSelection ?? null, // null = all pages
      pageCount: j.orderItem.pageCount,
      selectedPages: j.orderItem.selectedPages,
      copies: j.orderItem.copies,
      paperSize: j.orderItem.paperSize,
      colorMode: j.orderItem.colorMode,
      duplex: j.orderItem.duplex,
      fitToPage: j.orderItem.fitToPage,
    })),
    serverTime: new Date().toISOString(),
    pollAfterSeconds: 5,
  });
});

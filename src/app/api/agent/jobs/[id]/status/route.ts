import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, ApiError, rateLimit } from "@/lib/guards";
import { hashDeviceToken } from "@/lib/auth";
import { reportJobStatus } from "@/lib/printqueue";

// Agent reports job progress. States are validated server-side; contradictory
// or duplicate reports are recorded as events but never corrupt the state.
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  rateLimit(req, "agent-status", 600, 60_000);
  const { id } = await params;
  const token = req.headers.get("x-device-token")?.trim();
  if (!token) throw new ApiError(401, "Device token required");
  const device = await db.printDevice.findUnique({ where: { tokenHash: hashDeviceToken(token) } });
  if (!device || device.status !== "ACTIVE") throw new ApiError(401, "Device token invalid or revoked");

  const body = await req.json().catch(() => null);
  const status = String(body?.status ?? "");
  const VALID = ["DISPATCHED", "SPOOLING", "SPOOLER_ACCEPTED", "PRINTING", "COMPLETED", "FAILED", "QUEUED"];
  if (!VALID.includes(status)) throw new ApiError(400, `Invalid status "${status}"`);
  const message = typeof body?.message === "string" ? body.message.slice(0, 500) : undefined;
  const printerName = typeof body?.printerName === "string" ? body.printerName.slice(0, 120) : undefined;

  const result = await reportJobStatus({
    jobId: id,
    shopId: device.shopId, // tenant scope from the device token
    deviceId: device.id,
    status,
    message,
    printerName,
  });
  return NextResponse.json({ ok: result.ok, warning: result.warning ?? null });
});

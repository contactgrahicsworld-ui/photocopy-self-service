import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, ApiError, rateLimit } from "@/lib/guards";
import { generateDeviceToken, hashDeviceToken } from "@/lib/auth";
import { audit } from "@/lib/audit";

/**
 * Agent authentication.
 *
 * Mode 1 (pairing): { pairingCode } → one-time exchange for a device token.
 * The token is returned ONCE and stored only as SHA-256.
 * Mode 2 (session): { deviceToken } → validate + heartbeat, returns shop info.
 */
export const POST = handler(async (req: NextRequest) => {
  rateLimit(req, "agent-pair", 30, 60_000);
  const body = await req.json().catch(() => null);
  const code = String(body?.pairingCode ?? "").trim().toUpperCase();
  const deviceToken = String(body?.deviceToken ?? "").trim();
  const platform = String(body?.platform ?? "windows").slice(0, 30);
  const agentVersion = String(body?.agentVersion ?? "").slice(0, 20);
  const ip = req.headers.get("x-forwarded-for") ?? null;

  if (deviceToken) {
    const device = await db.printDevice.findUnique({ where: { tokenHash: hashDeviceToken(deviceToken) } });
    if (!device || device.status !== "ACTIVE") throw new ApiError(401, "Device token invalid or revoked");
    await db.printDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), lastIp: ip } });
    const shop = await db.shop.findUnique({ where: { id: device.shopId }, select: { name: true, slug: true } });
    return NextResponse.json({ ok: true, mode: "token", shop, deviceId: device.id, deviceName: device.name, agentVersion });
  }

  if (!code) throw new ApiError(400, "Pairing code or device token required");
  const device = await db.printDevice.findUnique({ where: { pairingCode: code } });
  if (!device || !device.pairingExpiresAt || device.pairingExpiresAt.getTime() < Date.now()) {
    throw new ApiError(400, "Invalid or expired pairing code. Generate a new one in Shop Dashboard → Printers & Devices.");
  }
  if (device.status !== "PENDING") throw new ApiError(400, "This pairing code was already used");

  const token = generateDeviceToken();
  await db.printDevice.update({
    where: { id: device.id },
    data: { status: "ACTIVE", tokenHash: hashDeviceToken(token), pairingCode: null, pairingExpiresAt: null, platform, lastSeenAt: new Date(), lastIp: ip },
  });
  const shop = await db.shop.findUnique({ where: { id: device.shopId }, select: { name: true, slug: true } });
  await audit({ actorType: "AGENT", shopId: device.shopId, action: "AGENT_PAIRED", entityType: "PrintDevice", entityId: device.id, meta: { platform, agentVersion }, ip });

  return NextResponse.json({ ok: true, mode: "paired", deviceToken: token, shop, deviceId: device.id, deviceName: device.name });
});

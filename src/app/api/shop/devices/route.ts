import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin, ApiError } from "@/lib/guards";
import { generateDeviceToken, hashDeviceToken } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const GET = handler(async () => {
  const session = await requireShopAdmin();
  const devices = await db.printDevice.findMany({
    where: { shopId: session.shopId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, platform: true, status: true, lastSeenAt: true, lastIp: true, createdAt: true, revokedAt: true },
  });
  return NextResponse.json({ devices });
});

// Register a new print agent device → returns a ONE-TIME pairing code (15 min).
// The device token itself is issued only to the agent at pairing time and is
// never stored in plain text (SHA-256 only).
export const POST = handler(async (req: NextRequest) => {
  const session = await requireShopAdmin();
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim().slice(0, 80) || "Windows Print Agent";
  const platform = String(body?.platform ?? "windows").slice(0, 30);

  const pairingCode = (Math.random().toString(36) + Math.random().toString(36)).replace(/[^a-z0-9]/g, "").slice(0, 8).toUpperCase();
  const device = await db.printDevice.create({
    data: {
      shopId: session.shopId,
      name,
      platform,
      pairingCode,
      pairingExpiresAt: new Date(Date.now() + 15 * 60000),
      status: "PENDING",
    },
  });
  await audit({ actorType: "SHOP_ADMIN", actorId: session.uid, shopId: session.shopId, action: "PRINT_DEVICE_REGISTERED", entityType: "PrintDevice", entityId: device.id, meta: { name } });
  return NextResponse.json({ ok: true, deviceId: device.id, pairingCode, pairingValidMinutes: 15 });
});

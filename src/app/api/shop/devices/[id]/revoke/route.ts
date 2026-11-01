import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin, ApiError } from "@/lib/guards";
import { audit } from "@/lib/audit";

// Revoke a device — its token stops working immediately (agent heartbeats fail).
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireShopAdmin();
  const device = await db.printDevice.findFirst({ where: { id, shopId: session.shopId } });
  if (!device) throw new ApiError(404, "Device not found");
  await db.printDevice.update({ where: { id: device.id }, data: { status: "REVOKED", revokedAt: new Date() } });
  await audit({ actorType: "SHOP_ADMIN", actorId: session.uid, shopId: session.shopId, action: "PRINT_DEVICE_REVOKED", entityType: "PrintDevice", entityId: device.id });
  return NextResponse.json({ ok: true });
});

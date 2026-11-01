import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin, ApiError } from "@/lib/guards";
import { setOrderStatus } from "@/lib/orders";

// Shop admin cancels an order (only while payment is pending/unverified).
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireShopAdmin();
  const order = await db.order.findFirst({ where: { id, shopId: session.shopId } });
  if (!order) throw new ApiError(404, "Order not found");
  if (!["PAYMENT_PENDING", "VERIFICATION_PENDING", "FAILED"].includes(order.status)) {
    throw new ApiError(400, `Order in state ${order.status} cannot be cancelled here`);
  }
  await db.payment.updateMany({ where: { orderId: order.id, status: { in: ["CREATED", "PAYMENT_PENDING", "VERIFICATION_PENDING"] } }, data: { status: "EXPIRED" } });
  await setOrderStatus(order.id, session.shopId, "CANCELLED", { note: "Cancelled by shop", actorType: "SHOP_ADMIN", actorId: session.uid, force: true });
  return NextResponse.json({ ok: true });
});

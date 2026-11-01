import { NextRequest, NextResponse } from "next/server";
import { handler, requireShopAdmin, ApiError } from "@/lib/guards";
import { rejectPayment } from "@/lib/payments";
import { addOrderEvent } from "@/lib/orders";
import { db } from "@/lib/db";

// Shop admin rejects a submitted UTR (e.g. no matching credit). Optionally
// re-open the payment so the customer can submit a corrected UTR.
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id: paymentId } = await params;
  const session = await requireShopAdmin();
  const body = await req.json().catch(() => null);
  const reason = String(body?.reason ?? "").trim();
  const requeue = !!body?.requeue;
  if (reason.length < 3) throw new ApiError(400, "Give a short reason (shown to the customer)");

  await rejectPayment({
    paymentId,
    verifierRole: "SHOP_ADMIN",
    verifierSessionShopId: session.shopId,
    verifierUserId: session.uid,
    reason,
    requeue,
  });

  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (payment?.orderId) {
    if (requeue) {
      await db.order.update({ where: { id: payment.orderId }, data: { status: "PAYMENT_PENDING" } });
      await addOrderEvent(payment.orderId, payment.shopId, "PAYMENT_PENDING", `UTR rejected: ${reason}`, "SHOP_ADMIN", session.uid);
    } else {
      await db.order.update({ where: { id: payment.orderId }, data: { status: "CANCELLED" } });
      await addOrderEvent(payment.orderId, payment.shopId, "CANCELLED", `Payment rejected: ${reason}`, "SHOP_ADMIN", session.uid);
    }
  }
  return NextResponse.json({ ok: true });
});

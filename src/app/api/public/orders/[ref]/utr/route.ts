import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, rateLimit, ApiError } from "@/lib/guards";
import { submitUtr } from "@/lib/payments";
import { addOrderEvent } from "@/lib/orders";
import { ORDER_STATUS_LABELS } from "@/lib/types";

// Customer submits UTR for their order's payment.
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ ref: string }> }) => {
  const { ref } = await params;
  rateLimit(req, "utr-submit", 10, 60_000);
  const body = await req.json().catch(() => null);
  const code = String(body?.code ?? "").trim().toUpperCase();
  const utr = String(body?.utr ?? "").trim();
  if (!code) throw new ApiError(403, "Order access code required");

  const order = await db.order.findFirst({
    where: { orderNumber: ref, accessCode: code },
    include: { payments: { where: { type: "PRINT_ORDER" } } },
  });
  if (!order) throw new ApiError(404, "Order not found");
  const payment = order.payments[0];
  if (!payment) throw new ApiError(404, "Payment not found for this order");

  await submitUtr({ paymentId: payment.id, utr, shopIdScope: order.shopId, actorType: "CUSTOMER" });

  if (order.status === "PAYMENT_PENDING") {
    await db.order.update({ where: { id: order.id }, data: { status: "VERIFICATION_PENDING" } });
    await addOrderEvent(order.id, order.shopId, "VERIFICATION_PENDING", `UTR submitted: ${utr.toUpperCase()}`, "CUSTOMER");
  }

  return NextResponse.json({ ok: true, status: "VERIFICATION_PENDING", statusLabel: ORDER_STATUS_LABELS.VERIFICATION_PENDING });
});

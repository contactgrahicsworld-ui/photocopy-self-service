import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin, ApiError } from "@/lib/guards";
import { submitUtr } from "@/lib/payments";

// Shop submits UTR for its own subscription payment.
export const POST = handler(async (req: NextRequest) => {
  const session = await requireShopAdmin();
  const body = await req.json().catch(() => null);
  const reference = String(body?.reference ?? "");
  const payment = await db.payment.findUnique({ where: { reference } });
  if (!payment || payment.shopId !== session.shopId) throw new ApiError(404, "Payment not found");
  await submitUtr({ paymentId: payment.id, utr: String(body?.utr ?? ""), shopIdScope: session.shopId, actorType: "SHOP_ADMIN" });
  return NextResponse.json({ ok: true });
});

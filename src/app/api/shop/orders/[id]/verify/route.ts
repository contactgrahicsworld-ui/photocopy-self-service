import { NextRequest, NextResponse } from "next/server";
import { handler, requireShopAdmin, getClientIp } from "@/lib/guards";
import { verifyPayment } from "@/lib/payments";

// Shop admin confirms customer payment against their own bank/UPI app.
// This is the ONLY action that releases an order into the print queue.
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id: paymentId } = await params;
  const session = await requireShopAdmin();
  const body = await req.json().catch(() => null);
  const amountPaise = Number(body?.amountConfirmedPaise);
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    return NextResponse.json({ error: "Confirm the exact credited amount in paise" }, { status: 400 });
  }
  const result = await verifyPayment({
    paymentId,
    verifierRole: "SHOP_ADMIN",
    verifierSessionShopId: session.shopId,
    verifierUserId: session.uid,
    verifierName: session.name,
    amountConfirmedPaise: amountPaise,
    ip: getClientIp(req),
  });
  return NextResponse.json({ ok: true, ...result });
});

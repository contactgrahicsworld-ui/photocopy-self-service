import { NextRequest, NextResponse } from "next/server";
import { handler, requireSuperAdmin, ApiError, getClientIp } from "@/lib/guards";
import { verifyPayment } from "@/lib/payments";

// Verify a subscription payment — only Super Admin (owner of platform VPA).
// Confirms the EXACT expected amount was credited in their own bank/UPI app.
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireSuperAdmin();
  const body = await req.json().catch(() => null);
  const amountPaise = Number(body?.amountConfirmedPaise);
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new ApiError(400, "Confirm the exact credited amount");
  const result = await verifyPayment({
    paymentId: id,
    verifierRole: "SUPER_ADMIN",
    verifierSessionShopId: null,
    verifierUserId: session.uid,
    verifierName: session.name ?? undefined,
    amountConfirmedPaise: amountPaise,
    ip: getClientIp(req),
  });
  return NextResponse.json({ ok: true, ...result });
});

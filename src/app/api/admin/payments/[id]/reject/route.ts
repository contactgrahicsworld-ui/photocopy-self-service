import { NextRequest, NextResponse } from "next/server";
import { handler, requireSuperAdmin, ApiError, getClientIp } from "@/lib/guards";
import { rejectPayment } from "@/lib/payments";

// Reject a subscription UTR (no matching credit). requeue=true lets the shop
// submit a corrected UTR.
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireSuperAdmin();
  const body = await req.json().catch(() => null);
  const reason = String(body?.reason ?? "").trim();
  if (reason.length < 3) throw new ApiError(400, "Give a short reason");
  await rejectPayment({
    paymentId: id,
    verifierRole: "SUPER_ADMIN",
    verifierSessionShopId: null,
    verifierUserId: session.uid,
    reason,
    requeue: !!body?.requeue,
  });
  return NextResponse.json({ ok: true });
});

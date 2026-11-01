import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireSuperAdmin, ApiError } from "@/lib/guards";
import { verifyPayment } from "@/lib/payments";
import { upiQrDataUrl } from "@/lib/upi";
import { getClientIp } from "@/lib/guards";

// Subscription payments awaiting Super Admin verification (their own bank).
export const GET = handler(async (req: NextRequest) => {
  await requireSuperAdmin();
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const payments = await db.payment.findMany({
    where: { type: "SUBSCRIPTION", ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { shop: { select: { name: true, slug: true } }, plan: { select: { code: true, name: true } } },
  });
  const enriched = [];
  for (const p of payments) {
    if (["PAYMENT_PENDING", "VERIFICATION_PENDING"].includes(p.status)) {
      enriched.push({ ...p, qrDataUrl: await upiQrDataUrl(p.upiUri) });
    } else {
      enriched.push({ ...p, qrDataUrl: null });
    }
  }
  return NextResponse.json({
    payments: enriched.map((p) => ({
      id: p.id,
      shopName: p.shop.name,
      shopSlug: p.shop.slug,
      planCode: p.plan?.code,
      planName: p.plan?.name,
      reference: p.reference,
      amountPaise: p.amountPaise,
      payeeUpiId: p.payeeUpiId,
      utr: p.utr,
      status: p.status,
      createdAt: p.createdAt,
      utrSubmittedAt: p.utrSubmittedAt,
      verifiedAt: p.verifiedAt,
      rejectionReason: p.rejectionReason,
      qrDataUrl: p.qrDataUrl,
    })),
  });
});

// (Verification POST lives at /api/admin/payments/[id]/verify — this file only lists.)

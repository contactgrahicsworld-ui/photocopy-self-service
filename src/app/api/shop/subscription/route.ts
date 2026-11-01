import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin, ApiError } from "@/lib/guards";
import { getShopLimits } from "@/lib/subscriptions";
import { createSubscriptionPayment } from "@/lib/payments";
import { upiQrDataUrl } from "@/lib/upi";

export const GET = handler(async () => {
  const session = await requireShopAdmin();
  const limits = await getShopLimits(session.shopId);
  const payments = await db.payment.findMany({
    where: { shopId: session.shopId, type: "SUBSCRIPTION" },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { plan: true },
  });
  const platformUpiSetting = await db.platformSetting.findUnique({ where: { key: "upi" } });
  const platformUpi = platformUpiSetting ? JSON.parse(platformUpiSetting.value) : { vpa: "", payeeName: "" };
  const plans = await db.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  return NextResponse.json({
    subscription: limits,
    plans: plans.map((p) => ({ id: p.id, code: p.code, name: p.name, pricePaise: p.pricePaise, durationDays: p.durationDays, features: p.features ? JSON.parse(p.features) : [] })),
    platformUpiConfigured: !!platformUpi.vpa,
    recentPayments: payments.map((p) => ({ id: p.id, reference: p.reference, planCode: p.plan?.code, amountPaise: p.amountPaise, status: p.status, utr: p.utr, createdAt: p.createdAt })),
  });
});

// Shop selects a plan → payment request with PLATFORM UPI QR.
export const POST = handler(async (req: NextRequest) => {
  const session = await requireShopAdmin();
  const body = await req.json().catch(() => null);
  const planId = String(body?.planId ?? "");
  const setting = await db.platformSetting.findUnique({ where: { key: "upi" } });
  const upi = setting ? JSON.parse(setting.value) : { vpa: "", payeeName: "" };
  if (!upi.vpa || !upi.payeeName) throw new ApiError(400, "Platform UPI is not configured yet. Please contact support.");

  const pay = await createSubscriptionPayment({
    shopId: session.shopId,
    planId,
    platformUpiId: upi.vpa,
    platformPayeeName: upi.payeeName,
  });
  const qrDataUrl = await upiQrDataUrl(pay.upiUri);
  return NextResponse.json({ ok: true, ...pay, qrDataUrl, instructions: upi.instructions ?? null });
});

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireSuperAdmin, ApiError, getClientIp } from "@/lib/guards";
import { isValidUpiId } from "@/lib/upi";
import { audit } from "@/lib/audit";
import { activateSubscription } from "@/lib/subscriptions";

export const GET = handler(async () => {
  await requireSuperAdmin();
  const settings = await db.platformSetting.findMany();
  const map: Record<string, unknown> = {};
  for (const s of settings) map[s.key] = JSON.parse(s.value);
  return NextResponse.json({ settings: map });
});

// Platform settings: Super Admin UPI (subscription collections), announcement.
export const PUT = handler(async (req: NextRequest) => {
  const session = await requireSuperAdmin();
  const body = await req.json().catch(() => null);
  if (body?.upi) {
    const vpa = String(body.upi.vpa ?? "").trim();
    const payeeName = String(body.upi.payeeName ?? "").trim();
    if (vpa && !isValidUpiId(vpa)) throw new ApiError(400, "Invalid UPI ID format");
    if (vpa && !payeeName) throw new ApiError(400, "Payee name is required with a UPI ID");
    await db.platformSetting.upsert({
      where: { key: "upi" },
      update: { value: JSON.stringify({ vpa, payeeName, instructions: String(body.upi.instructions ?? "").slice(0, 500) }) },
      create: { key: "upi", value: JSON.stringify({ vpa, payeeName, instructions: String(body.upi.instructions ?? "Pay using any UPI app, then submit the UTR.") }) },
    });
    await audit({ actorType: "SUPER_ADMIN", actorId: session.uid, action: "PLATFORM_UPI_UPDATED", meta: { vpa }, ip: getClientIp(req) });
  }
  if (body?.announcement !== undefined) {
    await db.platformSetting.upsert({
      where: { key: "announcement" },
      update: { value: JSON.stringify({ text: String(body.announcement.text ?? "").slice(0, 300) }) },
      create: { key: "announcement", value: JSON.stringify({ text: String(body.announcement.text ?? "").slice(0, 300) }) },
    });
  }
  return NextResponse.json({ ok: true });
});

// Manual subscription activation (offline payment) / extension.
export const POST = handler(async (req: NextRequest) => {
  const session = await requireSuperAdmin();
  const body = await req.json().catch(() => null);
  const shopId = String(body?.shopId ?? "");
  const planId = String(body?.planId ?? "");
  const dbShop = await db.shop.findUnique({ where: { id: shopId } });
  if (!dbShop) throw new ApiError(404, "Shop not found");
  const plan = await db.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new ApiError(404, "Plan not found");
  await activateSubscription(shopId, planId);
  await audit({ actorType: "SUPER_ADMIN", actorId: session.uid, shopId, action: "SUBSCRIPTION_MANUALLY_ACTIVATED", entityType: "SubscriptionPlan", entityId: planId, meta: { planCode: plan.code }, ip: getClientIp(req) });
  return NextResponse.json({ ok: true });
});

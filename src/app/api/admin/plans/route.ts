import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireSuperAdmin, ApiError } from "@/lib/guards";
import { audit } from "@/lib/audit";

export const GET = handler(async () => {
  await requireSuperAdmin();
  const plans = await db.subscriptionPlan.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json({ plans: plans.map((p) => ({ ...p, features: p.features ? JSON.parse(p.features) : [] })) });
});

export const POST = handler(async (req: NextRequest) => {
  const session = await requireSuperAdmin();
  const body = await req.json().catch(() => null);
  const code = String(body?.code ?? "").trim().toUpperCase();
  const name = String(body?.name ?? "").trim();
  const pricePaise = Number(body?.pricePaise);
  if (!/^[A-Z0-9_]{2,20}$/.test(code)) throw new ApiError(400, "Plan code must be 2–20 chars (A-Z, 0-9, _)");
  if (!name) throw new ApiError(400, "Plan name required");
  if (!Number.isInteger(pricePaise) || pricePaise < 0) throw new ApiError(400, "Price must be a positive integer of paise");
  // durationDays null => LIFETIME behaviour (never expires)
  const durationDays = body?.durationDays == null || body.durationDays === "" ? null : Number(body.durationDays);
  if (durationDays != null && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 36500)) {
    throw new ApiError(400, "Duration must be 1–36500 days or empty (lifetime)");
  }
  const plan = await db.subscriptionPlan.create({
    data: {
      code, name, pricePaise, durationDays,
      printerLimit: body?.printerLimit ? Number(body.printerLimit) : null,
      storageLimitMb: body?.storageLimitMb ? Number(body.storageLimitMb) : null,
      monthlyOrderLimit: body?.monthlyOrderLimit ? Number(body.monthlyOrderLimit) : null,
      features: Array.isArray(body?.features) ? JSON.stringify(body.features) : null,
      sortOrder: Number(body?.sortOrder ?? 99),
    },
  });
  await audit({ actorType: "SUPER_ADMIN", actorId: session.uid, action: "PLAN_CREATED", entityType: "SubscriptionPlan", entityId: plan.id, meta: { code } });
  return NextResponse.json({ ok: true, plan });
});

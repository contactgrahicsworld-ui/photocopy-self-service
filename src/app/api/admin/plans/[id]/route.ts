import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireSuperAdmin, ApiError } from "@/lib/guards";
import { audit } from "@/lib/audit";

export const PATCH = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireSuperAdmin();
  const body = await req.json().catch(() => null);
  const plan = await db.subscriptionPlan.findUnique({ where: { id } });
  if (!plan) throw new ApiError(404, "Plan not found");

  const data: Record<string, unknown> = {};
  if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (body?.pricePaise !== undefined) {
    const p = Number(body.pricePaise);
    if (!Number.isInteger(p) || p < 0) throw new ApiError(400, "Invalid price");
    data.pricePaise = p;
  }
  if (body?.durationDays !== undefined) {
    data.durationDays = body.durationDays == null || body.durationDays === "" ? null : Number(body.durationDays);
    if (data.durationDays != null && (!Number.isInteger(data.durationDays) || (data.durationDays as number) < 1)) throw new ApiError(400, "Invalid duration");
  }
  for (const k of ["printerLimit", "storageLimitMb", "monthlyOrderLimit"] as const) {
    if (body?.[k] !== undefined) data[k] = body[k] === null || body[k] === "" ? null : Number(body[k]);
  }
  if (typeof body?.isActive === "boolean") data.isActive = body.isActive;
  if (Array.isArray(body?.features)) data.features = JSON.stringify(body.features);

  const updated = await db.subscriptionPlan.update({ where: { id: plan.id }, data });
  await audit({ actorType: "SUPER_ADMIN", actorId: session.uid, action: "PLAN_UPDATED", entityType: "SubscriptionPlan", entityId: plan.id, meta: { fields: Object.keys(data) } });
  return NextResponse.json({ ok: true, plan: updated });
});

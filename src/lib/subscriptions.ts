// Subscription lifecycle service.
// Plans: TRIAL(7d) M3 M6 Y1 LIFETIME. Lifetime subscriptions NEVER expire.

import { db } from "./db";
import { Prisma } from "@prisma/client";

export async function getActiveSubscription(shopId: string) {
  const sub = await db.subscription.findFirst({
    where: { shopId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });
  if (!sub) return null;
  // Lazy expiry evaluation (sweep also runs via /api/cron/sweep)
  if (!sub.isLifetime && sub.expiresAt && sub.expiresAt.getTime() < Date.now()) {
    await db.subscription.update({ where: { id: sub.id }, data: { status: "EXPIRED" } });
    return null;
  }
  return sub;
}

export async function ensureTrialSubscription(shopId: string): Promise<void> {
  const existing = await db.subscription.findFirst({ where: { shopId } });
  if (existing) return;
  const trial = await db.subscriptionPlan.findUnique({ where: { code: "TRIAL" } });
  if (!trial) return;
  await db.subscription.create({
    data: {
      shopId,
      planId: trial.id,
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + trial.durationDays! * 86400000),
      status: "ACTIVE",
    },
  });
}

/**
 * Activate a subscription for a shop. Supersedes any previous subscription.
 * plan.durationDays === null  =>  lifetime, expiresAt stays null forever.
 */
export async function activateSubscription(shopId: string, planId: string): Promise<void> {
  const plan = await db.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new Error("Plan not found");
  await db.$transaction(async (tx) => {
    await tx.subscription.updateMany({ where: { shopId, status: "ACTIVE" }, data: { status: "CANCELLED" } });
    await tx.subscription.create({
      data: {
        shopId,
        planId,
        startsAt: new Date(),
        expiresAt: plan.durationDays == null ? null : new Date(Date.now() + plan.durationDays * 86400000),
        isLifetime: plan.durationDays == null,
        status: "ACTIVE",
      },
    });
    if (plan.durationDays == null) {
      // Lifetime: make sure no expiry sweep can ever touch it.
      await tx.subscription.updateMany({ where: { shopId, isLifetime: true }, data: { status: "ACTIVE" } });
    }
  });
}

/** Expire due subscriptions. Returns count. Lifetime subs are untouched. */
export async function sweepExpiredSubscriptions(): Promise<number> {
  const due = await db.subscription.findMany({
    where: { status: "ACTIVE", isLifetime: false, expiresAt: { lt: new Date() } },
    select: { id: true },
  });
  if (due.length === 0) return 0;
  await db.subscription.updateMany({ where: { id: { in: due.map((d) => d.id) } }, data: { status: "EXPIRED" } });
  return due.length;
}

/** Plan limit checks used by ordering & shop settings. */
export async function getShopLimits(shopId: string) {
  const sub = await getActiveSubscription(shopId);
  const plan = sub?.plan ?? null;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthlyOrders = await db.order.count({ where: { shopId, createdAt: { gte: monthStart } } });
  const printers = await db.printer.count({ where: { shopId, status: { not: "RETIRED" } } });
  return {
    hasActiveSubscription: !!sub,
    plan: plan
      ? {
          code: plan.code,
          name: plan.name,
          isLifetime: plan.durationDays == null,
          expiresAt: plan.durationDays == null ? null : sub!.expiresAt,
          printerLimit: plan.printerLimit,
          storageLimitMb: plan.storageLimitMb,
          monthlyOrderLimit: plan.monthlyOrderLimit,
          features: plan.features ? (JSON.parse(plan.features) as string[]) : [],
        }
      : null,
    usage: { monthlyOrders, printers },
  };
}

export function planLimitReached(limit: number | null | undefined, current: number): boolean {
  if (limit == null) return false; // null = unlimited
  return current >= limit;
}

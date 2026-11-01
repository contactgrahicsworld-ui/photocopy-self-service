import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireSuperAdmin } from "@/lib/guards";
import { sweepExpiredSubscriptions } from "@/lib/subscriptions";
import { sweepExpiredPayments } from "@/lib/orders";

// Platform overview: revenue, shops, health. Platform-level only — no
// customer document contents and no per-shop printing collections.
export const GET = handler(async () => {
  await requireSuperAdmin();
  await Promise.all([sweepExpiredSubscriptions(), sweepExpiredPayments()]);

  const [shopCount, activeShops, suspendedShops, totalOrders, ordersToday, docs, docsAgg] = await Promise.all([
    db.shop.count(),
    db.shop.count({ where: { status: "ACTIVE" } }),
    db.shop.count({ where: { status: "SUSPENDED" } }),
    db.order.count(),
    db.order.count({ where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    db.document.findMany({ select: { sizeBytes: true } }),
    db.payment.aggregate({ where: { type: "SUBSCRIPTION", status: "VERIFIED" }, _sum: { amountPaise: true }, _count: true }),
  ]);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthRevenue = await db.payment.aggregate({
    where: { type: "SUBSCRIPTION", status: "VERIFIED", verifiedAt: { gte: monthStart } },
    _sum: { amountPaise: true },
  });

  const pendingSubPayments = await db.payment.count({ where: { type: "SUBSCRIPTION", status: "VERIFICATION_PENDING" } });
  const activeSubs = await db.subscription.count({ where: { status: "ACTIVE" } });
  const storageBytes = docs.reduce((a, d) => a + d.sizeBytes, 0);

  const recentShops = await db.shop.findMany({
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { id: true, slug: true, name: true, status: true, createdAt: true },
  });

  return NextResponse.json({
    shops: { total: shopCount, active: activeShops, suspended: suspendedShops },
    orders: { total: totalOrders, today: ordersToday },
    subscriptionRevenue: {
      totalPaise: docsAgg._sum.amountPaise ?? 0,
      thisMonthPaise: monthRevenue._sum.amountPaise ?? 0,
      verifiedCount: docsAgg._count,
    },
    pendingSubscriptionVerifications: pendingSubPayments,
    activeSubscriptions: activeSubs,
    storageBytes,
    documentCount: docs.length,
    recentShops,
    health: { db: "connected", time: new Date().toISOString() },
  });
});

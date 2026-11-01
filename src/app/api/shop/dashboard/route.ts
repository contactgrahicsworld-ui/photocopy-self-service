import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin, ApiError } from "@/lib/guards";
import { getShopLimits } from "@/lib/subscriptions";
import { sweepExpiredPayments } from "@/lib/orders";

// Shop dashboard summary. Tenant scope = session.shopId, always.
export const GET = handler(async () => {
  const session = await requireShopAdmin();
  const shopId = session.shopId;
  await sweepExpiredPayments(); // lazy sweep keeps the queue honest

  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new ApiError(404, "Shop not found");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [verifiedToday, pendingVerification, activeQueue, failedJobs, newOrders, ordersToday] = await Promise.all([
    db.payment.aggregate({ where: { shopId, type: "PRINT_ORDER", status: "VERIFIED", verifiedAt: { gte: todayStart } }, _sum: { amountPaise: true } }),
    db.order.count({ where: { shopId, status: "VERIFICATION_PENDING" } }),
    db.printJob.count({ where: { shopId, status: { in: ["QUEUED", "DISPATCHED", "SPOOLING", "SPOOLER_ACCEPTED", "PRINTING"] } } }),
    db.printJob.count({ where: { shopId, status: "FAILED" } }),
    db.order.count({ where: { shopId, status: "PAYMENT_PENDING", createdAt: { gte: todayStart } } }),
    db.order.count({ where: { shopId, createdAt: { gte: todayStart } } }),
  ]);

  const recentOrders = await db.order.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, orderNumber: true, status: true, totalPaise: true, customerName: true, createdAt: true },
  });

  const limits = await getShopLimits(shopId);

  return NextResponse.json({
    shop: { name: shop.name, slug: shop.slug, status: shop.status, upiConfigured: !!shop.upiId },
    stats: {
      collectionsTodayPaise: verifiedToday._sum.amountPaise ?? 0,
      ordersToday,
      newOrdersToday: newOrders,
      pendingVerification,
      activeQueue,
      failedJobs,
    },
    recentOrders,
    subscription: limits,
  });
});

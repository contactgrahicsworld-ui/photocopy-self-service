import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin, ApiError } from "@/lib/guards";
import { sweepExpiredPayments } from "@/lib/orders";

export const GET = handler(async (req: NextRequest) => {
  const session = await requireShopAdmin();
  await sweepExpiredPayments();
  const status = req.nextUrl.searchParams.get("status") || undefined;
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1"));
  const pageSize = 20;

  const where = { shopId: session.shopId, ...(status ? { status } : {}) };
  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { payments: { where: { type: "PRINT_ORDER" }, select: { id: true, utr: true, status: true, reference: true } }, items: { select: { id: true, fileName: true } } },
    }),
    db.order.count({ where }),
  ]);

  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      totalPaise: o.totalPaise,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      createdAt: o.createdAt,
      itemCount: o.items.length,
      payment: o.payments[0] ?? null,
    })),
    total,
    page,
    pageSize,
  });
});

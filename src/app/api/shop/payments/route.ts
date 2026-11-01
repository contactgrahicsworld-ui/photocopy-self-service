import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin } from "@/lib/guards";

// Shop payment records (customer UTRs + statuses). Tenant-scoped.
export const GET = handler(async (req: NextRequest) => {
  const session = await requireShopAdmin();
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const payments = await db.payment.findMany({
    where: { shopId: session.shopId, type: "PRINT_ORDER", ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { order: { select: { orderNumber: true, status: true } } },
  });
  return NextResponse.json({
    payments: payments.map((p) => ({
      id: p.id,
      reference: p.reference,
      orderNumber: p.order?.orderNumber,
      orderStatus: p.order?.status,
      amountPaise: p.amountPaise,
      utr: p.utr,
      status: p.status,
      createdAt: p.createdAt,
      verifiedAt: p.verifiedAt,
      rejectionReason: p.rejectionReason,
    })),
  });
});

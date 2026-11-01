import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin } from "@/lib/guards";
import { formatIST } from "@/lib/format";

// Daily / weekly / monthly collections & order reports (tenant-scoped).
export const GET = handler(async (req: NextRequest) => {
  const session = await requireShopAdmin();
  const range = req.nextUrl.searchParams.get("range") ?? "day";
  const format = req.nextUrl.searchParams.get("format") ?? "json";

  const now = new Date();
  let start: Date;
  if (range === "day") start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  else if (range === "week") start = new Date(now.getTime() - 7 * 86400000);
  else if (range === "month") start = new Date(now.getFullYear(), now.getMonth(), 1);
  else start = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [payments, orders] = await Promise.all([
    db.payment.findMany({
      where: { shopId: session.shopId, type: "PRINT_ORDER", status: "VERIFIED", verifiedAt: { gte: start } },
      orderBy: { verifiedAt: "desc" },
      include: { order: { select: { orderNumber: true } } },
    }),
    db.order.findMany({
      where: { shopId: session.shopId, createdAt: { gte: start } },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { items: true } } },
    }),
  ]);

  const totalPaise = payments.reduce((a, p) => a + p.amountPaise, 0);
  const statusCounts: Record<string, number> = {};
  for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;

  if (format === "csv") {
    const rows = [
      ["OrderNumber", "Customer", "Phone", "Status", "Amount(INR)", "UTR", "VerifiedAt(IST)", "CreatedAt(IST)"],
      ...payments.map((p) => [
        p.order?.orderNumber ?? "-",
        "-",
        "-",
        "VERIFIED",
        (p.amountPaise / 100).toFixed(2),
        p.utr ?? "",
        formatIST(p.verifiedAt),
        formatIST(p.createdAt),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="collections-${range}.csv"` },
    });
  }

  return NextResponse.json({
    range,
    from: start.toISOString(),
    verifiedPayments: payments.map((p) => ({
      reference: p.reference,
      orderNumber: p.order?.orderNumber,
      amountPaise: p.amountPaise,
      utr: p.utr,
      verifiedAt: p.verifiedAt,
    })),
    totalPaise,
    ordersCount: orders.length,
    statusCounts,
  });
});

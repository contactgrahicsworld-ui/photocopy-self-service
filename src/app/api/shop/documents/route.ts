import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin } from "@/lib/guards";
import { createFileToken } from "@/lib/auth";
import { storageUsageBytes } from "@/lib/storage";
import { getShopLimits } from "@/lib/subscriptions";

// Customer documents list (metadata + short-lived links). Tenant-scoped.
export const GET = handler(async () => {
  const session = await requireShopAdmin();
  const [docs, usedBytes, limits] = await Promise.all([
    db.document.findMany({
      where: { shopId: session.shopId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { order: { select: { orderNumber: true, status: true } } },
    }),
    storageUsageBytes(session.shopId),
    getShopLimits(session.shopId),
  ]);
  return NextResponse.json({
    documents: docs.map((d) => ({
      id: d.id,
      originalName: d.originalName,
      pageCount: d.pageCount,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt,
      orderNumber: d.order?.orderNumber,
      orderStatus: d.order?.status,
      downloadUrl: `/api/files/${d.id}?token=${createFileToken(d.id, d.shopId, 300)}`,
    })),
    storageUsedBytes: usedBytes,
    storageLimitMb: limits.plan?.storageLimitMb ?? null,
  });
});

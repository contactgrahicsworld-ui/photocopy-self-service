import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireSuperAdmin } from "@/lib/guards";

export const GET = handler(async (req: NextRequest) => {
  await requireSuperAdmin();
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1"));
  const shopId = req.nextUrl.searchParams.get("shopId") ?? undefined;
  const pageSize = 50;
  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where: shopId ? { shopId } : undefined,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { shop: { select: { name: true, slug: true } } },
    }),
    db.auditLog.count({ where: shopId ? { shopId } : undefined }),
  ]);
  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      actorType: l.actorType,
      actorLabel: l.actorLabel ?? l.actorId,
      shop: l.shop ? { name: l.shop.name, slug: l.shop.slug } : null,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      meta: l.meta ? JSON.parse(l.meta) : null,
      ip: l.ip,
      createdAt: l.createdAt,
    })),
    total,
    page,
    pageSize,
  });
});

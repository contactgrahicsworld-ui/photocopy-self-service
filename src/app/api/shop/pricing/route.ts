import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin, ApiError } from "@/lib/guards";
import { PAPER_SIZES } from "@/lib/types";

export const GET = handler(async () => {
  const session = await requireShopAdmin();
  const rules = await db.pricingRule.findMany({ where: { shopId: session.shopId }, orderBy: [{ paperSize: "asc" }, { colorMode: "asc" }] });
  const shop = await db.shop.findUnique({ where: { id: session.shopId }, select: { taxPercent: true, additionalChargePaise: true, additionalChargeLabel: true } });
  return NextResponse.json({ rules, ...shop });
});

// Upsert pricing rules + snapshot a PricingVersion (order history stays fixed).
export const POST = handler(async (req: NextRequest) => {
  const session = await requireShopAdmin();
  const body = await req.json().catch(() => null);
  const rules = Array.isArray(body?.rules) ? body.rules : null;
  if (!rules || rules.length === 0) throw new ApiError(400, "No pricing rules provided");

  const seen = new Set<string>();
  for (const r of rules) {
    const key = `${r.paperSize}|${r.colorMode}`;
    if (seen.has(key)) throw new ApiError(400, "Duplicate pricing rule");
    seen.add(key);
    if (!(typeof r.paperSize === "string" && (PAPER_SIZES.includes(r.paperSize) || r.paperSize.startsWith("CUSTOM:")))) {
      throw new ApiError(400, `Invalid paper size: ${r.paperSize}`);
    }
    if (!["BW", "COLOR"].includes(r.colorMode)) throw new ApiError(400, "Invalid colour mode");
    if (!Number.isInteger(r.pricePerSidePaise) || r.pricePerSidePaise < 0 || r.pricePerSidePaise > 100000) {
      throw new ApiError(400, "Per-side price must be between ₹0 and ₹1000");
    }
    if (r.duplexPricePerSidePaise != null && (!Number.isInteger(r.duplexPricePerSidePaise) || r.duplexPricePerSidePaise < 0)) {
      throw new ApiError(400, "Invalid duplex price");
    }
  }

  await db.$transaction(async (tx) => {
    for (const r of rules) {
      await tx.pricingRule.upsert({
        where: { shopId_paperSize_colorMode: { shopId: session.shopId, paperSize: r.paperSize, colorMode: r.colorMode } },
        update: { pricePerSidePaise: r.pricePerSidePaise, duplexPricePerSidePaise: r.duplexPricePerSidePaise ?? null, active: r.active !== false },
        create: {
          shopId: session.shopId,
          paperSize: r.paperSize,
          colorMode: r.colorMode,
          pricePerSidePaise: r.pricePerSidePaise,
          duplexPricePerSidePaise: r.duplexPricePerSidePaise ?? null,
          active: r.active !== false,
        },
      });
    }
    await tx.pricingVersion.create({
      data: {
        shopId: session.shopId,
        version: 1 + (await tx.pricingVersion.count({ where: { shopId: session.shopId } })),
        snapshot: JSON.stringify(rules),
        createdByUserId: session.uid,
      },
    });
  });

  const updated = await db.pricingRule.findMany({ where: { shopId: session.shopId }, orderBy: [{ paperSize: "asc" }, { colorMode: "asc" }] });
  return NextResponse.json({ ok: true, rules: updated });
});

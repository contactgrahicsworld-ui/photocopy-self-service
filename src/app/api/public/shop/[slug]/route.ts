import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, rateLimit, ApiError } from "@/lib/guards";
import { getActiveSubscription, getShopLimits } from "@/lib/subscriptions";
import { isValidUpiId } from "@/lib/upi";

// Public shop info for the QR ordering page (mobile-first). Exposes only what
// customers need — never other shops' data, never internal ids beyond slug.
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
  const { slug } = await params;
  rateLimit(req, "public-shop", 60, 60_000);

  const shop = await db.shop.findUnique({ where: { slug } });
  if (!shop || shop.status === "ARCHIVED") throw new ApiError(404, "Shop not found. Please scan the QR code again.");

  const sub = await getActiveSubscription(shop.id);
  const suspended = shop.status === "SUSPENDED" || !sub;
  const upiReady = !!shop.upiId && isValidUpiId(shop.upiId);

  const rules = await db.pricingRule.findMany({ where: { shopId: shop.id, active: true }, orderBy: [{ paperSize: "asc" }, { colorMode: "asc" }] });
  const printers = await db.printer.findMany({ where: { shopId: shop.id, status: "ACTIVE" } });
  const paperSizes = [...new Set(printers.flatMap((p) => { try { return JSON.parse(p.paperSizes) as string[]; } catch { return []; } }))];

  const announcement = await db.platformSetting.findUnique({ where: { key: "announcement" } });

  return NextResponse.json({
    shop: {
      slug: shop.slug,
      name: shop.name,
      address: shop.address,
      phone: shop.phone,
      businessHours: shop.businessHours,
      logoUrl: shop.logoUrl,
    },
    accepting: !suspended && upiReady,
    reason: suspended ? "This shop is temporarily not accepting online orders." : upiReady ? null : "Shop payment setup pending.",
    announcement: announcement ? (JSON.parse(announcement.value)?.text ?? null) : null,
    pricing: rules.map((r) => ({
      paperSize: r.paperSize,
      colorMode: r.colorMode,
      pricePerSidePaise: r.pricePerSidePaise,
      duplexPricePerSidePaise: r.duplexPricePerSidePaise,
    })),
    paperSizes,
    additionalChargePaise: shop.additionalChargePaise,
    additionalChargeLabel: shop.additionalChargeLabel,
    taxPercent: shop.taxPercent,
  });
});

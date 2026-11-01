import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin, ApiError } from "@/lib/guards";
import { qrPngBuffer } from "@/lib/upi";

// Shop ordering QR (PNG) pointing at /s/{slug}. Base URL is derived from the
// request (or BASE_URL env) so the QR always matches the deployment origin.
export const GET = handler(async (req: NextRequest) => {
  const session = await requireShopAdmin();
  const shop = await db.shop.findUnique({ where: { id: session.shopId } });
  if (!shop) throw new ApiError(404, "Shop not found");

  const base = process.env.BASE_URL || `${req.headers.get("x-forwarded-proto") || "http"}://${req.headers.get("host")}`;
  const url = `${base.replace(/\/$/, "")}/s/${shop.slug}`;
  const png = await qrPngBuffer(url);
  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Content-Disposition": `inline; filename="smart-photocopy-${shop.slug}.png"` },
  });
});

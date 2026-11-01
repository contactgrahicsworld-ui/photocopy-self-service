import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin, ApiError } from "@/lib/guards";
import { isValidUpiId } from "@/lib/upi";
import { audit } from "@/lib/audit";

export const GET = handler(async () => {
  const session = await requireShopAdmin();
  const shop = await db.shop.findUnique({ where: { id: session.shopId } });
  if (!shop) throw new ApiError(404, "Shop not found");
  return NextResponse.json({
    slug: shop.slug,
    name: shop.name,
    ownerName: shop.ownerName,
    phone: shop.phone,
    address: shop.address,
    businessHours: shop.businessHours,
    upiId: shop.upiId,
    upiPayeeName: shop.upiPayeeName,
    taxPercent: shop.taxPercent,
    additionalChargePaise: shop.additionalChargePaise,
    additionalChargeLabel: shop.additionalChargeLabel,
    status: shop.status,
  });
});

export const PATCH = handler(async (req: NextRequest) => {
  const session = await requireShopAdmin();
  const body = await req.json().catch(() => null);
  const data: Record<string, unknown> = {};

  if (typeof body?.name === "string" && body.name.trim().length >= 2) data.name = body.name.trim().slice(0, 120);
  if (typeof body?.ownerName === "string") data.ownerName = body.ownerName.trim().slice(0, 120) || null;
  if (typeof body?.phone === "string") data.phone = body.phone.replace(/[^0-9+ ]/g, "").slice(0, 15) || null;
  if (typeof body?.address === "string") data.address = body.address.trim().slice(0, 300) || null;
  if (typeof body?.businessHours === "string") data.businessHours = body.businessHours.trim().slice(0, 200) || null;

  // UPI: validate VPA format; payee name required (appears in customer's UPI app).
  if (body?.upiId !== undefined) {
    const vpa = String(body.upiId ?? "").trim();
    if (vpa && !isValidUpiId(vpa)) throw new ApiError(400, "Invalid UPI ID format. Example: yourname@upi");
    data.upiId = vpa || null;
  }
  if (body?.upiPayeeName !== undefined) data.upiPayeeName = String(body.upiPayeeName ?? "").trim().slice(0, 50) || null;
  if (data.upiId === null && !data.upiPayeeName) {
    const shop = await db.shop.findUnique({ where: { id: session.shopId } });
    if (shop?.upiId && !shop.upiPayeeName) data.upiPayeeName = shop.name; // keep payee consistent
  }
  if (body?.taxPercent !== undefined) {
    const tax = Number(body.taxPercent);
    if (!Number.isFinite(tax) || tax < 0 || tax > 28) throw new ApiError(400, "Tax must be between 0 and 28 percent");
    data.taxPercent = tax;
  }
  if (body?.additionalChargePaise !== undefined) {
    const ch = Number(body.additionalChargePaise);
    if (!Number.isInteger(ch) || ch < 0 || ch > 1000000) throw new ApiError(400, "Invalid additional charge");
    data.additionalChargePaise = ch;
  }
  if (body?.additionalChargeLabel !== undefined) data.additionalChargeLabel = String(body.additionalChargeLabel ?? "").trim().slice(0, 60) || null;

  const updated = await db.shop.update({ where: { id: session.shopId }, data });
  await audit({ actorType: "SHOP_ADMIN", actorId: session.uid, shopId: session.shopId, action: "SHOP_PROFILE_UPDATED", meta: { fields: Object.keys(data) } });
  return NextResponse.json({ ok: true, shop: { slug: updated.slug, name: updated.name, upiId: updated.upiId, upiPayeeName: updated.upiPayeeName } });
});

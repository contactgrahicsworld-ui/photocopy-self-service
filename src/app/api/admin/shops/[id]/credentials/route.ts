import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireSuperAdmin, ApiError, getClientIp } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { isValidUpiId } from "@/lib/upi";

// Update a shop: suspend / activate / restore / edit profile. Tenant scope is
// taken from the URL id, never from the payload.
export const PATCH = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireSuperAdmin();
  const body = await req.json().catch(() => null);
  const shop = await db.shop.findUnique({ where: { id } });
  if (!shop) throw new ApiError(404, "Shop not found");

  const data: Record<string, unknown> = {};
  if (["ACTIVE", "SUSPENDED", "ARCHIVED"].includes(body?.status)) data.status = body.status;
  if (typeof body?.name === "string" && body.name.trim().length >= 2) data.name = body.name.trim().slice(0, 120);
  if (body?.phone !== undefined) data.phone = String(body.phone ?? "").replace(/[^0-9+ ]/g, "").slice(0, 15) || null;
  if (body?.address !== undefined) data.address = String(body.address ?? "").trim().slice(0, 300) || null;
  if (body?.businessHours !== undefined) data.businessHours = String(body.businessHours ?? "").trim().slice(0, 200) || null;
  if (body?.upiId !== undefined) {
    const vpa = String(body.upiId ?? "").trim();
    if (vpa && !isValidUpiId(vpa)) throw new ApiError(400, "Invalid UPI ID");
    data.upiId = vpa || null;
  }
  if (body?.upiPayeeName !== undefined) data.upiPayeeName = String(body.upiPayeeName ?? "").trim().slice(0, 50) || null;

  const updated = await db.shop.update({ where: { id: shop.id }, data });
  await audit({
    actorType: "SUPER_ADMIN", actorId: session.uid, shopId: shop.id,
    action: body?.status && data.status ? `SHOP_${data.status}` : "SHOP_UPDATED",
    entityType: "Shop", entityId: shop.id, meta: { fields: Object.keys(data) }, ip: getClientIp(req),
  });
  return NextResponse.json({ ok: true, status: updated.status });
});

// Reset the shop admin's password (support flow). Audited.
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireSuperAdmin();
  const body = await req.json().catch(() => null);
  const password = String(body?.newPassword ?? "");
  if (password.length < 8) throw new ApiError(400, "New password must be at least 8 characters");
  const admin = await db.user.findFirst({ where: { shopId: id, role: "SHOP_ADMIN" } });
  if (!admin) throw new ApiError(404, "Shop has no admin user");
  const { hashPassword } = await import("@/lib/auth");
  await db.user.update({ where: { id: admin.id }, data: { passwordHash: hashPassword(password), isActive: true } });
  await audit({ actorType: "SUPER_ADMIN", actorId: session.uid, shopId: id, action: "SHOP_ADMIN_PASSWORD_RESET", entityType: "User", entityId: admin.id, ip: getClientIp(req) });
  return NextResponse.json({ ok: true });
});

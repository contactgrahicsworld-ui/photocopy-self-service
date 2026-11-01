import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireSuperAdmin, ApiError, getClientIp } from "@/lib/guards";
import { hashPassword, generateDeviceToken } from "@/lib/auth";
import { ensureTrialSubscription, getShopLimits } from "@/lib/subscriptions";
import { isValidUpiId } from "@/lib/upi";
import { audit } from "@/lib/audit";

export const GET = handler(async (req: NextRequest) => {
  await requireSuperAdmin();
  const shops = await db.shop.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      users: { where: { role: "SHOP_ADMIN" }, select: { email: true, isActive: true, lastLoginAt: true } },
      subscriptions: { where: { status: "ACTIVE" }, include: { plan: true }, take: 1 },
      _count: { select: { orders: true, printers: true, documents: true } },
    },
  });
  return NextResponse.json({
    shops: shops.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      ownerName: s.ownerName,
      phone: s.phone,
      status: s.status,
      upiConfigured: !!s.upiId,
      adminEmail: s.users[0]?.email ?? null,
      subscription: s.subscriptions[0] ? { planName: s.subscriptions[0].plan.name, planCode: s.subscriptions[0].plan.code, expiresAt: s.subscriptions[0].expiresAt, isLifetime: s.subscriptions[0].isLifetime } : null,
      orderCount: s._count.orders,
      printerCount: s._count.printers,
      documentCount: s._count.documents,
      createdAt: s.createdAt,
    })),
  });
});

// Create a shop + its first Shop Admin (secure provisioning by Super Admin).
export const POST = handler(async (req: NextRequest) => {
  const session = await requireSuperAdmin();
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const slug = String(body?.slug ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const email = String(body?.adminEmail ?? "").trim().toLowerCase();
  const password = String(body?.adminPassword ?? "");

  if (name.length < 2) throw new ApiError(400, "Shop name is required");
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) throw new ApiError(400, "Slug must be 3–40 chars: lowercase letters, digits, dashes");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(400, "Valid shop admin email required");
  if (password.length < 8) throw new ApiError(400, "Shop admin password must be at least 8 characters");
  if (body?.upiId && !isValidUpiId(body.upiId)) throw new ApiError(400, "Invalid shop UPI ID");

  const dupeSlug = await db.shop.findUnique({ where: { slug } });
  if (dupeSlug) throw new ApiError(409, "This shop URL slug is already taken");
  const dupeEmail = await db.user.findUnique({ where: { email } });
  if (dupeEmail) throw new ApiError(409, "This admin email is already in use");

  const shop = await db.shop.create({
    data: {
      slug,
      name,
      ownerName: String(body?.ownerName ?? "").trim() || null,
      phone: String(body?.phone ?? "").replace(/[^0-9+ ]/g, "").slice(0, 15) || null,
      address: String(body?.address ?? "").trim() || null,
      upiId: String(body?.upiId ?? "").trim() || null,
      upiPayeeName: String(body?.upiPayeeName ?? "").trim() || null,
      status: "ACTIVE",
    },
  });
  const admin = await db.user.create({
    data: { email, name: String(body?.adminName ?? "Shop Admin").trim(), role: "SHOP_ADMIN", shopId: shop.id, passwordHash: hashPassword(password) },
  });
  await ensureTrialSubscription(shop.id); // 7-day trial starts automatically

  await audit({ actorType: "SUPER_ADMIN", actorId: session.uid, action: "SHOP_CREATED", entityType: "Shop", entityId: shop.id, meta: { slug, adminEmail: email }, ip: getClientIp(req) });
  return NextResponse.json({ ok: true, shopId: shop.id, slug, adminEmail: email, orderingUrl: `/s/${slug}`, trialStarted: true }, { status: 201 });
});

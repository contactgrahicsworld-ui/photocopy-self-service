import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { handler, rateLimit, getClientIp, ApiError } from "@/lib/guards";
import { audit } from "@/lib/audit";

export const POST = handler(async (req: NextRequest) => {
  rateLimit(req, "login", 10, 60_000);
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (!email || !password) throw new ApiError(400, "Email and password are required");

  const user = await db.user.findUnique({ where: { email } });
  // Constant-shape failure: never reveal which part was wrong.
  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    await audit({ actorType: user?.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "SHOP_ADMIN", actorId: user?.id, action: "LOGIN_FAILED", ip: getClientIp(req) });
    throw new ApiError(401, "Invalid email or password");
  }

  const token = createSessionToken({
    uid: user.id,
    role: user.role,
    shopId: user.shopId,
    name: user.name,
    email: user.email,
  });
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ actorType: user.role, actorId: user.id, actorLabel: user.name, shopId: user.shopId, action: "LOGIN_SUCCESS", ip: getClientIp(req) });

  const res = NextResponse.json({
    ok: true,
    role: user.role,
    redirect: user.role === "SUPER_ADMIN" ? "/admin" : "/shop",
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
});

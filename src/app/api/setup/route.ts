// One-time platform bootstrap. There are NO predefined credentials anywhere in
// this system: the first Super Admin is created here, on first run, by the
// person who controls the SETUP_TOKEN secret. Once a SUPER_ADMIN exists this
// endpoint is permanently closed (409).
//
// GET  /api/setup  → { setupNeeded: boolean }
// POST /api/setup  { setupToken, email, password, name } → creates SUPER_ADMIN

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, SESSION_COOKIE, sessionCookieOptions, createSessionToken } from "@/lib/auth";
import { handler, rateLimit, getClientIp, ApiError } from "@/lib/guards";
import { audit } from "@/lib/audit";

export const GET = handler(async () => {
  const count = await db.user.count({ where: { role: "SUPER_ADMIN" } });
  return NextResponse.json({ setupNeeded: count === 0 });
});

export const POST = handler(async (req: NextRequest) => {
  rateLimit(req, "setup", 5, 60_000);

  const already = await db.user.count({ where: { role: "SUPER_ADMIN" } });
  if (already > 0) throw new ApiError(409, "Setup already completed. Sign in instead.");

  const expected = process.env.SETUP_TOKEN || "";
  const body = await req.json().catch(() => null);
  const provided = String(body?.setupToken ?? "");
  if (!expected) throw new ApiError(500, "SETUP_TOKEN is not configured on the server. Set it in the deployment environment first.");
  if (!provided || provided !== expected) throw new ApiError(401, "Invalid setup token");

  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const name = String(body?.name ?? "").trim() || "Platform Owner";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "A valid email is required");
  if (password.length < 10) throw new ApiError(400, "Password must be at least 10 characters");
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new ApiError(400, "Password must contain letters and numbers");

  const user = await db.user.create({
    data: { email, name, role: "SUPER_ADMIN", passwordHash: hashPassword(password), isActive: true },
  });

  await audit({
    actorType: "SUPER_ADMIN",
    actorId: user.id,
    actorLabel: email,
    action: "SETUP_COMPLETED",
    entityType: "User",
    entityId: user.id,
    ip: getClientIp(req),
  });

  // Log the owner straight in.
  const token = createSessionToken({ uid: user.id, role: user.role, shopId: null, name: user.name, email: user.email });
  const res = NextResponse.json({ ok: true, user: { id: user.id, email: user.email, role: user.role } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
});

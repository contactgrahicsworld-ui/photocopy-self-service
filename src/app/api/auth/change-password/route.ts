// Change own password — available to every signed-in console user.
// Requires the CURRENT password (prevents session-hijack password takeover).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/auth";
import { requireSession, handler, rateLimit, ApiError, getClientIp } from "@/lib/guards";
import { audit } from "@/lib/audit";

export const POST = handler(async (req: NextRequest) => {
  const session = await requireSession();
  rateLimit(req, "change-password", 5, 60_000);

  const body = await req.json().catch(() => null);
  const current = String(body?.currentPassword ?? "");
  const next = String(body?.newPassword ?? "");
  if (!current || !next) throw new ApiError(400, "Current and new password are required");
  if (next.length < 10) throw new ApiError(400, "New password must be at least 10 characters");
  if (!/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) throw new ApiError(400, "New password must contain letters and numbers");

  const user = await db.user.findUnique({ where: { id: session.uid } });
  if (!user || !user.isActive) throw new ApiError(401, "Account not found");
  if (!verifyPassword(current, user.passwordHash)) throw new ApiError(401, "Current password is incorrect");

  await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(next) } });

  await audit({
    actorType: user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "SHOP_ADMIN",
    actorId: user.id,
    actorLabel: user.email,
    shopId: user.shopId,
    action: "PASSWORD_CHANGED",
    entityType: "User",
    entityId: user.id,
    ip: getClientIp(req),
  });

  return NextResponse.json({ ok: true });
});

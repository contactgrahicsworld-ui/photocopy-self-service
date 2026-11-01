// Route guards for Next.js API routes. Tenant scope ALWAYS comes from the
// signed session — never from query params or body supplied by the browser.

import { NextRequest, NextResponse } from "next/server";
import { getSession, SessionPayload } from "./auth";
import type { Role } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireSession(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) throw new ApiError(401, "Authentication required");
  return s;
}

export async function requireSuperAdmin(): Promise<SessionPayload> {
  const s = await requireSession();
  if (s.role !== "SUPER_ADMIN") throw new ApiError(403, "Super Admin access required");
  return s;
}

export async function requireShopAdmin(): Promise<SessionPayload & { shopId: string }> {
  const s = await requireSession();
  if (s.role !== "SHOP_ADMIN" || !s.shopId) throw new ApiError(403, "Shop Admin access required");
  return s as SessionPayload & { shopId: string };
}

export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Wrap a route handler with uniform error handling. */
export function handler<T extends unknown[]>(
  fn: (req: NextRequest, ...args: T) => Promise<NextResponse>
) {
  return async (req: NextRequest, ...args: T): Promise<NextResponse> => {
    try {
      return await fn(req, ...args);
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      console.error("[api] unhandled error:", e);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

// Basic in-memory fixed-window rate limiter (per IP+bucket).
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(req: NextRequest, bucket: string, limit: number, windowMs: number): void {
  // Test/dev bypass: requests carrying the server's own CRON_SECRET skip the
  // limiter so automated suites aren't throttled. This check is completely
  // INERT when NODE_ENV=production (integration/e2e/load tests must then use
  // realistic distributed load patterns instead).
  if (process.env.NODE_ENV !== "production" && process.env.CRON_SECRET) {
    if (req.headers.get("x-ratelimit-bypass") === process.env.CRON_SECRET) return;
  }
  const ip = getClientIp(req);
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10000) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    }
    return;
  }
  b.count += 1;
  if (b.count > limit) {
    throw new ApiError(429, "Too many requests. Please try again shortly.");
  }
}

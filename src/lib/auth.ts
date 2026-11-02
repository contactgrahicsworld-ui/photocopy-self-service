// Authentication: scrypt password hashing + HMAC-signed session tokens.
// Session cookie is httpOnly + SameSite=Lax; role & shopId live INSIDE the
// signed payload and are NEVER taken from the browser.

import crypto from "node:crypto";
import { cookies } from "next/headers";

const DEV_FALLBACK_SECRET = "dev-only-secret-change-me";
const SECRET = process.env.SESSION_SECRET || DEV_FALLBACK_SECRET;

/**
 * Fail closed: if the app runs in production with an unset/weak SESSION_SECRET,
 * refuse to sign or verify sessions instead of silently accepting a known key.
 * (Checked lazily so the build itself never crashes on missing env.)
 */
function assertProductionSecret(): void {
  if (process.env.NODE_ENV === "production" && SECRET === DEV_FALLBACK_SECRET) {
    throw new Error(
      "SESSION_SECRET is not configured. Refusing to sign sessions with the development fallback. Set SESSION_SECRET (openssl rand -hex 32) in the deployment environment."
    );
  }
}

export const SESSION_COOKIE = "sp_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// ── Password hashing (scrypt, no external deps) ──────────────────────────────
export function hashPassword(password: string): string {
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters");
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
    const hash = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
    const expected = Buffer.from(hashHex, "hex");
    return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
  } catch {
    return false;
  }
}

// ── Signed session tokens (compact JWS-style: payload.sig, HS256) ───────────
export interface SessionPayload {
  uid: string;
  role: string; // SUPER_ADMIN | SHOP_ADMIN
  shopId?: string | null;
  name?: string | null;
  email?: string;
  iat: number;
  exp: number;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(data: string): string {
  assertProductionSecret();
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function createSessionToken(p: Omit<SessionPayload, "iat" | "exp">): string {
  const payload: SessionPayload = { ...p, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  try {
    assertProductionSecret();
  } catch {
    return null;
  }
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.uid || !payload.role) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Cookie helpers (Next.js server) ──────────────────────────────────────────
export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && process.env.FORCE_INSECURE_COOKIES !== "1",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

// ── Short-lived signed file tokens (private document downloads) ──────────────
export interface FileTokenPayload {
  did: string; // document id
  shop: string; // tenant scope
  exp: number;
  jti: string;
}

export function createFileToken(documentId: string, shopId: string, ttlSeconds = 300): string {
  const payload: FileTokenPayload = {
    did: documentId,
    shop: shopId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    jti: crypto.randomBytes(8).toString("hex"),
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyFileToken(token: string | null | undefined): FileTokenPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as FileTokenPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Device tokens (print agent) ──────────────────────────────────────────────
export function generateDeviceToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashDeviceToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

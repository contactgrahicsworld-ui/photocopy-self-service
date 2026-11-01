import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { handler } from "@/lib/guards";

export const POST = handler(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});

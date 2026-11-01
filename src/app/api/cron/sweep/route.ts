import { NextRequest, NextResponse } from "next/server";
import { handler, ApiError } from "@/lib/guards";
import { sweepExpiredSubscriptions } from "@/lib/subscriptions";
import { sweepExpiredPayments } from "@/lib/orders";

// Maintenance sweep — call daily (or every few minutes) with CRON_SECRET:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" /api/cron/sweep
// Expires stale payments/orders and overdue subscriptions (lifetime subs are
// never touched).
export const POST = handler(async (req: NextRequest) => {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret || auth !== `Bearer ${secret}`) throw new ApiError(401, "Invalid cron secret");
  const [expiredPayments, expiredSubs] = await Promise.all([sweepExpiredPayments(), sweepExpiredSubscriptions()]);
  return NextResponse.json({ ok: true, expiredPayments, expiredSubscriptions: expiredSubs });
});

import { NextRequest, NextResponse } from "next/server";
import { handler, requireShopAdmin } from "@/lib/guards";
import { retryJob } from "@/lib/printqueue";

// Re-queue a FAILED job (same idempotencyKey — no duplicate job creation).
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireShopAdmin();
  await retryJob(id, session.shopId, session.uid);
  return NextResponse.json({ ok: true });
});

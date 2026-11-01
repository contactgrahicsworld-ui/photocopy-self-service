import { NextRequest, NextResponse } from "next/server";
import { handler, requireShopAdmin } from "@/lib/guards";
import { reprintJob } from "@/lib/printqueue";

// Manual reprint — NEW job (fresh idempotencyKey). Caller must warn the shop
// user that duplicate physical output is possible.
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireShopAdmin();
  const body = await req.json().catch(() => ({}));
  const result = await reprintJob(id, session.shopId, body?.printerId);
  return NextResponse.json({ ok: true, newJobId: result.newJobId });
});

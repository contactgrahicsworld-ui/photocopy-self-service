import { NextRequest, NextResponse } from "next/server";
import { handler, requireShopAdmin } from "@/lib/guards";
import { assignPrinter } from "@/lib/printqueue";

// Manually assign / change the printer of a queued or failed job.
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireShopAdmin();
  const body = await req.json().catch(() => ({}));
  await assignPrinter(id, session.shopId, body?.printerId ?? null);
  return NextResponse.json({ ok: true });
});

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin, ApiError } from "@/lib/guards";
import { getShopLimits, planLimitReached } from "@/lib/subscriptions";
import { audit } from "@/lib/audit";
import { PAPER_SIZES } from "@/lib/types";

export const GET = handler(async () => {
  const session = await requireShopAdmin();
  const printers = await db.printer.findMany({ where: { shopId: session.shopId }, orderBy: { createdAt: "asc" } });
  const limits = await getShopLimits(session.shopId);
  return NextResponse.json({ printers, limits });
});

export const POST = handler(async (req: NextRequest) => {
  const session = await requireShopAdmin();
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  if (name.length < 2 || name.length > 80) throw new ApiError(400, "Printer name must be 2–80 characters (must match the Windows printer name)");
  const colorMode = ["BW", "COLOR", "ANY"].includes(body?.colorMode) ? body.colorMode : "BW";
  const paperSizes = Array.isArray(body?.paperSizes) ? body.paperSizes.filter((s: string) => PAPER_SIZES.includes(s)) : [];
  if (paperSizes.length === 0) throw new ApiError(400, "Select at least one supported paper size");

  const limits = await getShopLimits(session.shopId);
  if (planLimitReached(limits.plan?.printerLimit, limits.usage.printers)) {
    throw new ApiError(403, `Your plan allows ${limits.plan?.printerLimit} printer(s). Upgrade the subscription to add more.`);
  }

  const printer = await db.printer.create({
    data: {
      shopId: session.shopId,
      name,
      colorMode,
      paperSizes: JSON.stringify(paperSizes),
      duplexCapable: !!body?.duplexCapable,
      isDefault: !!body?.isDefault,
    },
  });
  if (printer.isDefault) {
    await db.printer.updateMany({ where: { shopId: session.shopId, id: { not: printer.id } }, data: { isDefault: false } });
  }
  await audit({ actorType: "SHOP_ADMIN", actorId: session.uid, shopId: session.shopId, action: "PRINTER_ADDED", entityType: "Printer", entityId: printer.id, meta: { name } });
  return NextResponse.json({ ok: true, printer });
});

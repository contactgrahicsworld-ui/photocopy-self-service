import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin, ApiError } from "@/lib/guards";

// Update or retire a printer. Tenant scope enforced by shopId in the where.
export const PATCH = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireShopAdmin();
  const body = await req.json().catch(() => null);

  const printer = await db.printer.findFirst({ where: { id, shopId: session.shopId } });
  if (!printer) throw new ApiError(404, "Printer not found");

  const data: Record<string, unknown> = {};
  if (typeof body?.name === "string" && body.name.trim().length >= 2) data.name = body.name.trim().slice(0, 80);
  if (["BW", "COLOR", "ANY"].includes(body?.colorMode)) data.colorMode = body.colorMode;
  if (Array.isArray(body?.paperSizes)) data.paperSizes = JSON.stringify(body.paperSizes.filter((s: string) => ["A4", "A3", "LEGAL", "PHOTO_4X6"].includes(s)));
  if (typeof body?.duplexCapable === "boolean") data.duplexCapable = body.duplexCapable;
  if (typeof body?.isDefault === "boolean") data.isDefault = body.isDefault;
  if (["ACTIVE", "OFFLINE", "RETIRED"].includes(body?.status)) data.status = body.status;

  const updated = await db.printer.update({ where: { id: printer.id }, data });
  if (updated.isDefault) {
    await db.printer.updateMany({ where: { shopId: session.shopId, id: { not: printer.id } }, data: { isDefault: false } });
  }
  return NextResponse.json({ ok: true, printer: updated });
});

export const DELETE = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireShopAdmin();
  const printer = await db.printer.findFirst({ where: { id, shopId: session.shopId } });
  if (!printer) throw new ApiError(404, "Printer not found");
  const activeJobs = await db.printJob.count({ where: { printerId: printer.id, status: { in: ["QUEUED", "DISPATCHED", "SPOOLING", "SPOOLER_ACCEPTED", "PRINTING"] } } });
  if (activeJobs > 0) throw new ApiError(400, "Printer has active jobs. Reassign them first.");
  await db.printer.update({ where: { id: printer.id }, data: { status: "RETIRED", isDefault: false } });
  return NextResponse.json({ ok: true });
});

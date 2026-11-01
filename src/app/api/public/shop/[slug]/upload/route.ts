import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, rateLimit, getClientIp, ApiError } from "@/lib/guards";
import { validatePdfUpload, storePdf } from "@/lib/storage";
import { MAX_FILES_PER_ORDER } from "@/lib/types";
import { getActiveSubscription } from "@/lib/subscriptions";
import { audit } from "@/lib/audit";

// Customer PDF upload (no login). Strict validation; documents are private.
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
  const { slug } = await params;
  rateLimit(req, "upload", 20, 60_000);

  const shop = await db.shop.findUnique({ where: { slug } });
  if (!shop || shop.status !== "ACTIVE") throw new ApiError(404, "Shop not available");
  const sub = await getActiveSubscription(shop.id);
  if (!sub) throw new ApiError(403, "This shop is temporarily not accepting orders");

  const form = await req.formData().catch(() => null);
  if (!form) throw new ApiError(400, "Invalid upload request");
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new ApiError(400, "No files uploaded");
  if (files.length > MAX_FILES_PER_ORDER) throw new ApiError(400, `Maximum ${MAX_FILES_PER_ORDER} documents per order`);

  const results = [];
  for (const file of files) {
    const v = await validatePdfUpload(file);
    if (!v.ok) {
      await audit({ actorType: "CUSTOMER", shopId: shop.id, action: "UPLOAD_REJECTED", entityType: "Document", entityId: file.name, meta: { error: v.error, size: file.size }, ip: getClientIp(req) });
      results.push({ fileName: file.name, ok: false, error: v.error });
      continue;
    }
    const storedName = await storePdf(shop.id, v.buffer!, file.name);
    const doc = await db.document.create({
      data: {
        shopId: shop.id,
        originalName: file.name.slice(0, 180),
        storedName,
        mimeType: "application/pdf",
        sizeBytes: v.buffer!.length,
        pageCount: v.pageCount!,
        checksum: v.checksum!,
        scanStatus: "OK",
      },
    });
    results.push({
      ok: true,
      documentId: doc.id,
      fileName: doc.originalName,
      pageCount: doc.pageCount,
      sizeBytes: doc.sizeBytes,
    });
  }

  const anyOk = results.some((r) => r.ok);
  return NextResponse.json({ results }, { status: anyOk ? 200 : 400 });
});

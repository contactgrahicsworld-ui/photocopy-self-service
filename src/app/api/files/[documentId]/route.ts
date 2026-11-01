import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireSession, ApiError } from "@/lib/guards";
import { verifyFileToken, createFileToken } from "@/lib/auth";
import { readStoredPdf } from "@/lib/storage";

/**
 * Private document access. Allowed ONLY for:
 * 1. The owning shop's admin (session-bound), for limited time via signed link.
 * 2. Holders of a valid short-lived signed token (print agent, ~10 min TTL).
 * Super Admins deliberately do NOT get customer document contents here.
 */
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ documentId: string }> }) => {
  const { documentId } = await params;
  const token = req.nextUrl.searchParams.get("token");

  let shopId: string | null = null;
  if (token) {
    const payload = verifyFileToken(token);
    if (!payload || payload.did !== documentId) throw new ApiError(403, "Invalid or expired download link");
    shopId = payload.shop;
  } else {
    const session = await requireSession();
    if (session.role !== "SHOP_ADMIN" || !session.shopId) {
      throw new ApiError(403, "Not authorized to access documents");
    }
    shopId = session.shopId; // session-derived tenant scope
  }

  const doc = await db.document.findFirst({ where: { id: documentId, shopId } });
  if (!doc) throw new ApiError(404, "Document not found");

  // Issue a fresh short-lived token when accessed via session (shop admin UI).
  let redirectToken = token;
  if (!redirectToken) {
    redirectToken = createFileToken(doc.id, doc.shopId, 300);
    return NextResponse.redirect(new URL(`/api/files/${doc.id}?token=${redirectToken}`, req.url));
  }

  const buffer = await readStoredPdf(doc.shopId, doc.storedName);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${encodeURIComponent(doc.originalName)}"`,
      "Cache-Control": "private, no-store",
    },
  });
});

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, ApiError } from "@/lib/guards";
import { verifyFileToken } from "@/lib/auth";
import { readStoredPdf } from "@/lib/storage";

// Agent document download — short-lived signed token (10 min) issued at job
// claim. Tokens are tenant-scoped and single-purpose.
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ documentId: string }> }) => {
  const { documentId } = await params;
  const token = req.nextUrl.searchParams.get("token");
  const payload = verifyFileToken(token);
  if (!payload || payload.did !== documentId) throw new ApiError(403, "Invalid or expired download link");
  const doc = await db.document.findFirst({ where: { id: documentId, shopId: payload.shop } });
  if (!doc) throw new ApiError(404, "Document not found");
  const buffer = await readStoredPdf(doc.shopId, doc.storedName);
  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store" },
  });
});

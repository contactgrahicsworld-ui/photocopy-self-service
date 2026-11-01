// Private document storage + PDF validation.
// Files live in db/uploads/{shopId}/ — NEVER inside public/. They are only
// readable through /api/files/[id] with a short-lived signed token.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { MAX_UPLOAD_MB, MAX_FILES_PER_ORDER } from "./types";

const STORAGE_ROOT = process.env.FILE_STORAGE_DIR || path.join(process.cwd(), "db", "uploads");

export interface PdfValidationResult {
  ok: boolean;
  error?: string;
  pageCount?: number;
  buffer?: Buffer;
  checksum?: string;
}

/**
 * Validate an uploaded file as a printable PDF:
 * - extension (.pdf)
 * - declared MIME (application/pdf)
 * - file signature (%PDF- magic bytes)
 * - structural integrity + encryption check (pdf-lib load)
 * - page count > 0
 * - size cap
 */
export async function validatePdfUpload(file: File): Promise<PdfValidationResult> {
  const name = file.name || "document.pdf";
  if (!/\.pdf$/i.test(name)) {
    return { ok: false, error: "Only PDF files are accepted (.pdf)." };
  }
  if (file.type && file.type !== "application/pdf") {
    return { ok: false, error: "Invalid file type — expected a PDF document." };
  }
  const sizeBytes = file.size;
  if (sizeBytes <= 0) return { ok: false, error: "The file is empty." };
  if (sizeBytes > MAX_UPLOAD_MB * 1024 * 1024) {
    return { ok: false, error: `File is too large. Maximum ${MAX_UPLOAD_MB} MB per document.` };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // File signature check — protects against renamed executables/images.
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return { ok: false, error: "This file is not a valid PDF (bad file signature)." };
  }

  // Structural integrity + encryption detection.
  let pageCount = 0;
  try {
    const pdf = await PDFDocument.load(buffer, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
    pageCount = pdf.getPageCount();
    if (pageCount <= 0) return { ok: false, error: "The PDF has no pages." };
    if (pageCount > 2000) return { ok: false, error: "PDF has too many pages (max 2000)." };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(msg)) {
      return { ok: false, error: "This PDF is password-protected/encrypted. Please upload an unlocked copy." };
    }
    return { ok: false, error: "The PDF appears to be corrupted or unsupported. Please re-export it and try again." };
  }

  return {
    ok: true,
    pageCount,
    buffer,
    checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

/** Persist a validated PDF inside the tenant's private directory. */
export async function storePdf(shopId: string, buffer: Buffer, originalName: string): Promise<string> {
  const dir = path.join(STORAGE_ROOT, shopId);
  await fs.mkdir(dir, { recursive: true });
  const safeExt = originalName.toLowerCase().endsWith(".pdf") ? ".pdf" : ".pdf";
  const storedName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${safeExt}`;
  await fs.writeFile(path.join(dir, storedName), buffer);
  return storedName;
}

/** Resolve the absolute path of a stored document (validated against traversal). */
export function storedPdfPath(shopId: string, storedName: string): string {
  const safe = path.basename(storedName); // blocks ../ traversal
  return path.join(STORAGE_ROOT, path.basename(shopId), safe);
}

export async function readStoredPdf(shopId: string, storedName: string): Promise<Buffer> {
  return fs.readFile(storedPdfPath(shopId, storedName));
}

export async function storageUsageBytes(shopId: string): Promise<number> {
  try {
    const dir = path.join(STORAGE_ROOT, shopId);
    const files = await fs.readdir(dir);
    let total = 0;
    for (const f of files) {
      const st = await fs.stat(path.join(dir, f));
      total += st.size;
    }
    return total;
  } catch {
    return 0;
  }
}

export function maxFilesPerOrder(): number {
  return MAX_FILES_PER_ORDER;
}

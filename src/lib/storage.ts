// Private document storage + PDF validation.
// Two interchangeable backends, same function signatures:
//  - "local"    — files under FILE_STORAGE_DIR/{shopId}/ (sandbox / self-hosted)
//  - "supabase" — Supabase Storage private bucket (Vercel / serverless; the
//                 filesystem there is ephemeral, so PDFs must live in object
//                 storage). Objects are keyed {shopId}/{storedName} and are
//                 NEVER public: reads always flow through our authenticated
//                 API routes with the service key.
// Files are only readable through /api/files/[id] with a short-lived signed
// token, or by the print agent with a device-token-authorized download URL.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { MAX_UPLOAD_MB, MAX_FILES_PER_ORDER } from "./types";

const STORAGE_BACKEND = (process.env.STORAGE_BACKEND || "local").toLowerCase();
const STORAGE_ROOT = process.env.FILE_STORAGE_DIR || path.join(process.cwd(), "db", "uploads");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "documents";

function supabaseBackendEnabled(): boolean {
  if (STORAGE_BACKEND !== "supabase") return false;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[storage] STORAGE_BACKEND=supabase but SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing — falling back to local");
    return false;
  }
  return true;
}

function objectPath(shopId: string, storedName: string): string {
  // Both segments are basename-validated: blocks any ../ traversal.
  return `${path.basename(shopId)}/${path.basename(storedName)}`;
}

async function sbFetch(pathname: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      ...(init?.headers || {}),
    },
  });
  return res;
}

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

/** Persist a validated PDF inside the tenant's private directory/object prefix. */
export async function storePdf(shopId: string, buffer: Buffer, originalName: string): Promise<string> {
  const safeExt = originalName.toLowerCase().endsWith(".pdf") ? ".pdf" : ".pdf";
  const storedName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${safeExt}`;

  if (supabaseBackendEnabled()) {
    const res = await sbFetch(`/object/${SUPABASE_BUCKET}/${objectPath(shopId, storedName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf", "x-upsert": "false" },
      body: new Uint8Array(buffer),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Supabase Storage upload failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    return storedName;
  }

  const dir = path.join(STORAGE_ROOT, shopId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, storedName), buffer);
  return storedName;
}

/** Resolve the local absolute path of a stored document (local backend only). */
export function storedPdfPath(shopId: string, storedName: string): string {
  const safe = path.basename(storedName); // blocks ../ traversal
  return path.join(STORAGE_ROOT, path.basename(shopId), safe);
}

export async function readStoredPdf(shopId: string, storedName: string): Promise<Buffer> {
  if (supabaseBackendEnabled()) {
    // Service-role read: the plain /object endpoint (the /authenticated one is
    // for end-user JWTs and rejects service keys).
    const res = await sbFetch(`/object/${SUPABASE_BUCKET}/${objectPath(shopId, storedName)}`);
    if (!res.ok) {
      throw new Error(`Supabase Storage download failed (${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFile(storedPdfPath(shopId, storedName));
}

export async function storageUsageBytes(shopId: string): Promise<number> {
  if (supabaseBackendEnabled()) {
    try {
      const res = await sbFetch(`/object/list/${SUPABASE_BUCKET}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: `${path.basename(shopId)}/`, limit: 10000 }),
      });
      if (!res.ok) return 0;
      const items = (await res.json()) as Array<{ metadata?: { size?: number } }>;
      return items.reduce((acc, it) => acc + (it.metadata?.size ?? 0), 0);
    } catch {
      return 0;
    }
  }
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

/** Delete a tenant's stored object (used when purging rejected/expired docs). */
export async function deleteStoredPdf(shopId: string, storedName: string): Promise<void> {
  if (supabaseBackendEnabled()) {
    await sbFetch(`/object/${SUPABASE_BUCKET}/${objectPath(shopId, storedName)}`, { method: "DELETE" }).catch(() => {});
    return;
  }
  try {
    await fs.unlink(storedPdfPath(shopId, storedName));
  } catch {
    /* already gone */
  }
}

export function storageBackendName(): string {
  return supabaseBackendEnabled() ? "supabase" : "local";
}

export function maxFilesPerOrder(): number {
  return MAX_FILES_PER_ORDER;
}

// Auth & storage security tests: password hashing, session tokens, file
// tokens, PDF validation (including encrypted/corrupted rejection).
import { describe, test, expect } from "bun:test";
import {
  hashPassword, verifyPassword, createSessionToken, verifySessionToken,
  createFileToken, verifyFileToken, generateDeviceToken, hashDeviceToken,
} from "../src/lib/auth";
import { validatePdfUpload } from "../src/lib/storage";
import { PDFDocument } from "pdf-lib";

describe("password hashing (scrypt)", () => {
  test("hash + verify round-trip", () => {
    const h = hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("correct horse battery", h)).toBe(true);
    expect(verifyPassword("wrong password", h)).toBe(false);
  });
  test("salts are unique per hash", () => {
    expect(hashPassword("same-input")).not.toBe(hashPassword("same-input"));
  });
  test("rejects short passwords", () => {
    expect(() => hashPassword("short")).toThrow();
  });
});

describe("signed session tokens", () => {
  const base = { uid: "u1", role: "SHOP_ADMIN", shopId: "s1", name: "Test", email: "t@t.in" };
  test("valid token verifies with correct payload", () => {
    const t = createSessionToken(base);
    const p = verifySessionToken(t);
    expect(p?.uid).toBe("u1");
    expect(p?.role).toBe("SHOP_ADMIN");
    expect(p?.shopId).toBe("s1");
    expect(p?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
  test("tampered payload rejected", () => {
    const t = createSessionToken(base);
    const [body, sig] = t.split(".");
    // flip role in payload, keep signature
    const forged = Buffer.from(JSON.stringify({ ...base, role: "SUPER_ADMIN" })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`)).toBeNull();
    // flip signature
    expect(verifySessionToken(`${body}.${"A".repeat(sig.length)}`)).toBeNull();
  });
  test("expired token rejected", () => {
    const t = createSessionToken(base);
    const [body, sig] = t.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    payload.exp = Math.floor(Date.now() / 1000) - 10;
    const newBody = Buffer.from(JSON.stringify(payload)).toString("base64url");
    // re-signed but expired → must fail on expiry check
    const crypto = require("node:crypto");
    const newSig = crypto.createHmac("sha256", process.env.SESSION_SECRET || "dev-only-secret-change-me").update(newBody).digest("base64url");
    expect(verifySessionToken(`${newBody}.${newSig}`)).toBeNull();
  });
  test("garbage rejected", () => {
    expect(verifySessionToken("garbage")).toBeNull();
    expect(verifySessionToken("")).toBeNull();
    expect(verifySessionToken(null)).toBeNull();
  });
});

describe("short-lived file tokens", () => {
  test("round-trip and tenant binding", () => {
    const t = createFileToken("doc1", "shop1", 60);
    const p = verifyFileToken(t);
    expect(p?.did).toBe("doc1");
    expect(p?.shop).toBe("shop1");
  });
  test("token for another document id fails", () => {
    const t = createFileToken("doc1", "shop1", 60);
    expect(verifyFileToken(t)?.did).not.toBe("doc2");
  });
  test("expired token fails", () => {
    const crypto = require("node:crypto");
    const secret = process.env.SESSION_SECRET || "dev-only-secret-change-me";
    const payload = { did: "d", shop: "s", exp: Math.floor(Date.now() / 1000) - 5, jti: "x" };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
    expect(verifyFileToken(`${body}.${sig}`)).toBeNull();
  });
  test("device tokens are 64-hex and hash stably", () => {
    const t1 = generateDeviceToken();
    expect(t1).toMatch(/^[a-f0-9]{64}$/);
    expect(hashDeviceToken(t1)).toBe(hashDeviceToken(t1));
    expect(hashDeviceToken(t1)).not.toBe(t1);
    expect(hashDeviceToken(generateDeviceToken())).not.toBe(hashDeviceToken(t1));
  });
});

function makeFile(name: string, type: string, buf: Buffer): File {
  return new File([buf], name, { type });
}

describe("PDF upload validation", () => {
  test("valid PDF accepted with correct page count", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage(); pdf.addPage(); pdf.addPage();
    const bytes = await pdf.save();
    const v = await validatePdfUpload(makeFile("test.pdf", "application/pdf", Buffer.from(bytes)));
    expect(v.ok).toBe(true);
    expect(v.pageCount).toBe(3);
    expect(v.checksum).toMatch(/^[a-f0-9]{64}$/);
  });
  test("non-PDF extension rejected", async () => {
    const v = await validatePdfUpload(makeFile("report.exe", "application/pdf", Buffer.from("%PDF-1.4 fake")));
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/PDF files are accepted/i);
  });
  test("renamed executable with %PDF magic but broken structure rejected", async () => {
    // Has PDF magic but invalid xref/structure → must fail integrity check
    const fake = Buffer.from("%PDF-1.4\nthis is not really a pdf body at all\nno trailer");
    const v = await validatePdfUpload(makeFile("virus.pdf", "application/pdf", fake));
    expect(v.ok).toBe(false);
  });
  test("empty file rejected", async () => {
    const v = await validatePdfUpload(makeFile("empty.pdf", "application/pdf", Buffer.alloc(0)));
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/empty/i);
  });
  test("encrypted (password-protected) PDF rejected with clear message", async () => {
    // Handcraft an encrypted-flag PDF: pdf-lib load must fail on encryption.
    const encrypted = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Filter /Standard /V 1 /R 2 /O (x) /U (y) /P -1 >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 1 0 R >>\n%%EOF"
    );
    const v = await validatePdfUpload(makeFile("locked.pdf", "application/pdf", encrypted));
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/password-protected|corrupted|unsupported/i);
  });
  test("wrong declared mime rejected", async () => {
    const pdf = await PDFDocument.create();
    const bytes = await pdf.save();
    const v = await validatePdfUpload(makeFile("doc.pdf", "image/jpeg", Buffer.from(bytes)));
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/Invalid file type/i);
  });
});

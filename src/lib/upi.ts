// Direct UPI payment helpers — NO payment gateway.
// Builds standard UPI deep-link URIs and QR codes that any UPI app
// (GPay / PhonePe / Paytm / BHIM) can scan.

import QRCode from "qrcode";
import crypto from "node:crypto";

const UPI_ID_RE = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9.\-]{1,32}$/;

export function isValidUpiId(vpa: string): boolean {
  return typeof vpa === "string" && UPI_ID_RE.test(vpa.trim());
}

/**
 * Build a UPI payment URI:
 * upi://pay?pa=VPA&pn=NAME&am=AMOUNT&cu=INR&tn=NOTE&tr=REF
 * All params properly percent-encoded. Amount is rupees with 2 decimals.
 */
export function buildUpiUri(opts: {
  payeeUpiId: string;
  payeeName: string;
  amountPaise: number;
  reference: string; // unique payment reference (goes into tr + tn)
  note?: string;
}): string {
  const vpa = opts.payeeUpiId.trim();
  if (!isValidUpiId(vpa)) throw new Error(`Invalid UPI ID: "${vpa}"`);
  if (!opts.payeeName?.trim()) throw new Error("Payee name is required");
  if (!Number.isInteger(opts.amountPaise) || opts.amountPaise <= 0) throw new Error("Amount must be a positive integer of paise");
  if (!opts.reference?.trim()) throw new Error("Payment reference is required");

  const amountRupees = (opts.amountPaise / 100).toFixed(2);
  // encodeURIComponent gives %20 spaces (standard for UPI deep links).
  const params = [
    ["pa", vpa],
    ["pn", opts.payeeName.trim().slice(0, 50)], // UPI spec: max 50 chars
    ["am", amountRupees],
    ["cu", "INR"],
    ["tn", (opts.note ?? `Payment ${opts.reference}`).slice(0, 50)],
    ["tr", opts.reference.slice(0, 35)], // UPI spec: max 35 chars alphanumeric
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join("&");
  return `upi://pay?${params}`;
}

/** Render a UPI URI as a PNG data URL for <img> display. */
export async function upiQrDataUrl(upiUri: string): Promise<string> {
  return QRCode.toDataURL(upiUri, { errorCorrectionLevel: "M", margin: 2, width: 480 });
}

/** Render any text/URL as PNG buffer (shop ordering QR etc.). */
export async function qrPngBuffer(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { errorCorrectionLevel: "M", margin: 3, width: 720 });
}

/**
 * SECURITY TRUTH (documented product behaviour):
 * A generated UPI QR only *requests* a payment. A submitted UTR only *claims*
 * a transfer happened. Neither proves credit until the receiving account owner
 * (or a future bank/PSP API) confirms. This platform therefore implements
 * MANUAL verification by the receiving account owner and never pretends
 * automatic verification. No UPI PINs / OTPs / bank passwords are ever
 * collected by this software.
 */
export const PAYMENT_DISCLAIMER =
  "Pay using any UPI app. Payment is confirmed only after the shop owner verifies the actual credit in their bank/UPI account.";

/** Internal reference generator, e.g. PMT-K4X9F2QW */
export function paymentReference(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

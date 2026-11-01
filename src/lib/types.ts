// Shared domain types & constants for SMART PHOTOCOPY

export const ROLES = ["SUPER_ADMIN", "SHOP_ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const SHOP_STATUSES = ["ACTIVE", "SUSPENDED", "ARCHIVED"] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

export const PAYMENT_STATES = [
  "CREATED",
  "PAYMENT_PENDING",
  "VERIFICATION_PENDING",
  "VERIFIED",
  "REJECTED",
  "EXPIRED",
  "REFUND_PENDING",
  "REFUNDED",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const ORDER_STATES = [
  "PAYMENT_PENDING",
  "VERIFICATION_PENDING",
  "PAID",
  "QUEUED",
  "SPOOLING",
  "PRINTING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const PRINT_JOB_STATES = [
  "QUEUED",
  "DISPATCHED",
  "SPOOLING",
  "SPOOLER_ACCEPTED",
  "PRINTING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type PrintJobState = (typeof PRINT_JOB_STATES)[number];

export const PAPER_SIZES = ["A4", "A3", "LEGAL", "PHOTO_4X6"] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

export const COLOR_MODES = ["BW", "COLOR"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const TZ = "Asia/Kolkata";
export const CURRENCY = "INR";

export const MAX_UPLOAD_MB = 20;
export const MAX_FILES_PER_ORDER = 10;
export const PAYMENT_WINDOW_MINUTES = 60; // UPI payment link validity

export const ORDER_STATUS_LABELS: Record<string, string> = {
  PAYMENT_PENDING: "Awaiting payment",
  VERIFICATION_PENDING: "Payment verification",
  PAID: "Payment confirmed",
  QUEUED: "In print queue",
  SPOOLING: "Sending to printer",
  PRINTING: "Printing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

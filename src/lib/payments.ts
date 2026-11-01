// Payment service — UTR submission, manual verification, duplicate guards.
//
// SECURITY MODEL (honest, no gateway):
// A UPI QR is a *request*. A UTR is a *claim*. Neither proves money arrived.
// Only the receiving account owner's explicit confirmation (here: manual
// verification against their own bank/UPI app) moves money-dependent state
// forward. This module enforces: expected-amount equality, single-use UTRs per
// payee account, one verification per payment, cross-tenant isolation, and a
// strict state machine. A future bank/PSP reconciliation API can replace the
// manual verify step without touching the rest of the system (states & audit
// are already gateway-shaped).

import { db } from "./db";
import { ApiError } from "./guards";
import { activateSubscription } from "./subscriptions";
import { releaseOrderToQueue } from "./printqueue";
import { audit } from "./audit";
import { paymentReference, buildUpiUri } from "./upi";

/** Customer/shop submits a UTR for a pending payment. */
export async function submitUtr(opts: {
  paymentId: string;
  utr: string;
  shopIdScope: string; // tenant scope check (payment must belong to this shop)
  actorType: "CUSTOMER" | "SHOP_ADMIN";
}): Promise<void> {
  const utr = opts.utr.trim().toUpperCase();
  if (!/^[A-Z0-9]{8,30}$/.test(utr)) {
    throw new ApiError(400, "Enter a valid UTR / transaction reference (8-30 letters or digits).");
  }

  const payment = await db.payment.findUnique({ where: { id: opts.paymentId } });
  if (!payment || payment.shopId !== opts.shopIdScope) throw new ApiError(404, "Payment not found");
  if (payment.status === "EXPIRED") throw new ApiError(400, "This payment request has expired. Please start again.");
  if (!["CREATED", "PAYMENT_PENDING", "VERIFICATION_PENDING"].includes(payment.status)) {
    throw new ApiError(400, `This payment is already ${payment.status}.`);
  }

  // Duplicate UTR rejection: same UTR already recorded for the same payee.
  const clash = await db.payment.findFirst({
    where: { utr, payeeUpiId: payment.payeeUpiId, id: { not: payment.id }, status: { in: ["VERIFICATION_PENDING", "VERIFIED", "REFUND_PENDING", "REFUNDED"] } },
  });
  if (clash) {
    await audit({
      actorType: opts.actorType,
      shopId: payment.shopId,
      action: "PAYMENT_UTR_DUPLICATE_REJECTED",
      entityType: "Payment",
      entityId: payment.id,
      meta: { utr, clashPaymentId: clash.id },
    });
    throw new ApiError(409, "This transaction reference has already been submitted. Each payment needs its own UTR.");
  }

  await db.payment.update({
    where: { id: payment.id },
    data: { utr, status: "VERIFICATION_PENDING", utrSubmittedAt: new Date() },
  });
  await audit({
    actorType: opts.actorType,
    shopId: payment.shopId,
    action: "PAYMENT_UTR_SUBMITTED",
    entityType: "Payment",
    entityId: payment.id,
    meta: { utr, reference: payment.reference, amountPaise: payment.amountPaise },
  });
}

export interface VerifyPaymentResult {
  released: boolean;
  activated?: { planCode: string; isLifetime: boolean; expiresAt: Date | null };
}

/**
 * Verify (or reject) a payment. Only the owner of the payee account may
 * verify: subscription payments are verified by SUPER_ADMIN (they own the
 * platform VPA); print-order payments by that SHOP's admin.
 * Verifier must confirm the EXACT expected amount was credited.
 */
export async function verifyPayment(opts: {
  paymentId: string;
  verifierRole: "SUPER_ADMIN" | "SHOP_ADMIN";
  verifierSessionShopId: string | null;
  verifierUserId: string;
  verifierName?: string;
  amountConfirmedPaise: number;
  ip?: string;
}): Promise<VerifyPaymentResult> {
  const payment = await db.payment.findUnique({ where: { id: opts.paymentId } });
  if (!payment) throw new ApiError(404, "Payment not found");

  // Cross-tenant payment verification prevention:
  if (opts.verifierRole === "SHOP_ADMIN") {
    if (!opts.verifierSessionShopId || payment.shopId !== opts.verifierSessionShopId) {
      throw new ApiError(403, "You can only verify payments for your own shop.");
    }
    if (payment.type !== "PRINT_ORDER") {
      throw new ApiError(403, "Subscription payments are verified by the platform owner.");
    }
  } else if (opts.verifierRole === "SUPER_ADMIN") {
    if (payment.type !== "SUBSCRIPTION") {
      throw new ApiError(403, "Customer print payments are verified by the shop owner.");
    }
  }

  if (payment.status === "VERIFIED") throw new ApiError(409, "This payment is already verified.");
  if (!["VERIFICATION_PENDING", "PAYMENT_PENDING", "CREATED"].includes(payment.status)) {
    throw new ApiError(400, `Payment cannot be verified from state ${payment.status}.`);
  }
  if (!payment.utr) throw new ApiError(400, "No UTR submitted yet for this payment.");
  if (opts.amountConfirmedPaise !== payment.amountPaise) {
    throw new ApiError(400, `Amount mismatch: expected exactly ₹${(payment.amountPaise / 100).toFixed(2)}.`);
  }

  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: "VERIFIED",
      verifiedByUserId: opts.verifierUserId,
      verifiedAt: new Date(),
    },
  });

  await audit({
    actorType: opts.verifierRole,
    actorId: opts.verifierUserId,
    actorLabel: opts.verifierName,
    shopId: payment.shopId,
    action: "PAYMENT_VERIFIED",
    entityType: "Payment",
    entityId: payment.id,
    meta: { reference: payment.reference, utr: payment.utr, amountPaise: payment.amountPaise, type: payment.type },
    ip: opts.ip,
  });

  if (payment.type === "SUBSCRIPTION" && payment.planId) {
    await activateSubscription(payment.shopId, payment.planId);
    const plan = await db.subscriptionPlan.findUnique({ where: { id: payment.planId } });
    const sub = await db.subscription.findFirst({ where: { shopId: payment.shopId, planId: payment.planId, status: "ACTIVE" } });
    await audit({
      actorType: "SUPER_ADMIN",
      actorId: opts.verifierUserId,
      shopId: payment.shopId,
      action: "SUBSCRIPTION_ACTIVATED",
      entityType: "Subscription",
      entityId: sub?.id,
      meta: { planCode: plan?.code, isLifetime: plan?.durationDays == null },
    });
    return {
      released: false,
      activated: { planCode: plan?.code ?? "?", isLifetime: plan?.durationDays == null, expiresAt: sub?.expiresAt ?? null },
    };
  }

  // PRINT_ORDER: release the authorized order into the print queue.
  if (payment.orderId) {
    await db.order.update({
      where: { id: payment.orderId },
      data: { status: "PAID", paidAt: new Date() },
    });
    const { addOrderEvent } = await import("./orders");
    await addOrderEvent(payment.orderId, payment.shopId, "PAID", `Payment verified (UTR ${payment.utr})`, "SHOP_ADMIN", opts.verifierUserId);
    await releaseOrderToQueue(payment.orderId, payment.shopId);
    return { released: true };
  }
  return { released: false };
}

export async function rejectPayment(opts: {
  paymentId: string;
  verifierRole: "SUPER_ADMIN" | "SHOP_ADMIN";
  verifierSessionShopId: string | null;
  verifierUserId: string;
  reason: string;
  requeue?: boolean; // true => back to PAYMENT_PENDING for corrected UTR
}): Promise<void> {
  const payment = await db.payment.findUnique({ where: { id: opts.paymentId } });
  if (!payment) throw new ApiError(404, "Payment not found");
  if (opts.verifierRole === "SHOP_ADMIN" && (!opts.verifierSessionShopId || payment.shopId !== opts.verifierSessionShopId)) {
    throw new ApiError(403, "You can only manage payments for your own shop.");
  }
  if (opts.verifierRole === "SUPER_ADMIN" && payment.type !== "SUBSCRIPTION") {
    throw new ApiError(403, "Customer print payments are managed by the shop owner.");
  }
  if (payment.status === "VERIFIED") throw new ApiError(409, "Verified payments cannot be rejected here. Use a refund.");
  if (!["VERIFICATION_PENDING", "PAYMENT_PENDING"].includes(payment.status)) {
    throw new ApiError(400, `Payment cannot be rejected from state ${payment.status}.`);
  }
  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: opts.requeue ? "PAYMENT_PENDING" : "REJECTED",
      rejectionReason: opts.reason.slice(0, 300),
      utr: opts.requeue ? null : payment.utr,
    },
  });
  await audit({
    actorType: opts.verifierRole,
    actorId: opts.verifierUserId,
    shopId: payment.shopId,
    action: "PAYMENT_REJECTED",
    entityType: "Payment",
    entityId: payment.id,
    meta: { reason: opts.reason, reference: payment.reference, requeued: !!opts.requeue },
  });
}

/** Create a subscription payment request (shop pays the PLATFORM UPI). */
export async function createSubscriptionPayment(opts: {
  shopId: string;
  planId: string;
  platformUpiId: string;
  platformPayeeName: string;
}): Promise<{ reference: string; upiUri: string; amountPaise: number }> {
  const plan = await db.subscriptionPlan.findUnique({ where: { id: opts.planId } });
  if (!plan || !plan.isActive) throw new ApiError(400, "Plan not available");
  if (plan.pricePaise <= 0 && plan.code !== "TRIAL") throw new ApiError(400, "Plan price is not configured");
  const reference = paymentReference("SUB");
  const upiUri = buildUpiUri({
    payeeUpiId: opts.platformUpiId,
    payeeName: opts.platformPayeeName,
    amountPaise: plan.pricePaise,
    reference,
    note: `SmartPhotocopy ${plan.code}`,
  });
  await db.payment.create({
    data: {
      type: "SUBSCRIPTION",
      shopId: opts.shopId,
      planId: plan.id,
      reference,
      amountPaise: plan.pricePaise,
      payeeUpiId: opts.platformUpiId,
      payeeName: opts.platformPayeeName,
      upiUri,
      status: "PAYMENT_PENDING",
      expiresAt: new Date(Date.now() + 3 * 86400000), // 3 days to pay
    },
  });
  return { reference, upiUri, amountPaise: plan.pricePaise };
}

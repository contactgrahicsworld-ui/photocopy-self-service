import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, rateLimit, getClientIp, ApiError } from "@/lib/guards";
import { createOrder } from "@/lib/orders";
import { upiQrDataUrl } from "@/lib/upi";
import { getActiveSubscription } from "@/lib/subscriptions";
import { PAPER_SIZES, MAX_FILES_PER_ORDER } from "@/lib/types";
import { audit } from "@/lib/audit";

const ZOD_SIZE_RE = new RegExp(`^(${PAPER_SIZES.join("|")}|CUSTOM:[A-Za-z0-9 \\-]{1,40})$`);

// Customer order creation (no login). All pricing is recalculated server-side.
export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
  const { slug } = await params;
  rateLimit(req, "order-create", 10, 60_000);

  const shop = await db.shop.findUnique({ where: { slug } });
  if (!shop || shop.status !== "ACTIVE") throw new ApiError(404, "Shop not available");
  const sub = await getActiveSubscription(shop.id);
  if (!sub) throw new ApiError(403, "This shop is temporarily not accepting orders");

  const body = await req.json().catch(() => null);
  if (!body) throw new ApiError(400, "Invalid request");
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0 || items.length > MAX_FILES_PER_ORDER) {
    throw new ApiError(400, `Order must contain 1–${MAX_FILES_PER_ORDER} documents`);
  }
  for (const it of items) {
    if (typeof it.documentId !== "string") throw new ApiError(400, "Invalid item");
    if (!ZOD_SIZE_RE.test(String(it.paperSize ?? ""))) throw new ApiError(400, "Unsupported paper size");
    if (!["BW", "COLOR"].includes(it.colorMode)) throw new ApiError(400, "Unsupported colour mode");
    it.copies = Number(it.copies ?? 1);
    it.duplex = !!it.duplex;
    it.fitToPage = it.fitToPage !== false;
    if (it.pageSelection != null && typeof it.pageSelection !== "string") throw new ApiError(400, "Invalid page selection");
  }

  const customerName = typeof body.customerName === "string" ? body.customerName.slice(0, 80) : null;
  const customerPhone = typeof body.customerPhone === "string" ? body.customerPhone.replace(/[^0-9+]/g, "").slice(0, 15) : null;

  const origin = req.headers.get("origin") || `${req.headers.get("x-forwarded-proto") || "http"}://${req.headers.get("host")}`;

  const created = await createOrder({
    shopId: shop.id, // server-side tenant scope — never from the client
    customerName,
    customerPhone,
    items,
    baseUrl: origin,
  });

  const qrDataUrl = await upiQrDataUrl(created.upiUri);

  await audit({
    actorType: "CUSTOMER",
    shopId: shop.id,
    action: "ORDER_CREATED",
    entityType: "Order",
    entityId: created.order.id,
    meta: { orderNumber: created.order.orderNumber, totalPaise: created.totalPaise, items: items.length },
    ip: getClientIp(req),
  });

  return NextResponse.json({
    orderNumber: created.order.orderNumber,
    accessCode: created.order.accessCode,
    statusUrl: `/s/${slug}/status/${created.order.orderNumber}?code=${created.order.accessCode}`,
    totalPaise: created.totalPaise,
    payment: {
      reference: created.paymentRef,
      upiUri: created.upiUri,
      qrDataUrl,
      payeeUpiId: shop.upiId,
      payeeName: shop.upiPayeeName,
      payInstruction: `Pay exactly ₹${(created.totalPaise / 100).toFixed(2)} to ${shop.upiPayeeName} (${shop.upiId}) using any UPI app, then submit the UTR / transaction reference.`,
    },
  });
});

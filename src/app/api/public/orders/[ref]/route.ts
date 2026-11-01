import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, rateLimit, ApiError } from "@/lib/guards";
import { ORDER_STATUS_LABELS } from "@/lib/types";
import { upiQrDataUrl } from "@/lib/upi";

// Public order status — requires orderNumber + accessCode (unguessable pair).
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ ref: string }> }) => {
  const { ref } = await params;
  rateLimit(req, "order-status", 60, 60_000);
  const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase() ?? "";
  if (!code) throw new ApiError(403, "Order access code required");

  const order = await db.order.findFirst({
    where: { orderNumber: ref, accessCode: code },
    include: {
      shop: { select: { name: true, slug: true, upiId: true, upiPayeeName: true } },
      items: true,
      events: { orderBy: { createdAt: "asc" } },
      payments: { where: { type: "PRINT_ORDER" } },
    },
  });
  if (!order) throw new ApiError(404, "Order not found — check your order reference and access code");

  const payment = order.payments[0];
  const qrDataUrl = payment && ["PAYMENT_PENDING", "CREATED"].includes(payment.status) ? await upiQrDataUrl(payment.upiUri) : null;

  return NextResponse.json({
    orderNumber: order.orderNumber,
    shopName: order.shop.name,
    shopSlug: order.shop.slug,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status] ?? order.status,
    createdAt: order.createdAt,
    completedAt: order.completedAt,
    items: order.items.map((i) => ({
      fileName: i.fileName,
      pageCount: i.pageCount,
      pageSelection: i.pageSelection,
      selectedPages: i.selectedPages,
      copies: i.copies,
      paperSize: i.paperSize,
      colorMode: i.colorMode,
      duplex: i.duplex,
      sheets: i.sheets,
      lineTotalPaise: i.lineTotalPaise,
    })),
    subtotalPaise: order.subtotalPaise,
    additionalPaise: order.additionalPaise,
    taxPaise: order.taxPaise,
    totalPaise: order.totalPaise,
    payment: payment
      ? {
          reference: payment.reference,
          status: payment.status,
          amountPaise: payment.amountPaise,
          payeeUpiId: payment.payeeUpiId,
          payeeName: payment.payeeName,
          upiUri: payment.upiUri,
          qrDataUrl,
          utrSubmitted: !!payment.utr,
          rejectionReason: payment.status === "REJECTED" ? payment.rejectionReason : null,
        }
      : null,
    events: order.events.map((e) => ({ status: e.status, note: e.note, at: e.createdAt })),
  });
});

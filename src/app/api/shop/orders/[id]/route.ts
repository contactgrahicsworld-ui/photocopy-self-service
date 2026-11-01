import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireShopAdmin, ApiError } from "@/lib/guards";
import { createFileToken } from "@/lib/auth";
import { upiQrDataUrl } from "@/lib/upi";

// Single order detail — tenant-scoped. Includes event history + print jobs.
export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireShopAdmin();

  const order = await db.order.findFirst({
    where: { id, shopId: session.shopId }, // tenant scope from session
    include: {
      items: { include: { document: true, printJobs: true } },
      events: { orderBy: { createdAt: "asc" } },
      payments: { where: { type: "PRINT_ORDER" } },
    },
  });
  if (!order) throw new ApiError(404, "Order not found");

  const payment = order.payments[0];
  const qrDataUrl = payment && !["VERIFIED", "REJECTED", "EXPIRED", "REFUNDED"].includes(payment.status) ? await upiQrDataUrl(payment.upiUri) : null;

  return NextResponse.json({
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      accessCode: order.accessCode,
      status: order.status,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      subtotalPaise: order.subtotalPaise,
      additionalPaise: order.additionalPaise,
      taxPaise: order.taxPaise,
      totalPaise: order.totalPaise,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      completedAt: order.completedAt,
    },
    items: order.items.map((i) => ({
      id: i.id,
      fileName: i.fileName,
      pageCount: i.pageCount,
      pageSelection: i.pageSelection,
      selectedPages: i.selectedPages,
      copies: i.copies,
      paperSize: i.paperSize,
      colorMode: i.colorMode,
      duplex: i.duplex,
      sheets: i.sheets,
      sides: i.sides,
      lineTotalPaise: i.lineTotalPaise,
      priceSnapshot: JSON.parse(i.priceSnapshot),
      documentId: i.documentId,
      printJobs: i.printJobs.map((j) => ({
        id: j.id,
        status: j.status,
        printerName: j.printerName,
        attempt: j.attempt,
        lastError: j.lastError,
        createdAt: j.createdAt,
      })),
    })),
    payment: payment
      ? {
          id: payment.id,
          reference: payment.reference,
          status: payment.status,
          amountPaise: payment.amountPaise,
          utr: payment.utr,
          utrSubmittedAt: payment.utrSubmittedAt,
          verifiedAt: payment.verifiedAt,
          rejectionReason: payment.rejectionReason,
          payeeUpiId: payment.payeeUpiId,
          qrDataUrl,
        }
      : null,
    events: order.events.map((e) => ({ status: e.status, note: e.note, actorType: e.actorType, at: e.createdAt })),
  });
});

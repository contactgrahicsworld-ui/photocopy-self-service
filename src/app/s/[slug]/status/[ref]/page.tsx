"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatINR, formatIST } from "@/lib/format";
import { ORDER_STATUS_LABELS } from "@/lib/types";
import { Loader2, CheckCircle2, Clock, XCircle } from "lucide-react";

interface OrderStatus {
  orderNumber: string; shopName: string; shopSlug: string; status: string; statusLabel: string;
  createdAt: string; completedAt?: string | null;
  items: { fileName: string; pageCount: number; pageSelection?: string | null; copies: number; paperSize: string; colorMode: string; duplex: boolean; sheets: number; lineTotalPaise: number }[];
  subtotalPaise: number; additionalPaise: number; taxPaise: number; totalPaise: number;
  payment: { reference: string; status: string; amountPaise: number; payeeUpiId: string; payeeName: string; upiUri: string; qrDataUrl?: string | null; utrSubmitted: boolean; rejectionReason?: string | null } | null;
  events: { status: string; note?: string; at: string }[];
}

const DONE = ["QUEUED", "SPOOLING", "PRINTING", "COMPLETED"];
const STEPS = ["PAYMENT_PENDING", "VERIFICATION_PENDING", "PAID", "QUEUED", "COMPLETED"];

export default function OrderStatusPage() {
  const { slug, ref } = useParams<{ slug: string; ref: string }>();
  const params = useSearchParams();
  const code = params.get("code") ?? "";
  const [data, setData] = useState<OrderStatus | null>(null);
  const [err, setErr] = useState<string | null>(() => (code ? null : "Missing order access code — use the link from your order confirmation."));
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!code) return;
    fetch(`/api/public/orders/${ref}?code=${encodeURIComponent(code)}`).then(async (r) => {
      const d = await r.json();
      if (!r.ok) setErr(d.error ?? "Order not found");
      else { setData(d); setErr(null); }
    });
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(load, 8000); // live status polling
    return () => clearInterval(t);
  }, []);

  async function submitUtr() {
    setBusy(true);
    const res = await fetch(`/api/public/orders/${ref}/utr`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, utr }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) load(); else window.alert(d.error ?? "Failed");
  }

  if (err) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 p-6">
        <Card className="max-w-sm w-full"><CardContent className="p-6 text-center space-y-3">
          <XCircle className="h-10 w-10 text-red-500 mx-auto" />
          <p className="text-sm font-medium">{err}</p>
          <Link href={`/s/${slug}`}><Button variant="outline" size="sm">Back to shop</Button></Link>
        </CardContent></Card>
      </div>
    );
  }
  if (!data) return <div className="min-h-screen grid place-items-center bg-slate-50"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>;

  const stepIdx = STEPS.indexOf(data.status) >= 0 ? STEPS.indexOf(data.status) : data.status === "SPOOLING" || data.status === "PRINTING" ? 4 : data.status === "FAILED" || data.status === "CANCELLED" ? -2 : 5;
  const canPay = data.payment && ["PAYMENT_PENDING", "CREATED"].includes(data.payment.status);
  const canUtr = data.payment && data.payment.status === "PAYMENT_PENDING" && !data.payment.utrSubmitted;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b">
        <div className="max-w-md mx-auto px-4 py-3">
          <h1 className="font-bold">{data.shopName}</h1>
          <p className="text-xs text-muted-foreground">Order {data.orderNumber} · {formatIST(data.createdAt)}</p>
        </div>
      </header>
      <main className="flex-1 max-w-md w-full mx-auto px-4 py-4 space-y-4">
        {/* Progress steps */}
        <Card><CardContent className="p-4">
          {stepIdx === -2 ? (
            <div className="flex items-center gap-2 text-red-600"><XCircle className="h-5 w-5" /><span className="font-semibold">{data.statusLabel}</span></div>
          ) : (
            <div className="space-y-2">
              {STEPS.map((s, i) => (
                <div key={s} className="flex items-center gap-2 text-sm">
                  {i < stepIdx ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : i === stepIdx ? <Loader2 className="h-4 w-4 animate-spin text-amber-600" /> : <Clock className="h-4 w-4 text-slate-300" />}
                  <span className={i <= stepIdx ? "font-medium" : "text-muted-foreground"}>{ORDER_STATUS_LABELS[s] ?? s}</span>
                </div>
              ))}
            </div>
          )}
          {data.status === "COMPLETED" && <p className="text-xs text-emerald-700 mt-3">✔ All documents printed — please collect from the counter.</p>}
        </CardContent></Card>

        {/* Payment block */}
        {data.payment && canPay && (
          <Card><CardContent className="p-4 space-y-3 text-center">
            <Badge className="bg-amber-600">Payment pending</Badge>
            <div className="text-2xl font-extrabold">{formatINR(data.payment.amountPaise)}</div>
            <p className="text-xs text-muted-foreground">Pay to {data.payment.payeeName} ({data.payment.payeeUpiId})</p>
            {data.payment.qrDataUrl && <img src={data.payment.qrDataUrl} alt="UPI QR" className="mx-auto w-48 h-48 rounded-lg border bg-white" />}
            <a href={data.payment.upiUri}><Button className="w-full bg-emerald-600 hover:bg-emerald-700">Open UPI app to pay</Button></a>
          </CardContent></Card>
        )}
        {canUtr && (
          <Card><CardContent className="p-4 space-y-2">
            <p className="text-sm font-medium">Paid already? Enter UTR</p>
            <Input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="12-digit UTR from your UPI app" className="font-mono" />
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={utr.trim().length < 8 || busy} onClick={submitUtr}>Submit</Button>
          </CardContent></Card>
        )}
        {data.payment?.rejectionReason && (
          <Alert variant="destructive"><AlertDescription>Payment rejected: {data.payment.rejectionReason}</AlertDescription></Alert>
        )}

        {/* Bill */}
        <Card><CardContent className="p-4 space-y-1.5 text-sm">
          {data.items.map((it) => (
            <div key={it.fileName + it.lineTotalPaise} className="flex justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">{it.fileName} · {it.copies}×{it.paperSize} {it.colorMode === "BW" ? "B/W" : "Colour"}{it.duplex ? " duplex" : ""}{it.pageSelection ? ` · pages ${it.pageSelection}` : ""}</span>
              <span className="shrink-0">{formatINR(it.lineTotalPaise)}</span>
            </div>
          ))}
          {data.additionalPaise > 0 && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Charges</span><span>{formatINR(data.additionalPaise)}</span></div>}
          {data.taxPaise > 0 && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Tax</span><span>{formatINR(data.taxPaise)}</span></div>}
          <div className="flex justify-between font-bold border-t pt-1.5"><span>Total</span><span>{formatINR(data.totalPaise)}</span></div>
        </CardContent></Card>

        {/* History */}
        <Card><CardContent className="p-4 space-y-1.5">
          {data.events.map((e, i) => (
            <div key={i} className="text-xs flex gap-2"><Badge variant="outline" className="shrink-0">{e.status.replace(/_/g, " ")}</Badge><span className="text-muted-foreground">{formatIST(e.at)}</span>{e.note && <span className="min-w-0 truncate">{e.note}</span>}</div>
          ))}
        </CardContent></Card>

        <p className="text-center text-[11px] text-muted-foreground pb-4">This page refreshes automatically · Keep this link to track your order</p>
      </main>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { formatINR } from "@/lib/format";
import { calcItem, paperSizeLabel } from "@/lib/pricing";
import { MAX_FILES_PER_ORDER, ORDER_STATUS_LABELS } from "@/lib/types";
import { Loader2, UploadCloud, FileText, Trash2, XCircle, ShieldCheck, Copy, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ShopInfo {
  shop: { slug: string; name: string; address?: string; phone?: string; businessHours?: string };
  accepting: boolean; reason?: string | null; announcement?: string | null;
  pricing: { paperSize: string; colorMode: string; pricePerSidePaise: number; duplexPricePerSidePaise: number | null }[];
  paperSizes: string[];
  additionalChargePaise: number; additionalChargeLabel?: string; taxPercent: number;
}

interface DocItem {
  documentId: string; fileName: string; pageCount: number;
  copies: number; paperSize: string; colorMode: "BW" | "COLOR"; duplex: boolean; pageSelection: string;
  error?: string;
}

interface OrderResult {
  orderNumber: string; statusUrl: string; totalPaise: number;
  payment: { reference: string; upiUri: string; qrDataUrl: string; payeeUpiId: string; payeeName: string; payInstruction: string };
}

type Stage = "compose" | "pay";

export default function CustomerOrderPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const [info, setInfo] = useState<ShopInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState<Stage>("compose");
  const [result, setResult] = useState<OrderResult | null>(null);
  const [utr, setUtr] = useState("");
  const [utrDone, setUtrDone] = useState(false);

  useEffect(() => {
    fetch(`/api/public/shop/${slug}`).then(async (r) => {
      const d = await r.json();
      if (!r.ok) setLoadErr(d.error ?? "Shop not found");
      else setInfo(d);
    }).catch(() => setLoadErr("Could not reach the shop page. Check your internet."));
  }, [slug]);

  const rules = info?.pricing ?? [];

  const priced = useMemo(() => {
    return docs.map((d) => {
      try {
        const calc = calcItem(
          { pageCount: d.pageCount, pageSelection: d.pageSelection || null, copies: d.copies, paperSize: d.paperSize, colorMode: d.colorMode, duplex: d.duplex },
          rules
        );
        return { doc: d, calc, error: undefined as string | undefined };
      } catch (e) {
        return { doc: d, calc: null, error: e instanceof Error ? e.message : "Invalid settings" };
      }
    });
  }, [docs, rules]);

  const subtotal = priced.reduce((a, p) => a + (p.calc?.lineTotalPaise ?? 0), 0);
  const additional = info?.additionalChargePaise ?? 0;
  const taxPaise = Math.round((subtotal + additional) * ((info?.taxPercent ?? 0) / 100));
  const total = subtotal + additional + taxPaise;

  const upload = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (docs.length + list.length > MAX_FILES_PER_ORDER) {
      toast({ title: `Maximum ${MAX_FILES_PER_ORDER} documents per order`, variant: "destructive" });
      return;
    }
    setUploading(true);
    const fd = new FormData();
    for (const f of list) fd.append("files", f);
    try {
      const res = await fetch(`/api/public/shop/${slug}/upload`, { method: "POST", body: fd });
      const data = await res.json();
      const newDocs: DocItem[] = [];
      for (const r of data.results ?? []) {
        if (!r.ok) {
          toast({ title: `Rejected: ${r.fileName}`, description: r.error, variant: "destructive" });
          continue;
        }
        const availSizes = (info?.paperSizes ?? ["A4"]).filter((s) => rules.some((p) => p.paperSize === s && p.colorMode === "BW"));
        newDocs.push({
          documentId: r.documentId, fileName: r.fileName, pageCount: r.pageCount,
          copies: 1, paperSize: availSizes[0] ?? "A4", colorMode: "BW", duplex: false, pageSelection: "",
        });
      }
      setDocs((prev) => [...prev, ...newDocs]);
    } catch {
      toast({ title: "Upload failed. Check your internet and try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [slug, docs.length, info, rules, toast]);

  async function submitOrder() {
    if (priced.some((p) => p.error)) {
      toast({ title: "Fix the highlighted settings first", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/shop/${slug}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: customerName.trim() || null,
          customerPhone: customerPhone.trim() || null,
          items: priced.map((p) => ({
            documentId: p.doc.documentId,
            pageSelection: p.doc.pageSelection || null,
            copies: p.doc.copies,
            paperSize: p.doc.paperSize,
            colorMode: p.doc.colorMode,
            duplex: p.doc.duplex,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create order");
      setResult(data);
      setStage("pay");
      window.scrollTo({ top: 0 });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Order failed", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitUtr() {
    const res = await fetch(`/api/public/orders/${result!.orderNumber}/utr`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: new URLSearchParams(result!.statusUrl.split("?")[1] ?? "").get("code"), utr }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { setUtrDone(true); toast({ title: "UTR submitted! The shop will verify your payment shortly." }); }
    else toast({ title: data.error ?? "Failed to submit UTR", variant: "destructive" });
  }

  if (loadErr) {
    return (
      <div className="min-h-screen grid place-items-center p-6 bg-slate-50">
        <Card className="max-w-sm w-full"><CardContent className="p-6 text-center space-y-3">
          <XCircle className="h-10 w-10 text-red-500 mx-auto" />
          <p className="font-medium">{loadErr}</p>
        </CardContent></Card>
      </div>
    );
  }
  if (!info) return <div className="min-h-screen grid place-items-center bg-slate-50"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>;

  const paperSizes = info.paperSizes.filter((s) => rules.some((r) => r.paperSize === s));

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-emerald-600 text-white grid place-items-center shrink-0"><FileText className="h-5 w-5" /></div>
          <div className="min-w-0">
            <h1 className="font-bold leading-tight truncate">{info.shop.name}</h1>
            <p className="text-xs text-muted-foreground leading-tight truncate">{info.shop.address ?? ""}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-md w-full mx-auto px-4 py-4 space-y-4">
        {info.announcement && <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900"><AlertDescription>{info.announcement}</AlertDescription></Alert>}

        {!info.accepting && (
          <Alert variant="destructive"><AlertDescription>{info.reason ?? "Not accepting orders right now."}</AlertDescription></Alert>
        )}

        {info.shop.businessHours && <p className="text-xs text-muted-foreground text-center">🕒 {info.shop.businessHours}{info.shop.phone ? ` · 📞 ${info.shop.phone}` : ""}</p>}

        {stage === "compose" && (
          <>
            {/* Upload */}
            <Card>
              <CardContent className="p-4">
                <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={!info.accepting || uploading}
                  className="w-full border-2 border-dashed border-emerald-300 rounded-xl p-6 text-center hover:bg-emerald-50 transition-colors min-h-[120px] disabled:opacity-50"
                  aria-label="Upload PDF files"
                >
                  {uploading ? <Loader2 className="h-8 w-8 mx-auto animate-spin text-emerald-600" /> : <UploadCloud className="h-8 w-8 mx-auto text-emerald-600" />}
                  <p className="mt-2 text-sm font-medium">{uploading ? "Uploading & checking…" : "Tap to upload PDF files"}</p>
                  <p className="text-xs text-muted-foreground mt-1">Max 20 MB per file · up to {MAX_FILES_PER_ORDER} files · password-protected PDFs are rejected</p>
                </button>
              </CardContent>
            </Card>

            {/* Per-document settings */}
            {priced.map((p, idx) => {
              const d = p.doc;
              const upd = (patch: Partial<DocItem>) => setDocs((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
              const sizesHere = paperSizes.filter((s) => rules.some((r) => r.paperSize === s && (d.colorMode === "BW" ? r.colorMode === "BW" : true)));
              return (
                <Card key={d.documentId} className={p.error ? "border-red-300" : ""}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{d.fileName}</p>
                        <p className="text-xs text-muted-foreground">{d.pageCount} pages</p>
                      </div>
                      <Button size="icon" variant="ghost" className="text-destructive shrink-0" aria-label="Remove document" onClick={() => setDocs((prev) => prev.filter((_, i) => i !== idx))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1"><Label className="text-xs">Paper size</Label>
                        <Select value={d.paperSize} onValueChange={(v) => upd({ paperSize: v })}>
                          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                          <SelectContent>{sizesHere.map((s) => <SelectItem key={s} value={s}>{paperSizeLabel(s)}</SelectItem>)}</SelectContent>
                        </Select></div>
                      <div className="space-y-1"><Label className="text-xs">Print mode</Label>
                        <Select value={d.colorMode} onValueChange={(v) => upd({ colorMode: v as "BW" | "COLOR" })}>
                          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="BW">Black &amp; White</SelectItem><SelectItem value="COLOR">Colour</SelectItem></SelectContent>
                        </Select></div>
                      <div className="space-y-1"><Label className="text-xs">Copies</Label>
                        <Input type="number" inputMode="numeric" min={1} max={500} value={d.copies} onChange={(e) => upd({ copies: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} className="h-10" /></div>
                      <div className="space-y-1"><Label className="text-xs">Pages (e.g. 1-3,5 or blank = all)</Label>
                        <Input value={d.pageSelection} onChange={(e) => upd({ pageSelection: e.target.value })} placeholder="all pages" className="h-10" /></div>
                    </div>

                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Double-sided (duplex)</Label>
                      <Switch checked={d.duplex} onCheckedChange={(v) => upd({ duplex: v })} aria-label="Duplex printing" />
                    </div>

                    {p.error ? (
                      <p className="text-xs text-red-600 font-medium">{p.error}</p>
                    ) : p.calc && (
                      <div className="rounded-lg bg-slate-100 p-2.5 text-xs space-y-0.5">
                        <p className="text-muted-foreground">{p.calc.breakdown}</p>
                        <p className="font-bold text-sm">{formatINR(p.calc.lineTotalPaise)}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}

            {/* Customer details (optional) */}
            {docs.length > 0 && (
              <Card><CardContent className="p-4 grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label className="text-xs">Your name (optional)</Label><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="h-10" /></div>
                <div className="space-y-1"><Label className="text-xs">Phone (optional)</Label><Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} inputMode="tel" className="h-10" /></div>
              </CardContent></Card>
            )}

            {/* Bill */}
            {docs.length > 0 && (
              <Card>
                <CardContent className="p-4 space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Printing</span><span>{formatINR(subtotal)}</span></div>
                  {additional > 0 && <div className="flex justify-between"><span className="text-muted-foreground">{info.additionalChargeLabel ?? "Additional charges"}</span><span>{formatINR(additional)}</span></div>}
                  {taxPaise > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax ({info.taxPercent}%)</span><span>{formatINR(taxPaise)}</span></div>}
                  <Separator />
                  <div className="flex justify-between font-bold text-base"><span>Total payable</span><span>{formatINR(total)}</span></div>
                  <p className="text-xs text-muted-foreground">Final price is confirmed server-side before payment.</p>
                </CardContent>
              </Card>
            )}

            <Button
              className="w-full h-12 text-base bg-emerald-600 hover:bg-emerald-700"
              disabled={!info.accepting || docs.length === 0 || submitting || priced.some((p) => p.error)}
              onClick={submitOrder}
            >
              {submitting ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : null}
              Continue to payment {docs.length > 0 ? `· ${formatINR(total)}` : ""}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center pb-4 flex items-center justify-center gap-1"><ShieldCheck className="h-3 w-3" /> No account needed · Pay directly to the shop&apos;s UPI</p>
          </>
        )}

        {stage === "pay" && result && (
          <>
            <Card>
              <CardContent className="p-4 space-y-3 text-center">
                <Badge className="bg-amber-600 mx-auto">{ORDER_STATUS_LABELS.PAYMENT_PENDING}</Badge>
                <p className="text-sm">Order <span className="font-mono font-bold">{result.orderNumber}</span> created</p>
                <div className="text-3xl font-extrabold">{formatINR(result.totalPaise)}</div>
                <p className="text-xs text-muted-foreground">Pay to <b>{result.payment.payeeName}</b> ({result.payment.payeeUpiId})</p>
                <img src={result.payment.qrDataUrl} alt="UPI payment QR" className="mx-auto w-56 h-56 rounded-lg border bg-white" />
                <div className="flex flex-col gap-2">
                  <a href={result.payment.upiUri} className="block">
                    <Button className="w-full h-11 bg-emerald-600 hover:bg-emerald-700"><ExternalLink className="h-4 w-4 mr-1" /> Open UPI app to pay</Button>
                  </a>
                  <Button variant="outline" onClick={() => { navigator.clipboard.writeText(result.payment.reference); toast({ title: "Payment reference copied" }); }}>
                    <Copy className="h-4 w-4 mr-1" /> Copy reference {result.payment.reference}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">{result.payment.payInstruction}</p>
              </CardContent>
            </Card>

            {!utrDone ? (
              <Card>
                <CardContent className="p-4 space-y-3">
                  <Label className="text-sm">After paying, enter the UTR / transaction reference</Label>
                  <Input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. 415223987654" className="h-11 font-mono" />
                  <Button className="w-full h-11 bg-emerald-600 hover:bg-emerald-700" disabled={utr.trim().length < 8} onClick={submitUtr}>Submit payment reference</Button>
                  <p className="text-[11px] text-muted-foreground">Find the 12-digit UTR in your UPI app&apos;s transaction details. The shop confirms your order only after checking the credit in their account.</p>
                </CardContent>
              </Card>
            ) : (
              <Alert className="border-emerald-300 bg-emerald-50"><AlertDescription>UTR submitted. Track your order status below.</AlertDescription></Alert>
            )}

            <Button variant="outline" className="w-full" onClick={() => router.push(result.statusUrl)}>
              View order status
            </Button>
            <Link href={`/s/${slug}`} className="block text-center text-xs text-muted-foreground underline pb-4">Start a new order</Link>
          </>
        )}
      </main>

      <footer className="bg-white border-t py-3 text-center text-[11px] text-muted-foreground">
        Powered by Smart Photocopy · Prices in ₹ · IST
      </footer>
    </div>
  );
}

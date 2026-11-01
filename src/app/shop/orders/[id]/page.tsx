"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatINR, formatIST } from "@/lib/format";
import { Loader2, CheckCircle2, XCircle, Printer, RefreshCw, Copy, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Detail {
  order: { id: string; orderNumber: string; accessCode: string; status: string; customerName?: string; customerPhone?: string; subtotalPaise: number; additionalPaise: number; taxPaise: number; totalPaise: number; createdAt: string; paidAt?: string | null };
  items: { id: string; fileName: string; pageCount: number; pageSelection?: string | null; selectedPages: number; copies: number; paperSize: string; colorMode: string; duplex: boolean; sheets: number; sides: number; lineTotalPaise: number; priceSnapshot: { breakdown: string }; documentId: string; printJobs: { id: string; status: string; printerName?: string | null; attempt: number; lastError?: string | null; createdAt: string }[] }[];
  payment: { id: string; reference: string; status: string; amountPaise: number; utr?: string | null; utrSubmittedAt?: string | null; rejectionReason?: string | null; payeeUpiId: string; qrDataUrl?: string | null } | null;
  events: { status: string; note?: string; actorType: string; at: string }[];
}

const JOB_COLORS: Record<string, string> = { QUEUED: "bg-slate-500", DISPATCHED: "bg-blue-500", SPOOLING: "bg-violet-500", SPOOLER_ACCEPTED: "bg-violet-600", PRINTING: "bg-violet-700", COMPLETED: "bg-emerald-600", FAILED: "bg-red-600", CANCELLED: "bg-slate-400" };

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [printers, setPrinters] = useState<{ id: string; name: string }[]>([]);
  const [confirmAmount, setConfirmAmount] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [requeue, setRequeue] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dlg, setDlg] = useState<"none" | "verify" | "reject">("none");
  const { toast } = useToast();

  const load = useCallback(() => {
    fetch(`/api/shop/orders/${id}`).then(async (r) => (r.ok ? setData(await r.json()) : null));
  }, [id]);
  useEffect(() => { load(); fetch("/api/shop/printers").then(async (r) => r.ok && setPrinters((await r.json()).printers.filter((p: { status: string }) => p.status === "ACTIVE"))); }, [load]);

  if (!data) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const o = data.order;
  const p = data.payment;

  async function verify() {
    setBusy(true);
    const res = await fetch(`/api/shop/orders/${p!.id}/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amountConfirmedPaise: Math.round(parseFloat(confirmAmount) * 100) }) });
    const out = await res.json();
    setBusy(false); setDlg("none"); setConfirmAmount("");
    if (res.ok) { toast({ title: out.released ? "Payment verified — order released to print queue" : "Payment verified" }); load(); }
    else toast({ title: out.error ?? "Failed", variant: "destructive" });
  }

  async function reject() {
    setBusy(true);
    const res = await fetch(`/api/shop/orders/${p!.id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: rejectReason, requeue }) });
    const out = await res.json();
    setBusy(false); setDlg("none"); setRejectReason("");
    if (res.ok) { toast({ title: requeue ? "UTR rejected — customer can resubmit" : "Payment rejected" }); load(); }
    else toast({ title: out.error ?? "Failed", variant: "destructive" });
  }

  async function jobAction(jobId: string, action: "retry" | "reprint", printerId?: string) {
    if (action === "reprint" && !window.confirm("Reprint creates a NEW physical print job. If the original also printed, you may get duplicate output. Continue?")) return;
    const url = action === "retry" ? "retry" : "reprint";
    const res = await fetch(`/api/shop/printjobs/${jobId}/${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: printerId ? JSON.stringify({ printerId }) : "{}" });
    const out = await res.json();
    if (res.ok) { toast({ title: action === "retry" ? "Job re-queued" : "Reprint queued" }); load(); }
    else toast({ title: out.error ?? "Failed", variant: "destructive" });
  }

  async function assign(jobId: string, printerId: string) {
    const res = await fetch(`/api/shop/printjobs/${jobId}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ printerId: printerId === "none" ? null : printerId }) });
    if (res.ok) { toast({ title: "Printer assigned" }); load(); } else toast({ title: (await res.json()).error, variant: "destructive" });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{o.orderNumber}</h1>
          <p className="text-sm text-muted-foreground">{o.customerName ?? "Walk-in"} {o.customerPhone ? `· ${o.customerPhone}` : ""} · {formatIST(o.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{o.status.replace(/_/g, " ")}</Badge>
          <a href={`/s//status/${o.orderNumber}?code=${o.accessCode}`.replace("/s//status", `/api/public/orders/${o.orderNumber}`)} target="_blank" rel="noreferrer" className="hidden" aria-hidden>status</a>
        </div>
      </div>

      {/* Payment verification panel */}
      {p && !["VERIFIED", "REJECTED", "EXPIRED"].includes(p.status) && (
        <Card className={p.status === "VERIFICATION_PENDING" ? "border-amber-300" : ""}>
          <CardHeader className="pb-2"><CardTitle className="text-base">Payment verification</CardTitle>
            <CardDescription>Check the actual credit in YOUR bank/UPI app. Amount must match exactly: <b>{formatINR(p.amountPaise)}</b> · Ref <span className="font-mono">{p.reference}</span></CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              {p.qrDataUrl && <img src={p.qrDataUrl} alt="UPI QR" className="h-28 w-28 rounded border" />}
              <div className="text-sm space-y-1">
                <div>Payee: <b>{p.payeeUpiId}</b></div>
                {p.utr ? <div>UTR submitted: <span className="font-mono font-semibold">{p.utr}</span> {p.utrSubmittedAt && <span className="text-muted-foreground">({formatIST(p.utrSubmittedAt)})</span>}</div> : <div className="text-muted-foreground">Customer has not submitted a UTR yet.</div>}
                {p.rejectionReason && <div className="text-destructive">Previous rejection: {p.rejectionReason}</div>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Dialog open={dlg === "verify"} onOpenChange={(v) => setDlg(v ? "verify" : "none")}>
                <DialogTrigger asChild><Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!p.utr}><CheckCircle2 className="h-4 w-4 mr-1" /> Confirm credit &amp; release print</Button></DialogTrigger>
                <DialogContent><DialogHeader><DialogTitle>Confirm payment credit</DialogTitle></DialogHeader>
                  <Alert><AlertDescription>Only confirm after seeing the credit in your own bank/UPI app. This releases the order to the print queue automatically.</AlertDescription></Alert>
                  <div className="space-y-1.5"><Label>Amount credited (₹) — must equal {formatINR(p.amountPaise)}</Label>
                    <Input inputMode="decimal" value={confirmAmount} onChange={(e) => setConfirmAmount(e.target.value)} placeholder={(p.amountPaise / 100).toFixed(2)} /></div>
                  <DialogFooter><Button onClick={verify} disabled={busy || !confirmAmount} className="bg-emerald-600 hover:bg-emerald-700">{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Confirm</Button></DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog open={dlg === "reject"} onOpenChange={(v) => setDlg(v ? "reject" : "none")}>
                <DialogTrigger asChild><Button variant="outline" disabled={!p.utr}><XCircle className="h-4 w-4 mr-1" /> Reject UTR</Button></DialogTrigger>
                <DialogContent><DialogHeader><DialogTitle>Reject submitted UTR</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1.5"><Label>Reason (visible to customer)</Label><Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="No matching credit found in account" /></div>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={requeue} onChange={(e) => setRequeue(e.target.checked)} /> Let the customer submit a corrected UTR</label>
                  </div>
                  <DialogFooter><Button variant="destructive" onClick={reject} disabled={busy || rejectReason.length < 3}>Reject</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      )}
      {p?.status === "VERIFIED" && (
        <Alert className="border-emerald-300 bg-emerald-50"><CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertDescription>Payment verified{p.utr ? ` (UTR ${p.utr})` : ""}. Print jobs were released automatically.</AlertDescription></Alert>
      )}

      {/* Items + print jobs */}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.items.map((it) => (
          <Card key={it.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold truncate flex items-center gap-2"><Printer className="h-4 w-4 text-emerald-600 shrink-0" />{it.fileName}</CardTitle>
              <CardDescription>{it.priceSnapshot.breakdown}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded bg-slate-50 p-2"><div className="text-muted-foreground">Paper</div><div className="font-medium">{it.paperSize}</div></div>
                <div className="rounded bg-slate-50 p-2"><div className="text-muted-foreground">Mode</div><div className="font-medium">{it.colorMode === "BW" ? "B/W" : "Colour"}{it.duplex ? " · duplex" : ""}</div></div>
                <div className="rounded bg-slate-50 p-2"><div className="text-muted-foreground">Sheets</div><div className="font-medium">{it.sheets} ({it.sides} sides)</div></div>
              </div>

              {it.printJobs.length === 0 && <div className="text-xs text-muted-foreground">No print job yet — releases after payment verification.</div>}
              {it.printJobs.map((j) => (
                <div key={j.id} className="rounded border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs"><Badge className={JOB_COLORS[j.status] ?? "bg-slate-500"}>{j.status.replace(/_/g, " ")}</Badge>
                      <span className="ml-2 text-muted-foreground">try #{j.attempt} · {j.printerName ?? "no printer assigned"}</span></div>
                    <div className="flex gap-1">
                      <Select onValueChange={(v) => assign(j.id, v)} value="">
                        <SelectTrigger className="h-7 w-[140px] text-xs" aria-label="Assign printer"><SelectValue placeholder="Assign…" /></SelectTrigger>
                        <SelectContent>{printers.map((pr) => <SelectItem key={pr.id} value={pr.id}>{pr.name}</SelectItem>)}</SelectContent>
                      </Select>
                      {j.status === "FAILED" && <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => jobAction(j.id, "retry")}><RefreshCw className="h-3 w-3 mr-1" />Retry</Button>}
                      {(j.status === "FAILED" || j.status === "COMPLETED") && <Button size="sm" variant="ghost" className="h-7 px-2 text-amber-700" onClick={() => jobAction(j.id, "reprint")}><Copy className="h-3 w-3 mr-1" />Reprint</Button>}
                    </div>
                  </div>
                  {j.lastError && <div className="text-xs text-red-600">{j.lastError}</div>}
                </div>
              ))}
              <div className="flex justify-between text-sm font-semibold border-t pt-2"><span>Line total</span><span>{formatINR(it.lineTotalPaise)}</span></div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Totals + history */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Bill</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatINR(o.subtotalPaise)}</span></div>
            {o.additionalPaise > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Additional charges</span><span>{formatINR(o.additionalPaise)}</span></div>}
            {o.taxPaise > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{formatINR(o.taxPaise)}</span></div>}
            <div className="flex justify-between font-bold text-base border-t pt-2"><span>Total</span><span>{formatINR(o.totalPaise)}</span></div>
          </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Order history</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-72 overflow-y-auto">
            {data.events.map((e, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <Badge variant="outline" className="shrink-0">{e.status.replace(/_/g, " ")}</Badge>
                <div><div className="text-muted-foreground">{formatIST(e.at)} · {e.actorType}</div>{e.note && <div>{e.note}</div>}</div>
              </div>
            ))}
          </CardContent></Card>
      </div>
    </div>
  );
}

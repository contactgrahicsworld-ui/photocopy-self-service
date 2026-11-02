"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatINR, formatIST, daysUntil } from "@/lib/format";
import { Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SubData {
  subscription: { hasActiveSubscription: boolean; plan: { code: string; name: string; isLifetime: boolean; expiresAt: string | null } | null; usage: { monthlyOrders: number; printers: number } };
  plans: { id: string; code: string; name: string; pricePaise: number; durationDays: number | null; features: string[] }[];
  platformUpiConfigured: boolean;
  recentPayments: { id: string; reference: string; planCode?: string; amountPaise: number; status: string; utr?: string | null; createdAt: string }[];
}

export default function ShopSubscription() {
  const [data, setData] = useState<SubData | null>(null);
  const [pay, setPay] = useState<{ reference: string; qrDataUrl: string; amountPaise: number; upiUri: string; instructions?: string | null; planCode: string } | null>(null);
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const load = useCallback(() => fetch("/api/shop/subscription").then(async (r) => setData(await r.json())), []);
  useEffect(() => { void load(); }, [load]);

  async function choosePlan(planId: string, planCode: string) {
    setBusy(true);
    const res = await fetch("/api/shop/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId }) });
    const out = await res.json();
    setBusy(false);
    if (!res.ok) { toast({ title: out.error, variant: "destructive" }); return; }
    setPay({ ...out, planCode });
  }

  async function submitUtr() {
    setBusy(true);
    const res = await fetch("/api/shop/subscription/utr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference: pay!.reference, utr }) });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) { toast({ title: "UTR submitted — platform owner will verify shortly" }); setPay(null); setUtr(""); load(); }
    else toast({ title: out.error ?? "Submission failed", variant: "destructive" });
  }

  if (!data) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const days = daysUntil(data.subscription.plan?.expiresAt ?? null);

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold">Subscription</h1><p className="text-sm text-muted-foreground">Your plan controls printer, storage and order limits.</p></div>

      {data.subscription.plan ? (
        <Alert className={data.subscription.hasActiveSubscription ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}>
          <CheckCircle2 className={`h-4 w-4 ${data.subscription.hasActiveSubscription ? "text-emerald-600" : "text-red-600"}`} />
          <AlertDescription>
            <b>{data.subscription.plan.name}</b> — {data.subscription.plan.isLifetime ? "lifetime, never expires" : days != null && days >= 0 ? `${days} day(s) remaining (till ${formatIST(data.subscription.plan.expiresAt)})` : "EXPIRED — renew to resume customer ordering"}
            <div className="text-xs mt-1 text-muted-foreground">Usage: {data.subscription.usage.printers} printer(s) · {data.subscription.usage.monthlyOrders} orders this month</div>
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive"><AlertDescription>No active subscription — customer ordering is paused. Choose a plan below.</AlertDescription></Alert>
      )}

      {!data.platformUpiConfigured && <Alert variant="destructive"><AlertDescription>Platform UPI is not configured yet — subscriptions can&apos;t be paid right now. Contact the platform owner.</AlertDescription></Alert>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.plans.map((p) => (
          <Card key={p.id} className="flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between"><CardTitle className="text-base">{p.name}</CardTitle>{data.subscription.plan?.code === p.code && <Badge className="bg-emerald-600">Current</Badge>}</div>
              <CardDescription className="text-2xl font-bold text-foreground">{p.pricePaise === 0 ? "Free" : formatINR(p.pricePaise)}<span className="text-xs font-normal text-muted-foreground">{p.durationDays ? ` / ${p.durationDays} days` : " — lifetime"}</span></CardDescription>
            </CardHeader>
            <CardContent className="mt-auto space-y-3">
              <ul className="text-xs text-muted-foreground space-y-1">
                {p.features.map((f) => <li key={f}>• {f}</li>)}
              </ul>
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={busy || !data.platformUpiConfigured} onClick={() => choosePlan(p.id, p.code)}>
                {p.pricePaise === 0 ? "Start trial" : "Pay by UPI"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent subscription payments</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {data.recentPayments.length === 0 && <p className="text-sm text-muted-foreground">No payments yet.</p>}
          {data.recentPayments.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border-b pb-2 last:border-0">
              <span className="font-mono text-xs">{p.reference}</span>
              <span>{p.planCode}</span><span className="font-semibold">{formatINR(p.amountPaise)}</span>
              {p.utr && <span className="font-mono text-xs text-muted-foreground">UTR {p.utr}</span>}
              <Badge variant={p.status === "VERIFIED" ? "default" : p.status === "REJECTED" ? "destructive" : "secondary"} className={p.status === "VERIFIED" ? "bg-emerald-600" : ""}>{p.status.replace(/_/g, " ")}</Badge>
              <span className="text-xs text-muted-foreground">{formatIST(p.createdAt)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!pay} onOpenChange={(v) => !v && setPay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Pay {formatINR(pay?.amountPaise ?? 0)} — {pay?.planCode}</DialogTitle>
            <DialogDescription>Scan with any UPI app. Ref: <span className="font-mono">{pay?.reference}</span></DialogDescription></DialogHeader>
          {pay && <img src={pay.qrDataUrl} alt="Subscription payment QR" className="mx-auto w-56 h-56 rounded-lg border" />}
          <div className="space-y-1.5">
            <Label>UTR / transaction reference after payment</Label>
            <Input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. 415223987654" className="font-mono" />
          </div>
          <DialogFooter>
            <Button onClick={submitUtr} disabled={busy || utr.trim().length < 8} className="bg-emerald-600 hover:bg-emerald-700">Submit UTR</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

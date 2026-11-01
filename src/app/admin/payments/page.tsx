"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatINR, formatIST } from "@/lib/format";
import { Loader2 } from "lucide-react";

interface Payment {
  id: string; shopName: string; shopSlug: string; planCode?: string; planName?: string; reference: string;
  amountPaise: number; payeeUpiId: string; utr?: string | null; status: string; createdAt: string;
  utrSubmittedAt?: string | null; verifiedAt?: string | null; rejectionReason?: string | null;
}

export default function AdminShopPayments() {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => fetch("/api/admin/payments").then(async (r) => (r.ok ? setPayments((await r.json()).payments) : setErr((await r.json()).error)));
  useEffect(() => { load(); }, []);

  async function verify(p: Payment) {
    const credited = window.prompt(`Check your bank/UPI app for credit of ₹${(p.amountPaise / 100).toFixed(2)} from ${p.shopName}.\n\nEnter the EXACT credited amount in rupees to confirm (e.g. ${(p.amountPaise / 100).toFixed(2)}):`);
    if (!credited) return;
    const paise = Math.round(parseFloat(credited) * 100);
    const res = await fetch(`/api/admin/payments/${p.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amountConfirmedPaise: paise }) });
    const data = await res.json();
    if (res.ok) {
      window.alert(data.activated ? `Subscription activated: ${data.activated.planCode}${data.activated.isLifetime ? " (never expires)" : ""}` : "Payment verified");
      load();
    } else window.alert(data.error ?? "Verification failed");
  }

  async function reject(p: Payment, requeue: boolean) {
    const reason = window.prompt(requeue ? "Reason (customer will resubmit UTR):" : "Reason (final rejection):");
    if (!reason) return;
    const res = await fetch(`/api/admin/payments/${p.id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, requeue }) });
    if (res.ok) { load(); } else window.alert((await res.json()).error);
  }

  if (!payments) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const pending = payments.filter((p) => p.status === "VERIFICATION_PENDING" || p.status === "PAYMENT_PENDING");

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold">Subscription payments</h1><p className="text-sm text-muted-foreground">Verify UTRs against your own bank/UPI app. Platform revenue only — shop print collections stay with the shops.</p></div>

      {pending.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {pending.map((p) => (
            <Card key={p.id} className={p.status === "VERIFICATION_PENDING" ? "border-amber-300" : ""}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{p.shopName} <span className="text-xs text-muted-foreground">(/s/{p.shopSlug})</span></div>
                    <div className="text-sm text-muted-foreground">{p.planName} · {formatINR(p.amountPaise)}</div>
                  </div>
                  <Badge className={p.status === "VERIFICATION_PENDING" ? "bg-amber-600" : ""}>{p.status === "VERIFICATION_PENDING" ? "UTR submitted" : "Awaiting UTR"}</Badge>
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div>Ref: <span className="font-mono">{p.reference}</span> → pay to <span className="font-mono">{p.payeeUpiId}</span></div>
                  {p.utr && <div>UTR: <span className="font-mono font-medium text-foreground">{p.utr}</span> · submitted {formatIST(p.utrSubmittedAt)}</div>}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => verify(p)} disabled={!p.utr}>Confirm credit</Button>
                  <Button size="sm" variant="outline" onClick={() => reject(p, true)} disabled={!p.utr}>Reject (ask new UTR)</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => reject(p, false)} disabled={!p.utr}>Reject finally</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {pending.length === 0 && <Alert><AlertDescription>No payments awaiting verification right now.</AlertDescription></Alert>}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Shop</TableHead><TableHead>Plan</TableHead><TableHead>Amount</TableHead><TableHead>UTR</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm">{p.shopName}</TableCell>
                  <TableCell><Badge variant="outline">{p.planCode}</Badge></TableCell>
                  <TableCell>{formatINR(p.amountPaise)}</TableCell>
                  <TableCell className="font-mono text-xs">{p.utr ?? "—"}</TableCell>
                  <TableCell><Badge variant={p.status === "VERIFIED" ? "default" : p.status === "REJECTED" ? "destructive" : "secondary"} className={p.status === "VERIFIED" ? "bg-emerald-600" : ""}>{p.status}</Badge>{p.rejectionReason && <div className="text-xs text-muted-foreground">{p.rejectionReason}</div>}</TableCell>
                  <TableCell className="text-xs">{formatIST(p.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
    </div>
  );
}

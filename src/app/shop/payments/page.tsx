"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatINR, formatIST } from "@/lib/format";
import { Loader2 } from "lucide-react";

interface Pay { id: string; reference: string; orderNumber?: string; orderStatus?: string; amountPaise: number; utr?: string | null; status: string; createdAt: string; verifiedAt?: string | null; rejectionReason?: string | null }

export default function ShopPayments() {
  const [payments, setPayments] = useState<Pay[] | null>(null);
  useEffect(() => { fetch("/api/shop/payments").then(async (r) => r.ok && setPayments((await r.json()).payments)); }, []);

  if (!payments) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold">Payment records</h1><p className="text-sm text-muted-foreground">Every customer payment request with its UTR and verification trail.</p></div>
      <Card><CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Reference</TableHead><TableHead>UTR</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Created (IST)</TableHead></TableRow></TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="text-sm">{p.orderNumber ?? "—"}<div className="text-xs text-muted-foreground">{p.orderStatus?.replace(/_/g, " ")}</div></TableCell>
                <TableCell className="font-mono text-xs">{p.reference}</TableCell>
                <TableCell className="font-mono text-xs">{p.utr ?? "—"}</TableCell>
                <TableCell className="text-sm font-semibold">{formatINR(p.amountPaise)}</TableCell>
                <TableCell>
                  <Badge variant={p.status === "VERIFIED" ? "default" : p.status === "REJECTED" ? "destructive" : "secondary"} className={p.status === "VERIFIED" ? "bg-emerald-600" : ""}>{p.status.replace(/_/g, " ")}</Badge>
                  {p.rejectionReason && <div className="text-xs text-muted-foreground">{p.rejectionReason}</div>}
                </TableCell>
                <TableCell className="text-xs">{formatIST(p.createdAt)}{p.verifiedAt && <div className="text-muted-foreground">verified {formatIST(p.verifiedAt)}</div>}</TableCell>
              </TableRow>
            ))}
            {payments.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No payment records yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

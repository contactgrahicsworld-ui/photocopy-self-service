"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatINR, formatIST } from "@/lib/format";
import { Loader2 } from "lucide-react";

const STATUSES = ["", "PAYMENT_PENDING", "VERIFICATION_PENDING", "QUEUED", "PRINTING", "COMPLETED", "FAILED", "CANCELLED"];
const STATUS_COLORS: Record<string, string> = {
  PAYMENT_PENDING: "bg-slate-500", VERIFICATION_PENDING: "bg-amber-600", PAID: "bg-blue-600", QUEUED: "bg-violet-600",
  SPOOLING: "bg-violet-600", PRINTING: "bg-violet-700", COMPLETED: "bg-emerald-600", FAILED: "bg-red-600", CANCELLED: "bg-slate-400", REFUNDED: "bg-slate-400",
};

function OrdersInner() {
  const params = useSearchParams();
  const [orders, setOrders] = useState<Array<{ id: string; orderNumber: string; status: string; totalPaise: number; customerName?: string; customerPhone?: string; createdAt: string; itemCount: number; payment?: { utr?: string | null; status: string } | null }> | null>(null);
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [loading, setLoading] = useState(true);

  const load = useCallback((st: string) => {
    setLoading(true);
    fetch(`/api/shop/orders${st ? `?status=${st}` : ""}`).then(async (r) => r.ok && setOrders((await r.json()).orders)).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => load(status), 0);
    return () => clearTimeout(t);
  }, [load, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Orders &amp; print queue</h1>
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors min-h-[32px] ${status === s ? "bg-emerald-600 text-white border-emerald-600" : "bg-white hover:bg-slate-100"}`}>
              {s === "" ? "All" : s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>

      <Card><CardContent className="p-0 overflow-x-auto">
        {loading ? <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : (
          <Table>
            <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>Amount</TableHead><TableHead>UTR</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {(orders ?? []).map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <Link href={`/shop/orders/${o.id}`} className="font-medium hover:underline">{o.orderNumber}</Link>
                    <div className="text-xs text-muted-foreground">{formatIST(o.createdAt)} · {o.itemCount} doc(s)</div>
                  </TableCell>
                  <TableCell className="text-sm">{o.customerName ?? "Walk-in"}<div className="text-xs text-muted-foreground">{o.customerPhone ?? ""}</div></TableCell>
                  <TableCell className="text-sm font-semibold">{formatINR(o.totalPaise)}</TableCell>
                  <TableCell className="font-mono text-xs">{o.payment?.utr ?? "—"}</TableCell>
                  <TableCell><Badge className={STATUS_COLORS[o.status] ?? "bg-slate-500"}>{o.status.replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell className="text-right"><Link href={`/shop/orders/${o.id}`}><Button size="sm" variant="outline">Open</Button></Link></TableCell>
                </TableRow>
              ))}
              {(orders ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No orders{status ? ` with status ${status.replace(/_/g, " ")}` : ""}</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </CardContent></Card>
    </div>
  );
}

export default function ShopOrders() {
  return <Suspense fallback={null}><OrdersInner /></Suspense>;
}

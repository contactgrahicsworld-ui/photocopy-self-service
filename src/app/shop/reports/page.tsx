"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatINR, formatIST } from "@/lib/format";
import { Loader2, Download } from "lucide-react";

interface Report {
  range: string; totalPaise: number; ordersCount: number;
  statusCounts: Record<string, number>;
  verifiedPayments: { reference: string; orderNumber?: string; amountPaise: number; utr?: string; verifiedAt?: string }[];
}

export default function ShopReports() {
  const [range, setRange] = useState<"day" | "week" | "month">("day");
  const [data, setData] = useState<Report | null>(null);

  const load = useCallback((r: string) => fetch(`/api/shop/reports?range=${r}`).then(async (res) => res.ok && setData(await res.json())), []);
  useEffect(() => { load(range); }, [load, range]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Reports</h1>
        <div className="flex gap-1.5">
          {(["day", "week", "month"] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)} className={`rounded-full px-4 py-1.5 text-xs font-medium border min-h-[32px] capitalize ${range === r ? "bg-emerald-600 text-white border-emerald-600" : "bg-white hover:bg-slate-100"}`}>{r === "day" ? "Today" : r === "week" ? "Last 7 days" : "This month"}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Verified collections</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatINR(data?.totalPaise ?? 0)}</div></CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Orders</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{data?.ordersCount ?? 0}</div></CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">By status</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-1">
            {Object.entries(data?.statusCounts ?? {}).map(([k, v]) => <Badge key={k} variant="outline">{k.replace(/_/g, " ")}: {v}</Badge>)}
          </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Verified payments ({data?.verifiedPayments.length ?? 0})</CardTitle>
          <Button size="sm" variant="outline" onClick={() => window.open(`/api/shop/reports?range=${range}&format=csv`, "_blank")}><Download className="h-3 w-3 mr-1" />CSV</Button>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Reference</TableHead><TableHead>UTR</TableHead><TableHead>Amount</TableHead><TableHead>Verified at (IST)</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data?.verifiedPayments ?? []).map((p) => (
                <TableRow key={p.reference}>
                  <TableCell className="text-sm">{p.orderNumber ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{p.reference}</TableCell>
                  <TableCell className="font-mono text-xs">{p.utr ?? "—"}</TableCell>
                  <TableCell className="text-sm font-semibold">{formatINR(p.amountPaise)}</TableCell>
                  <TableCell className="text-xs">{formatIST(p.verifiedAt)}</TableCell>
                </TableRow>
              ))}
              {(data?.verifiedPayments ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No verified payments in this period</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

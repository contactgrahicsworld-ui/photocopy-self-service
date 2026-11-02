"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus } from "lucide-react";
import { formatINR } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

interface Plan {
  id: string; code: string; name: string; pricePaise: number; durationDays: number | null;
  printerLimit: number | null; storageLimitMb: number | null; monthlyOrderLimit: number | null;
  features: string[]; isActive: boolean;
}

export default function AdminPlans() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const { toast } = useToast();
  const [form, setForm] = useState({ code: "", name: "", priceRupees: "", durationDays: "", printerLimit: "", storageLimitMb: "", monthlyOrderLimit: "" });

  const load = useCallback(() => fetch("/api/admin/plans").then(async (r) => setPlans((await r.json()).plans)), []);
  useEffect(() => { void load(); }, [load]);

  async function save(p: Partial<Plan>) {
    const res = await fetch(`/api/admin/plans/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
    toast({ title: res.ok ? "Plan updated" : "Update failed", variant: res.ok ? "default" : "destructive" });
    load();
  }

  async function create() {
    const body = {
      code: form.code.toUpperCase(), name: form.name,
      pricePaise: Math.round(parseFloat(form.priceRupees || "0") * 100),
      durationDays: form.durationDays === "" ? null : Number(form.durationDays),
      printerLimit: form.printerLimit === "" ? null : Number(form.printerLimit),
      storageLimitMb: form.storageLimitMb === "" ? null : Number(form.storageLimitMb),
      monthlyOrderLimit: form.monthlyOrderLimit === "" ? null : Number(form.monthlyOrderLimit),
    };
    const res = await fetch("/api/admin/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    toast({ title: res.ok ? "Plan created" : data.error, variant: res.ok ? "default" : "destructive" });
    if (res.ok) { setForm({ code: "", name: "", priceRupees: "", durationDays: "", printerLimit: "", storageLimitMb: "", monthlyOrderLimit: "" }); load(); }
  }

  function editPrice(p: Plan) {
    const v = window.prompt(`New price (₹) for ${p.name}:`, (p.pricePaise / 100).toFixed(2));
    if (v === null) return;
    save({ id: p.id, pricePaise: Math.round(parseFloat(v) * 100) });
  }

  if (!plans) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold">Subscription plans</h1><p className="text-sm text-muted-foreground">Prices are in ₹. Empty duration = lifetime (never expires).</p></div>

      <Card><CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Price</TableHead><TableHead>Duration</TableHead><TableHead>Limits</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
          <TableBody>
            {plans.map((p) => (
              <TableRow key={p.id}>
                <TableCell><Badge variant="outline">{p.code}</Badge></TableCell>
                <TableCell className="text-sm font-medium">{p.name}</TableCell>
                <TableCell>
                  <button className="underline-offset-2 hover:underline font-medium" onClick={() => editPrice(p)}>{formatINR(p.pricePaise)}</button>
                </TableCell>
                <TableCell className="text-sm">{p.durationDays == null ? <Badge className="bg-emerald-600">Lifetime — never expires</Badge> : `${p.durationDays} days`}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{p.printerLimit ?? "∞"} printers · {p.storageLimitMb ? `${p.storageLimitMb} MB` : "∞"} storage · {p.monthlyOrderLimit ?? "∞"} orders/mo</TableCell>
                <TableCell><Switch checked={p.isActive} onCheckedChange={(v) => save({ id: p.id, isActive: v })} aria-label={`Toggle ${p.code}`} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> Add custom plan</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1"><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="M12" /></div>
          <div className="space-y-1"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="12 Months" /></div>
          <div className="space-y-1"><Label>Price ₹</Label><Input type="number" value={form.priceRupees} onChange={(e) => setForm({ ...form, priceRupees: e.target.value })} placeholder="4999" /></div>
          <div className="space-y-1"><Label>Days (blank=lifetime)</Label><Input type="number" value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: e.target.value })} placeholder="365" /></div>
          <div className="space-y-1"><Label>Printer limit</Label><Input type="number" value={form.printerLimit} onChange={(e) => setForm({ ...form, printerLimit: e.target.value })} placeholder="blank = ∞" /></div>
          <div className="space-y-1"><Label>Storage MB</Label><Input type="number" value={form.storageLimitMb} onChange={(e) => setForm({ ...form, storageLimitMb: e.target.value })} /></div>
          <div className="space-y-1"><Label>Orders / month</Label><Input type="number" value={form.monthlyOrderLimit} onChange={(e) => setForm({ ...form, monthlyOrderLimit: e.target.value })} /></div>
          <div className="flex items-end"><Button className="w-full" onClick={create}>Create plan</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}

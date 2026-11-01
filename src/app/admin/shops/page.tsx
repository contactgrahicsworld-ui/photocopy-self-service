"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatIST } from "@/lib/format";
import { Loader2, Plus, RotateCcw, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Shop {
  id: string; slug: string; name: string; ownerName?: string; phone?: string; status: string; upiConfigured: boolean;
  adminEmail: string | null; subscription: { planName: string; planCode: string; expiresAt: string | null; isLifetime: boolean } | null;
  orderCount: number; printerCount: number; documentCount: number; createdAt: string;
}

export default function AdminShops() {
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", ownerName: "", phone: "", address: "", upiId: "", upiPayeeName: "", adminEmail: "", adminPassword: "" });
  const { toast } = useToast();

  const load = useCallback(() => {
    fetch("/api/admin/shops").then(async (r) => (r.ok ? setShops((await r.json()).shops) : setError((await r.json()).error)));
  }, []);
  useEffect(load, [load]);

  async function createShop() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/admin/shops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOpen(false);
      setForm({ name: "", slug: "", ownerName: "", phone: "", address: "", upiId: "", upiPayeeName: "", adminEmail: "", adminPassword: "" });
      toast({ title: "Shop created", description: `Ordering URL: /s/${data.slug} · 7-day trial activated` });
      load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/admin/shops/${id}/credentials`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    toast({ title: `Shop ${status.toLowerCase()}` });
    load();
  }

  async function resetPassword(shop: Shop) {
    const pw = prompt(`New password for ${shop.adminEmail ?? "admin"} (min 8 chars):`);
    if (!pw || pw.length < 8) { if (pw !== null) toast({ title: "Password must be at least 8 characters", variant: "destructive" }); return; }
    const res = await fetch(`/api/admin/shops/${shop.id}/credentials`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newPassword: pw }) });
    toast({ title: res.ok ? "Password reset" : "Reset failed", variant: res.ok ? "default" : "destructive" });
  }

  if (!shops) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div><h1 className="text-xl font-bold">Shops</h1><p className="text-sm text-muted-foreground">Each shop is an isolated tenant with its own QR, UPI, pricing and queue.</p></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> New shop</Button></DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create shop</DialogTitle></DialogHeader>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1"><Label>Shop name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sri Balaji Xerox" /></div>
              <div className="space-y-1"><Label>URL slug *</Label><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} placeholder="balaji-xerox" /></div>
              <div className="space-y-1"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="9876543210" /></div>
              <div className="col-span-2 space-y-1"><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="space-y-1"><Label>Shop UPI ID</Label><Input value={form.upiId} onChange={(e) => setForm({ ...form, upiId: e.target.value })} placeholder="balaji@upi" /></div>
              <div className="space-y-1"><Label>UPI payee name</Label><Input value={form.upiPayeeName} onChange={(e) => setForm({ ...form, upiPayeeName: e.target.value })} placeholder="Sri Balaji Xerox" /></div>
              <div className="col-span-2 border-t pt-3"><Label className="text-xs text-muted-foreground">FIRST SHOP ADMIN (can be changed later)</Label></div>
              <div className="space-y-1"><Label>Admin email *</Label><Input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} /></div>
              <div className="space-y-1"><Label>Admin password *</Label><Input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={createShop} disabled={busy}>{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Create shop (starts 7-day trial)</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Shop</TableHead><TableHead>Admin</TableHead><TableHead>Subscription</TableHead><TableHead>Usage</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {shops.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">/s/{s.slug} · {formatIST(s.createdAt)}</div>
                  </TableCell>
                  <TableCell className="text-xs">{s.adminEmail}<br /><span className="text-muted-foreground">{s.upiConfigured ? "UPI configured" : "UPI missing"}</span></TableCell>
                  <TableCell className="text-xs">
                    {s.subscription ? (
                      <>
                        <Badge variant="outline" className="mb-1">{s.subscription.planCode}</Badge><br />
                        {s.subscription.isLifetime ? "Never expires" : `till ${formatIST(s.subscription.expiresAt)}`}
                      </>
                    ) : <span className="text-destructive">Expired / none</span>}
                  </TableCell>
                  <TableCell className="text-xs">{s.orderCount} orders · {s.printerCount} printers<br />{s.documentCount} documents</TableCell>
                  <TableCell><Badge variant={s.status === "ACTIVE" ? "default" : "destructive"} className={s.status === "ACTIVE" ? "bg-emerald-600" : ""}>{s.status}</Badge></TableCell>
                  <TableCell className="text-right space-x-1">
                    {s.status === "ACTIVE" ? (
                      <Button size="sm" variant="outline" onClick={() => setStatus(s.id, "SUSPENDED")}>Suspend</Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setStatus(s.id, "ACTIVE")}><RotateCcw className="h-3 w-3 mr-1" />Restore</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => resetPassword(s)} aria-label="Reset admin password"><KeyRound className="h-3 w-3" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {shops.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No shops yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

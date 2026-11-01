"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ShopSettings() {
  const [form, setForm] = useState({ name: "", ownerName: "", phone: "", address: "", businessHours: "", upiId: "", upiPayeeName: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/shop/profile").then(async (r) => {
      const d = await r.json();
      setForm({ name: d.name ?? "", ownerName: d.ownerName ?? "", phone: d.phone ?? "", address: d.address ?? "", businessHours: d.businessHours ?? "", upiId: d.upiId ?? "", upiPayeeName: d.upiPayeeName ?? "" });
      setLoading(false);
    });
  }, []);

  async function save() {
    setBusy(true);
    const res = await fetch("/api/shop/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const out = await res.json();
    toast({ title: res.ok ? "Shop settings saved" : out.error, variant: res.ok ? "default" : "destructive" });
    setBusy(false);
  }

  if (loading) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div><h1 className="text-xl font-bold">Shop settings</h1><p className="text-sm text-muted-foreground">Shown on your customer ordering page. Your UPI ID receives customer payments directly.</p></div>
      <Card>
        <CardContent className="grid sm:grid-cols-2 gap-4 p-6">
          <div className="space-y-1"><Label>Shop name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-1"><Label>Owner name</Label><Input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} /></div>
          <div className="space-y-1"><Label>Contact phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" /></div>
          <div className="space-y-1"><Label>Business hours</Label><Input value={form.businessHours} onChange={(e) => setForm({ ...form, businessHours: e.target.value })} placeholder="Mon–Sat 9 AM – 9 PM" /></div>
          <div className="sm:col-span-2 space-y-1"><Label>Address</Label><Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="sm:col-span-2 border-t pt-4"><Label className="text-xs text-muted-foreground">UPI PAYMENT SETTINGS — money goes DIRECTLY to this account</Label></div>
          <div className="space-y-1"><Label>Your UPI ID / VPA</Label><Input value={form.upiId} onChange={(e) => setForm({ ...form, upiId: e.target.value })} placeholder="yourshop@upi" /></div>
          <div className="space-y-1"><Label>Payee name (seen by customers)</Label><Input value={form.upiPayeeName} onChange={(e) => setForm({ ...form, upiPayeeName: e.target.value })} placeholder={form.name || "Shop name"} /></div>
          <p className="sm:col-span-2 text-xs text-muted-foreground">Double-check the VPA — wrong IDs send customers&apos; money elsewhere. Format: name@bank.</p>
        </CardContent>
      </Card>
      <Button onClick={save} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700"><Save className="h-4 w-4 mr-1" />{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save</Button>
    </div>
  );
}

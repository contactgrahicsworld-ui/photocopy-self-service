"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Plus, Trash2, MonitorSmartphone } from "lucide-react";
import { formatIST } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

interface Printer { id: string; name: string; colorMode: string; paperSizes: string; duplexCapable: boolean; isDefault: boolean; status: string }
interface Device { id: string; name: string; platform?: string; status: string; lastSeenAt?: string | null; lastIp?: string | null }

const SIZES = ["A4", "A3", "LEGAL", "PHOTO_4X6"];

export default function ShopPrinters() {
  const [printers, setPrinters] = useState<Printer[] | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [dlg, setDlg] = useState<"printer" | "device" | "none">("none");
  const [pairing, setPairing] = useState<{ pairingCode: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", colorMode: "BW", duplexCapable: false, isDefault: false, sizes: ["A4"] as string[] });
  const [deviceName, setDeviceName] = useState("");
  const { toast } = useToast();

  const load = useCallback(() => {
    fetch("/api/shop/printers").then(async (r) => r.ok && setPrinters((await r.json()).printers.filter((p: Printer) => p.status !== "RETIRED")));
    fetch("/api/shop/devices").then(async (r) => r.ok && setDevices((await r.json()).devices));
  }, []);
  useEffect(load, [load]);

  async function addPrinter() {
    setBusy(true);
    const res = await fetch("/api/shop/printers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, paperSizes: form.sizes }) });
    const out = await res.json();
    setBusy(false);
    if (res.ok) { toast({ title: "Printer added" }); setDlg("none"); setForm({ name: "", colorMode: "BW", duplexCapable: false, isDefault: false, sizes: ["A4"] }); load(); }
    else toast({ title: out.error, variant: "destructive" });
  }

  async function retire(id: string) {
    if (!window.confirm("Retire this printer? It won't receive new jobs.")) return;
    await fetch(`/api/shop/printers/${id}`, { method: "DELETE" });
    load();
  }

  async function addDevice() {
    setBusy(true);
    const res = await fetch("/api/shop/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: deviceName || "Windows Print Agent" }) });
    const out = await res.json();
    setBusy(false);
    if (res.ok) { setPairing({ pairingCode: out.pairingCode, name: deviceName || "Windows Print Agent" }); setDlg("none"); setDeviceName(""); load(); }
    else toast({ title: out.error, variant: "destructive" });
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this device? Its print agent will immediately lose access.")) return;
    await fetch(`/api/shop/devices/${id}/revoke`, { method: "POST" });
    toast({ title: "Device revoked" });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-xl font-bold">Printers</h1><p className="text-sm text-muted-foreground">Names must match the Windows printer names on the shop PC.</p></div>
        <Dialog open={dlg === "printer"} onOpenChange={(v) => setDlg(v ? "printer" : "none")}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> Add printer</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add printer</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>Windows printer name (exact)</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="HP LaserJet M1136 MFP" /></div>
              <div className="space-y-1"><Label>Colour capability</Label>
                <Select value={form.colorMode} onValueChange={(v) => setForm({ ...form, colorMode: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="BW">Black &amp; White only</SelectItem><SelectItem value="COLOR">Colour</SelectItem><SelectItem value="ANY">Both</SelectItem></SelectContent>
                </Select></div>
              <div><Label className="mb-1.5 block">Supported paper sizes</Label><div className="flex flex-wrap gap-3">
                {SIZES.map((s) => (
                  <label key={s} className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={form.sizes.includes(s)} onCheckedChange={(v) => setForm({ ...form, sizes: v ? [...form.sizes, s] : form.sizes.filter((x) => x !== s) })} />{s}
                  </label>
                ))}
              </div></div>
              <div className="flex flex-col gap-2 text-sm">
                <label className="flex items-center gap-2"><Checkbox checked={form.duplexCapable} onCheckedChange={(v) => setForm({ ...form, duplexCapable: !!v })} />Supports duplex (double-sided) printing</label>
                <label className="flex items-center gap-2"><Checkbox checked={form.isDefault} onCheckedChange={(v) => setForm({ ...form, isDefault: !!v })} />Default printer</label>
              </div>
            </div>
            <DialogFooter><Button onClick={addPrinter} disabled={busy || form.name.trim().length < 2 || form.sizes.length === 0}>Add</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(printers ?? []).map((p) => (
          <Card key={p.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm font-semibold">{p.name}</CardTitle>
                <div className="flex gap-1">{p.isDefault && <Badge className="bg-emerald-600">Default</Badge>}{p.status !== "ACTIVE" && <Badge variant="destructive">{p.status}</Badge>}</div>
              </div>
              <CardDescription>{p.colorMode === "BW" ? "B/W" : p.colorMode === "COLOR" ? "Colour" : "B/W + Colour"}{p.duplexCapable ? " · duplex" : ""} · {(JSON.parse(p.paperSizes) as string[]).join(", ")}</CardDescription>
            </CardHeader>
            <CardContent><Button size="sm" variant="ghost" className="text-destructive" onClick={() => retire(p.id)}><Trash2 className="h-3 w-3 mr-1" />Retire</Button></CardContent>
          </Card>
        ))}
        {printers?.length === 0 && <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No printers yet. Add your first printer to receive print jobs.</CardContent></Card>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div><h2 className="text-lg font-bold flex items-center gap-2"><MonitorSmartphone className="h-5 w-5 text-emerald-600" />Print agent devices</h2>
          <p className="text-sm text-muted-foreground">Windows agents that download &amp; print authorized jobs for THIS shop only.</p></div>
        <Dialog open={dlg === "device"} onOpenChange={(v) => { setDlg(v ? "device" : "none"); if (!v) setPairing(null); }}>
          <DialogTrigger asChild><Button variant="outline"><Plus className="h-4 w-4 mr-1" /> Register device</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Register print agent device</DialogTitle></DialogHeader>
            <div className="space-y-1"><Label>Device name</Label><Input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="Counter PC 1" /></div>
            <DialogFooter><Button onClick={addDevice} disabled={busy}>Generate pairing code</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {pairing && (
        <Alert className="border-emerald-300 bg-emerald-50">
          <AlertDescription>
            <b>Pairing code for “{pairing.name}”</b>: <span className="font-mono text-lg font-bold tracking-widest">{pairing.pairingCode}</span>
            <div className="text-xs mt-1">Valid for 15 minutes, single use. Enter it in the Windows agent&apos;s pairing prompt on the shop PC.</div>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {devices.map((d) => (
          <Card key={d.id}>
            <CardContent className="p-4 flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-sm">{d.name} <Badge variant="outline" className="ml-1">{d.status}</Badge></div>
                <div className="text-xs text-muted-foreground mt-1">{d.platform ?? "windows"} · last seen {d.lastSeenAt ? formatIST(d.lastSeenAt) : "never"}</div>
              </div>
              {d.status !== "REVOKED" && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => revoke(d.id)}>Revoke</Button>}
            </CardContent>
          </Card>
        ))}
        {devices.length === 0 && <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">No devices yet — register one, then pair your Windows agent.</CardContent></Card>}
      </div>
    </div>
  );
}

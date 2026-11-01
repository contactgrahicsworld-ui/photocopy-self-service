"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Rule { paperSize: string; colorMode: string; pricePerSidePaise: number; duplexPricePerSidePaise: number | null; active: boolean }

const ROWS: { paperSize: string; colorMode: "BW" | "COLOR"; label: string }[] = [
  { paperSize: "A4", colorMode: "BW", label: "A4 · Black & White" },
  { paperSize: "A4", colorMode: "COLOR", label: "A4 · Colour" },
  { paperSize: "A3", colorMode: "BW", label: "A3 · Black & White" },
  { paperSize: "A3", colorMode: "COLOR", label: "A3 · Colour" },
  { paperSize: "LEGAL", colorMode: "BW", label: "Legal · Black & White" },
  { paperSize: "LEGAL", colorMode: "COLOR", label: "Legal · Colour" },
  { paperSize: "PHOTO_4X6", colorMode: "COLOR", label: "Photo 4×6 · Colour" },
];

export default function ShopPricing() {
  const [rules, setRules] = useState<Record<string, Rule>>({});
  const [tax, setTax] = useState(0);
  const [additionalRupees, setAdditionalRupees] = useState("");
  const [additionalLabel, setAdditionalLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/shop/pricing").then(async (r) => {
      const data = await r.json();
      const map: Record<string, Rule> = {};
      for (const row of ROWS) {
        const existing = data.rules.find((x: Rule) => x.paperSize === row.paperSize && x.colorMode === row.colorMode);
        map[`${row.paperSize}|${row.colorMode}`] = existing ?? { paperSize: row.paperSize, colorMode: row.colorMode, pricePerSidePaise: -1, duplexPricePerSidePaise: null, active: false };
      }
      for (const r of data.rules) if (!map[`${r.paperSize}|${r.colorMode}`]) map[`${r.paperSize}|${r.colorMode}`] = r;
      setRules(map);
      setTax(data.taxPercent ?? 0);
      setAdditionalRupees(data.additionalChargePaise ? (data.additionalChargePaise / 100).toFixed(2) : "");
      setAdditionalLabel(data.additionalChargeLabel ?? "");
      setLoading(false);
    });
  }, []);

  async function save() {
    setBusy(true);
    const payload = Object.values(rules)
      .filter((r) => r.active && r.pricePerSidePaise >= 0)
      .map((r) => ({ paperSize: r.paperSize, colorMode: r.colorMode, pricePerSidePaise: r.pricePerSidePaise, duplexPricePerSidePaise: r.duplexPricePerSidePaise, active: true }));
    const res = await fetch("/api/shop/pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: payload }) });
    const out = await res.json();
    if (res.ok) {
      const pr = await fetch("/api/shop/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taxPercent: tax, additionalChargePaise: Math.round(parseFloat(additionalRupees || "0") * 100), additionalChargeLabel: additionalLabel }) });
      if (!pr.ok) { toast({ title: (await pr.json()).error, variant: "destructive" }); }
    }
    toast({ title: res.ok ? "Pricing saved — new orders use these rates (old orders keep their snapshot)" : out.error, variant: res.ok ? "default" : "destructive" });
    setBusy(false);
  }

  function upd(key: string, field: keyof Rule, value: unknown) {
    setRules({ ...rules, [key]: { ...rules[key], [field]: value } });
  }

  if (loading) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div><h1 className="text-xl font-bold">Pricing</h1><p className="text-sm text-muted-foreground">Prices are per printed side, in ₹. Server-side calculation — customer apps cannot change them. Duplex rate is optional (defaults to the normal rate).</p></div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-slate-50 text-left text-xs text-muted-foreground">
              <th className="p-3">Paper &amp; mode</th><th className="p-3 w-28">₹ / side</th><th className="p-3 w-28">₹ / side duplex</th><th className="p-3 w-20">Enabled</th>
            </tr></thead>
            <tbody>
              {ROWS.map((row) => {
                const key = `${row.paperSize}|${row.colorMode}`;
                const r = rules[key];
                if (!r) return null;
                return (
                  <tr key={key} className="border-b last:border-0">
                    <td className="p-3 font-medium">{row.label}</td>
                    <td className="p-3"><Input type="number" step="0.01" min="0" inputMode="decimal" disabled={!r.active} className="h-9" value={r.pricePerSidePaise < 0 ? "" : (r.pricePerSidePaise / 100).toFixed(2)} onChange={(e) => upd(key, "pricePerSidePaise", Math.round(parseFloat(e.target.value || "0") * 100))} aria-label={`${row.label} price`} /></td>
                    <td className="p-3"><Input type="number" step="0.01" min="0" inputMode="decimal" disabled={!r.active} className="h-9" value={r.duplexPricePerSidePaise == null ? "" : (r.duplexPricePerSidePaise / 100).toFixed(2)} onChange={(e) => upd(key, "duplexPricePerSidePaise", e.target.value === "" ? null : Math.round(parseFloat(e.target.value) * 100))} aria-label={`${row.label} duplex price`} /></td>
                    <td className="p-3"><Switch checked={r.active} onCheckedChange={(v) => upd(key, "active", v)} aria-label={`Enable ${row.label}`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Charges &amp; tax</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1"><Label>Flat additional charge (₹ per order)</Label><Input type="number" step="0.01" min="0" value={additionalRupees} onChange={(e) => setAdditionalRupees(e.target.value)} placeholder="0" /></div>
          <div className="space-y-1"><Label>Charge label</Label><Input value={additionalLabel} onChange={(e) => setAdditionalLabel(e.target.value)} placeholder="Handling / binding fee" /></div>
          <div className="space-y-1"><Label>Tax (GST %)</Label><Input type="number" step="0.01" min="0" max="28" value={tax} onChange={(e) => setTax(parseFloat(e.target.value || "0"))} /></div>
        </CardContent>
      </Card>

      <Alert><AlertDescription>Every confirmed order stores an immutable snapshot of these rates. Changing prices later never rewrites historical bills.</AlertDescription></Alert>
      <Button onClick={save} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700"><Save className="h-4 w-4 mr-1" />{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save pricing</Button>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AdminSettings() {
  const [vpa, setVpa] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/admin/settings").then(async (r) => {
      const data = await r.json();
      const upi = data.settings?.upi ?? {};
      setVpa(upi.vpa ?? ""); setPayeeName(upi.payeeName ?? ""); setInstructions(upi.instructions ?? "");
      setAnnouncement(data.settings?.announcement?.text ?? "");
      setLoading(false);
    });
  }, []);

  async function save() {
    setBusy(true);
    const res = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ upi: { vpa, payeeName, instructions }, announcement: { text: announcement } }) });
    const data = await res.json().catch(() => ({}));
    toast({ title: res.ok ? "Settings saved" : data.error ?? "Save failed", variant: res.ok ? "default" : "destructive" });
    setBusy(false);
  }

  if (loading) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div><h1 className="text-xl font-bold">Platform settings</h1><p className="text-sm text-muted-foreground">Your UPI ID receives ALL subscription payments. Shop print collections never pass through you.</p></div>

      <Card>
        <CardHeader><CardTitle className="text-base">Super Admin UPI (subscription collections)</CardTitle>
          <CardDescription>Shops see this VPA + QR when paying for plans. Use your personal/business UPI — no gateway involved.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5"><Label>UPI ID / VPA</Label><Input value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="yourname@upi" /></div>
          <div className="space-y-1.5"><Label>Payee name (shown in payer&apos;s UPI app)</Label><Input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="Smart Photocopy" /></div>
          <div className="space-y-1.5"><Label>Payment instructions for shops</Label><Textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Announcement (shown on all shop ordering pages)</CardTitle></CardHeader>
        <CardContent className="space-y-1.5">
          <Textarea rows={2} value={announcement} onChange={(e) => setAnnouncement(e.target.value)} placeholder="e.g. Independence Day offer — 10% off colour prints!" />
        </CardContent>
      </Card>

      {vpa && !/^[\w.\-]{2,64}@[a-zA-Z][\w.\-]{1,32}$/.test(vpa) && (
        <Alert variant="destructive"><AlertDescription>That UPI ID does not look valid. Expected format: name@bank (e.g. qwer1234@okicici)</AlertDescription></Alert>
      )}

      <Button onClick={save} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">{busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save settings</Button>
    </div>
  );
}

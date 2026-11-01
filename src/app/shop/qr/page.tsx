"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Download, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ShopQr() {
  const [slug, setSlug] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/shop/profile").then(async (r) => {
      if (!r.ok) return;
      const d = await r.json();
      if (cancelled) return;
      setSlug(d.slug);
      setOrigin(window.location.origin);
    });
    return () => { cancelled = true; };
  }, []);

  if (!slug) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const orderUrl = `${origin}/s/${slug}`;
  const qrUrl = `/api/shop/qr`;

  return (
    <div className="space-y-4 max-w-xl">
      <div><h1 className="text-xl font-bold">Shop ordering QR</h1><p className="text-sm text-muted-foreground">Print this and display it at your counter. Customers scan → order → pay your UPI.</p></div>
      <Card>
        <CardHeader><CardTitle className="text-base">Ordering page QR</CardTitle>
          <CardDescription className="break-all">{orderUrl}</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {qrUrl ? <img src={qrUrl} alt="Shop ordering QR code" className="mx-auto rounded-lg border w-64 h-64" /> : <Loader2 className="animate-spin mx-auto" />}
          <div className="flex flex-wrap gap-2 justify-center">
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={async () => {
              const res = await fetch(qrUrl!);
              const blob = await res.blob();
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `smart-photocopy-${slug}.png`;
              a.click();
            }}><Download className="h-4 w-4 mr-1" /> Download PNG</Button>
            <Button variant="outline" onClick={() => { navigator.clipboard.writeText(orderUrl); toast({ title: "Ordering URL copied" }); }}><Copy className="h-4 w-4 mr-1" /> Copy link</Button>
          </div>
          <p className="text-xs text-muted-foreground text-center">Tip: print at 10×10 cm or larger for reliable scanning at counter distance.</p>
        </CardContent>
      </Card>
    </div>
  );
}

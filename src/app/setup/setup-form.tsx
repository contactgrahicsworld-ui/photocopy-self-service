"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SetupForm({ setupNeeded }: { setupNeeded: boolean }) {
  const router = useRouter();
  const [setupToken, setSetupToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (password !== confirm) {
      setMsg({ ok: false, text: "Passwords do not match." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupToken, name, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg({ ok: true, text: "Platform owner created. Opening your console…" });
        setTimeout(() => router.push("/admin"), 800);
      } else {
        setMsg({ ok: false, text: data.error || `Setup failed (${res.status})` });
      }
    } catch {
      setMsg({ ok: false, text: "Network error — please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-emerald-600 text-white grid place-items-center">
              <Printer className="h-5 w-5" />
            </div>
            <div className="font-bold">Smart Photocopy</div>
          </Link>
          <Link href="/login"><Button size="sm" variant="outline">Sign in</Button></Link>
        </div>
      </header>

      <main className="flex-1 max-w-md w-full mx-auto px-4 py-12">
        {setupNeeded ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl"><ShieldCheck className="h-5 w-5 text-emerald-600" /> First-time setup</CardTitle>
              <CardDescription>
                Create the Platform Owner account. This is possible only once and only with the server&apos;s SETUP_TOKEN — there are no predefined credentials in this system.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="st-token">Setup token</Label>
                  <Input id="st-token" type="password" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} required placeholder="From the deployment environment (SETUP_TOKEN)" autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-name">Your name</Label>
                  <Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Platform Owner" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-email">Owner email</Label>
                  <Input id="st-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-pass">Password (min 10 chars, letters + numbers)</Label>
                  <Input id="st-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} autoComplete="new-password" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="st-confirm">Confirm password</Label>
                  <Input id="st-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={10} autoComplete="new-password" />
                </div>
                {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-destructive"}`}>{msg.text}</p>}
                <Button type="submit" disabled={busy} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                  {busy ? "Creating…" : "Create platform owner"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Setup already completed</CardTitle>
              <CardDescription>
                A platform owner already exists for this installation. For security, first-time setup is permanently closed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/login"><Button className="bg-emerald-600 hover:bg-emerald-700 text-white">Go to sign in →</Button></Link>
            </CardContent>
          </Card>
        )}
      </main>

      <footer className="mt-auto border-t py-6 text-center text-xs text-muted-foreground">
        Smart Photocopy — multi-tenant SaaS · Prices in ₹ · Times shown in IST (Asia/Kolkata)
      </footer>
    </div>
  );
}

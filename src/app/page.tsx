import Link from "next/link";
import { db } from "@/lib/db";
import { formatINR } from "@/lib/format";
import {
  Printer, QrCode, ShieldCheck, Smartphone, IndianRupee, Store, Building2,
  Rocket, UploadCloud, Banknote, CheckCircle2, ArrowRight, Clock3, FileCheck2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

async function platformState() {
  try {
    const [superAdmins, plans] = await Promise.all([
      db.user.count({ where: { role: "SUPER_ADMIN" } }),
      db.subscriptionPlan.findMany({ orderBy: { sortOrder: "asc" } }),
    ]);
    return { setupNeeded: superAdmins === 0, plans };
  } catch {
    return { setupNeeded: false, plans: [] };
  }
}

export default async function Home() {
  const { setupNeeded, plans } = await platformState();
  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b bg-white/85 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white grid place-items-center shadow-sm shadow-emerald-200">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <div className="font-bold leading-tight tracking-tight">Smart Photocopy</div>
              <div className="text-[11px] text-muted-foreground leading-tight">Scan · Upload · Pay by UPI · Printed</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden sm:block">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link href="/login">
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">Start free trial</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ── First-time setup banner ──────────────────────────────────────── */}
        {setupNeeded && (
          <div className="max-w-6xl mx-auto px-4 pt-6">
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
              <div>
                <p className="font-semibold flex items-center gap-2"><Rocket className="h-4 w-4 text-emerald-700" /> First-time setup pending</p>
                <p className="text-sm text-muted-foreground">This deployment has no platform owner yet. Complete the one-time setup with your SETUP_TOKEN to start onboarding shops.</p>
              </div>
              <Link href="/setup"><Button className="bg-emerald-600 hover:bg-emerald-700 text-white">Open setup →</Button></Link>
            </section>
          </div>
        )}

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(16,185,129,0.10),transparent)]" />
          <div className="max-w-6xl mx-auto px-4 pt-16 pb-14 text-center">
            <Badge variant="outline" className="mb-5 border-emerald-200 text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">
              <IndianRupee className="h-3 w-3 mr-1" /> Direct UPI payments · No gateway · No commissions
            </Badge>
            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-[1.05] mb-5 max-w-3xl mx-auto">
              Your photocopy shop,&nbsp;
              <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">online in minutes</span>
            </h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto mb-8">
              Customers scan your counter QR, upload PDFs, choose print options and pay straight into your UPI ID.
              You verify the credit in your own bank app — the order then enters your print queue automatically.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-14">
              <Link href="/login">
                <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700 text-white px-7 h-11">
                  Create your shop <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="px-7 h-11">Sign in to dashboard</Button>
              </Link>
            </div>

            {/* how it works strip */}
            <div className="grid gap-3 sm:grid-cols-4 max-w-4xl mx-auto text-left">
              {[
                { icon: QrCode, step: "1", title: "Customer scans QR", desc: "No app, no signup" },
                { icon: UploadCloud, step: "2", title: "Uploads PDF & picks options", desc: "Live server-side pricing" },
                { icon: Banknote, step: "3", title: "Pays your UPI directly", desc: "You confirm the credit" },
                { icon: Printer, step: "4", title: "Prints on your Windows PC", desc: "Auto queue, honest status" },
              ].map((s) => (
                <div key={s.step} className="rounded-xl border bg-slate-50/60 p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="h-6 w-6 rounded-full bg-emerald-600 text-white text-xs font-bold grid place-items-center">{s.step}</span>
                    <s.icon className="h-4 w-4 text-emerald-600" />
                  </div>
                  <p className="text-sm font-semibold leading-tight">{s.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Feature cards ────────────────────────────────────────────────── */}
        <section className="max-w-6xl mx-auto px-4 pb-14">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { icon: QrCode, title: "QR ordering, zero friction", desc: "Every shop gets a unique QR + mobile ordering page. Customers order in under a minute — no registration, no app install." },
              { icon: ShieldCheck, title: "Your money stays yours", desc: "Print payments go straight to the shop's UPI ID. Platform subscription fees go to the platform owner's UPI. The two are never mixed." },
              { icon: Smartphone, title: "Windows print agent", desc: "Paired devices pull authorized jobs automatically and print with your settings — colour, duplex, copies — with real spooler status." },
            ].map((f) => (
              <Card key={f.title} className="border-slate-200 hover:border-emerald-300 hover:shadow-md transition-all">
                <CardHeader className="pb-2">
                  <div className="h-10 w-10 rounded-lg bg-emerald-50 grid place-items-center mb-2">
                    <f.icon className="h-5 w-5 text-emerald-600" />
                  </div>
                  <CardTitle className="text-lg">{f.title}</CardTitle>
                </CardHeader>
                <CardContent><CardDescription className="text-sm leading-relaxed">{f.desc}</CardDescription></CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ── Pricing (from the live database) ─────────────────────────────── */}
        {plans.length > 0 && (
          <section className="max-w-6xl mx-auto px-4 pb-14">
            <div className="text-center mb-8">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">Simple subscription for shop owners</h2>
              <p className="text-muted-foreground">Start with a free 7-day trial. Pay by UPI — verified manually, no gateway fees.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {plans.map((p) => {
                const lifetime = p.durationDays == null;
                const features: string[] = (() => {
                  if (!p.features) return [];
                  try { return JSON.parse(p.features) as string[]; } catch { return []; }
                })();
                return (
                  <Card key={p.code} className={`flex flex-col ${p.code === "M6" ? "border-emerald-500 shadow-lg shadow-emerald-100 relative" : ""}`}>
                    {p.code === "M6" && (
                      <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-emerald-600 text-white">Most popular</Badge>
                    )}
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{p.name}</CardTitle>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-extrabold tracking-tight">{p.pricePaise === 0 ? "Free" : formatINR(p.pricePaise)}</span>
                        {!lifetime && p.pricePaise > 0 && <span className="text-xs text-muted-foreground">/ {p.durationDays} days</span>}
                        {lifetime && <span className="text-xs text-muted-foreground">one-time</span>}
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col">
                      <ul className="text-sm space-y-1.5 mb-4 flex-1">
                        {features.map((f) => (
                          <li key={f} className="flex items-start gap-1.5 text-muted-foreground">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />{f}
                          </li>
                        ))}
                      </ul>
                      <Link href="/login">
                        <Button size="sm" variant={p.code === "M6" ? "default" : "outline"} className={`w-full ${p.code === "M6" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`}>
                          {p.pricePaise === 0 ? "Start free trial" : "Choose plan"}
                        </Button>
                      </Link>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Two audiences ───────────────────────────────────────────────── */}
        <section className="max-w-6xl mx-auto px-4 pb-14 grid gap-4 md:grid-cols-2">
          <Link href="/login" className="block">
            <Card className="h-full hover:border-emerald-400 hover:shadow-md transition-all">
              <CardHeader className="pb-2">
                <div className="h-10 w-10 rounded-lg bg-emerald-50 grid place-items-center mb-2">
                  <Store className="h-5 w-5 text-emerald-600" />
                </div>
                <CardTitle className="text-lg">Shop owners</CardTitle>
                <CardDescription>Dashboard for orders, payments & UTR verification, pricing, printers, devices, QR poster and reports.</CardDescription>
              </CardHeader>
              <CardContent><Button variant="outline" size="sm">Shop sign in →</Button></CardContent>
            </Card>
          </Link>
          <Link href="/login" className="block">
            <Card className="h-full hover:border-emerald-400 hover:shadow-md transition-all">
              <CardHeader className="pb-2">
                <div className="h-10 w-10 rounded-lg bg-emerald-50 grid place-items-center mb-2">
                  <Building2 className="h-5 w-5 text-emerald-600" />
                </div>
                <CardTitle className="text-lg">Platform owner</CardTitle>
                <CardDescription>Super Admin console — onboard shops, manage plans, verify subscription UTRs and audit every action.</CardDescription>
              </CardHeader>
              <CardContent><Button variant="outline" size="sm">Admin sign in →</Button></CardContent>
            </Card>
          </Link>
        </section>

        {/* ── Trust / honest payment model ────────────────────────────────── */}
        <section className="max-w-6xl mx-auto px-4 pb-16">
          <div className="rounded-2xl border bg-gradient-to-b from-slate-50 to-white p-6 sm:p-8">
            <div className="grid gap-6 md:grid-cols-3 items-start">
              <div className="md:col-span-1">
                <p className="font-semibold flex items-center gap-2 mb-2"><FileCheck2 className="h-4 w-4 text-emerald-600" /> Honest payment model</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  A UPI QR only <em>requests</em> a payment and a submitted UTR only <em>claims</em> one — neither proves money arrived.
                  So Smart Photocopy uses manual verification by the receiving account owner, with duplicate-UTR prevention,
                  exact-amount checks and a full audit trail. We never collect UPI PINs, OTPs or banking passwords.
                </p>
              </div>
              <div className="md:col-span-2 grid gap-3 sm:grid-cols-3">
                {[
                  { icon: Clock3, title: "Orders in real time", desc: "Dashboard and queue update the moment an order or UTR arrives." },
                  { icon: ShieldCheck, title: "Tenant isolation", desc: "Every query is scoped by shop — data of one shop can never leak to another." },
                  { icon: IndianRupee, title: "0% commission", desc: "Only the flat subscription. Your print income is 100% yours." },
                ].map((t) => (
                  <div key={t.title} className="rounded-xl border bg-white p-4">
                    <t.icon className="h-4 w-4 text-emerald-600 mb-1.5" />
                    <p className="text-sm font-semibold">{t.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-6">
        <div className="max-w-6xl mx-auto px-4 text-center text-xs text-muted-foreground">
          Smart Photocopy — multi-tenant SaaS · Prices in ₹ · Times shown in IST (Asia/Kolkata)
        </div>
      </footer>
    </div>
  );
}

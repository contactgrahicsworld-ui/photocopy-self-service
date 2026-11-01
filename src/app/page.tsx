import Link from "next/link";
import { Printer, QrCode, ShieldCheck, Smartphone, IndianRupee, Store, Building2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-emerald-600 text-white grid place-items-center">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <div className="font-bold leading-tight">Smart Photocopy</div>
              <div className="text-xs text-muted-foreground leading-tight">Scan · Upload · Pay by UPI · Printed</div>
            </div>
          </div>
          <Link href="/login">
            <Button size="sm">Sign in</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-10">
        <section className="text-center mb-12">
          <Badge variant="outline" className="mb-4 border-emerald-200 text-emerald-700 bg-emerald-50">
            <IndianRupee className="h-3 w-3 mr-1" /> Direct UPI payments · No gateway
          </Badge>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-4">
            The complete ordering &amp; printing platform for photocopy shops
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Customers scan your shop&apos;s QR, upload PDFs, choose print options and pay directly to your UPI ID.
            You verify the credit in your own bank app — then the order enters your print queue automatically.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3 mb-12">
          {[
            { icon: QrCode, title: "QR ordering, no app", desc: "Each shop gets a unique QR and ordering page. Customers order without registration." },
            { icon: ShieldCheck, title: "You control payments", desc: "Money goes straight to your UPI ID. Platform subscription fees go to the platform owner's UPI. Never mixed." },
            { icon: Smartphone, title: "Windows print agent", desc: "Authorized jobs reach your Windows PC and print with your settings — colour, duplex, copies." },
          ].map((f) => (
            <Card key={f.title}>
              <CardHeader className="pb-2">
                <f.icon className="h-6 w-6 text-emerald-600 mb-2" />
                <CardTitle className="text-lg">{f.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>{f.desc}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid gap-4 md:grid-cols-3 mb-12">
          <Link href="/login" className="block">
            <Card className="h-full hover:border-emerald-400 transition-colors">
              <CardHeader className="pb-2">
                <Store className="h-6 w-6 text-emerald-600 mb-2" />
                <CardTitle className="text-lg">Shop owners</CardTitle>
                <CardDescription>Sign in to your shop dashboard — orders, payments, pricing, printers and reports.</CardDescription>
              </CardHeader>
              <CardContent><Button variant="outline" size="sm">Shop sign in →</Button></CardContent>
            </Card>
          </Link>
          <Link href="/login" className="block">
            <Card className="h-full hover:border-emerald-400 transition-colors">
              <CardHeader className="pb-2">
                <Building2 className="h-6 w-6 text-emerald-600 mb-2" />
                <CardTitle className="text-lg">Platform owner</CardTitle>
                <CardDescription>Super Admin console — shops, subscription plans, UTR verification and audit logs.</CardDescription>
              </CardHeader>
              <CardContent><Button variant="outline" size="sm">Admin sign in →</Button></CardContent>
            </Card>
          </Link>
          <Link href="/s/demo-shop" className="block">
            <Card className="h-full hover:border-emerald-400 transition-colors">
              <CardHeader className="pb-2">
                <QrCode className="h-6 w-6 text-emerald-600 mb-2" />
                <CardTitle className="text-lg">Customer demo</CardTitle>
                <CardDescription>Try the mobile ordering flow on the demo shop (labelled DEMO data).</CardDescription>
              </CardHeader>
              <CardContent><Button variant="outline" size="sm">Open demo shop →</Button></CardContent>
            </Card>
          </Link>
        </section>

        <section className="rounded-xl border bg-slate-50 p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Honest payment model</p>
          A UPI QR only <em>requests</em> a payment and a submitted UTR only <em>claims</em> one — neither proves money arrived.
          Smart Photocopy therefore uses manual verification by the receiving account owner (platform owner for subscriptions, shop owner for print orders), with duplicate-UTR prevention, amount checks and a full audit trail. A bank/PSP verification API can be added later without redesign. We never collect UPI PINs, OTPs or banking passwords.
        </section>
      </main>

      <footer className="mt-auto border-t py-6 text-center text-xs text-muted-foreground">
        Smart Photocopy — multi-tenant SaaS · Prices in ₹ · Times shown in IST (Asia/Kolkata)
      </footer>
    </div>
  );
}

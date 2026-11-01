"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatINR, formatIST, daysUntil } from "@/lib/format";
import { Loader2, AlertTriangle, ExternalLink } from "lucide-react";

interface Dash {
  shop: { name: string; slug: string; status: string; upiConfigured: boolean };
  stats: { collectionsTodayPaise: number; ordersToday: number; newOrdersToday: number; pendingVerification: number; activeQueue: number; failedJobs: number };
  recentOrders: { id: string; orderNumber: string; status: string; totalPaise: number; customerName?: string; createdAt: string }[];
  subscription: { hasActiveSubscription: boolean; plan: { code: string; name: string; isLifetime: boolean; expiresAt: string | null } | null; usage: { monthlyOrders: number; printers: number } };
}

const STATUS_COLORS: Record<string, string> = {
  PAYMENT_PENDING: "bg-slate-500", VERIFICATION_PENDING: "bg-amber-600", PAID: "bg-blue-600", QUEUED: "bg-violet-600",
  SPOOLING: "bg-violet-600", PRINTING: "bg-violet-700", COMPLETED: "bg-emerald-600", FAILED: "bg-red-600", CANCELLED: "bg-slate-400",
};

export default function ShopDashboard() {
  const [data, setData] = useState<Dash | null>(null);
  useEffect(() => {
    fetch("/api/shop/dashboard").then(async (r) => r.ok && setData(await r.json()));
  }, []);

  if (!data) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const s = data.stats;
  const days = daysUntil(data.subscription.plan?.expiresAt ?? null);

  return (
    <div className="space-y-6">
      {!data.subscription.hasActiveSubscription && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Your subscription has expired — the customer ordering page is paused. <Link href="/shop/subscription" className="underline font-medium">Renew now</Link></AlertDescription>
        </Alert>
      )}
      {!data.shop.upiConfigured && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription>Your UPI ID is not configured — customers can&apos;t pay. <Link href="/shop/settings" className="underline font-medium">Set it up</Link></AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{data.shop.name}</h1>
          <p className="text-sm text-muted-foreground">Today · {formatIST(new Date())}</p>
        </div>
        <Link href={`/s/${data.shop.slug}`} target="_blank">
          <Button variant="outline" size="sm"><ExternalLink className="h-3 w-3 mr-1" /> View ordering page</Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card><CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Collections today</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatINR(s.collectionsTodayPaise)}</div><div className="text-xs text-muted-foreground">{s.ordersToday} orders today</div></CardContent></Card>
        <Link href="/shop/orders?status=VERIFICATION_PENDING"><Card className="hover:border-amber-400 transition-colors"><CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Awaiting payment verification</CardTitle></CardHeader>
          <CardContent><div className={`text-2xl font-bold ${s.pendingVerification > 0 ? "text-amber-600" : ""}`}>{s.pendingVerification}</div><div className="text-xs text-muted-foreground">{s.newOrdersToday} new orders today</div></CardContent></Card></Link>
        <Link href="/shop/orders"><Card className="hover:border-emerald-400 transition-colors"><CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Active print queue</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{s.activeQueue}</div><div className={`text-xs ${s.failedJobs > 0 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>{s.failedJobs} failed job(s)</div></CardContent></Card></Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent orders</CardTitle>
          <CardDescription>Latest activity across your shop</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.recentOrders.length === 0 && <p className="text-sm text-muted-foreground">No orders yet — share your shop QR!</p>}
          {data.recentOrders.map((o) => (
            <Link key={o.id} href={`/shop/orders/${o.id}`} className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-slate-50 transition-colors">
              <div className="min-w-0">
                <div className="font-medium text-sm">{o.orderNumber} <span className="text-muted-foreground font-normal">· {o.customerName ?? "Walk-in customer"}</span></div>
                <div className="text-xs text-muted-foreground">{formatIST(o.createdAt)}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-semibold">{formatINR(o.totalPaise)}</span>
                <Badge className={STATUS_COLORS[o.status] ?? "bg-slate-500"}>{o.status.replace(/_/g, " ")}</Badge>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>

      {data.subscription.plan && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <span className="font-medium">{data.subscription.plan.name}</span>
              <span className="text-muted-foreground"> · {data.subscription.usage.printers} printer(s) · {data.subscription.usage.monthlyOrders} orders this month</span>
            </div>
            <Badge variant="outline" className={days != null && days <= 3 ? "border-red-300 text-red-700" : ""}>
              {data.subscription.plan.isLifetime ? "Lifetime — never expires" : days != null && days >= 0 ? `${days} day(s) remaining` : "Expired"}
            </Badge>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

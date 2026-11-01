"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatINR, formatIST } from "@/lib/format";
import { Loader2, AlertTriangle } from "lucide-react";

interface Overview {
  shops: { total: number; active: number; suspended: number };
  orders: { total: number; today: number };
  subscriptionRevenue: { totalPaise: number; thisMonthPaise: number; verifiedCount: number };
  pendingSubscriptionVerifications: number;
  activeSubscriptions: number;
  storageBytes: number;
  documentCount: number;
  recentShops: { id: string; slug: string; name: string; status: string; createdAt: string }[];
  health: { db: string; time: string };
}

export default function AdminOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/overview").then(async (r) => (r.ok ? setData(await r.json()) : setErr((await r.json()).error)));
  }, []);

  if (err) return <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>;
  if (!data) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const stats = [
    { label: "Shops", value: `${data.shops.active} active`, sub: `${data.shops.total} total · ${data.shops.suspended} suspended` },
    { label: "Subscription revenue", value: formatINR(data.subscriptionRevenue.totalPaise), sub: `${formatINR(data.subscriptionRevenue.thisMonthPaise)} this month · ${data.subscriptionRevenue.verifiedCount} verified payments` },
    { label: "Orders (all shops)", value: String(data.orders.total), sub: `${data.orders.today} today` },
    { label: "Active subscriptions", value: String(data.activeSubscriptions), sub: `${data.pendingSubscriptionVerifications} payments awaiting your verification` },
  ];

  return (
    <div className="space-y-6">
      {data.pendingSubscriptionVerifications > 0 && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {data.pendingSubscriptionVerifications} subscription payment(s) are waiting for UTR verification.{" "}
            <a href="/admin/payments" className="underline font-medium">Review now</a>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground font-medium">{s.label}</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recently added shops</CardTitle>
            <CardDescription>Latest tenants onboarded</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recentShops.length === 0 && <p className="text-sm text-muted-foreground">No shops yet. Create your first shop under “Shops”.</p>}
            {data.recentShops.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{s.name}</div>
                  <div className="text-xs text-muted-foreground">/s/{s.slug} · {formatIST(s.createdAt)}</div>
                </div>
                <Badge variant={s.status === "ACTIVE" ? "default" : "destructive"} className={s.status === "ACTIVE" ? "bg-emerald-600" : ""}>{s.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Platform health</CardTitle>
            <CardDescription>Storage and service status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Database</span><Badge className="bg-emerald-600">{data.health.db}</Badge></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Customer documents</span><span>{data.documentCount}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Storage used</span><span>{(data.storageBytes / 1048576).toFixed(1)} MB</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Server time (UTC)</span><span className="text-xs">{new Date(data.health.time).toLocaleString()}</span></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

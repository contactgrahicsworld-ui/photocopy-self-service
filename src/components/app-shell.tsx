"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Printer, LogOut, Menu, X, LayoutDashboard, ClipboardList, IndianRupee, Settings, BarChart3, CreditCard, FileText, QrCode, Landmark, Store, ScrollText, BadgeIndianRupee } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Nav defined CLIENT-SIDE: React components (icons) must not cross the
// server→client boundary. Layouts only pass a navKey.
const NAVS = {
  SUPER_ADMIN: [
    { href: "/admin", label: "Overview", icon: LayoutDashboard },
    { href: "/admin/shops", label: "Shops", icon: Store },
    { href: "/admin/payments", label: "Subscription payments", icon: CreditCard },
    { href: "/admin/plans", label: "Plans", icon: BadgeIndianRupee },
    { href: "/admin/settings", label: "Settings", icon: Settings },
    { href: "/admin/audit", label: "Audit logs", icon: ScrollText },
  ],
  SHOP_ADMIN: [
    { href: "/shop", label: "Dashboard", icon: LayoutDashboard },
    { href: "/shop/orders", label: "Orders & queue", icon: ClipboardList },
    { href: "/shop/payments", label: "Payment records", icon: Landmark },
    { href: "/shop/pricing", label: "Pricing", icon: IndianRupee },
    { href: "/shop/printers", label: "Printers & devices", icon: Printer },
    { href: "/shop/documents", label: "Documents", icon: FileText },
    { href: "/shop/reports", label: "Reports", icon: BarChart3 },
    { href: "/shop/qr", label: "Shop QR", icon: QrCode },
    { href: "/shop/subscription", label: "Subscription", icon: CreditCard },
    { href: "/shop/settings", label: "Shop settings", icon: Settings },
  ],
} as const;

export function AppShell({
  role,
  children,
}: {
  nav?: unknown;
  children: React.ReactNode;
  role: "SUPER_ADMIN" | "SHOP_ADMIN";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<{ name?: string; email?: string } | null>(null);
  const [open, setOpen] = useState(false);
  const nav = NAVS[role];

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => {});
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const sidebar = (
    <nav className="p-3 space-y-1" aria-label="Dashboard navigation">
      {nav.map((item) => {
        const active = pathname === item.href || (item.href !== "/admin" && item.href !== "/shop" && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors min-h-[44px]",
              active ? "bg-emerald-600 text-white" : "text-slate-700 hover:bg-slate-100"
            )}
          >
            {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b sticky top-0 z-20">
        <div className="h-14 px-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Toggle menu" onClick={() => setOpen(!open)}>
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <Link href="/" className="flex items-center gap-2 min-w-0">
              <div className="h-8 w-8 rounded-md bg-emerald-600 text-white grid place-items-center shrink-0">
                <Printer className="h-4 w-4" />
              </div>
              <div className="font-semibold truncate">Smart Photocopy <span className="hidden sm:inline text-muted-foreground font-normal">— {role === "SUPER_ADMIN" ? "Platform" : "Shop"} Console</span></div>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:block text-right">
              <div className="text-sm font-medium leading-tight truncate max-w-[200px]">{me?.name ?? "…"}</div>
              <div className="text-xs text-muted-foreground leading-tight">{me?.email}</div>
            </div>
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={logout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex w-full max-w-7xl mx-auto">
        <aside className="hidden lg:block w-60 shrink-0 border-r bg-white min-h-[calc(100vh-3.5rem)] sticky top-14 self-start">
          {sidebar}
        </aside>
        {open && (
          <div className="lg:hidden fixed inset-0 top-14 z-10 bg-black/30" onClick={() => setOpen(false)}>
            <aside className="w-64 h-full bg-white border-r" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
          </div>
        )}
        <main className="flex-1 min-w-0 p-4 sm:p-6">{children}</main>
      </div>

      <footer className="mt-auto border-t bg-white py-3 text-center text-xs text-muted-foreground">
        Prices in ₹ (INR) · Times in IST · Smart Photocopy SaaS
      </footer>
    </div>
  );
}

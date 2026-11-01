import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "SHOP_ADMIN") redirect("/admin");

  return (
    <AppShell role="SHOP_ADMIN">
      {children}
    </AppShell>
  );
}

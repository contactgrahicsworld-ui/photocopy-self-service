import { db } from "@/lib/db";
import SetupForm from "./setup-form";

// One-time platform bootstrap page. If a SUPER_ADMIN already exists this page
// explains that setup is closed and links to sign-in.
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const count = await db.user.count({ where: { role: "SUPER_ADMIN" } }).catch(() => 1);
  return <SetupForm setupNeeded={count === 0} />;
}

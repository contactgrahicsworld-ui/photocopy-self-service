import { NextResponse } from "next/server";
import { handler, requireSession } from "@/lib/guards";

export const GET = handler(async () => {
  const s = await requireSession();
  return NextResponse.json({ uid: s.uid, role: s.role, shopId: s.shopId, name: s.name, email: s.email });
});

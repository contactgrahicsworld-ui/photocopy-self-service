// Provision or reset a Super Admin account. NO public registration exists —
// this is the only way a Super Admin is created.
// Usage: SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... bun scripts/create-superadmin.ts

import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function main() {
  const email = (process.env.SUPER_ADMIN_EMAIL || "").toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD || "";
  if (!email || !password) {
    console.error("Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD environment variables.");
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("SUPER_ADMIN_PASSWORD must be at least 10 characters.");
    process.exit(1);
  }
  const user = await db.user.upsert({
    where: { email },
    update: { role: "SUPER_ADMIN", passwordHash: hashPassword(password), isActive: true, shopId: null },
    create: {
      email,
      name: process.env.SUPER_ADMIN_NAME || "Platform Owner",
      role: "SUPER_ADMIN",
      passwordHash: hashPassword(password),
    },
  });
  console.log(`✔ Super Admin ready: ${user.email}`);
}

main().catch((e) => (console.error(e), process.exit(1))).finally(() => db.$disconnect());

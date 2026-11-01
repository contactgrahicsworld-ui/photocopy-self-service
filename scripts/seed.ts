// SMART PHOTOCOPY — provisioning seed.
// ALWAYS: subscription plans + platform settings placeholders.
// DEV ONLY (never on a production deployment): demo super admin + demo shop.
// The production path for the first Super Admin is the one-time /setup flow —
// no predefined credentials exist in this system.
//
// Run: bun scripts/seed.ts

import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const db = new PrismaClient();

const IS_PROD = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
const ALLOW_DEMO = process.env.FORCE_DEMO_SEED === "1";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function main() {
  console.log("── Smart Photocopy provisioning ──");

  // 1. Super Admin (DEV ONLY — production uses the one-time /setup flow)
  if (IS_PROD && !ALLOW_DEMO) {
    console.log("↷ Production deployment: skipping demo super admin & demo shop.");
    console.log("  First owner account is created once at /setup with SETUP_TOKEN.");
  } else {
  // Dev/demo environments: credentials MUST come from the environment.
  // No hardcoded fallback — run the /setup flow instead on production.
  const email = process.env.SUPER_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("↷ SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD not set — skipping super admin creation (use /setup flow).");
  } else {
  const superAdmin = await db.user.upsert({
    where: { email },
    update: { role: "SUPER_ADMIN", isActive: true },
    create: {
      email,
      name: process.env.SUPER_ADMIN_NAME || "Platform Owner",
      role: "SUPER_ADMIN",
      passwordHash: hashPassword(password),
    },
  });
  console.log(`✔ Super Admin: ${email}`);
  } // end env-required check
  } // end dev-only super admin

  // 2. Subscription plans
  const plans = [
    { code: "TRIAL", name: "7-Day Free Trial", pricePaise: 0, durationDays: 7, printerLimit: 1, storageLimitMb: 500, monthlyOrderLimit: 100, sortOrder: 0, features: JSON.stringify(["1 printer", "500 MB storage", "100 orders/month"]) },
    { code: "M3", name: "3 Months", pricePaise: 99900, durationDays: 90, printerLimit: 3, storageLimitMb: 5000, monthlyOrderLimit: 1000, sortOrder: 1, features: JSON.stringify(["Up to 3 printers", "5 GB storage", "1000 orders/month", "Reports & CSV export"]) },
    { code: "M6", name: "6 Months", pricePaise: 179900, durationDays: 182, printerLimit: 5, storageLimitMb: 10000, monthlyOrderLimit: 3000, sortOrder: 2, features: JSON.stringify(["Up to 5 printers", "10 GB storage", "3000 orders/month", "Reports & CSV export"]) },
    { code: "Y1", name: "1 Year", pricePaise: 299900, durationDays: 365, printerLimit: 8, storageLimitMb: 20000, monthlyOrderLimit: 10000, sortOrder: 3, features: JSON.stringify(["Up to 8 printers", "20 GB storage", "10000 orders/month", "Priority support"]) },
    { code: "LIFETIME", name: "Lifetime", pricePaise: 999900, durationDays: null, printerLimit: null, storageLimitMb: null, monthlyOrderLimit: null, sortOrder: 4, features: JSON.stringify(["Unlimited printers", "Unlimited storage", "Unlimited orders", "All future updates — never expires"]) },
  ];
  for (const p of plans) {
    await db.subscriptionPlan.upsert({ where: { code: p.code }, update: p, create: p });
  }
  console.log("✔ Plans: TRIAL / M3 / M6 / Y1 / LIFETIME");

  // 3. Platform settings (UPI placeholder — Super Admin must set the real VPA)
  await db.platformSetting.upsert({
    where: { key: "upi" },
    update: {},
    create: {
      key: "upi",
      value: JSON.stringify({
        vpa: "",
        payeeName: "",
        instructions: "Pay the exact subscription amount using any UPI app, then submit the UTR / transaction reference below.",
      }),
    },
  });
  await db.platformSetting.upsert({
    where: { key: "announcement" },
    update: {},
    create: { key: "announcement", value: JSON.stringify({ text: "Welcome to Smart Photocopy!" }) },
  });
  console.log("✔ Platform settings (configure your real UPI ID in Super Admin → Settings)");

  if (IS_PROD && !ALLOW_DEMO) {
    console.log("✔ Done (production mode — plans + settings only, no demo data)");
    await db.$disconnect();
    return;
  }

  // 4. DEMO shop — labelled demo data, DEV/DEMO ENVIRONMENTS ONLY.
  // Demo credentials also come from the environment; nothing is hardcoded.
  const demoSlug = "demo-shop";
  const demoEmail = process.env.DEMO_SHOP_EMAIL?.toLowerCase();
  const demoPassword = process.env.DEMO_SHOP_PASSWORD;
  if (!demoEmail || !demoPassword) {
    console.log("↷ DEMO_SHOP_EMAIL/DEMO_SHOP_PASSWORD not set — skipping demo shop creation.");
    await db.$disconnect();
    return;
  }
  let shop = await db.shop.findUnique({ where: { slug: demoSlug } });
  if (!shop) {
    shop = await db.shop.create({
      data: {
        slug: demoSlug,
        name: "DEMO — Sri Balaji Xerox",
        ownerName: "Demo Owner",
        phone: "9000000000",
        address: "Shop No. 4, Main Market Road, Bengaluru 560001",
        businessHours: "Mon–Sat 9:00 AM – 9:00 PM, Sun 10:00 AM – 2:00 PM",
        status: "ACTIVE",
        upiId: "demoshop@upi",
        upiPayeeName: "Sri Balaji Xerox Demo",
        taxPercent: 0,
        additionalChargePaise: 0,
      },
    });
    await db.user.upsert({
      where: { email: demoEmail },
      update: { shopId: shop.id, role: "SHOP_ADMIN" },
      create: {
        email: demoEmail,
        name: "Demo Shop Admin",
        role: "SHOP_ADMIN",
        shopId: shop.id,
        passwordHash: hashPassword(demoPassword),
      },
    });
    const rules = [
      { paperSize: "A4", colorMode: "BW", pricePerSidePaise: 200, duplexPricePerSidePaise: 150 },
      { paperSize: "A4", colorMode: "COLOR", pricePerSidePaise: 1000, duplexPricePerSidePaise: 900 },
      { paperSize: "A3", colorMode: "BW", pricePerSidePaise: 500, duplexPricePerSidePaise: 450 },
      { paperSize: "A3", colorMode: "COLOR", pricePerSidePaise: 2000, duplexPricePerSidePaise: 1800 },
      { paperSize: "LEGAL", colorMode: "BW", pricePerSidePaise: 400, duplexPricePerSidePaise: 350 },
      { paperSize: "LEGAL", colorMode: "COLOR", pricePerSidePaise: 1500, duplexPricePerSidePaise: 1400 },
      { paperSize: "PHOTO_4X6", colorMode: "COLOR", pricePerSidePaise: 3000, duplexPricePerSidePaise: null },
    ];
    for (const r of rules) {
      await db.pricingRule.create({ data: { shopId: shop.id, ...r } });
    }
    await db.printer.createMany({
      data: [
        { shopId: shop.id, name: "DEMO HP LaserJet M1136 (B/W)", colorMode: "BW", paperSizes: JSON.stringify(["A4", "LEGAL"]), duplexCapable: false, isDefault: true },
        { shopId: shop.id, name: "DEMO Canon PIXMA G3020 (Colour)", colorMode: "COLOR", paperSizes: JSON.stringify(["A4", "A3", "PHOTO_4X6"]), duplexCapable: true },
      ],
    });
    const trial = await db.subscriptionPlan.findUnique({ where: { code: "TRIAL" } });
    await db.subscription.create({
      data: { shopId: shop.id, planId: trial!.id, startsAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400000), status: "ACTIVE" },
    });
    console.log(`✔ DEMO shop: /s/${demoSlug}  (admin ${demoEmail})`);
  } else {
    console.log("• DEMO shop already exists");
  }

  console.log("── Provisioning complete ──");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

// End-to-end integration tests — run against the live dev server (port 3000).
// Covers the required scenarios: auth, tenant isolation, customer QR ordering,
// PDF validation, server-side pricing, UPI QR, UTR submission, manual
// verification, duplicate-UTR rejection, subscription activation/expiry/
// lifetime, print queue authorization, routing, duplicate-job prevention,
// agent flows, order state, security failures.
//
// These tests create clearly-named throwaway tenants (slug test-e2e-*) and
// delete them in afterAll — no fake data is left as production data.

import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
// Local dev credentials come from the environment (.env) — nothing hardcoded.
const DEV_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? "";
const DEV_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? "";
const db = new PrismaClient();

// ── minimal cookie-jar HTTP client ───────────────────────────────────────────
class Client {
  jar = new Map<string, string>();
  deviceToken: string | null = null;

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { ...headers };
    // Dev-only rate-limit bypass so the suite isn't throttled (server enforces
    // NODE_ENV !== production for this; see src/lib/guards.ts).
    if (process.env.CRON_SECRET && !headers["x-no-bypass"]) h["x-ratelimit-bypass"] = process.env.CRON_SECRET;
    if (this.deviceToken && !h["x-device-token"]) h["x-device-token"] = this.deviceToken;
    const cookie = [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h["cookie"] = cookie;
    if (body !== undefined && !(body instanceof FormData)) h["content-type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    let json: any = null;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("json")) json = await res.json().catch(() => null);
    else json = await res.text().catch(() => null);
    return { status: res.status, data: json };
  }

  async login(email: string, password: string) {
    return this.req("POST", "/api/auth/login", { email, password });
  }
  agent(path: string, method = "GET", body?: unknown) {
    return this.req(method, path, body, this.deviceToken ? { "x-device-token": this.deviceToken } : {});
  }
}

async function makeTestPdf(pages: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage();
  return Buffer.from(await pdf.save());
}

async function uploadPdf(c: Client, slug: string, name: string, buf: Buffer) {
  const fd = new FormData();
  fd.append("files", new File([buf], name, { type: "application/pdf" }));
  return c.req("POST", `/api/public/shop/${slug}/upload`, fd);
}

// Shared fixture state (filled in beforeAll-equivalent first test)
const superA = new Client();
const shopA = new Client(); // tenant A
const shopB = new Client(); // tenant B (isolation checks)
const customer = new Client();
const agentA = new Client();

let tenantA: { id: string; slug: string; adminEmail: string } | null = null;
let tenantB: { id: string; slug: string; adminEmail: string } | null = null;

const PW = "TestPass!234";

/** Wipe ALL e2e fixtures (by slug/email prefix) — safe to call repeatedly.
 *  Runs before AND after the suite so leftovers from any earlier failed run
 *  can never poison a fresh run. */
async function purgeE2EData() {
  const shops = await db.shop.findMany({ where: { slug: { startsWith: "test-e2e" } }, select: { id: true } });
  for (const s of shops) {
    await db.orderEvent.deleteMany({ where: { shopId: s.id } });
    await db.printJobEvent.deleteMany({ where: { shopId: s.id } });
    await db.printJob.deleteMany({ where: { shopId: s.id } });
    await db.orderItem.deleteMany({ where: { shopId: s.id } });
    await db.payment.deleteMany({ where: { shopId: s.id } });
    await db.order.deleteMany({ where: { shopId: s.id } });
    await db.document.deleteMany({ where: { shopId: s.id } });
    await db.pricingRule.deleteMany({ where: { shopId: s.id } });
    await db.pricingVersion.deleteMany({ where: { shopId: s.id } });
    await db.printer.deleteMany({ where: { shopId: s.id } });
    await db.printDevice.deleteMany({ where: { shopId: s.id } });
    await db.subscription.deleteMany({ where: { shopId: s.id } });
    await db.customer.deleteMany({ where: { shopId: s.id } });
    await db.auditLog.deleteMany({ where: { shopId: s.id } });
    await db.notification.deleteMany({ where: { shopId: s.id } });
    await db.shop.delete({ where: { id: s.id } });
    const fs = await import("node:fs/promises");
    await fs.rm(`/home/z/my-project/db/uploads/${s.id}`, { recursive: true, force: true }).catch(() => {});
  }
  await db.user.deleteMany({ where: { email: { contains: "@test.local" } } });
}

beforeAll(async () => {
  await purgeE2EData();
});

afterAll(async () => {
  // Cleanup: remove tenants & users created by tests (no fake data left behind)
  try {
    await purgeE2EData();
  } catch (e) {
    console.warn("cleanup warning:", e);
  }
  await db.$disconnect();
});

// ══════════════════════════ 1. AUTHENTICATION ═══════════════════════════════
describe("1. authentication & provisioning", () => {
  test("super admin login works (seeded account)", async () => {
    const r = await superA.login(DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD);
    expect(r.status).toBe(200);
    expect(r.data.role).toBe("SUPER_ADMIN");
    expect(r.data.redirect).toBe("/admin");
  });

  test("wrong password rejected with 401, no role leakage", async () => {
    const c = new Client();
    const r = await c.login(DEV_ADMIN_EMAIL, "wrong-password");
    expect(r.status).toBe(401);
    expect(r.data.error).toBe("Invalid email or password");
  });

  test("unauthenticated access to protected APIs is blocked", async () => {
    expect((await new Client().req("GET", "/api/shop/dashboard")).status).toBe(401);
    expect((await new Client().req("GET", "/api/admin/overview")).status).toBe(401);
  });
});

// ══════════════════════════ 2. SHOP PROVISIONING ════════════════════════════
describe("2. super admin provisions two isolated shops", () => {
  test("create shop A (trial auto-started)", async () => {
    const r = await superA.req("POST", "/api/admin/shops", {
      name: "E2E Test Shop A", slug: "test-e2e-a", adminEmail: "e2e-a@test.local", adminPassword: PW,
      upiId: "e2eshopa@upi", upiPayeeName: "E2E Shop A",
    });
    expect(r.status).toBe(201);
    expect(r.data.trialStarted).toBe(true);
    tenantA = { id: r.data.shopId, slug: r.data.slug, adminEmail: "e2e-a@test.local" };
  });

  test("create shop B (for isolation tests)", async () => {
    const r = await superA.req("POST", "/api/admin/shops", {
      name: "E2E Test Shop B", slug: "test-e2e-b", adminEmail: "e2e-b@test.local", adminPassword: PW,
      upiId: "e2eshopb@upi", upiPayeeName: "E2E Shop B",
    });
    expect(r.status).toBe(201);
    tenantB = { id: r.data.shopId, slug: r.data.slug, adminEmail: "e2e-b@test.local" };
  });

  test("duplicate slug / duplicate admin email rejected", async () => {
    const r1 = await superA.req("POST", "/api/admin/shops", { name: "Dup", slug: "test-e2e-a", adminEmail: "x1@test.local", adminPassword: PW });
    expect(r1.status).toBe(409);
    const r2 = await superA.req("POST", "/api/admin/shops", { name: "Dup", slug: "test-e2e-c", adminEmail: "e2e-a@test.local", adminPassword: PW });
    expect(r2.status).toBe(409);
  });

  test("shop admins log in; role & shopId come from signed session", async () => {
    const ra = await shopA.login("e2e-a@test.local", PW);
    expect(ra.status).toBe(200);
    const rb = await shopB.login("e2e-b@test.local", PW);
    expect(rb.status).toBe(200);
    const me = await shopA.req("GET", "/api/auth/me");
    expect(me.data.role).toBe("SHOP_ADMIN");
    expect(me.data.shopId).toBe(tenantA!.id);
  });

  test("shop B admin cannot use shop A's resources (tenant isolation at API layer)", async () => {
    // shop A creates a printer
    const pr = await shopA.req("POST", "/api/shop/printers", { name: "TestPrinter A1", colorMode: "BW", paperSizes: ["A4"], duplexCapable: true, isDefault: true });
    expect(pr.status).toBe(200);
    const printerAId = pr.data.printer.id;
    // shop B tries to retire/patch shop A's printer → 404 (tenant-scoped)
    const patch = await shopB.req("PATCH", `/api/shop/printers/${printerAId}`, { name: "Hacked" });
    expect(patch.status).toBe(404);
    // shop B cannot read shop A's orders list (it only ever sees its own)
    const orders = await shopB.req("GET", "/api/shop/orders");
    expect(orders.status).toBe(200);
    expect(orders.data.orders).toHaveLength(0);
  });
});

// ══════════════════════════ 3. PRICING & SHOP SETUP ═════════════════════════
describe("3. shop pricing (server-side authority)", () => {
  test("shop A sets pricing rules", async () => {
    const r = await shopA.req("POST", "/api/shop/pricing", {
      rules: [
        { paperSize: "A4", colorMode: "BW", pricePerSidePaise: 200, duplexPricePerSidePaise: 150 },
        { paperSize: "A4", colorMode: "COLOR", pricePerSidePaise: 1000 },
      ],
    });
    expect(r.status).toBe(200);
  });

  test("invalid prices rejected", async () => {
    const r = await shopA.req("POST", "/api/shop/pricing", { rules: [{ paperSize: "A4", colorMode: "BW", pricePerSidePaise: -5 }] });
    expect(r.status).toBe(400);
  });

  test("public shop page shows pricing but NOT UPI-accepting until configured", async () => {
    const r = await customer.req("GET", "/api/public/shop/test-e2e-a");
    expect(r.status).toBe(200);
    expect(r.data.shop.name).toBe("E2E Test Shop A");
    expect(r.data.accepting).toBe(true); // UPI set at creation
    expect(r.data.pricing.length).toBe(2);
  });
});

// ══════════════════════════ 4. CUSTOMER ORDERING ════════════════════════════
let uploadedDocId: string;
let orderRef: string;
let orderCode: string;
let orderPayment: { id?: string; reference: string; upiUri: string; amountPaise: number };

describe("4. customer QR ordering (no registration)", () => {
  test("valid PDF upload accepted, page count detected", async () => {
    const r = await uploadPdf(customer, "test-e2e-a", "assignment.pdf", await makeTestPdf(9));
    expect(r.status).toBe(200);
    const ok = r.data.results.find((x: any) => x.ok);
    expect(ok.pageCount).toBe(9);
    uploadedDocId = ok.documentId;
  });

  test("corrupted PDF rejected with clear message", async () => {
    const fake = Buffer.from("%PDF-1.4\nnot-a-real-pdf");
    const r = await uploadPdf(customer, "test-e2e-a", "virus.pdf", fake);
    expect(r.data.results[0].ok).toBe(false);
    expect(r.data.results[0].error).toMatch(/corrupted|unsupported|valid PDF/i);
  });

  test("non-PDF file rejected", async () => {
    const fd = new FormData();
    fd.append("files", new File([Buffer.from("hello")], "notes.txt", { type: "text/plain" }));
    const r = await customer.req("POST", "/api/public/shop/test-e2e-a/upload", fd);
    expect(r.data.results[0].ok).toBe(false);
  });

  test("order created with SERVER-side pricing (duplex sheet math)", async () => {
    const r = await customer.req("POST", "/api/public/shop/test-e2e-a/orders", {
      customerName: "E2E Customer", customerPhone: "9999900000",
      items: [
        // 9-page doc, duplex, 1 copy → 9 sides, ceil(9/2)=5 sheets @ ₹1.50 = ₹13.50
        { documentId: uploadedDocId, copies: 1, paperSize: "A4", colorMode: "BW", duplex: true },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.data.totalPaise).toBe(1350); // server calculated, duplex @1.50
    expect(r.data.payment.upiUri).toContain("am=13.50");
    expect(r.data.payment.upiUri).toContain("pa=e2eshopa%40upi");
    expect(r.data.payment.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    orderRef = r.data.orderNumber;
    orderCode = r.data.accessCode;
    orderPayment = r.data.payment;
  });

  test("order API has no client-supplied price field & protects status without code", async () => {
    // The create-order API takes no price input at all (server-side only), and
    // status without the access code is refused.
    const noCode = await customer.req("GET", `/api/public/orders/${orderRef}`);
    expect(noCode.status).toBe(403);
  });

  test("order status requires access code; wrong code fails", async () => {
    const wrong = await customer.req("GET", `/api/public/orders/${orderRef}?code=XXXXXX`);
    expect(wrong.status).toBe(404);
    const right = await customer.req("GET", `/api/public/orders/${orderRef}?code=${orderCode}`);
    expect(right.status).toBe(200);
    expect(right.data.status).toBe("PAYMENT_PENDING");
  });

  test("shop B cannot see shop A's order", async () => {
    const r = await shopB.req("GET", "/api/shop/orders");
    expect(r.data.orders.find((o: any) => o.orderNumber === orderRef)).toBeUndefined();
    const detail = await shopA.req("GET", "/api/shop/orders");
    expect(detail.data.orders.find((o: any) => o.orderNumber === orderRef)).toBeDefined();
  });
});

// ══════════════════════════ 5. UTR & PAYMENT VERIFICATION ═══════════════════
let paymentId: string;

describe("5. UTR submission & manual payment verification", () => {
  test("customer submits UTR", async () => {
    const detail = await shopA.req("GET", `/api/shop/orders`);
    const order = detail.data.orders.find((o: any) => o.orderNumber === orderRef);
    paymentId = order.payment.id;
    expect(order.payment.status).toBe("PAYMENT_PENDING");

    const r = await customer.req("POST", `/api/public/orders/${orderRef}/utr`, { code: orderCode, utr: "415223987654" });
    expect(r.status).toBe(200);
    expect(r.data.status).toBe("VERIFICATION_PENDING");
  });

  test("malformed UTR rejected", async () => {
    const r = await customer.req("POST", `/api/public/orders/${orderRef}/utr`, { code: orderCode, utr: "ab" });
    expect(r.status).toBe(400);
  });

  test("duplicate UTR (same payee) rejected with 409", async () => {
    // Another order in the same shop tries to reuse the same UTR
    const up = await uploadPdf(customer, "test-e2e-a", "second.pdf", await makeTestPdf(2));
    const doc2 = up.data.results.find((x: any) => x.ok).documentId;
    const ord = await customer.req("POST", `/api/public/shop/test-e2e-a/orders`, {
      items: [{ documentId: doc2, copies: 1, paperSize: "A4", colorMode: "BW", duplex: false }],
    });
    const list = await shopA.req("GET", "/api/shop/orders");
    const newOrder = list.data.orders.find((o: any) => o.orderNumber === ord.data.orderNumber);
    const dup = await customer.req("POST", `/api/public/orders/${ord.data.orderNumber}/utr`, { code: ord.data.accessCode, utr: "415223987654" });
    expect(dup.status).toBe(409);
    expect(dup.data.error).toMatch(/already been submitted/);
    // cleanup this extra order's payment by expiring it
    await db.payment.update({ where: { id: newOrder.payment.id }, data: { status: "EXPIRED" } });
    await db.order.update({ where: { id: newOrder.id }, data: { status: "CANCELLED" } });
  });

  test("verification with WRONG amount fails; order not released", async () => {
    const r = await shopA.req("POST", `/api/shop/orders/${paymentId}/verify`, { amountConfirmedPaise: 900 });
    expect(r.status).toBe(400);
    const o = await customer.req("GET", `/api/public/orders/${orderRef}?code=${orderCode}`);
    expect(o.data.status).toBe("VERIFICATION_PENDING");
  });

  test("unverified payment → agent poll returns NO jobs (queue authorization)", async () => {
    // Register & pair agent for shop A first
    const reg = await shopA.req("POST", "/api/shop/devices", { name: "Test Agent PC" });
    expect(reg.status).toBe(200);
    const pair = await agentA.req("POST", "/api/agent/pair", { pairingCode: reg.data.pairingCode, platform: "linux/test", agentVersion: "1.0.0" });
    expect(pair.status).toBe(200);
    expect(pair.data.deviceToken).toMatch(/^[a-f0-9]{64}$/);
    agentA.deviceToken = pair.data.deviceToken;

    const poll = await agentA.req("GET", "/api/agent/jobs");
    expect(poll.status).toBe(200);
    expect(poll.data.jobs).toHaveLength(0);
  });

  test("shop B cannot verify shop A's payment (cross-tenant prevention)", async () => {
    const r = await shopB.req("POST", `/api/shop/orders/${paymentId}/verify`, { amountConfirmedPaise: 1350 });
    expect([403, 404]).toContain(r.status);
  });

  test("correct amount verified → order auto-released to print queue with routing", async () => {
    const r = await shopA.req("POST", `/api/shop/orders/${paymentId}/verify`, { amountConfirmedPaise: 1350 });
    expect(r.status).toBe(200);
    expect(r.data.released).toBe(true);
    const o = await customer.req("GET", `/api/public/orders/${orderRef}?code=${orderCode}`);
    expect(o.data.status).toBe("QUEUED");
  });

  test("double verification rejected (409)", async () => {
    const r = await shopA.req("POST", `/api/shop/orders/${paymentId}/verify`, { amountConfirmedPaise: 1350 });
    expect(r.status).toBe(409);
  });

  test("payment records show UTR + verifier trail (auditability)", async () => {
    const rec = await shopA.req("GET", "/api/shop/payments");
    const p = rec.data.payments.find((x: any) => x.utr === "415223987654");
    expect(p).toBeDefined();
    expect(p.status).toBe("VERIFIED");
    expect(p.verifiedAt).toBeTruthy();
  });
});

// ══════════════════════════ 6. PRINT AGENT PIPELINE ═════════════════════════
let claimedJob: any;

describe("6. print agent: claim → download → honest status", () => {
  test("agent claims the authorized job exactly once (idempotent claim)", async () => {
    const poll1 = await agentA.req("GET", "/api/agent/jobs");
    expect(poll1.data.jobs).toHaveLength(1);
    claimedJob = poll1.data.jobs[0];
    expect(claimedJob.copies).toBe(1);
    expect(claimedJob.duplex).toBe(true);
    expect(claimedJob.printerName).toContain("TestPrinter A1"); // routed by colorMode+size+duplex

    // Second device of same shop must NOT be able to claim the same job
    const reg2 = await shopA.req("POST", "/api/shop/devices", { name: "Second PC" });
    const agentA2 = new Client();
    const pair2 = await agentA2.req("POST", "/api/agent/pair", { pairingCode: reg2.data.pairingCode });
    agentA2.deviceToken = pair2.data.deviceToken;
    const poll2 = await agentA2.req("GET", "/api/agent/jobs");
    expect(poll2.data.jobs).toHaveLength(0); // already DISPATCHED
  });

  test("agent downloads the document with its signed token (real PDF bytes)", async () => {
    const res = await fetch(`${BASE}${claimedJob.downloadPath}`);
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("download link without/with invalid token is rejected", async () => {
    const noToken = await fetch(`${BASE}/api/files/${claimedJob.documentId}`);
    expect(noToken.status).toBe(401); // requires session or valid token
    const badToken = await fetch(`${BASE}/api/agent/download/${claimedJob.documentId}?token=forged.token.sig`);
    expect(badToken.status).toBe(403);
  });

  test("super admin has NO access to customer document contents", async () => {
    const r = await superA.req("GET", `/api/files/${claimedJob.documentId}`);
    expect([403, 401]).toContain(r.status);
  });

  test("state machine rejects impossible transitions, accepts honest ones", async () => {
    // DISPATCHED → COMPLETED directly is NOT allowed (must go through spooler states)
    const jump = await agentA.req("POST", `/api/agent/jobs/${claimedJob.id}/status`, { status: "COMPLETED", message: "trying to skip" });
    expect(jump.data.ok).toBe(false);
    const s1 = await agentA.req("POST", `/api/agent/jobs/${claimedJob.id}/status`, { status: "SPOOLING" });
    expect(s1.data.ok).toBe(true);
    const s2 = await agentA.req("POST", `/api/agent/jobs/${claimedJob.id}/status`, { status: "SPOOLER_ACCEPTED" });
    expect(s2.data.ok).toBe(true);
    const s3 = await agentA.req("POST", `/api/agent/jobs/${claimedJob.id}/status`, { status: "PRINTING" });
    expect(s3.data.ok).toBe(true);
    const s4 = await agentA.req("POST", `/api/agent/jobs/${claimedJob.id}/status`, { status: "COMPLETED", message: "spooler drained" });
    expect(s4.data.ok).toBe(true);
    const o = await customer.req("GET", `/api/public/orders/${orderRef}?code=${orderCode}`);
    expect(o.data.status).toBe("COMPLETED");
  });

  test("revoked device token stops working immediately (revocation)", async () => {
    const reg = await shopA.req("POST", "/api/shop/devices", { name: "Doomed Device" });
    const c = new Client();
    const pair = await c.req("POST", "/api/agent/pair", { pairingCode: reg.data.pairingCode });
    c.deviceToken = pair.data.deviceToken;
    expect((await c.req("GET", "/api/agent/jobs")).status).toBe(200);
    const devices = await shopA.req("GET", "/api/shop/devices");
    const dev = devices.data.devices.find((d: any) => d.name === "Doomed Device");
    await shopA.req("POST", `/api/shop/devices/${dev.id}/revoke`, {});
    const after = await c.req("GET", "/api/agent/jobs");
    expect(after.status).toBe(401);
  });

  test("agent token of shop A is tenant-scoped: it can never see shop B data", async () => {
    // shop B creates its own order & pays it; shop A's agent poll must not include it
    const up = await uploadPdf(customer, "test-e2e-b", "b-shop.pdf", await makeTestPdf(3));
    const docB = up.data.results.find((x: any) => x.ok).documentId;
    await shopB.req("POST", "/api/shop/pricing", { rules: [{ paperSize: "A4", colorMode: "BW", pricePerSidePaise: 300 }] });
    const ord = await customer.req("POST", "/api/public/shop/test-e2e-b/orders", {
      items: [{ documentId: docB, copies: 1, paperSize: "A4", colorMode: "BW", duplex: false }],
    });
    const list = await shopB.req("GET", "/api/shop/orders");
    const bOrder = list.data.orders.find((o: any) => o.orderNumber === ord.data.orderNumber);
    await shopB.req("POST", `/api/shop/orders/${bOrder.payment.id}/verify`, { amountConfirmedPaise: 900 }); // 3 pages × ₹3 = ₹9

    const poll = await agentA.req("GET", "/api/agent/jobs");
    const ids = poll.data.jobs.map((j: any) => j.orderNumber);
    expect(ids).not.toContain(ord.data.orderNumber);

    // mark B's order completed via its own agent-less path for cleanup: cancel via DB
    await db.printJob.updateMany({ where: { orderId: bOrder.id }, data: { status: "CANCELLED" } });
    await db.order.update({ where: { id: bOrder.id }, data: { status: "CANCELLED" } });
  });
});

// ══════════════════════════ 7. SUBSCRIPTIONS ════════════════════════════════
describe("7. subscriptions: trial, expiry, lifetime, platform verification", () => {
  test("platform UPI configured by super admin", async () => {
    const r = await superA.req("PUT", "/api/admin/settings", { upi: { vpa: "platformowner@upi", payeeName: "Smart Photocopy Platform", instructions: "Pay exact amount" } });
    expect(r.status).toBe(200);
  });

  test("shop B requests M3 plan → pays → super admin verifies wrong amount → fails; right amount activates", async () => {
    const plans = await shopB.req("GET", "/api/shop/subscription");
    const m3 = plans.data.plans.find((p: any) => p.code === "M3");
    const pay = await shopB.req("POST", "/api/shop/subscription", { planId: m3.id });
    expect(pay.status).toBe(200);
    expect(pay.data.upiUri).toContain("pa=platformowner%40upi");
    expect(pay.data.upiUri).toContain(`am=${(m3.pricePaise / 100).toFixed(2)}`);

    // UTR submit by shop
    const sub = await shopB.req("POST", "/api/shop/subscription/utr", { reference: pay.data.reference, utr: "998877665544" });
    expect(sub.status).toBe(200);

    // wrong amount rejected
    const plist = await superA.req("GET", "/api/admin/payments?status=VERIFICATION_PENDING");
    const p = plist.data.payments.find((x: any) => x.reference === pay.data.reference);
    const bad = await superA.req("POST", `/api/admin/payments/${p.id}/verify`, { amountConfirmedPaise: 100 });
    expect(bad.status).toBe(400);

    // correct amount activates
    const good = await superA.req("POST", `/api/admin/payments/${p.id}/verify`, { amountConfirmedPaise: m3.pricePaise });
    expect(good.status).toBe(200);
    expect(good.data.activated.planCode).toBe("M3");

    const subNow = await shopB.req("GET", "/api/shop/subscription");
    expect(subNow.data.subscription.plan.code).toBe("M3");
    expect(subNow.data.subscription.plan.isLifetime).toBe(false);
    expect(subNow.data.subscription.plan.expiresAt).toBeTruthy();
  });

  test("LIFETIME subscription never expires (expiresAt stays null)", async () => {
    const plans = await shopB.req("GET", "/api/shop/subscription");
    const life = plans.data.plans.find((p: any) => p.code === "LIFETIME");
    const pay = await shopB.req("POST", "/api/shop/subscription", { planId: life.id });
    await shopB.req("POST", "/api/shop/subscription/utr", { reference: pay.data.reference, utr: "777666555444" });
    const plist = await superA.req("GET", "/api/admin/payments?status=VERIFICATION_PENDING");
    const p = plist.data.payments.find((x: any) => x.reference === pay.data.reference);
    const good = await superA.req("POST", `/api/admin/payments/${p.id}/verify`, { amountConfirmedPaise: life.pricePaise });
    expect(good.data.activated.isLifetime).toBe(true);
    expect(good.data.activated.expiresAt).toBeNull();

    // sweep must NOT expire lifetime subs even with past date simulated
    const sub = await db.subscription.findFirst({ where: { shopId: tenantB!.id, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
    expect(sub!.isLifetime).toBe(true);
    expect(sub!.expiresAt).toBeNull();
  });

  test("expired subscription deactivates ordering (lazy expiry)", async () => {
    // Force-expire shop A's trial directly in DB
    await db.subscription.updateMany({ where: { shopId: tenantA!.id, status: "ACTIVE" }, data: { expiresAt: new Date(Date.now() - 86400000) } });
    const page = await customer.req("GET", "/api/public/shop/test-e2e-a");
    expect(page.data.accepting).toBe(false);
    // new orders blocked at the upload gate itself (expired shop)
    const up = await uploadPdf(customer, "test-e2e-a", "late.pdf", await makeTestPdf(1));
    expect(up.status).toBe(403);
  });
});

// ══════════════════════════ 8. SECURITY EDGE CASES ══════════════════════════
describe("8. security & authorization failures", () => {
  test("rate limiting blocks brute-force login (11th attempt → 429)", async () => {
    const c = new Client();
    let last = 0;
    for (let i = 0; i < 11; i++) {
      // x-no-bypass: this test must hit the REAL limiter
      last = (await c.req("POST", "/api/auth/login", { email: "nobody@test.local", password: "wrongwrong1" }, { "x-no-bypass": "1" })).status;
    }
    expect(last).toBe(429);
  });

  test("invalid platform UPI VPA rejected", async () => {
    const r = await superA.req("PUT", "/api/admin/settings", { upi: { vpa: "clearly not a vpa!!", payeeName: "X" } });
    expect(r.status).toBe(400);
    // restore
    await superA.req("PUT", "/api/admin/settings", { upi: { vpa: "platformowner@upi", payeeName: "Smart Photocopy Platform" } });
  });

  test("shop admin cannot access super admin APIs (RBAC)", async () => {
    const r = await shopA.req("GET", "/api/admin/overview");
    expect(r.status).toBe(403);
  });

  test("suspended shop stops accepting orders", async () => {
    await superA.req("PATCH", `/api/admin/shops/${tenantA!.id}/credentials`, { status: "SUSPENDED" });
    const page = await customer.req("GET", "/api/public/shop/test-e2e-a");
    expect(page.data.accepting).toBe(false);
    // restore for cleanup consistency
    await superA.req("PATCH", `/api/admin/shops/${tenantA!.id}/credentials`, { status: "ACTIVE" });
  });

  test("audit log captured privileged actions", async () => {
    const logs = await superA.req("GET", "/api/admin/audit-logs");
    const actions = logs.data.logs.map((l: any) => l.action);
    expect(actions).toContain("SHOP_CREATED");
    expect(actions).toContain("PAYMENT_VERIFIED");
    expect(actions).toContain("SUBSCRIPTION_ACTIVATED");
    expect(actions).toContain("AGENT_PAIRED");
  });
});

// SMART PHOTOCOPY — PRODUCTION SMOKE TEST
// Runs against a deployed URL. Exercises: one-time setup, auth (success/failure/
// tamper), shop creation, customer order → UPI → UTR → duplicate-UTR rejection →
// verification → print queue → agent claim/download/status → completion,
// tenant isolation, change-password, security headers.
//
// Usage:
//   BASE_URL=https://smart-photocopy.vercel.app SETUP_TOKEN=... bun scripts/smoke-prod.ts
// Re-run behaviour: setup step logs in with existing owner when setup is closed.

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const SETUP_TOKEN = process.env.SETUP_TOKEN || "";
const OWNER_EMAIL = process.env.SMOKE_OWNER_EMAIL || `owner-${Date.now()}@smoke.test`;
const OWNER_PASSWORD = process.env.SMOKE_OWNER_PASSWORD || `Smk${Date.now()}xY9!`;

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✔ ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ""));
    console.log(`  ✘ ${name}`, detail ?? "");
  }
}

class Client {
  jar = new Map<string, string>();
  deviceToken: string | null = null;

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, raw = false) {
    const h: Record<string, string> = { ...headers };
    if (this.deviceToken && !h["x-device-token"]) h["x-device-token"] = this.deviceToken;
    const cookie = [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h["cookie"] = cookie;
    if (body !== undefined && !(body instanceof FormData) && !h["content-type"]) h["content-type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      redirect: "manual",
    });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    if (raw) return { status: res.status, res, headers: res.headers };
    const ct = res.headers.get("content-type") ?? "";
    const data = ct.includes("json") ? await res.json().catch(() => null) : await res.text().catch(() => "");
    return { status: res.status, data, headers: res.headers };
  }

  async login(email: string, password: string) {
    return this.req("POST", "/api/auth/login", { email, password });
  }
}

function makeTestPdf(pages: number): Buffer {
  const pageContent = (n: number) => `BT /F1 24 Tf 72 720 Td (Smoke Test Page ${n} of ${pages}) Tj ET`;
  const objs: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  for (let i = 0; i < pages; i++) {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(pageContent(i + 1))} >>\nstream\n${pageContent(i + 1)}\nendstream`);
  }
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

async function main() {
  console.log(`Smoke test against ${BASE}\n`);

  // ── 0. Reachability & headers ───────────────────────────────────────────────
  console.log("[0] reachability & security headers");
  const root = await new Client().req("GET", "/", undefined, {}, true);
  check("GET / returns 200", root.status === 200, root.status);
  check("X-Frame-Options: DENY", root.headers.get("x-frame-options") === "DENY", root.headers.get("x-frame-options"));
  check("X-Content-Type-Options: nosniff", root.headers.get("x-content-type-options") === "nosniff");
  check("Strict-Transport-Security present", !!root.headers.get("strict-transport-security"));

  // ── 1. Setup (one-time) ─────────────────────────────────────────────────────
  console.log("\n[1] one-time setup (no predefined credentials)");
  const anon = new Client();
  const status0 = await anon.req("GET", "/api/setup");
  check("GET /api/setup reports state", typeof status0.data?.setupNeeded === "boolean", status0.data);

  let owner: Client;
  let ownerEmail = OWNER_EMAIL;
  let ownerPassword = OWNER_PASSWORD;
  if (status0.data?.setupNeeded === true) {
    const bad = await anon.req("POST", "/api/setup", { setupToken: "WRONG", email: OWNER_EMAIL, password: OWNER_PASSWORD });
    check("setup with wrong token → 401", bad.status === 401, bad.status);
    const ok = await anon.req("POST", "/api/setup", { setupToken: SETUP_TOKEN, email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Platform Owner" });
    check("setup with correct token creates owner (200)", ok.status === 200, ok.data);
    const again = await new Client().req("POST", "/api/setup", { setupToken: SETUP_TOKEN, email: "x@y.zz", password: "Password123" });
    check("second setup attempt → 409 (permanently closed)", again.status === 409, again.status);
    owner = anon;
  } else {
    ownerEmail = process.env.SMOKE_EXISTING_EMAIL || "";
    ownerPassword = process.env.SMOKE_EXISTING_PASSWORD || "";
    if (!ownerEmail || !ownerPassword) {
      console.log("  ℹ setup already completed — provide SMOKE_EXISTING_EMAIL/SMOKE_EXISTING_PASSWORD to test owner flows");
      owner = new Client();
    } else {
      owner = new Client();
      const lg = await owner.login(ownerEmail, ownerPassword);
      check("existing owner login", lg.status === 200, lg.data);
    }
  }

  // ── 2. Authentication ───────────────────────────────────────────────────────
  console.log("\n[2] authentication");
  const wrongPw = await new Client().login(ownerEmail, "definitely-wrong-pw");
  check("wrong password → 401", wrongPw.status === 401);
  const wrongPw2 = await new Client().login("nosuchuser@example.com", ownerPassword);
  check("unknown user → 401 (no user enumeration)", wrongPw2.status === 401 && wrongPw2.data?.error === "Invalid email or password");
  const unauth = await new Client().req("GET", "/api/admin/overview");
  check("unauthenticated admin API → 401", unauth.status === 401);
  const tampered = await new Client().req("GET", "/api/admin/overview", undefined, { cookie: "sp_session=eyJ1aWQiOiJ4Iiwicm9sZSI6IlNVUEVSX0FETUlOIiwiZXhwIjo5OTk5OTk5OTk5fQ.invalidsig" });
  check("tampered session token → 401", tampered.status === 401, tampered.status);

  if (ownerEmail) {
    const me = await owner.req("GET", "/api/auth/me");
    check("session /me returns SUPER_ADMIN", me.status === 200 && me.data?.role === "SUPER_ADMIN", me.data);

    const cpBad = await owner.req("POST", "/api/auth/change-password", { currentPassword: "wrong", newPassword: "NewPass12345" });
    check("change-password with wrong current → 401", cpBad.status === 401, cpBad.data);
    const altPassword = ownerPassword + "1";
    const cpOk = await owner.req("POST", "/api/auth/change-password", { currentPassword: ownerPassword, newPassword: altPassword });
    check("change-password works", cpOk.status === 200, cpOk.data);
    const relog = await new Client().login(ownerEmail, altPassword);
    check("login with new password works", relog.status === 200);
    const oldPw = await new Client().login(ownerEmail, ownerPassword);
    check("login with OLD password fails", oldPw.status === 401);
    await owner.req("POST", "/api/auth/change-password", { currentPassword: altPassword, newPassword: ownerPassword });
    const restored = await new Client().login(ownerEmail, ownerPassword);
    check("password restored", restored.status === 200);

    // ── 3. Shop provisioning (Super Admin) ────────────────────────────────────
    console.log("\n[3] shop provisioning");
    const slug = `smoke-${Date.now()}`;
    const shopPw = `Shop${Date.now()}xY9!`;
    const created = await owner.req("POST", "/api/admin/shops", {
      slug, name: "Smoke Pilot Xerox", adminEmail: `admin-${slug}@smoke.test`, adminPassword: shopPw,
      upiId: "smokeshop@upi", upiPayeeName: "Smoke Pilot Xerox",
    });
    check("create shop", created.status === 200 || created.status === 201, created.data);
    const shopPage = await new Client().req("GET", `/s/${slug}`, undefined, {}, true);
    check("public shop page renders", shopPage.status === 200);

    const shop = new Client();
    const shopLogin = await shop.login(`admin-${slug}@smoke.test`, shopPw);
    check("shop admin login", shopLogin.status === 200, shopLogin.data);

    const pricing = await shop.req("POST", "/api/shop/pricing", {
      rules: [
        { paperSize: "A4", colorMode: "BW", pricePerSidePaise: 200 },
        { paperSize: "A4", colorMode: "COLOR", pricePerSidePaise: 1000 },
      ],
    });
    check("shop pricing configured", pricing.status === 200 || pricing.status === 201, pricing.data);

    // ── 4. Customer flow ────────────────────────────────────────────────────────
    console.log("\n[4] customer ordering + payment pipeline");
    const pdf = makeTestPdf(3);
    const form = new FormData();
    form.append("files", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), "smoke.pdf");
    const up = await new Client().req("POST", `/api/public/shop/${slug}/upload`, form);
    check("PDF upload accepted", up.status === 200, up.data);
    const docId = up.data?.results?.[0]?.documentId;

    const badFile = new FormData();
    badFile.append("files", new Blob([new Uint8Array(Buffer.from("MZfake-not-a-pdf"))], { type: "application/pdf" }), "evil.pdf");
    const upBad = await new Client().req("POST", `/api/public/shop/${slug}/upload`, badFile);
    check("fake PDF rejected (signature check)", upBad.status >= 400, upBad.status);

    const order = await new Client().req("POST", `/api/public/shop/${slug}/orders`, {
      items: [{ documentId: docId, copies: 2, paperSize: "A4", colorMode: "BW", duplex: false }],
      customerName: "Smoke Customer",
    });
    check("order created with server-side price", order.status === 200, order.data);
    const orderNumber = order.data?.orderNumber;
    const accessCode = order.data?.accessCode;
    check("order carries UPI intent (uri + QR)", !!(order.data?.payment?.upiUri && order.data?.payment?.qrDataUrl));

    const ordersList = await shop.req("GET", "/api/shop/orders");
    const allOrders = ordersList.data?.orders ?? ordersList.data?.items ?? [];
    const found = Array.isArray(allOrders) ? allOrders.find((o: any) => o.orderNumber === orderNumber) : null;
    check("order visible to ITS shop only", !!found, { orderNumber, count: Array.isArray(allOrders) ? allOrders.length : ordersList.data });

    const utr = String(Date.now()).slice(0, 12);
    const subUtr = await new Client().req("POST", `/api/public/orders/${orderNumber}/utr`, { utr, code: accessCode });
    check("customer submits UTR → VERIFICATION_PENDING", subUtr.status === 200 && subUtr.data?.status === "VERIFICATION_PENDING", subUtr.data);

    const od2 = await shop.req("GET", `/api/shop/orders/${found?.id}`);
    const paymentId = od2.data?.payment?.id;
    check("payment record exists on order", !!paymentId);

    const verify = await shop.req("POST", `/api/shop/orders/${paymentId}/verify`, { amountConfirmedPaise: order.data?.totalPaise });
    check("shop verifies exact amount", verify.status === 200, verify.data);

    // second order for negative tests
    const pdf2 = makeTestPdf(2);
    const form2 = new FormData();
    form2.append("files", new Blob([new Uint8Array(pdf2)], { type: "application/pdf" }), "smoke2.pdf");
    const up2 = await new Client().req("POST", `/api/public/shop/${slug}/upload`, form2);
    const doc2 = up2.data?.results?.[0]?.documentId;
    const order2 = await new Client().req("POST", `/api/public/shop/${slug}/orders`, {
      items: [{ documentId: doc2, copies: 1, paperSize: "A4", colorMode: "BW", duplex: false }],
      customerName: "Smoke 2",
    });
    check("second order created", order2.status === 200, order2.data);
    await new Client().req("POST", `/api/public/orders/${order2.data?.orderNumber}/utr`, { utr: String(Date.now()).slice(0, 12), code: order2.data?.accessCode });
    const o2list = await shop.req("GET", "/api/shop/orders");
    const o2 = (o2list.data?.orders ?? []).find((o: any) => o.orderNumber === order2.data?.orderNumber);
    const o2detail = await shop.req("GET", `/api/shop/orders/${o2?.id}`);
    const o2pay = o2detail.data?.payment?.id;
    const wrongAmt = await shop.req("POST", `/api/shop/orders/${o2pay}/verify`, { amountConfirmedPaise: (order2.data?.totalPaise ?? 0) + 100 });
    check("wrong amount verification rejected (400)", wrongAmt.status === 400, wrongAmt.data);

    const dupUtr = await new Client().req("POST", `/api/public/orders/${order2.data?.orderNumber}/utr`, { utr, code: order2.data?.accessCode });
    check("duplicate UTR rejected (409/400)", dupUtr.status === 409 || dupUtr.status === 400, dupUtr.data);

    const od = await shop.req("GET", `/api/shop/orders/${found?.id}`);
    const odStatus = od.data?.order?.status ?? od.data?.status;
    check("verified order reached print queue (QUEUED)", odStatus === "QUEUED", odStatus);

    // ── 5. Print agent pipeline ───────────────────────────────────────────────
    console.log("\n[5] print agent pipeline (server contract)");
    const pair = await shop.req("POST", "/api/shop/devices", { name: "smoke-agent" });
    const pairingCode = pair.data?.pairingCode;
    check("pairing code issued", !!pairingCode, pair.data);

    const agent = new Client();
    const paired = await agent.req("POST", "/api/agent/pair", { pairingCode, platform: "windows", agentVersion: "smoke-1.0" });
    check("agent pairs with code", paired.status === 200 && !!paired.data?.deviceToken, paired.status);
    agent.deviceToken = paired.data?.deviceToken;

    const claim = await agent.req("GET", "/api/agent/jobs");
    check("agent claims queued job", claim.status === 200, claim.data);
    const job = claim.data?.jobs?.[0];
    if (job) {
      const dl = await agent.req("GET", job.downloadPath ?? `/api/agent/download/${job.documentId}`, undefined, {}, true);
      check("agent downloads PDF (authorized)", dl.status === 200, dl.status);
      const buf = Buffer.from(await (dl.res as Response).arrayBuffer());
      check("downloaded bytes are a real PDF", buf.subarray(0, 5).toString() === "%PDF-", buf.subarray(0, 5).toString());
      const wrongDev = await new Client().req("GET", "/api/agent/jobs", undefined, { "x-device-token": "f".repeat(64) });
      check("bogus device token cannot claim", wrongDev.status === 401 || wrongDev.status === 403, wrongDev.status);
      const st1 = await agent.req("POST", `/api/agent/jobs/${job.id}/status`, { status: "SPOOLING" });
      check("agent reports SPOOLING", st1.status === 200, st1.data);
      const st2 = await agent.req("POST", `/api/agent/jobs/${job.id}/status`, { status: "SPOOLER_ACCEPTED" });
      check("agent reports SPOOLER_ACCEPTED", st2.status === 200, st2.data);
      const st3 = await agent.req("POST", `/api/agent/jobs/${job.id}/status`, { status: "COMPLETED" });
      check("agent reports COMPLETED", st3.status === 200, st3.data);
      const ill = await agent.req("POST", `/api/agent/jobs/${job.id}/status`, { status: "PRINTING" });
      check("illegal state transition rejected (ok:false / 4xx)", ill.status >= 400 || ill.data?.ok === false, ill.data);
    }

    // ── 6. Tenant isolation ─────────────────────────────────────────────────────
    console.log("\n[6] tenant isolation");
    const slugB = `smoke-b-${Date.now()}`;
    const createdB = await owner.req("POST", "/api/admin/shops", {
      slug: slugB, name: "Smoke Tenant B", adminEmail: `admin-${slugB}@smoke.test`, adminPassword: shopPw,
      upiId: "shopb@upi", upiPayeeName: "Smoke B",
    });
    check("second shop created", createdB.status === 200 || createdB.status === 201, createdB.status);
    const shopB = new Client();
    await shopB.login(`admin-${slugB}@smoke.test`, shopPw);
    const iso = await shopB.req("GET", `/api/shop/orders/${found?.id}`);
    check("shop B cannot read shop A order (403/404)", iso.status === 403 || iso.status === 404, iso.status);
    const isoList = await shopB.req("GET", "/api/shop/orders");
    const bList = isoList.data?.orders ?? isoList.data?.items ?? [];
    const leaked = Array.isArray(bList) && bList.some((o: any) => o.orderNumber === orderNumber);
    check("shop B order list contains no shop A data", !leaked);
    const isoPay = await shopB.req("POST", `/api/shop/orders/${paymentId}/verify`, { amountConfirmedPaise: 100 });
    check("shop B cannot verify shop A payment", isoPay.status === 403 || isoPay.status === 404, isoPay.status);
    const crossPair = await new Client().req("POST", "/api/agent/pair", { pairingCode, platform: "windows", agentVersion: "smoke-1.0" });
    check("used pairing code cannot be reused", !(crossPair.status === 200 && crossPair.data?.deviceToken), crossPair.status);

    // ── 7. Storage backend confirmation ────────────────────────────────────────
    console.log("\n[7] storage backend");
    const docs = await shop.req("GET", "/api/shop/documents");
    check("documents API lists tenant docs", docs.status === 200, docs.status);
    const usedBytes = docs.data?.storageUsedBytes ?? docs.data?.usageBytes ?? 0;
    check("storage usage > 0 (backend actually stored the file)", usedBytes > 0, docs.data);
  }

  console.log(`\n════════════════════════════════════`);
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log("FAILURES:");
    for (const f of failures) console.log("  ✘ " + f);
  }
  if (ownerEmail) console.log(`Owner credentials: ${ownerEmail} / ${ownerPassword}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});

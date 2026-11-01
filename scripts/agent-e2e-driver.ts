// Driver: create a paid order on the demo shop, then hand the pairing code to the real agent
const BASE = "http://localhost:3000";
let jar = {};
async function req(method, path, body, headers = {}) {
  const h = { ...headers, "x-ratelimit-bypass": process.env.CRON_SECRET ?? "" };
  const cookie = Object.entries(jar).map(([k,v])=>`${k}=${v}`).join("; ");
  if (cookie) h.cookie = cookie;
  if (body !== undefined && !(body instanceof FormData)) h["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  for (const sc of res.headers.getSetCookie?.() ?? []) { const [pair] = sc.split(";"); const eq = pair.indexOf("="); if (eq>0) jar[pair.slice(0,eq)] = pair.slice(eq+1); }
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await res.json().catch(()=>null) : await res.text();
  return { status: res.status, data };
}
async function makePdf(pages) {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  for (let i=0;i<pages;i++) pdf.addPage();
  return Buffer.from(await pdf.save());
}
const login = await req("POST", "/api/auth/login", { email: process.env.DEMO_SHOP_EMAIL ?? "", password: process.env.DEMO_SHOP_PASSWORD ?? "" });
console.log("shop login:", login.status, JSON.stringify(login.data));
const dev = await req("POST", "/api/shop/devices", { name: "SimAgent E2E" });
console.log("device:", dev.status, "pairing:", dev.data.pairingCode);
const pdf = await makePdf(5);
const fd = new FormData();
fd.append("files", new File([pdf], "agent-e2e.pdf", { type: "application/pdf" }));
const up = await req("POST", "/api/public/shop/demo-shop/upload", fd);
const doc = up.data.results.find(r=>r.ok);
console.log("upload:", up.status, doc.pageCount, "pages");
const ord = await req("POST", "/api/public/shop/demo-shop/orders", { items: [{ documentId: doc.documentId, copies: 2, paperSize: "A4", colorMode: "BW", duplex: true }] });
console.log("order:", ord.status, ord.data.orderNumber, "total", ord.data.totalPaise, "(5p×2c duplex=6 sheets @₹1.50/side=15 sides → ₹22.50 expected: 2250)");
const utr = await req("POST", `/api/public/orders/${ord.data.orderNumber}/utr`, { code: ord.data.accessCode, utr: "121212121212" });
console.log("utr:", utr.status);
const list = await req("GET", "/api/shop/orders");
console.log("orders list:", list.status, JSON.stringify(list.data).slice(0, 200));
const o = list.data.orders.find(x=>x.orderNumber===ord.data.orderNumber);
const ver = await req("POST", `/api/shop/orders/${o.payment.id}/verify`, { amountConfirmedPaise: ord.data.totalPaise });
console.log("verify:", ver.status, "released:", ver.data.released);
console.log("PAIRING_CODE=" + dev.data.pairingCode);

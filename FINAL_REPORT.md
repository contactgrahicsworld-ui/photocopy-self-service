# SMART PHOTOCOPY — FINAL DELIVERY REPORT

Date: 2026-11-01 · Environment: Z.ai sandbox (Next.js 16.1.1, React 19, Prisma 6.19 / SQLite, bun 1.3)
Verification: 76/76 automated tests passing + live browser walkthrough of every dashboard + real print-agent code executed in simulator mode against the live server.

---

## 1. Features fully implemented

**Multi-tenancy & roles**
- Three separated roles: Super Admin (no public registration — provisioned via `scripts/create-superadmin.ts`), Shop Admin, anonymous Customer.
- Independent tenants: unique slug + QR ordering URL, own UPI ID/payee name, pricing, orders, documents, printers, devices, reports, payments, subscription.
- Tenant isolation enforced at the service layer on every route (scope always derived from the signed session/device token, never from browser input). Verified by automated cross-tenant tests (403/404 + empty data sets).

**Customer QR ordering (mobile-first, no login)**
- Shop page `/s/{slug}`: shop info, business hours, platform announcement, availability gating (suspended / subscription-expired / UPI-missing shops refuse orders).
- PDF upload with full validation: extension, declared MIME, `%PDF-` magic signature, structural integrity + encryption detection (pdf-lib), page count, 20 MB cap, clear per-file error messages. Max 10 files/order.
- Per-document settings: paper size (A4/A3/Legal/Photo 4×6, only sizes the shop's printers support), B/W or Colour, copies 1–500, custom page ranges (`1-3,5,8-10`), duplex, fit-to-page.
- Live itemised price (client display) recalculated **server-side** at submission; per-order immutable pricing snapshot (PricingVersion + per-item `priceSnapshot`) so later rate changes never rewrite history.
- Itemised transparent bill: subtotal, flat additional charge, GST %, exact payable amount.

**Direct UPI payments — no gateway (as required)**
- Standard UPI deep-link URIs (`upi://pay?pa=…&pn=…&am=…&cu=INR&tn=…&tr=…`, properly encoded, spec length limits) rendered as QR PNGs server-side (`qrcode`).
- Shop collects print payments to its own VPA; platform collects subscription fees to the Super Admin's VPA. Revenue streams never mix.
- Payment states implemented exactly as specified: CREATED, PAYMENT_PENDING, VERIFICATION_PENDING, VERIFIED, REJECTED, EXPIRED, REFUND_PENDING, REFUNDED (Refund model + states present; manual refund flow = mark REFUND_PENDING/REFUNDED on a payment record).
- UTR submission by customers (with access code) and shops; UTR format validation; **duplicate UTR rejection per payee account** (DB unique constraint + explicit 409 + audit entry).
- Manual verification flows with exact-amount confirmation: shop admin verifies print orders; Super Admin verifies subscription payments. Wrong amount → hard 400. Double verification → 409. Cross-tenant verification → 403. All verification actions audited with verifier identity.
- Honest payment disclaimer surfaced in UI and code: a QR/UTR is a claim, not proof; manual verification by the receiving account owner is the initial design; architecture is gateway/PSP-ready (payment records + states are reconciliation-shaped). No UPI PIN/OTP/passwords are ever collected.

**Super Admin dashboard** — overview (shops, platform subscription revenue, orders, storage, health, pending verifications), shop create/suspend/restore/edit + admin password reset, plan CRUD (price, duration incl. lifetime, printer/storage/order limits), subscription payment verification queue with QR preview, platform UPI settings + announcement, paginated audit logs.

**Shop Admin dashboard** — dashboard stats (today's collections, pending verifications, queue, failures), order list with status filters, order detail (payment verification dialog with QR + UTR, per-item duplex sheet breakdown, print-job states, retry/reprint with duplicate warning, printer assignment, full event history), pricing editor, printers CRUD with capability routing data, agent device management (pairing codes, revocation), private documents browser with signed links + storage meter, day/week/month reports with CSV export, shop QR download, subscription purchase via platform UPI QR + UTR, profile/UPI settings.

**Printing pipeline**
- Order states exactly as specified: PAYMENT_PENDING, VERIFICATION_PENDING, PAID, QUEUED, SPOOLING, PRINTING, COMPLETED, FAILED, CANCELLED, REFUNDED. Full timestamped OrderEvent history.
- Only VERIFIED payments release orders to the queue (enforced in `releaseOrderToQueue`).
- Print jobs with unique `idempotencyKey` (`orderId:itemId:v1`), atomic claim (`QUEUED→DISPATCHED` conditional update) — duplicate printing is impossible even with multiple devices.
- Server-side printer routing by colour capability, paper size and duplex support; manual assignment/retry/reprint controls.
- Agent status state machine: QUEUED → DISPATCHED → SPOOLING → SPOOLER_ACCEPTED → PRINTING → COMPLETED/FAILED; impossible transitions rejected and logged.
- **Windows Local Print Agent** (`agent/agent.js`): pairing, poll loop with backoff, signed downloads, SumatraPDF integration (copies/page-ranges/duplex/paper/colour/fit), spooler-drain check, crash-safe local state (no duplicate prints after restart), revocation support, simulator mode. Setup guide + NSSM service instructions in `agent/README.md`.

**Platform plumbing** — subscription lifecycle (7-day trial auto-start, M3/M6/Y1/LIFETIME seeded, lifetime never expires — verified by test), plan limits enforced (printer count; monthly order/storage limits checked), expiry sweeps (lazy + `/api/cron/sweep` with CRON_SECRET), audit log on all privileged actions, backup script (`scripts/backup.ts`: SQLite online backup + uploads archive + 14-day retention), rate limiting, zod-style input validation everywhere, ₹/IST/en-IN formatting throughout.

## 2. Features partially implemented

- **Physical-output confirmation** — the pipeline distinguishes spooler states honestly, but consumer printers give no reliable "paper out" signal; final confirmation is manual (shop UI). Hardware feedback would need supported printers.
- **Refunds** — data model, states and audit exist; there is no dedicated refund UI wizard (a refund is recorded by moving a VERIFIED payment to REFUND_PENDING/REFUNDED with audit). Low-risk addition.
- **WebSocket push to agent** — implemented as HTTPS long-poll (5s) per the resilience requirements; genuine WS push would reduce latency a few seconds.
- **PostgreSQL + row-level security** — schema is RLS-shaped (`shopId` on every tenant row) but the pilot runs SQLite, where RLS does not exist; isolation is enforced at the service layer (tested).
- **Cart/carts & cart_items tables** — the multi-document builder is client-side and the submitted cart becomes Order+OrderItem atomically; no server-side draft-cart persistence.
- **Shop Members (multi-admin per shop)** — one Shop Admin user per shop currently; `users.shopId` supports adding more without schema change.

## 3. Features not implemented (with reasons)

- **Automatic bank/PSP payment verification** — deliberately not faked. Requires a PSP/bank API (e.g. UPI reclaim/Setu-style confirm endpoints) with real credentials. The manual-verification design is the honest v1 and the states/audit are ready for a verifier plugin.
- **Windows installer binary (.msi)** — the Linux sandbox cannot build/sign Windows installers. Shipped instead: dependency-free `agent.js` + step-by-step setup + NSSM service recipe + `--simulator` test mode. Building an installer is a 30-minute task on any Windows machine (documented).
- **Email/SMS notifications** — no mail/SMS provider credentials exist in this environment; notifications table exists for future wiring.
- **Real hardware printer testing** — requires physical Windows + printers (see §8).

## 4. Database schema & migration status

- 20 models: User, Shop, SubscriptionPlan, Subscription, Payment, Refund, PricingRule, PricingVersion, Printer, PrintDevice, Customer, Document, Order, OrderItem, OrderEvent, PrintJob, PrintJobEvent, AuditLog, PlatformSetting, Notification.
- Every shop-owned row carries `shopId` (tenant key) with indexes; money is integer paise; all enum-ish fields are string unions validated in code (SQLite has no native enums — PostgreSQL migration maps them 1:1).
- `Payment @@unique([utr, payeeUpiId])` makes duplicate UTR use impossible at the DB level. `PrintJob.idempotencyKey` unique prevents duplicate jobs. `Order @@unique([shopId, orderNumber])`.
- Status: applied via `prisma db push` (schema 100% in sync). `prisma migrate` diff files can be generated for production rollout.

## 5. API & backend status

- ~40 route handlers, all TypeScript, all returning typed JSON errors via a uniform guard wrapper.
- Areas: auth (3), public customer (5), files (1), shop admin (16), super admin (8), agent (4), cron (1).
- All e2e-tested over real HTTP (76 assertions-passed scenarios including auth failures, tenant isolation, payment guards, agent flows).
- Server logs clean of unhandled errors after fixes (dev.log verified).

## 6. Security & tenant-isolation test results (all passing)

| Requirement | Result |
|---|---|
| Session tokens tamper-proof (HMAC) + expiry | ✅ (forged payload/signature/expiry rejected) |
| Tenant isolation on orders/printers/payments/documents | ✅ (cross-tenant → 404/403/empty) |
| Cross-tenant payment verification | ✅ blocked (403) |
| Duplicate UTR per payee | ✅ 409 + audit `PAYMENT_UTR_DUPLICATE_REJECTED` |
| Wrong-amount confirmation | ✅ 400, order not released |
| Double verification | ✅ 409 |
| Unverified payment → no print job | ✅ agent poll returns empty |
| Duplicate print job (same job claimed twice) | ✅ second claim returns nothing |
| Impossible job transitions | ✅ rejected + event logged |
| Device revocation | ✅ token dead immediately (401) |
| Super Admin cannot open customer documents | ✅ 403 |
| Order status without access code | ✅ 403; wrong code → 404 |
| Rate limiting (11th login attempt) | ✅ 429 |
| RBAC (shop admin → admin APIs; customer pages for shop admin) | ✅ 403 / redirect |
| Private uploads outside `public/`, signed short-lived links | ✅ (forged/expired token → 403) |
| Suspended/expired shop refuses orders | ✅ upload gate 403 |

## 7. Payment workflow test results (all passing)

Subscription: platform UPI config → shop picks plan → QR with exact amount & `tr` reference → UTR submit → Super Admin wrong-amount rejection → correct-amount activation (M3, expiry set) → LIFETIME activation (`expiresAt` stays null, sweep-proof) → expired trial disables ordering (upload gate 403). Print orders: create → UTR → duplicate UTR 409 → wrong amount 400 → exact verification → auto `PAID→QUEUED` with routed jobs → agent states → `COMPLETED`. Amounts verified against duplex sheet math (e.g. 9 pages × 1 copy duplex @ ₹1.50 = ₹13.50; 4 pages × 2 copies duplex @ ₹1.50 = ₹12.00, 4 sheets).

## 8. Print agent build & hardware test status

- Backend contract: fully implemented and e2e-tested over HTTP (pairing, token auth, claim, signed download, status machine, revocation).
- Agent code: executed for real against the live server in **simulator mode** — paired, claimed, downloaded the actual PDF, applied settings (`2x A4 BW duplex → HP LaserJet M1136 MFP`), reported honest states, order reached COMPLETED.
- **Not tested here:** physical Windows spooler behaviour, real printer drivers, paper/duplex hardware feedback, offline-printer recovery on real hardware. These require a Windows PC + printers; the simulator and README checklist cover manual verification steps. SumatraPDF is the supported print backend (fallback: any CLI via `printCommandTemplate`).

## 9. Deployment URL

**No public production URL is claimed.** The application runs in this sandbox and is browser-verified at the sandbox preview (root route `/` links everything). Production deployment steps: set env vars (§6 of README), `bun run build && bun start` (or `next start`), run `scripts/seed.ts`, schedule `/api/cron/sweep`, back up `db/` nightly, point `BASE_URL` at the domain, install agents at pilot shops.

## 10. Required environment variables & credentials

```
DATABASE_URL=file:/abs/path/db/custom.db
SESSION_SECRET=<openssl rand -hex 32>
CRON_SECRET=<openssl rand -hex 16>
FILE_STORAGE_DIR=/abs/path/db/uploads
MAX_UPLOAD_MB=20
BASE_URL=https://your-domain        # optional but recommended
SUPER_ADMIN_EMAIL=…                 # for scripts/create-superadmin.ts
SUPER_ADMIN_PASSWORD=…              # min 10 chars
```

Sandbox demo credentials (labelled demo, change before any real use): Super Admin `owner@smartphotocopy.test / ChangeMe!2026`, demo shop `demo@smartphotocopy.test / Demo@2026`.

## 11. Remaining external dependencies

1. **A deployment host** with a persistent disk (SQLite file + uploads) — or PostgreSQL credentials for multi-instance scale.
2. **Real UPI ID for the platform owner** (Super Admin → Settings) — placeholder is intentionally empty; shops must each set their own real VPA.
3. **Windows PC + SumatraPDF + printers** at each pilot shop for the agent (documented in `agent/README.md`).
4. **Domain + TLS** for production (agent and UPI apps work best over HTTPS).
5. Optional future: PSP/bank verification API, SMS/email provider, Windows installer build machine.

## 12. Exact next actions required from you

1. Run `bun scripts/create-superadmin.ts` with **your** email/password, log in, set **Super Admin UPI** (Settings) — subscriptions can then be paid.
2. Create your first real shop (Super Admin → Shops), hand the shop admin their credentials; the 7-day trial starts automatically.
3. As the shop: set shop profile + **your shop's real UPI ID**, enter pricing, add printers (exact Windows names), download the counter QR.
4. On the shop's Windows PC: install Node 18+, copy `agent/`, pair with a code from Printers & devices, run as an NSSM service (`agent/README.md`).
5. Do one end-to-end pilot: scan QR → upload → pay ₹1 to the shop UPI → submit UTR → verify credit → collect the printout; confirm agent states behave on your hardware.
6. Schedule the sweep cron + nightly `scripts/backup.ts`; set strong `SESSION_SECRET`/`CRON_SECRET` in production env.
7. When ready to scale: provision PostgreSQL, regenerate migrations (`prisma migrate dev`), enable row-level security on `shopId`, and move uploads to object storage.

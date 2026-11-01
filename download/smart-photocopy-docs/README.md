# SMART PHOTOCOPY

Multi-tenant SaaS for photocopy & printing shops: customers scan a shop QR, upload
PDFs, pick print options, pay **directly to the shop's UPI ID** (no payment
gateway), and the shop releases verified orders to an automatic Windows print queue.

- **Roles:** Super Admin (platform owner) · Shop Admin (tenant) · Customer (anonymous, no login)
- **Stack:** Next.js 16 (App Router) + TypeScript · Prisma + SQLite (pilot) · Tailwind 4 + shadcn/ui · bun
- **Money:** ₹ (integer paise everywhere) · Times: Asia/Kolkata · UPI deep-link QRs

---

## 1. Quick start (this sandbox / local dev)

```bash
bun install
cp .env.example .env            # then edit values (see §6)
bun run db:push                 # create schema
bun scripts/seed.ts             # provision super admin, plans, DEMO shop
bun run dev                     # http://localhost:3000
```

Default provisioned accounts (change immediately in any real deployment):

| Role | Credentials | Where |
|---|---|---|
| Super Admin | `owner@smartphotocopy.test` / `ChangeMe!2026` | `/login` → `/admin` |
| Demo Shop Admin | `demo@smartphotocopy.test` / `Demo@2026` | `/login` → `/shop` |
| Demo customer QR | no login | `/s/demo-shop` |

> The demo shop, its UPI VPA (`demoshop@upi`) and orders are **labelled demo data** — not production data.

### Creating the real Super Admin (no public registration exists)

```bash
SUPER_ADMIN_EMAIL=you@yourdomain.com SUPER_ADMIN_PASSWORD='strong-passphrase' bun scripts/create-superadmin.ts
```

## 2. The full order lifecycle

1. Shop admin sets **Shop settings** (name, address, hours, **their own UPI ID + payee name**) and **Pricing** (per paper-size × colour, optional duplex rate, flat charges, GST %).
2. Shop admin downloads the **Shop QR** (PNG) and displays it at the counter.
3. Customer scans → `/s/{shop-slug}` → uploads PDFs (validated: extension, MIME, `%PDF-` signature, structural integrity, encryption, page count, size cap).
4. Per-document settings: paper size, B/W or colour, copies, page ranges, duplex. **Price is calculated server-side only** (client value is display-only).
5. Order created → shop-specific **UPI QR** with the exact amount + unique payment reference.
6. Customer pays in any UPI app, submits the **UTR**.
7. Shop admin checks their own bank/UPI app → confirms the **exact credited amount**.
8. Order is automatically released to the print queue; print jobs are routed (colour/paper/duplex-capability) and claimed by the shop's Windows agent.
9. Agent downloads via short-lived signed URL, prints via SumatraPDF, reports honest states. Shop sees the queue, retry/reprint (with duplicate warning), reports and audit trail.

Subscription payments work the same way but target the **platform owner's UPI** and are verified by the Super Admin. Platform revenue and shop collections never mix.

## 3. Windows Print Agent

Source: `agent/` — plain Node.js 18+ (zero npm dependencies), prints via SumatraPDF.
Setup, pairing, NSSM service install, printer mapping and troubleshooting:
see **`agent/README.md`**.

```bash
node agent.js --pair ABCD1234     # one-time pairing (code from Shop Dashboard → Printers & devices)
node agent.js                     # normal polling loop
node agent.js --simulator         # test mode: no physical printing
```

Security: outbound-only HTTPS, device tokens stored as SHA-256, revocation is
immediate, jobs are claimed atomically (no double-printing), a local state file
prevents duplicate printing after a crash (unconfirmed jobs become FAILED for
manual checking — never silently reprinted).

**Honesty rule:** `COMPLETED` = spooler handed the job to the printer. It is not
hardware-confirmed paper output; the shop confirms or reprints manually.

## 4. Tests

```bash
bun test tests/          # 76 automated tests
```

- `tests/pricing.test.ts` — page ranges, duplex sheet math, server-side totals, UPI URI/VPA
- `tests/auth.test.ts` — scrypt hashing, session tokens (tamper/expiry), file tokens, PDF validation
- `tests/e2e.test.ts` — full HTTP integration: auth, provisioning, **tenant isolation**, ordering,
  UTR dedup, verification amount checks, queue authorization, agent claim/download/status,
  revocation, subscriptions (trial/expiry/lifetime), RBAC, rate limiting, audit trail
- Manual/hardware tests (real printers, Windows spooler) are documented in `agent/README.md`
- e2e creates only `test-e2e-*` tenants and purges them before & after each run

## 5. Operations

```bash
bun scripts/backup.ts /path/to/backups   # SQLite online backup + private uploads archive (14-day retention)
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://YOUR-DOMAIN/api/cron/sweep
# → expires stale payments/orders and overdue subscriptions (lifetime never expires)
```

Run the sweep on a schedule (cron every 5–15 min, or daily). Without it, expiry is
still enforced lazily on dashboard/public reads.

## 6. Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file path (pilot). PostgreSQL+RLS is the scale path. |
| `SESSION_SECRET` | HMAC key for sessions & signed file links (`openssl rand -hex 32`) |
| `CRON_SECRET` | protects `/api/cron/sweep`; also enables the dev-only rate-limit test bypass |
| `FILE_STORAGE_DIR` | private upload root (never inside `public/`) |
| `MAX_UPLOAD_MB` | per-file cap (default 20) |
| `BASE_URL` | optional; fixes the domain used in shop QR codes |

## 7. Key routes

| Area | Paths |
|---|---|
| Customer | `/s/{slug}` · `/s/{slug}/status/{orderNumber}?code=…` |
| Shop admin | `/shop` (+ orders, payments, pricing, printers, documents, reports, qr, subscription, settings) |
| Super Admin | `/admin` (+ shops, payments, plans, settings, audit) |
| Agent API | `POST /api/agent/pair` · `GET /api/agent/jobs` · `POST /api/agent/jobs/{id}/status` · `GET /api/agent/download/{docId}` |
| Maintenance | `POST /api/cron/sweep` |

## 8. Security model (summary)

- Tenant scope **always** comes from the signed session or device token — never the browser.
- One shared SQLite file for the pilot with strict service-layer scoping (every shop query
  filters `shopId` from the session). Production PostgreSQL should add row-level security on `shopId`.
- Private document storage; downloads only via 5–10 minute HMAC-signed links; Super Admin has
  **no** API access to customer document contents.
- Payments: no gateway, no UPI PIN/OTP collection, UTR uniqueness per payee account,
  exact-amount confirmation, single verification, full audit trail.
- Rate limiting on login/uploads/orders/UTR/agent endpoints (fixed window per IP).
- scrypt password hashing, httpOnly SameSite cookies, Prisma parameterised queries.

See `FINAL_REPORT.md` for the complete delivery report.

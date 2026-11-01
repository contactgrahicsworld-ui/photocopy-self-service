# SMART PHOTOCOPY

Multi-tenant SaaS for photocopy & printing shops: customers scan a shop QR, upload
PDFs, pick print options, pay **directly to the shop's UPI ID** (no payment
gateway), and the shop releases verified orders to an automatic Windows print queue.

- **Roles:** Super Admin (platform owner) · Shop Admin (tenant) · Customer (anonymous, no login)
- **Stack:** Next.js 16 (App Router) + TypeScript · Prisma (SQLite dev / PostgreSQL prod) · Tailwind 4 + shadcn/ui
- **Storage:** local disk (dev) or **Supabase Storage** private bucket (production/serverless)
- **Money:** ₹ (integer paise everywhere) · Times: Asia/Kolkata · UPI deep-link QRs
- **Security:** scrypt password hashing, HMAC-signed session/file/device tokens, per-tenant scoping from the signed session only, audit log, rate limiting, duplicate-UTR prevention

> **No predefined credentials exist anywhere in this system.** The first platform
> owner is created once at `/setup` using the server's `SETUP_TOKEN`.

---

## 1. Local development

```bash
bun install
cp .env.example .env          # fill values (see §5) — nothing has defaults that work in prod
bun run db:push               # create SQLite schema
bun scripts/seed.ts           # plans + platform settings; demo data ONLY if demo env vars are set
bun run dev                   # http://localhost:3000
```

First run: open `/setup`, enter `SETUP_TOKEN`, create the Platform Owner account,
sign in at `/login`, set your real UPI ID under Admin → Settings, create a shop.

## 2. Production deployment (Vercel + Supabase)

Why: Vercel's filesystem is ephemeral, so production uses **Supabase Postgres**
(schema `smartphoto`) + **Supabase Storage** (private `documents` bucket).

1. **Database** — create the Postgres schema:

   ```bash
   export DATABASE_URL="postgresql://<user>.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres?schema=smartphoto&sslmode=require"
   bunx prisma db push --schema prisma/schema.postgres.prisma --skip-generate
   bun scripts/seed.ts   # seeds plans + settings only (production mode)
   ```

2. **Storage** — create a private bucket (once):

   ```bash
   curl -X POST "https://<ref>.supabase.co/storage/v1/bucket" \
     -H "Authorization: Bearer <service_role_key>" -H "apikey: <service_role_key>" \
     -H "Content-Type: application/json" \
     -d '{"id":"documents","name":"documents","public":false,"file_size_limit":20971520}'
   ```

3. **Vercel** — set environment variables (Production + Preview):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase **transaction pooler** URL (`:6543/postgres?schema=smartphoto&sslmode=require&pgbouncer=true&connection_limit=1`) |
   | `SESSION_SECRET` | `openssl rand -hex 32` |
   | `CRON_SECRET` | `openssl rand -hex 16` (Vercel Cron sends it as Bearer automatically) |
   | `SETUP_TOKEN` | `openssl rand -hex 16` — one-time owner creation at `/setup` |
   | `STORAGE_BACKEND` | `supabase` |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (server-only secret) |
   | `SUPABASE_STORAGE_BUCKET` | `documents` |
   | `MAX_UPLOAD_MB` | `20` |
   | `BASE_URL` | `https://your-domain` |

   Deploy: `vercel --prod`. `vercel.json` builds with the Postgres Prisma schema
   and registers the hourly `/api/cron/sweep` (expires stale payments/subscriptions).

4. **First login** — open `https://your-domain/setup`, enter `SETUP_TOKEN`,
   create the owner account. The setup page closes itself permanently afterwards.

## 3. Windows print agent

See **`agent/README.md`**. Summary:

1. Shop Dashboard → *Printers & devices* → add printers (exact Windows names) → create device pairing code.
2. On the shop's Windows PC run `SmartPhotocopyAgent-Setup.exe` (GitHub Releases) or `node agent.js --pair <CODE>`.
3. Printing uses SumatraPDF (portable, included path configurable). The agent polls outbound HTTPS only, prints with colour/duplex/copies/page-ranges, reports honest spooler states and never re-prints a job after a crash (local idempotency state).
4. Run as a service with NSSM (guide in the agent README) or use the installer's auto-start option.

The agent has zero npm dependencies (Node built-ins only) and ships as a single
cross-compiled `.exe` — no Node.js installation required on the shop PC.

## 4. Testing

```bash
bun test tests/auth.test.ts tests/pricing.test.ts   # unit: hashing, tokens, PDF validation, pricing math
bun test tests/e2e.test.ts                          # integration: auth, tenant isolation, ordering, UPI/UTR, queue, agent (needs dev server running)
bun scripts/agent-e2e-driver.ts                     # print-agent simulator against the live server
```

Hardware behaviour (Windows spooler, real printers) is verified with the
checklist in `agent/README.md` — it cannot be tested from Linux.

## 5. Environment variables

```
DATABASE_URL=<sqlite file: URL for dev | Supabase pooler URL for prod>
SESSION_SECRET=<openssl rand -hex 32>
CRON_SECRET=<openssl rand -hex 16>
SETUP_TOKEN=<openssl rand -hex 16>     # one-time /setup, delete after use if you prefer
FILE_STORAGE_DIR=<abs path>            # dev/local backend only
STORAGE_BACKEND=local|supabase
SUPABASE_URL=<https://<ref>.supabase.co>          # supabase backend
SUPABASE_SERVICE_ROLE_KEY=<service_role key>      # supabase backend
SUPABASE_STORAGE_BUCKET=documents                 # supabase backend
MAX_UPLOAD_MB=20
BASE_URL=https://your-domain
SUPER_ADMIN_EMAIL=…                     # dev seeding only
SUPER_ADMIN_PASSWORD=…                  # dev seeding only
```

## 6. Honest payment model

A UPI QR only *requests* a payment and a submitted UTR only *claims* one — neither
proves money arrived. Verification is manual by the receiving account owner
(shop verifies print orders against its own bank app; the platform owner verifies
subscription payments). Duplicate UTRs to the same payee are impossible (DB
constraint + 409), amounts are enforced exactly, and every verification is
audited. The payment state machine and records are reconciliation-shaped so a
bank/PSP auto-verification API can be added later without redesign. No UPI PINs,
OTPs or banking passwords are ever collected.

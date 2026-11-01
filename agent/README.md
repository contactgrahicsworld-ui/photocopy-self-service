# Smart Photocopy — Windows Local Print Agent

The agent runs on the **shop's Windows PC**, connects **outbound only** (HTTPS to your
server, no inbound ports), receives only the **authorized print jobs of its own shop**,
and submits them to the Windows print spooler with the customer's settings
(paper size, colour, duplex, copies, page ranges).

## 1. Install

1. Install **Node.js 18 or newer** on the shop PC — https://nodejs.org (LTS, "next" defaults).
2. Copy the whole `agent/` folder to e.g. `C:\SmartPhotocopyAgent\`.
3. Download **SumatraPDF** (free, ~6 MB) — https://www.sumatrapdfreader.org/download-free-pdf-viewer
   and place `SumatraPDF.exe` in the same folder (or install it normally — the agent
   finds it automatically).
4. Copy `agent.config.example.json` → `agent.config.json` and set:
   ```json
   {
     "serverUrl": "https://YOUR-DOMAIN",   // your Smart Photocopy deployment URL
     "deviceToken": null,
     "printerMap": {
       "Printer name from the dashboard": "Exact Windows printer name"
     }
   }
   ```
   `printerMap` maps the logical printer names you entered in the Shop Dashboard →
   Printers to the actual Windows printer names on that PC.

## 2. Pair (one-time)

1. In the Shop Dashboard → **Printers & devices** → *Register device* → note the
   8-character pairing code (valid 15 minutes, single use).
2. In Command Prompt:
   ```
   cd C:\SmartPhotocopyAgent
   node agent.js --pair ABCD1234
   ```
   The agent exchanges the code for a device token, stores it in
   `agent.config.json`, and starts polling. The device token is stored only as a
   SHA-256 hash on the server and can be revoked any time from the dashboard.

## 3. Run continuously (recommended: as a Windows service)

Using **NSSM** (https://nssm.cc):
```
nssm install SmartPhotocopyAgent "C:\Program Files\nodejs\node.exe" "C:\SmartPhotocopyAgent\agent.js"
nssm set SmartPhotocopyAgent AppDirectory C:\SmartPhotocopyAgent
nssm start SmartPhotocopyAgent
```
The agent auto-retries with backoff after internet loss and never loses a job:
a local `agent.state.json` prevents double printing after a crash — a job that was
mid-print when the agent died is reported as **FAILED (printed output unconfirmed)**
so the shop decides manually, instead of silently reprinting.

## 4. How printing works

| Step | Meaning |
|---|---|
| QUEUED | order paid & verified, job created on the server |
| DISPATCHED | this agent claimed the job (atomic, single claim) |
| SPOOLING | agent downloaded the PDF and invoked the printer |
| SPOOLER_ACCEPTED | Windows accepted the job into the spooler |
| COMPLETED | spooler queue drained (job handed to the printer) |
| FAILED | printer/driver/paper error — visible in Shop Dashboard with retry/reprint |

**Honesty note (by design):** `COMPLETED` means *the spooler handed the job to the
printer*. Consumer printers usually give software no reliable "paper came out"
signal, so final confirmation is the shop's responsibility — the dashboard shows
job states and lets the shop reprint **with an explicit duplicate warning**.

Page ranges, copies (`3x`), duplex, paper size (`paper=A4`), fit-to-page and
colour/monochrome are passed to SumatraPDF via `-print-settings`.

## 5. Testing without a printer

Run in simulator mode — it performs the whole pipeline but writes
`simulated-print-<jobid>.txt` files instead of printing:
```
node agent.js --simulator
```

## 6. Troubleshooting

- **"SumatraPDF.exe not found"** → install SumatraPDF or set `SUMATRA_PATH` env var,
  or set `printCommandTemplate` to any CLI printer tool.
- **Jobs stay QUEUED** → the job's printer has no compatible printer (colour vs B/W,
  paper size, duplex). Assign a printer manually in the order screen.
- **Token rejected** → the device was revoked; register + pair again.
- **Wrong printer names** → `printerMap` keys must match the dashboard names,
  values must match Windows (`Get-Printer | select Name` in PowerShell).

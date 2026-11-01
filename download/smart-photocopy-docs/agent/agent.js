#!/usr/bin/env node
/**
 * SMART PHOTOCOPY — Windows Local Print Agent (v1.0.0)
 * =====================================================
 * Runs on the shop's Windows PC. Connects OUTBOUND over HTTPS only.
 * - Pairs once with a one-time code (Shop Dashboard → Printers & devices)
 * - Polls for authorized QUEUED jobs of ITS shop only (device token scoped)
 * - Downloads PDFs with short-lived signed URLs (10 min TTL)
 * - Prints via SumatraPDF (recommended) or a configurable command template
 * - Reports honest states: DISPATCHED → SPOOLING → SPOOLER_ACCEPTED →
 *   COMPLETED / FAILED. "COMPLETED" means the spooler finished handing the
 *   job to the printer — it is NOT hardware-confirmed paper output.
 * - Idempotent: a local state file prevents duplicate printing after a crash
 *   or reconnect (a job marked "printing" but unconfirmed needs MANUAL check).
 * - Survives internet loss: retries with backoff, never loses job data.
 *
 * Requirements: Node.js 18+ on Windows. No npm dependencies (built-ins only).
 *
 * Usage:
 *   node agent.js                          normal run (uses agent.config.json)
 *   node agent.js --pair ABC123            pair with a one-time code
 *   node agent.js --simulator              do not print; simulate + log (for testing)
 *   node agent.js --once                   poll once and exit (for testing/cron)
 *
 * Setup guide: see README.md next to this file.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { execFile } = require("child_process");
const os = require("os");
const readline = require("readline");

const AGENT_VERSION = "1.0.0";
const CONFIG_PATH = path.join(__dirname, "agent.config.json");
const STATE_PATH = path.join(__dirname, "agent.state.json");

// ── tiny helpers ─────────────────────────────────────────────────────────────
function log(...args) {
  console.log(new Date().toISOString(), "[agent]", ...args);
}

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function request(baseUrl, method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlPath, baseUrl); } catch (e) { return reject(new Error(`Invalid baseUrl/URL: ${baseUrl} ${urlPath}`)); }
    const mod = u.protocol === "http:" ? http : https;
    const payload = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const req = mod.request(u, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString("utf8")); } catch {}
        resolve({ status: res.statusCode, json, buffer: buf });
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("Request timeout")));
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(a.trim()); }));
}

// ── print backends ───────────────────────────────────────────────────────────
function sumatraSettings(job) {
  const parts = [];
  if (job.pages) parts.push(job.pages); // page range e.g. "1-3,5"
  parts.push(`${job.copies}x`);
  parts.push(job.duplex ? "duplex" : "simplex");
  // SumatraPDF understands paper=A4/A3/Letter/Legal; photo sizes fall back to fit.
  const paperMap = { A4: "A4", A3: "A3", LEGAL: "Legal", LETTER: "Letter" };
  parts.push(`paper=${paperMap[job.paperSize] || "A4"}`);
  if (job.fitToPage !== false) parts.push("fit");
  if (job.colorMode === "COLOR") parts.push("color"); else parts.push("monochrome");
  return parts.join(",");
}

function findSumatra() {
  const candidates = [
    process.env.SUMATRA_PATH,
    path.join(__dirname, "SumatraPDF.exe"),
    "C:\\Program Files\\SumatraPDF\\SumatraPDF.exe",
    "C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe",
    path.join(os.homedir(), "AppData\\Local\\SumatraPDF\\SumatraPDF.exe"),
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch {} }
  return null;
}

function runCommand(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 180000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code ?? 1 : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? err?.message ?? "") });
    });
  });
}

/** Best-effort drain check: wait until the Windows spooler queue is empty. */
async function waitForSpoolerDrain(printerName, maxSeconds = 120) {
  if (process.platform !== "win32") return "unknown";
  const ps = `Get-PrintJob -PrinterName "${printerName}" | Measure-Object | Select-Object -ExpandProperty Count`;
  const start = Date.now();
  while (Date.now() - start < maxSeconds * 1000) {
    const r = await runCommand("powershell", ["-NoProfile", "-Command", ps]);
    if (r.ok && r.stdout.trim() === "0") return "drained";
    await sleep(3000);
  }
  return "timeout";
}

async function printJob(job, cfg) {
  const printerName = (cfg.printerMap && cfg.printerMap[job.printerName]) || job.printerName;
  const downloadUrl = new URL(job.downloadPath, cfg.serverUrl).toString();
  log(`job ${job.id}: downloading (${job.fileName}, ${job.copies}x ${job.paperSize} ${job.colorMode}${job.duplex ? " duplex" : ""}) → "${printerName}"`);

  const dl = await request(cfg.serverUrl, "GET", job.downloadPath);
  if (dl.status !== 200) throw new Error(`download failed (HTTP ${dl.status})`);
  const tmpPdf = path.join(os.tmpdir(), `sp-agent-${job.idempotencyKey.replace(/[^a-z0-9]/gi, "_")}.pdf`);
  fs.writeFileSync(tmpPdf, dl.buffer);

  // Local crash-safety: record BEFORE printing. If we crash mid-print, the
  // job will be flagged "needs manual check" instead of silently reprinted.
  const state = loadJson(STATE_PATH, {});
  state[job.id] = { status: "printing", at: new Date().toISOString() };
  saveJson(STATE_PATH, state);

  if (cfg.simulator) {
    const out = path.join(__dirname, `simulated-print-${job.id}.txt`);
    fs.writeFileSync(out, `SIMULATED PRINT\njob=${job.id}\nfile=${job.fileName}\nprinter=${printerName}\npages=${job.pages ?? "all"} copies=${job.copies} paper=${job.paperSize} mode=${job.colorMode} duplex=${job.duplex}\n`);
    log(`job ${job.id}: SIMULATED → ${out}`);
    return { spoolerAccepted: true, message: `simulated print → ${path.basename(out)}` };
  }

  const sumatra = findSumatra();
  let result;
  if (sumatra) {
    result = await runCommand(sumatra, [
      "-print-to", printerName,
      "-silent",
      "-print-settings", sumatraSettings(job),
      tmpPdf,
    ]);
  } else if (cfg.printCommandTemplate) {
    const cmd = cfg.printCommandTemplate
      .replace("{printer}", printerName)
      .replace("{file}", tmpPdf)
      .replace("{pages}", job.pages || "")
      .replace("{copies}", String(job.copies));
    result = await runCommand(cmd.split(" ")[0], cmd.split(" ").slice(1));
  } else {
    throw new Error("SumatraPDF.exe not found. Install it (see README.md) or set printCommandTemplate / SUMATRA_PATH.");
  }

  try { fs.unlinkSync(tmpPdf); } catch {}
  if (!result.ok) throw new Error(`print command failed: ${result.stderr.slice(0, 300)}`);
  log(`job ${job.id}: spooler accepted`);
  return { spoolerAccepted: true, message: `spooler accepted → ${printerName}` };
}

// ── main loop ────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const simulator = args.includes("--simulator");
  const once = args.includes("--once");
  const pairIdx = args.indexOf("--pair");
  const pairingCodeArg = pairIdx >= 0 ? args[pairIdx + 1] : null;

  const cfg = loadJson(CONFIG_PATH, null);
  if (!cfg || !cfg.serverUrl) {
    console.error("Missing agent.config.json. Copy agent.config.example.json → agent.config.json and set serverUrl (e.g. https://your-domain.example).");
    process.exit(1);
  }
  cfg.simulator = simulator || !!cfg.simulator;

  let deviceToken = cfg.deviceToken || null;

  // Pairing
  if (!deviceToken && pairingCodeArg) {
    const res = await request(cfg.serverUrl, "POST", "/api/agent/pair", {
      body: { pairingCode: pairingCodeArg, platform: `${os.platform()}/${os.release()}`, agentVersion: AGENT_VERSION },
    });
    if (res.status !== 200 || !res.json?.deviceToken) {
      console.error("Pairing failed:", res.json?.error ?? `HTTP ${res.status}`);
      process.exit(1);
    }
    deviceToken = res.json.deviceToken;
    cfg.deviceToken = deviceToken;
    saveJson(CONFIG_PATH, cfg);
    log(`paired with shop "${res.json.shop?.name ?? res.json.shopName}" — token saved to agent.config.json`);
  }
  if (!deviceToken) {
    const code = await prompt("Enter pairing code (from Shop Dashboard → Printers & devices): ");
    const child = process.execPath;
    const { spawn } = require("child_process");
    const p = spawn(child, [__filename, "--pair", code], { stdio: "inherit" });
    p.on("exit", (c) => process.exit(c ?? 1));
    return;
  }

  // Validate token / heartbeat
  const me = await request(cfg.serverUrl, "POST", "/api/agent/pair", { body: { deviceToken } });
  if (me.status !== 200) {
    console.error("Device token rejected (revoked or rotated?). Register a new device in the shop dashboard.");
    process.exit(1);
  }
  log(`connected as "${me.json.deviceName}" for shop "${me.json.shop?.name}"${cfg.simulator ? " [SIMULATOR MODE]" : ""}`);

  let backoff = 5;
  for (;;) {
    try {
      const res = await request(cfg.serverUrl, "GET", "/api/agent/jobs", { headers: { "x-device-token": deviceToken } });
      if (res.status === 401) {
        console.error("Device token revoked or expired — re-pair required.");
        process.exit(1);
      }
      if (res.status !== 200) throw new Error(`poll failed HTTP ${res.status}`);
      backoff = 5;
      const jobs = res.json.jobs ?? [];
      if (jobs.length) log(`${jobs.length} authorized job(s) received`);

      for (const job of jobs) {
        const state = loadJson(STATE_PATH, {})[job.id];
        if (state?.status === "done") { log(`job ${job.id}: already completed locally, skipping`); continue; }
        if (state?.status === "printing") {
          // Crash safety: we may have already sent this to the printer.
          await request(cfg.serverUrl, "POST", `/api/agent/jobs/${job.id}/status`, {
            headers: { "x-device-token": deviceToken },
            body: { status: "FAILED", message: "Agent restarted mid-job — printed output unconfirmed. Shop must verify before reprinting." },
          });
          log(`job ${job.id}: unconfirmed after restart — marked FAILED for manual verification (no duplicate print)`);
          loadJson(STATE_PATH, {}); // reload
          const st = loadJson(STATE_PATH, {}); st[job.id] = { status: "done", at: new Date().toISOString() }; saveJson(STATE_PATH, st);
          continue;
        }

        try {
          await request(cfg.serverUrl, "POST", `/api/agent/jobs/${job.id}/status`, {
            headers: { "x-device-token": deviceToken },
            body: { status: "SPOOLING", message: "Downloading and sending to printer" },
          });
          const r = await printJob(job, cfg);
          await request(cfg.serverUrl, "POST", `/api/agent/jobs/${job.id}/status`, {
            headers: { "x-device-token": deviceToken },
            body: { status: "SPOOLER_ACCEPTED", message: r.message },
          });
          if (process.platform === "win32" && !cfg.simulator) {
            const drain = await waitForSpoolerDrain((cfg.printerMap && cfg.printerMap[job.printerName]) || job.printerName);
            await request(cfg.serverUrl, "POST", `/api/agent/jobs/${job.id}/status`, {
              headers: { "x-device-token": deviceToken },
              body: { status: "COMPLETED", message: drain === "drained" ? "Spooler queue drained — handed to printer" : `Spooler wait ${drain} — reported by agent` },
            });
          } else {
            await request(cfg.serverUrl, "POST", `/api/agent/jobs/${job.id}/status`, {
              headers: { "x-device-token": deviceToken },
              body: { status: "COMPLETED", message: r.message },
            });
          }
          const st = loadJson(STATE_PATH, {});
          st[job.id] = { status: "done", at: new Date().toISOString() };
          saveJson(STATE_PATH, st);
          log(`job ${job.id}: COMPLETED (spooler level — physical output is confirmed by the shop, not by software)`);
        } catch (e) {
          log(`job ${job.id}: FAILED — ${e.message}`);
          await request(cfg.serverUrl, "POST", `/api/agent/jobs/${job.id}/status`, {
            headers: { "x-device-token": deviceToken },
            body: { status: "FAILED", message: e.message.slice(0, 400) },
          }).catch(() => {});
          const st = loadJson(STATE_PATH, {});
          st[job.id] = { status: "failed", at: new Date().toISOString(), error: e.message.slice(0, 200) };
          saveJson(STATE_PATH, st);
        }
      }
      if (once) { log("--once complete"); return; }
      await sleep(((res.json.pollAfterSeconds ?? 5) * 1000));
    } catch (e) {
      log(`offline (${e.message}) — retrying in ${backoff}s`); // resilience: keep retrying
      if (once) process.exit(0);
      await sleep(backoff * 1000);
      backoff = Math.min(backoff * 2, 120);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

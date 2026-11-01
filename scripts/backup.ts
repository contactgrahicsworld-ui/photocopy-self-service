// Backup strategy: SQLite online backup + private uploads archive.
// Run daily via cron:  0 2 * * *  bun /path/scripts/backup.ts /backups
// Retention: keep 14 daily, 8 weekly (handled by caller or cleanup below).

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const outDir = process.argv[2] || path.join(process.cwd(), "db", "backups");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

// 1. SQLite backup (safe online copy via .backup)
const dbFile = process.env.DATABASE_URL?.replace(/^file:/, "") || path.join(process.cwd(), "db", "custom.db");
const dbBackup = path.join(outDir, `smartphotocopy-db-${stamp}.db`);
execSync(`sqlite3 "${dbFile}" ".backup '${dbBackup}'" || cp "${dbFile}" "${dbBackup}"`, { stdio: "inherit" });

// 2. Private uploads archive
const uploads = process.env.FILE_STORAGE_DIR || path.join(process.cwd(), "db", "uploads");
const tarBackup = path.join(outDir, `smartphotocopy-uploads-${stamp}.tar.gz`);
if (fs.existsSync(uploads)) {
  execSync(`tar -czf "${tarBackup}" -C "${path.dirname(uploads)}" "${path.basename(uploads)}"`, { stdio: "inherit" });
}

// 3. Retention: delete db backups older than 14 days
const cutoff = Date.now() - 14 * 86400000;
for (const f of fs.readdirSync(outDir)) {
  const p = path.join(outDir, f);
  if (fs.statSync(p).mtimeMs < cutoff) {
    fs.unlinkSync(p);
    console.log("retention: removed", f);
  }
}
console.log(`✔ Backup complete: ${dbBackup}${fs.existsSync(tarBackup) ? ` + ${tarBackup}` : ""}`);

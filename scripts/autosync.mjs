/**
 * Starts the autosync worker with the extra CA bundle already in place.
 *
 * Same constraint as scripts/with-ca.mjs: NODE_EXTRA_CA_CERTS is read when the
 * process starts, so it has to be set by the launcher, not from .env.
 *
 *   node scripts/autosync.mjs            # run forever, hourly by default
 *   node scripts/autosync.mjs --once     # one round, for cron/systemd timers
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_BUNDLE = resolve("certs/russian-trusted-ca-bundle.pem");
const configured = process.env.GLACIER_EXTRA_CA_PATH
  ? resolve(process.env.GLACIER_EXTRA_CA_PATH)
  : DEFAULT_BUNDLE;

const env = { ...process.env };

if (!env.NODE_EXTRA_CA_CERTS && existsSync(configured)) {
  env.NODE_EXTRA_CA_CERTS = configured;
  console.log(`[autosync] дополнительный корневой сертификат: ${configured}`);
}

const child = spawn(
  process.execPath,
  // --experimental-strip-types is inert where type stripping is already on by
  // default (Node 22.18+/24), but the image's Node 22 may be older.
  ["--experimental-strip-types", "--import", "./scripts/register-alias.mjs",
   "scripts/autosync-worker.ts", ...process.argv.slice(2)],
  { stdio: "inherit", env },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

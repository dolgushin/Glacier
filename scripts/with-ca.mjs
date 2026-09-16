/**
 * Starts Next with the extra CA bundle already in place.
 *
 * NODE_EXTRA_CA_CERTS is read by Node when the process starts, which means it
 * cannot come from .env — Next loads that file long after TLS is configured.
 * Telling the user to remember an environment variable every time they start
 * the service is a step that will be forgotten; this makes it automatic when
 * the bundle is present and a no-op when it is not.
 *
 *   node scripts/with-ca.mjs dev|start|build
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
  console.log(`[glacier] дополнительный корневой сертификат: ${configured}`);
} else if (!env.NODE_EXTRA_CA_CERTS) {
  console.log(
    "[glacier] сертификат УЦ Минцифры не найден — синхронизация с Т-Инвестициями работать не будет.\n" +
      "          Положите его в certs/russian-trusted-ca-bundle.pem (см. README).",
  );
}

// Spawn the Next CLI through this Node binary rather than a shell, so quoting
// and PATH behave the same on Windows and Linux.
const cli = resolve("node_modules/next/dist/bin/next");
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

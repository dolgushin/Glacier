/**
 * The autosync loop. Started by scripts/autosync.mjs, which sets up the CA
 * bundle and the path aliases; this file only does the work.
 *
 * Two modes:
 *   default   — a round every GLACIER_SYNC_INTERVAL_MINUTES (60 by default)
 *   --once    — a single round, exit code 1 when any account failed, so a cron
 *               line or a systemd timer can alert on it
 */
import { existsSync } from "node:fs";
import { describeRound, parseIntervalMinutes, runSyncRound } from "@/lib/brokers/scheduler";

// Next loads .env itself; a bare Node process does not, and GLACIER_SECRET is
// what decrypts the stored broker tokens.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const ONCE = process.argv.includes("--once");
const intervalMinutes = parseIntervalMinutes(process.env.GLACIER_SYNC_INTERVAL_MINUTES);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function round(): Promise<boolean> {
  const started = new Date();
  try {
    const result = await runSyncRound();
    console.log(`[autosync] ${started.toISOString()} ${describeRound(result)}`);
    return result.errors.length === 0;
  } catch (error) {
    // A round that throws before it can report — DB locked, schema missing —
    // must still be visible rather than silently retried forever.
    console.error(
      `[autosync] ${started.toISOString()} раунд не выполнен: ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return false;
  }
}

async function main() {
  if (ONCE) {
    const clean = await round();
    process.exit(clean ? 0 : 1);
  }

  console.log(`[autosync] запущен, интервал ${intervalMinutes} мин. Остановка: Ctrl+C.`);

  // Round first, sleep after: a restart should catch up immediately rather
  // than wait out a full interval.
  for (;;) {
    await round();
    await sleep(intervalMinutes * 60_000);
  }
}

await main();

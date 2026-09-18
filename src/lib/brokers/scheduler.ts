import { createHash, timingSafeEqual } from "node:crypto";
import { syncAllUsers } from "@/lib/brokers/engine";
import { logSync, refreshQuotes } from "@/lib/sync";
import { notifyRound } from "@/lib/telegram";
import { nowIso } from "@/lib/db";

/**
 * Scheduled broker sync.
 *
 * One round of work shared by the two ways it can be triggered: the long-running
 * `scripts/autosync.mjs` process and the /api/cron/sync endpoint for an external
 * scheduler. They differ only in who calls this and how often.
 */

export interface SyncRound {
  /** Users that had at least one enabled link. */
  users: number;
  /** Accounts actually synced. */
  accounts: number;
  /** New operations written across all of them. */
  inserted: number;
  errors: string[];
}

const DEFAULT_INTERVAL_MINUTES = 60;
const MIN_INTERVAL_MINUTES = 5;

/**
 * Interval between rounds, from GLACIER_SYNC_INTERVAL_MINUTES.
 *
 * Anything unparseable or absurdly small falls back to the default rather than
 * spinning: a one-minute loop against a broker API is how an account gets its
 * rate limit burned for the day.
 */
export function parseIntervalMinutes(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_INTERVAL_MINUTES) {
    return DEFAULT_INTERVAL_MINUTES;
  }
  return Math.floor(value);
}

/**
 * Compare a presented bearer token with the configured cron secret.
 *
 * Both sides are hashed first: timingSafeEqual needs equal-length buffers, and
 * hashing makes the length identical without revealing how long the real
 * secret is.
 */
export function cronSecretMatches(presented: string, configured: string): boolean {
  if (!presented || !configured) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(configured).digest();
  return timingSafeEqual(a, b);
}

/** One-line summary, stored in sync_log where the settings page can show it. */
export function describeRound(round: SyncRound): string {
  const base =
    `пользователей: ${round.users}, счетов: ${round.accounts}, ` +
    `новых операций: ${round.inserted}`;
  return round.errors.length > 0 ? `${base}; ошибки: ${round.errors.join("; ")}` : base;
}

/**
 * Sync every enabled account of every user, then reprice once if anything new
 * arrived. Quotes are refreshed after the round, not per account: ten accounts
 * of one user still cost one pass over the market data.
 */
export async function runSyncRound(): Promise<SyncRound> {
  const startedAt = nowIso();

  const { users, results, errors } = await syncAllUsers();
  const inserted = results.reduce((sum, outcome) => sum + outcome.inserted, 0);

  if (inserted > 0) {
    try {
      await refreshQuotes();
    } catch (error) {
      // New operations with stale prices are still correct data; the next
      // quote refresh will catch up. Not worth failing the round over.
      errors.push(`котировки: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const round: SyncRound = {
    users,
    accounts: results.length,
    inserted,
    errors,
  };
  logSync("brokers-auto", errors.length > 0 ? "error" : "ok", describeRound(round), startedAt);

  // Уведомления — после журнала и никогда в ущерб ему: сбой Telegram не должен
  // красить удачный раунд в ошибку.
  try {
    await notifyRound(startedAt, errors);
  } catch {
    // тихо: журнал раунда уже записан
  }
  return round;
}

import { all, get, nowIso, run, today } from "@/lib/db";
import { instrumentsInUse, setPrice } from "@/lib/repo";
import { fetchQuotes, fetchBondPayouts, marketFor } from "@/lib/providers/moex";
import { fetchCryptoPrices } from "@/lib/providers/coingecko";
import { fetchRates } from "@/lib/providers/cbr";
import { isDerivative, type Instrument } from "@/lib/types";

/**
 * Background refresh of everything the app reads from the outside world.
 * All of it is best-effort: when a source is unreachable the previously cached
 * value stays in place and the UI shows how stale it is.
 */

export function logSync(kind: string, status: "ok" | "error", detail: string, startedAt: string) {
  run(
    "INSERT INTO sync_log (kind, status, detail, started_at, finished_at) VALUES (?, ?, ?, ?, ?)",
    kind,
    status,
    detail.slice(0, 500),
    startedAt,
    nowIso(),
  );
}

// -------------------------------------------------------------------- FX

/** Latest known rate per currency, in roubles per unit. */
export function latestFxRates(): Map<string, number> {
  const rows = all<{ currency: string; rate: number }>(
    `SELECT currency, rate FROM fx_rates
      WHERE date = (SELECT MAX(date) FROM fx_rates f2 WHERE f2.currency = fx_rates.currency)`,
  );
  const rates = new Map<string, number>([["RUB", 1]]);
  for (const row of rows) rates.set(row.currency, row.rate);
  return rates;
}

export async function refreshFx(): Promise<{ updated: number }> {
  const startedAt = nowIso();
  try {
    const rates = await fetchRates();
    const date = today();
    for (const [currency, rate] of rates) {
      run(
        "INSERT INTO fx_rates (date, currency, rate) VALUES (?, ?, ?) ON CONFLICT(date, currency) DO UPDATE SET rate = excluded.rate",
        date,
        currency,
        rate,
      );
    }
    logSync("fx", "ok", `${rates.size} курсов`, startedAt);
    return { updated: rates.size };
  } catch (error) {
    logSync("fx", "error", String((error as Error).message), startedAt);
    return { updated: 0 };
  }
}

// ---------------------------------------------------------------- quotes

/**
 * MOEX quotes bonds as a percentage of face value. Store the money price so the
 * position maths never has to special-case an asset class.
 */
function toMoneyPrice(instrument: Instrument, raw: number): number {
  if (instrument.kind !== "bond") return raw;
  const face = instrument.face_value ?? 1000;
  return (raw / 100) * face;
}

export async function refreshQuotes(): Promise<{ updated: number; failed: number }> {
  const startedAt = nowIso();
  const instruments = instrumentsInUse();
  const date = today();
  let updated = 0;
  let failed = 0;

  // MOEX: one request per (market, board) group.
  const moexGroups = new Map<string, Instrument[]>();
  const coingecko: Instrument[] = [];

  for (const instrument of instruments) {
    // FORTS contracts are not on the stock market's ISS endpoints, and an
    // expired one is not quoted anywhere. Asking anyway produced a silent miss
    // per contract and left the request looking like a failed share lookup.
    if (isDerivative(instrument.kind)) continue;

    if (instrument.source === "moex") {
      const market = marketFor(instrument.kind);
      const board = instrument.board || (instrument.kind === "bond" ? "TQCB" : "TQBR");
      const key = `${market}|${board}`;
      const group = moexGroups.get(key);
      if (group) group.push(instrument);
      else moexGroups.set(key, [instrument]);
    } else if (instrument.source === "coingecko") {
      coingecko.push(instrument);
    }
    // `manual` instruments are priced by the user and never fetched.
  }

  for (const [key, group] of moexGroups) {
    const [market, board] = key.split("|");
    try {
      const quotes = await fetchQuotes(board, market, group.map((item) => item.symbol));
      for (const instrument of group) {
        const raw = quotes.get(instrument.symbol);
        if (raw === undefined) {
          failed++;
          continue;
        }
        setPrice(instrument.id, toMoneyPrice(instrument, raw), date);
        updated++;
      }
    } catch {
      failed += group.length;
    }
  }

  if (coingecko.length > 0) {
    try {
      const prices = await fetchCryptoPrices(coingecko.map((item) => item.source_id));
      for (const instrument of coingecko) {
        const price = prices.get(instrument.source_id);
        if (price === undefined) {
          failed++;
          continue;
        }
        setPrice(instrument.id, price, date);
        updated++;
      }
    } catch {
      failed += coingecko.length;
    }
  }

  logSync(
    "prices",
    failed === 0 ? "ok" : "error",
    `обновлено ${updated}, не удалось ${failed}`,
    startedAt,
  );
  return { updated, failed };
}

// --------------------------------------------------------------- payouts

/**
 * Announced coupons and amortisation for held bonds. Share dividends are not
 * available from public ISS, so those are forecast in domain/payouts.ts.
 */
export async function refreshPayouts(): Promise<{ upserted: number }> {
  const startedAt = nowIso();
  const bonds = instrumentsInUse().filter(
    (instrument) => instrument.source === "moex" && instrument.kind === "bond",
  );
  let upserted = 0;

  for (const bond of bonds) {
    const payouts = await fetchBondPayouts(bond.symbol);
    for (const payout of payouts) {
      run(
        `INSERT INTO payouts (instrument_id, kind, ex_date, pay_date, amount, currency, status, source, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, 'announced', 'moex', ?)
         ON CONFLICT(instrument_id, kind, COALESCE(ex_date, ''), COALESCE(pay_date, ''), amount)
         DO UPDATE SET fetched_at = excluded.fetched_at, status = 'announced'`,
        bond.id,
        payout.kind,
        payout.exDate,
        payout.payDate,
        payout.amount,
        payout.currency,
        nowIso(),
      );
      upserted++;
    }
  }

  logSync("payouts", "ok", `${upserted} выплат по ${bonds.length} облигациям`, startedAt);
  return { upserted };
}

// ------------------------------------------------------------- scheduling

const MIN_INTERVAL_MS = 10 * 60 * 1000;

function lastRun(kind: string): number {
  const row = get<{ started_at: string }>(
    "SELECT started_at FROM sync_log WHERE kind = ? ORDER BY started_at DESC LIMIT 1",
    kind,
  );
  return row ? Date.parse(row.started_at) : 0;
}

export function isStale(kind: string, maxAgeMs = MIN_INTERVAL_MS): boolean {
  return Date.now() - lastRun(kind) > maxAgeMs;
}

/**
 * Refresh on demand, throttled. Called when a dashboard is rendered so the
 * instance stays current without needing a cron daemon; a real deployment can
 * additionally hit /api/sync from cron.
 */
export async function refreshIfStale(): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  if (isStale("fx", 6 * 3600_000)) jobs.push(refreshFx());
  if (isStale("prices", MIN_INTERVAL_MS)) jobs.push(refreshQuotes());
  if (isStale("payouts", 24 * 3600_000)) jobs.push(refreshPayouts());
  if (jobs.length > 0) await Promise.allSettled(jobs);
}

export function lastSyncInfo(): { kind: string; status: string; detail: string; started_at: string }[] {
  return all(
    `SELECT kind, status, detail, started_at FROM sync_log s1
      WHERE started_at = (SELECT MAX(started_at) FROM sync_log s2 WHERE s2.kind = s1.kind)
      ORDER BY kind`,
  );
}

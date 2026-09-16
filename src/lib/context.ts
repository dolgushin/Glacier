import { all } from "@/lib/db";
import { listCategories, listPortfolios, listTransactions } from "@/lib/repo";
import { latestFxRates } from "@/lib/sync";
import { summarize, type Summary } from "@/lib/domain/analytics";
import type { Category, Instrument, Payout, Portfolio, Transaction } from "@/lib/types";

/**
 * Everything a portfolio page needs, loaded once.
 *
 * `portfolioId` of null means "all portfolios combined" — a composite view over
 * every portfolio the user owns, which is how most people actually read their
 * net worth.
 */
export interface PortfolioContext {
  portfolios: Portfolio[];
  selected: Portfolio | null;
  portfolioId: number | null;
  baseCurrency: string;
  categories: Category[];
  transactions: Transaction[];
  instruments: Map<number, Instrument>;
  fxRates: Map<string, number>;
  payouts: Payout[];
  summary: Summary;
}

/**
 * Parse the ?p= query parameter into a portfolio id the user actually owns.
 *
 * With exactly one portfolio there is nothing to combine, so it is treated as
 * selected. Otherwise the page would title itself "Все портфели" while the
 * switcher beside it showed that portfolio's name — the same state described
 * two different ways.
 */
export function resolvePortfolioId(
  portfolios: Portfolio[],
  raw: string | string[] | undefined,
): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || value === "all") {
    return portfolios.length === 1 ? portfolios[0].id : null;
  }
  const id = Number(value);
  return portfolios.some((portfolio) => portfolio.id === id) ? id : null;
}

export function loadContext(
  userId: number,
  portfolioId: number | null,
): PortfolioContext {
  const portfolios = listPortfolios(userId);
  const selected = portfolioId ? (portfolios.find((p) => p.id === portfolioId) ?? null) : null;
  const baseCurrency = selected?.base_currency ?? portfolios[0]?.base_currency ?? "RUB";

  const transactions = listTransactions(userId, {
    portfolioId: selected?.id,
  });

  const instrumentRows = all<Instrument>(
    `SELECT DISTINCT i.* FROM instruments i
       JOIN transactions t ON t.instrument_id = i.id
       JOIN portfolios p ON p.id = t.portfolio_id
      WHERE p.user_id = ?${selected ? " AND p.id = ?" : ""}`,
    ...(selected ? [userId, selected.id] : [userId]),
  );
  const instruments = new Map(instrumentRows.map((instrument) => [instrument.id, instrument]));

  const categories = selected
    ? listCategories(selected.id)
    : portfolios.flatMap((portfolio) => listCategories(portfolio.id));

  const payouts =
    instrumentRows.length > 0
      ? all<Payout>(
          `SELECT * FROM payouts WHERE instrument_id IN (${instrumentRows.map(() => "?").join(",")})`,
          ...instrumentRows.map((instrument) => instrument.id),
        )
      : [];

  const fxRates = latestFxRates();

  return {
    portfolios,
    selected,
    portfolioId: selected?.id ?? null,
    baseCurrency,
    categories,
    transactions,
    instruments,
    fxRates,
    payouts,
    summary: summarize({ transactions, instruments, fxRates, baseCurrency }),
  };
}

/**
 * The close before the most recent one, per instrument.
 *
 * Deliberately "previous known close" rather than "yesterday": a weekend, a
 * holiday, or a day the service was not running all produce gaps, and anchoring
 * to a calendar date would silently report a zero change on every Monday.
 */
export function loadPreviousCloses(instrumentIds: number[]): Map<number, number> {
  const previous = new Map<number, number>();
  if (instrumentIds.length === 0) return previous;

  const rows = all<{ instrument_id: number; close: number }>(
    `SELECT instrument_id, close FROM (
       SELECT instrument_id, close,
              ROW_NUMBER() OVER (PARTITION BY instrument_id ORDER BY date DESC) AS rn
         FROM prices
        WHERE instrument_id IN (${instrumentIds.map(() => "?").join(",")})
     ) WHERE rn = 2`,
    ...instrumentIds,
  );

  for (const row of rows) previous.set(row.instrument_id, row.close);
  return previous;
}

/** Daily close history for the instruments in play, for the value chart. */
export function loadPriceHistory(instrumentIds: number[]): Map<number, Map<string, number>> {
  const history = new Map<number, Map<string, number>>();
  if (instrumentIds.length === 0) return history;

  const rows = all<{ instrument_id: number; date: string; close: number }>(
    `SELECT instrument_id, date, close FROM prices
      WHERE instrument_id IN (${instrumentIds.map(() => "?").join(",")})
      ORDER BY date`,
    ...instrumentIds,
  );

  for (const row of rows) {
    const series = history.get(row.instrument_id) ?? new Map<string, number>();
    series.set(row.date, row.close);
    history.set(row.instrument_id, series);
  }
  return history;
}

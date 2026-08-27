import type { Instrument, Payout, Transaction } from "@/lib/types";
import type { Position } from "@/lib/domain/positions";

/**
 * The payment calendar.
 *
 * Two sources feed it:
 *  - announced payouts from the provider (MOEX bondization gives real coupon
 *    schedules for bonds);
 *  - a forecast derived from what the instrument has actually paid into this
 *    ledger before, used for shares because public ISS exposes no dividend feed.
 *
 * Forecast rows are always labelled as such. Presenting an estimate as a fact is
 * how a tracker loses trust.
 */

export interface CalendarEntry {
  instrument: Instrument;
  kind: "dividend" | "coupon" | "amortization";
  /** Record date (отсечка) — you must hold the security before this date. */
  exDate: string | null;
  payDate: string | null;
  /** Payment per unit, in the payout currency. */
  perUnit: number;
  quantity: number;
  /** perUnit * quantity, before tax. */
  gross: number;
  currency: string;
  status: "announced" | "forecast";
}

const DAY = 86_400_000;

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/** Announced payouts matched against what the user actually holds. */
export function announcedCalendar(positions: Position[], payouts: Payout[]): CalendarEntry[] {
  const held = new Map(positions.filter((p) => p.quantity > 0).map((p) => [p.instrument.id, p]));
  const todayIso = new Date().toISOString().slice(0, 10);
  const entries: CalendarEntry[] = [];

  for (const payout of payouts) {
    const position = held.get(payout.instrument_id);
    if (!position) continue;

    const when = payout.pay_date ?? payout.ex_date;
    if (!when || when < todayIso) continue;

    entries.push({
      instrument: position.instrument,
      kind: payout.kind,
      exDate: payout.ex_date,
      payDate: payout.pay_date,
      perUnit: payout.amount,
      quantity: position.quantity,
      gross: payout.amount * position.quantity,
      currency: payout.currency,
      status: payout.status,
    });
  }
  return entries;
}

interface HistoricPayment {
  date: string;
  perUnit: number;
  currency: string;
}

/**
 * Reconstruct per-unit payment history for an instrument from the ledger.
 * The quantity held at the payment date is needed to turn a total into a rate,
 * so replay the trades alongside.
 */
function paymentHistory(
  instrumentId: number,
  transactions: Transaction[],
): HistoricPayment[] {
  const relevant = transactions
    .filter((tx) => tx.instrument_id === instrumentId)
    .sort((a, b) => a.ts.localeCompare(b.ts));

  const history: HistoricPayment[] = [];
  let quantity = 0;

  for (const tx of relevant) {
    if (tx.type === "BUY") quantity += tx.quantity;
    else if (tx.type === "SELL" || tx.type === "REDEMPTION") quantity -= tx.quantity;
    else if (tx.type === "SPLIT" && tx.quantity > 0) quantity *= tx.quantity;
    else if (tx.type === "DIVIDEND" || tx.type === "COUPON") {
      if (quantity > 0 && tx.amount > 0) {
        history.push({ date: tx.ts.slice(0, 10), perUnit: tx.amount / quantity, currency: tx.currency });
      }
    }
  }
  return history;
}

/**
 * Project the next 12 months of payments for a holding, from its own history.
 * Needs at least two past payments to infer a period; a single payment is not
 * a pattern and is deliberately not extrapolated.
 */
export function forecastForPosition(
  position: Position,
  transactions: Transaction[],
  horizonMonths = 12,
): CalendarEntry[] {
  if (position.quantity <= 0) return [];

  const history = paymentHistory(position.instrument.id, transactions);
  if (history.length < 2) return [];

  const recent = history.slice(-6);
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    gaps.push((Date.parse(recent[i].date) - Date.parse(recent[i - 1].date)) / DAY);
  }
  const medianGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  if (!Number.isFinite(medianGap) || medianGap < 20) return [];

  // Snap to the nearest sane frequency: monthly, quarterly, semi-annual, annual.
  const periods = [30, 91, 182, 365];
  const periodDays = periods.reduce((best, candidate) =>
    Math.abs(candidate - medianGap) < Math.abs(best - medianGap) ? candidate : best,
  );

  // Average of the last year's payments, so a one-off special dividend does not
  // become a permanent forecast.
  const perYear = Math.max(1, Math.round(365 / periodDays));
  const window = recent.slice(-perYear);
  const averagePerUnit = window.reduce((sum, item) => sum + item.perUnit, 0) / window.length;
  if (!(averagePerUnit > 0)) return [];

  const last = new Date(recent[recent.length - 1].date);
  const currency = recent[recent.length - 1].currency;
  const kind: "dividend" | "coupon" = position.instrument.kind === "bond" ? "coupon" : "dividend";
  const horizonEnd = addMonths(new Date(), horizonMonths);

  const entries: CalendarEntry[] = [];
  let next = new Date(last.getTime() + periodDays * DAY);
  let guard = 0;

  while (next <= horizonEnd && guard++ < 24) {
    if (next.getTime() > Date.now()) {
      entries.push({
        instrument: position.instrument,
        kind,
        exDate: null,
        payDate: next.toISOString().slice(0, 10),
        perUnit: averagePerUnit,
        quantity: position.quantity,
        gross: averagePerUnit * position.quantity,
        currency,
        status: "forecast",
      });
    }
    next = new Date(next.getTime() + periodDays * DAY);
  }
  return entries;
}

/**
 * The full calendar: announced payouts, plus forecasts for holdings that have no
 * announcement covering them. An announced payment always wins over a forecast
 * for the same instrument in the same month.
 */
export function buildCalendar(
  positions: Position[],
  payouts: Payout[],
  transactions: Transaction[],
  horizonMonths = 12,
): CalendarEntry[] {
  const announced = announcedCalendar(positions, payouts);
  const covered = new Set(
    announced.map((entry) => `${entry.instrument.id}|${(entry.payDate ?? "").slice(0, 7)}`),
  );

  const forecast: CalendarEntry[] = [];
  for (const position of positions) {
    for (const entry of forecastForPosition(position, transactions, horizonMonths)) {
      const key = `${entry.instrument.id}|${(entry.payDate ?? "").slice(0, 7)}`;
      if (covered.has(key)) continue;
      covered.add(key);
      forecast.push(entry);
    }
  }

  const horizonEnd = addMonths(new Date(), horizonMonths).toISOString().slice(0, 10);
  return [...announced, ...forecast]
    .filter((entry) => (entry.payDate ?? entry.exDate ?? "") <= horizonEnd)
    .sort((a, b) => (a.payDate ?? a.exDate ?? "").localeCompare(b.payDate ?? b.exDate ?? ""));
}

/** Expected gross income over the next 12 months, in base currency. */
export function forwardIncome(
  calendar: CalendarEntry[],
  fxRates: Map<string, number>,
  baseCurrency: string,
): number {
  return calendar.reduce((sum, entry) => {
    const rate = entry.currency === baseCurrency ? 1 : (fxRates.get(entry.currency) ?? 1);
    return sum + entry.gross * rate;
  }, 0);
}

/** Group a calendar into months for the bar chart. */
export function byMonth(
  calendar: CalendarEntry[],
  fxRates: Map<string, number>,
  baseCurrency: string,
): { month: string; announced: number; forecast: number }[] {
  const buckets = new Map<string, { announced: number; forecast: number }>();

  for (const entry of calendar) {
    const month = (entry.payDate ?? entry.exDate ?? "").slice(0, 7);
    if (!month) continue;
    const rate = entry.currency === baseCurrency ? 1 : (fxRates.get(entry.currency) ?? 1);
    const bucket = buckets.get(month) ?? { announced: 0, forecast: 0 };
    bucket[entry.status] += entry.gross * rate;
    buckets.set(month, bucket);
  }

  return [...buckets.entries()]
    .map(([month, values]) => ({ month, ...values }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Dividends actually received, grouped by year — the "did it grow?" chart. */
export function receivedByYear(transactions: Transaction[]): { year: string; amount: number }[] {
  const buckets = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.type !== "DIVIDEND" && tx.type !== "COUPON" && tx.type !== "AMORTIZATION") continue;
    const year = tx.ts.slice(0, 4);
    buckets.set(year, (buckets.get(year) ?? 0) + tx.amount * tx.fx_rate);
  }
  return [...buckets.entries()]
    .map(([year, amount]) => ({ year, amount }))
    .sort((a, b) => a.year.localeCompare(b.year));
}

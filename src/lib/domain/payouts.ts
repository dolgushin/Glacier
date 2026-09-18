import { INCOME_TYPES, type Instrument, type Payout, type Transaction } from "@/lib/types";
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

// ---------------------------------------------------- матрица и устойчивость

/** Одна строка матрицы «год × месяц»: полученные выплаты в базовой валюте. */
export interface MatrixRow {
  year: number;
  /** 12 значений, null — месяца нет данных (он ещё не наступил). */
  months: (number | null)[];
  total: number;
}

/**
 * Матрица полученных выплат, как в DivvyDiary: строки — годы, колонки — месяцы.
 * Структура пассивного дохода читается сразу: сезонность, провалы, рост по
 * колонке одного месяца из года в год.
 *
 * Текущий год обрезается по текущему месяцу: нули в будущих месяцах читались
 * бы как «не заплатили», а это неправда. Месяцы без выплат внутри прошлого —
 * честный ноль.
 */
export function dividendMatrix(
  transactions: Transaction[],
  asOf = new Date().toISOString().slice(0, 10),
): MatrixRow[] {
  const currentYear = Number(asOf.slice(0, 4));
  const currentMonth = Number(asOf.slice(5, 7));

  const buckets = new Map<number, number[]>();
  for (const tx of transactions) {
    if (!INCOME_TYPES.includes(tx.type)) continue;
    const year = Number(tx.ts.slice(0, 4));
    const month = Number(tx.ts.slice(5, 7));
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;

    const row = buckets.get(year) ?? Array.from({ length: 12 }, () => 0);
    row[month - 1] += tx.amount * tx.fx_rate;
    buckets.set(year, row);
  }

  return [...buckets.entries()]
    .map(([year, months]) => {
      const visible = months.map((amount, index) =>
        year === currentYear && index + 1 > currentMonth ? null : amount,
      );
      return {
        year,
        months: visible,
        total: months.reduce((sum, amount) => sum + amount, 0),
      };
    })
    .sort((a, b) => b.year - a.year);
}

export type PayoutTrend = "growing" | "stable" | "falling" | "interrupted" | "insufficient";

export interface Sustainability {
  instrumentId: number;
  symbol: string;
  name: string;
  /** Сколько лет подряд бумага платила, считая от последнего платёжного года. */
  streak: number;
  trend: PayoutTrend;
  /** Получено за последние 12 месяцев, в базовой валюте. */
  trailing: number;
  /** Получено за предыдущие 12 месяцев. */
  previous: number;
}

/**
 * Устойчивость выплат по бумаге — российский аналог Safety Score из
 * TrackYourDividends, построенный на том, что мы знаем точно: на вашей истории
 * начислений. Payout ratio и тренд EPS из открытых источников недоступны,
 * поэтому оценка честно отвечает на более узкий вопрос: «платит ли, растёт ли».
 *
 * Порог ±10 % отсекает копеечные колебания сумм; восемнадцать месяцев тишины
 * у бумаги, которая платила хотя бы дважды, читаются как «перестала платить».
 */
export function payoutSustainability(
  transactions: Transaction[],
  instruments: Map<number, Instrument>,
  asOf = new Date().toISOString().slice(0, 10),
): Sustainability[] {
  const byInstrument = new Map<number, { ts: string; amount: number }[]>();
  for (const tx of transactions) {
    if (tx.instrument_id === null || !INCOME_TYPES.includes(tx.type)) continue;
    const list = byInstrument.get(tx.instrument_id) ?? [];
    list.push({ ts: tx.ts, amount: tx.amount * tx.fx_rate });
    byInstrument.set(tx.instrument_id, list);
  }

  const now = Date.parse(asOf);
  const yearMs = 365 * 86_400_000;
  const result: Sustainability[] = [];

  for (const [instrumentId, payments] of byInstrument) {
    const instrument = instruments.get(instrumentId);
    if (!instrument) continue;

    payments.sort((a, b) => a.ts.localeCompare(b.ts));
    const years = [...new Set(payments.map((payment) => Number(payment.ts.slice(0, 4))))].sort(
      (a, b) => a - b,
    );

    // Серия: идём от последнего платёжного года назад, пока годы неразрывны.
    let streak = 0;
    for (let index = years.length - 1; index >= 0; index--) {
      if (index === years.length - 1 || years[index] === years[index + 1] - 1) streak++;
      else break;
    }

    const trailing = payments
      .filter((payment) => now - Date.parse(payment.ts) <= yearMs)
      .reduce((sum, payment) => sum + payment.amount, 0);
    const previous = payments
      .filter((payment) => {
        const age = now - Date.parse(payment.ts);
        return age > yearMs && age <= 2 * yearMs;
      })
      .reduce((sum, payment) => sum + payment.amount, 0);

    const lastPaymentAt = Date.parse(payments[payments.length - 1].ts);

    let trend: PayoutTrend;
    if (payments.length < 2 || years.length < 2) {
      trend = "insufficient";
    } else if (now - lastPaymentAt > 18 * 30 * 86_400_000) {
      trend = "interrupted";
    } else if (previous > 0 && trailing > previous * 1.1) {
      trend = "growing";
    } else if (trailing < previous * 0.9) {
      trend = "falling";
    } else {
      trend = "stable";
    }

    result.push({
      instrumentId,
      symbol: instrument.symbol,
      name: instrument.name,
      streak,
      trend,
      trailing,
      previous,
    });
  }

  // Сначала те, кто платит и растит выплаты, — они и есть ответ на вопрос.
  const rank: Record<PayoutTrend, number> = {
    growing: 0,
    stable: 1,
    falling: 2,
    interrupted: 3,
    insufficient: 4,
  };
  return result.sort(
    (a, b) => rank[a.trend] - rank[b.trend] || b.trailing - a.trailing,
  );
}

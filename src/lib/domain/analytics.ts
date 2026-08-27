import type { Category, Instrument, Transaction } from "@/lib/types";
import { KIND_LABELS } from "@/lib/types";
import { buildPositions, cashBalances, cashEffect, sortLedger, type Position } from "@/lib/domain/positions";
import { simpleReturn, xirr, type CashFlow } from "@/lib/domain/xirr";

export interface AllocationSlice {
  key: string;
  label: string;
  value: number;
  share: number;
  color: string;
  targetShare?: number;
}

export interface Summary {
  /** Market value of open positions, in base currency. */
  marketValue: number;
  /** Cost basis of open positions, in base currency. */
  costBasis: number;
  /** Free cash derived from the ledger, in base currency. */
  cash: number;
  /** marketValue + cash. */
  totalValue: number;
  /** Net money the investor has put in (deposits - withdrawals). */
  netDeposits: number;
  realizedPnl: number;
  unrealizedPnl: number;
  income: number;
  feesPaid: number;
  taxesPaid: number;
  /** Everything combined: the honest profit number. */
  totalPnl: number;
  /** Annualised money-weighted return, or null when undefined. */
  xirr: number | null;
  /** Fallback percentage when XIRR has no solution. */
  simpleReturn: number | null;
  positions: Position[];
  openPositions: Position[];
  cashByCurrency: Map<string, number>;
}

/**
 * Category ramp, drawn from the same blue-violet-teal family as the palette.
 * Ordered so that neighbouring slices stay distinguishable rather than
 * shading into one another.
 */
const PALETTE = [
  "#3699ff", "#8950fc", "#1bc5bd", "#6930c3",
  "#ffa800", "#f64e60", "#187de4", "#0bb7af",
];

export function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

interface SummarizeParams {
  transactions: Transaction[];
  instruments: Map<number, Instrument>;
  fxRates: Map<string, number>;
  baseCurrency: string;
}

/**
 * The single place portfolio numbers are produced. Everything is converted into
 * the portfolio's base currency: historical flows at the rate recorded on the
 * transaction, current values at the latest known rate.
 */
export function summarize({
  transactions,
  instruments,
  fxRates,
  baseCurrency,
}: SummarizeParams): Summary {
  const positions = buildPositions({ transactions, instruments, fxRates, baseCurrency });
  const rateFor = (currency: string) =>
    currency === baseCurrency ? 1 : (fxRates.get(currency) ?? 1);

  let marketValue = 0;
  let costBasis = 0;
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let income = 0;
  let feesPaid = 0;
  let taxesPaid = 0;

  for (const position of positions) {
    const rate = position.fxRate;
    marketValue += position.marketValue * rate;
    costBasis += position.costBasis * rate;
    realizedPnl += position.realizedPnl * rate;
    unrealizedPnl += position.unrealizedPnl * rate;
    income += position.income * rate;
    feesPaid += position.feesPaid * rate;
    taxesPaid += position.taxesPaid * rate;
  }

  const cashByCurrency = cashBalances(transactions);
  let cash = 0;
  for (const [currency, value] of cashByCurrency) cash += value * rateFor(currency);

  let netDeposits = 0;
  for (const tx of transactions) {
    if (tx.type === "DEPOSIT") netDeposits += tx.amount * tx.fx_rate;
    if (tx.type === "WITHDRAWAL") netDeposits -= Math.abs(tx.amount) * tx.fx_rate;
  }

  // Money-weighted return on the securities themselves: what left the investor's
  // pocket, what came back, and what the holdings are worth right now.
  // Deposits and withdrawals are excluded — moving cash in is not a return.
  const flows: CashFlow[] = [];
  for (const tx of sortLedger(transactions)) {
    if (tx.instrument_id === null && tx.type !== "FEE" && tx.type !== "TAX") continue;
    const effect = cashEffect(tx) * tx.fx_rate;
    if (effect !== 0) flows.push({ date: tx.ts, amount: effect });
  }
  if (marketValue !== 0) {
    flows.push({ date: new Date().toISOString(), amount: marketValue });
  }

  const totalPnl = realizedPnl + unrealizedPnl + income - taxesPaid;

  return {
    marketValue,
    costBasis,
    cash,
    totalValue: marketValue + cash,
    netDeposits,
    realizedPnl,
    unrealizedPnl,
    income,
    feesPaid,
    taxesPaid,
    totalPnl,
    xirr: xirr(flows),
    simpleReturn: simpleReturn(costBasis > 0 ? costBasis : Math.abs(netDeposits), totalPnl),
    positions,
    openPositions: positions.filter((position) => position.quantity > 0),
    cashByCurrency,
  };
}

// ------------------------------------------------------------- allocation

function toSlices(
  buckets: Map<string, { label: string; value: number; color?: string; target?: number }>,
): AllocationSlice[] {
  const total = [...buckets.values()].reduce((sum, bucket) => sum + bucket.value, 0);
  return [...buckets.entries()]
    .filter(([, bucket]) => bucket.value > 0.005)
    .map(([key, bucket], index) => ({
      key,
      label: bucket.label,
      value: bucket.value,
      share: total > 0 ? bucket.value / total : 0,
      color: bucket.color ?? colorFor(index),
      targetShare: bucket.target,
    }))
    .sort((a, b) => b.value - a.value);
}

export function allocationByCategory(
  positions: Position[],
  categories: Category[],
): AllocationSlice[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const buckets = new Map<string, { label: string; value: number; color?: string; target?: number }>();

  for (const category of categories) {
    buckets.set(String(category.id), {
      label: category.name,
      value: 0,
      color: category.color,
      target: category.target_weight / 100,
    });
  }
  buckets.set("none", { label: "Без категории", value: 0, color: "#b5b5c3" });

  for (const position of positions) {
    if (position.quantity <= 0) continue;
    const key =
      position.categoryId !== null && byId.has(position.categoryId)
        ? String(position.categoryId)
        : "none";
    const bucket = buckets.get(key)!;
    bucket.value += position.marketValue * position.fxRate;
  }

  return toSlices(buckets);
}

export function allocationByKind(positions: Position[]): AllocationSlice[] {
  const buckets = new Map<string, { label: string; value: number }>();
  for (const position of positions) {
    if (position.quantity <= 0) continue;
    const key = position.instrument.kind;
    const bucket = buckets.get(key) ?? { label: KIND_LABELS[key] ?? key, value: 0 };
    bucket.value += position.marketValue * position.fxRate;
    buckets.set(key, bucket);
  }
  return toSlices(buckets);
}

export function allocationByCurrency(positions: Position[]): AllocationSlice[] {
  const buckets = new Map<string, { label: string; value: number }>();
  for (const position of positions) {
    if (position.quantity <= 0) continue;
    const bucket = buckets.get(position.currency) ?? { label: position.currency, value: 0 };
    bucket.value += position.marketValue * position.fxRate;
    buckets.set(position.currency, bucket);
  }
  return toSlices(buckets);
}

export function allocationByInstrument(positions: Position[], limit = 12): AllocationSlice[] {
  const slices = toSlices(
    new Map(
      positions
        .filter((position) => position.quantity > 0)
        .map((position) => [
          position.instrument.symbol,
          { label: position.instrument.symbol, value: position.marketValue * position.fxRate },
        ]),
    ),
  );
  if (slices.length <= limit) return slices;

  const head = slices.slice(0, limit);
  const tailValue = slices.slice(limit).reduce((sum, slice) => sum + slice.value, 0);
  const tailShare = slices.slice(limit).reduce((sum, slice) => sum + slice.share, 0);
  return [
    ...head,
    { key: "__rest", label: `Ещё ${slices.length - limit}`, value: tailValue, share: tailShare, color: "#b5b5c3" },
  ];
}

// ----------------------------------------------------------- value series

export interface SeriesPoint {
  date: string;
  value: number;
  invested: number;
}

/**
 * Daily portfolio value against invested capital.
 *
 * Uses cached daily closes, forward-filling gaps — MOEX has no bar on weekends
 * and an illiquid instrument can go days without a trade. Days before the first
 * known price for an instrument fall back to its cost basis, so the line starts
 * at the money put in rather than at zero.
 */
export function valueSeries(
  transactions: Transaction[],
  priceHistory: Map<number, Map<string, number>>,
  instruments: Map<number, Instrument>,
  fxRates: Map<string, number>,
  baseCurrency: string,
): SeriesPoint[] {
  const ledger = sortLedger(transactions).filter((tx) => tx.instrument_id !== null);
  if (ledger.length === 0) return [];

  const startDate = ledger[0].ts.slice(0, 10);
  const start = Date.parse(startDate);
  const end = Date.now();
  if (!Number.isFinite(start) || end < start) return [];

  const dayCount = Math.min(Math.floor((end - start) / 86_400_000) + 1, 2000);
  const quantities = new Map<number, number>();
  const costs = new Map<number, number>();
  const lastKnownPrice = new Map<number, number>();
  const series: SeriesPoint[] = [];

  let cursor = 0;
  let invested = 0;

  for (let day = 0; day < dayCount; day++) {
    const date = new Date(start + day * 86_400_000).toISOString().slice(0, 10);

    // Apply every transaction up to and including this day.
    while (cursor < ledger.length && ledger[cursor].ts.slice(0, 10) <= date) {
      const tx = ledger[cursor++];
      const id = tx.instrument_id!;
      const rate = tx.fx_rate;

      if (tx.type === "BUY") {
        quantities.set(id, (quantities.get(id) ?? 0) + tx.quantity);
        costs.set(id, (costs.get(id) ?? 0) + (tx.quantity * tx.price + tx.fee) * rate);
        invested += (tx.quantity * tx.price + tx.fee) * rate;
      } else if (tx.type === "SELL" || tx.type === "REDEMPTION") {
        const held = quantities.get(id) ?? 0;
        const sold = Math.min(tx.quantity, held);
        const costPerUnit = held > 0 ? (costs.get(id) ?? 0) / held : 0;
        quantities.set(id, held - sold);
        costs.set(id, (costs.get(id) ?? 0) - costPerUnit * sold);
        invested -= costPerUnit * sold;
      } else if (tx.type === "SPLIT" && tx.quantity > 0) {
        quantities.set(id, (quantities.get(id) ?? 0) * tx.quantity);
      }
    }

    let value = 0;
    for (const [instrumentId, quantity] of quantities) {
      if (quantity <= 1e-9) continue;
      const instrument = instruments.get(instrumentId);
      if (!instrument) continue;

      const history = priceHistory.get(instrumentId);
      const price = history?.get(date);
      if (price !== undefined) lastKnownPrice.set(instrumentId, price);

      const effective =
        lastKnownPrice.get(instrumentId) ??
        // No history yet: value the holding at what it cost.
        (quantity > 0 ? (costs.get(instrumentId) ?? 0) / quantity / (instrument.currency === baseCurrency ? 1 : (fxRates.get(instrument.currency) ?? 1)) : 0);

      const rate = instrument.currency === baseCurrency ? 1 : (fxRates.get(instrument.currency) ?? 1);
      value += quantity * effective * rate;
    }

    series.push({ date, value, invested });
  }

  // One point per day for two years is 730 points — thin it for the chart.
  const step = Math.max(1, Math.ceil(series.length / 400));
  const thinned = series.filter((_, index) => index % step === 0);
  if (series.length > 0 && thinned[thinned.length - 1] !== series[series.length - 1]) {
    thinned.push(series[series.length - 1]);
  }
  return thinned;
}

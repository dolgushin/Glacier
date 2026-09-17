import { isDerivative, type Instrument, type Transaction, type TxType } from "@/lib/types";

/**
 * Why a holding is shown but not counted in portfolio value.
 *
 * Every one of these means the ledger is missing an operation the broker never
 * reported. Counting such a position produces a number that is not merely
 * imprecise but wrong by orders of magnitude, so it is excluded and named.
 */
export type PositionAnomaly = "expired-derivative" | "derivative" | "suspect-split";

/**
 * How far the market price may stray from the average purchase price before the
 * gap stops looking like a market move and starts looking like a corporate
 * action nobody imported.
 *
 * A share that multiplied 500-fold is not a share that went up. VTB's 2024
 * reverse split is the case in hand: the ledger keeps pre-split quantities while
 * the quote feed returns the post-split price, and multiplying one by the other
 * inflates a 150 000 ₽ holding into 85 million.
 */
const SPLIT_SUSPICION_RATIO = 50;

const EQUITY_KINDS = new Set(["share", "etf"]);


/**
 * Positions are always derived from the ledger, never stored. Re-importing a
 * corrected broker report and recomputing yields the truth; there is no
 * denormalised balance to drift out of sync.
 */

export interface Lot {
  quantity: number;
  /** Per-unit cost including the share of the buy commission. */
  costPerUnit: number;
  date: string;
}

export interface Position {
  instrument: Instrument;
  categoryId: number | null;
  /** Units currently held. */
  quantity: number;
  /** Cost basis of the units still held, in the instrument currency. */
  costBasis: number;
  /** costBasis / quantity. */
  averagePrice: number;
  /** Realised profit from closed lots, net of commissions, in instrument currency. */
  realizedPnl: number;
  /** Dividends, coupons, amortisation received, gross of tax. */
  income: number;
  feesPaid: number;
  taxesPaid: number;
  /** Last known price in the instrument currency. */
  lastPrice: number | null;
  /** quantity * lastPrice. */
  marketValue: number;
  unrealizedPnl: number;
  /** realized + unrealized + income - taxes. */
  totalPnl: number;
  currency: string;
  /** Instrument currency -> portfolio base, at the latest known rate. */
  fxRate: number;
  firstTradeDate: string | null;
  /**
   * Set when the holding is deliberately left out of portfolio value because
   * the ledger is missing an operation. `marketValue` is zero in that case, and
   * the UI explains which operation is missing.
   */
  anomaly: PositionAnomaly | null;
  /**
   * The value the position would have had if it were counted. Kept so the UI can
   * show what was excluded rather than making the money disappear silently.
   */
  excludedValue: number;
}

/** Signed cash effect of a transaction, in the transaction currency. */
export function cashEffect(tx: Transaction): number {
  switch (tx.type) {
    case "BUY":
      return -(tx.quantity * tx.price + tx.fee);
    case "SELL":
      return tx.quantity * tx.price - tx.fee - tx.tax;
    case "REDEMPTION":
      return tx.quantity * tx.price - tx.fee - tx.tax;
    case "DIVIDEND":
    case "COUPON":
    case "AMORTIZATION":
    case "INTEREST":
      return tx.amount - tx.fee - tx.tax;
    case "DEPOSIT":
      return tx.amount;
    case "WITHDRAWAL":
      return -Math.abs(tx.amount);
    case "FEE":
      return -Math.abs(tx.amount || tx.fee);
    case "TAX":
      return -Math.abs(tx.amount || tx.tax);
    case "SPLIT":
      return 0;
    default:
      return 0;
  }
}

const ORDER: Record<TxType, number> = {
  DEPOSIT: 0,
  BUY: 1,
  SPLIT: 2,
  DIVIDEND: 3,
  COUPON: 3,
  AMORTIZATION: 3,
  INTEREST: 3,
  SELL: 4,
  REDEMPTION: 5,
  FEE: 6,
  TAX: 6,
  WITHDRAWAL: 7,
};

/** Chronological, with a deterministic tie-break so FIFO is reproducible. */
export function sortLedger(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort(
    (a, b) => a.ts.localeCompare(b.ts) || ORDER[a.type] - ORDER[b.type] || a.id - b.id,
  );
}

interface BuildParams {
  transactions: Transaction[];
  instruments: Map<number, Instrument>;
  /** instrument currency -> portfolio base currency */
  fxRates: Map<string, number>;
  baseCurrency: string;
  /** ISO date used to decide whether a dated contract has expired. */
  asOf?: string;
}

/**
 * Decide whether a holding can be trusted in portfolio value.
 *
 * Returns null for the ordinary case. Everything else is a holding whose
 * quantity and price come from different worlds and must not be multiplied.
 */
function classify(
  instrument: Instrument,
  quantity: number,
  averagePrice: number,
  lastPrice: number | null,
  asOf: string,
): PositionAnomaly | null {
  if (quantity === 0) return null;

  if (isDerivative(instrument.kind)) {
    // Expiry is not a trade, so no broker reports it as one and the contract
    // never closes in our ledger. Anything past delivery is settled by now.
    const expired = instrument.maturity_date !== null && instrument.maturity_date <= asOf;
    return expired ? "expired-derivative" : "derivative";
  }

  // A corporate action the broker did not report as an operation: the ledger's
  // quantity is on one side of a split and the quote is on the other.
  if (EQUITY_KINDS.has(instrument.kind) && lastPrice !== null && averagePrice > 0) {
    const ratio = lastPrice / averagePrice;
    if (ratio > SPLIT_SUSPICION_RATIO || ratio < 1 / SPLIT_SUSPICION_RATIO) {
      return "suspect-split";
    }
  }

  return null;
}

/**
 * FIFO lot matching. Commissions on a buy are capitalised into the lot cost;
 * commissions and taxes on a sell reduce the realised result. This matches how
 * Russian brokers report and how ЛДВ/налоговая база is actually computed.
 */
export function buildPositions({
  transactions,
  instruments,
  fxRates,
  baseCurrency,
  asOf = new Date().toISOString().slice(0, 10),
}: BuildParams): Position[] {
  const byInstrument = new Map<number, Transaction[]>();
  for (const tx of sortLedger(transactions)) {
    if (tx.instrument_id === null) continue;
    const list = byInstrument.get(tx.instrument_id);
    if (list) list.push(tx);
    else byInstrument.set(tx.instrument_id, [tx]);
  }

  const positions: Position[] = [];

  for (const [instrumentId, ledger] of byInstrument) {
    const instrument = instruments.get(instrumentId);
    if (!instrument) continue;

    const lots: Lot[] = [];
    let realizedPnl = 0;
    let income = 0;
    let feesPaid = 0;
    let taxesPaid = 0;
    let categoryId: number | null = null;
    let firstTradeDate: string | null = null;

    for (const tx of ledger) {
      if (tx.category_id !== null) categoryId = tx.category_id;
      feesPaid += tx.fee;
      taxesPaid += tx.tax;

      switch (tx.type) {
        case "BUY": {
          if (tx.quantity <= 0) break;
          firstTradeDate ??= tx.ts;
          lots.push({
            quantity: tx.quantity,
            costPerUnit: tx.price + tx.fee / tx.quantity,
            date: tx.ts,
          });
          break;
        }

        case "SELL":
        case "REDEMPTION": {
          let remaining = tx.quantity;
          if (remaining <= 0) break;
          const proceedsPerUnit = tx.price - (tx.fee + tx.tax) / tx.quantity;

          while (remaining > 1e-12 && lots.length > 0) {
            const lot = lots[0];
            const take = Math.min(lot.quantity, remaining);
            realizedPnl += take * (proceedsPerUnit - lot.costPerUnit);
            lot.quantity -= take;
            remaining -= take;
            if (lot.quantity <= 1e-12) lots.shift();
          }
          // Selling more than the ledger knows about (missing history):
          // book the proceeds as pure profit rather than dropping them.
          if (remaining > 1e-12) realizedPnl += remaining * proceedsPerUnit;
          break;
        }

        case "SPLIT": {
          // quantity carries the ratio: 2 = each share becomes 2.
          const ratio = tx.quantity;
          if (ratio > 0) {
            for (const lot of lots) {
              lot.quantity *= ratio;
              lot.costPerUnit /= ratio;
            }
          }
          break;
        }

        case "DIVIDEND":
        case "COUPON":
        case "AMORTIZATION":
        case "INTEREST":
          income += tx.amount;
          break;

        default:
          break;
      }
    }

    const quantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
    const costBasis = lots.reduce((sum, lot) => sum + lot.quantity * lot.costPerUnit, 0);
    const lastPrice = instrument.last_price;
    const marketValue = lastPrice !== null ? quantity * lastPrice : 0;
    const unrealizedPnl = lastPrice !== null ? marketValue - costBasis : 0;

    // Dust from float arithmetic: a fully closed position should read as zero.
    // Closed positions are kept — realised profit and received dividends are
    // history the portfolio's return depends on. The UI filters them out of the
    // holdings table, but they must never silently vanish from the ledger.
    const cleanQuantity = Math.abs(quantity) < 1e-9 ? 0 : quantity;
    const cleanRealized = Math.abs(realizedPnl) < 1e-9 ? 0 : realizedPnl;
    const averagePrice = cleanQuantity > 0 ? costBasis / cleanQuantity : 0;
    const anomaly = classify(instrument, cleanQuantity, averagePrice, lastPrice, asOf);

    // An excluded position contributes nothing: not value, not unrealised
    // profit. Realised profit and income stay — that money genuinely moved.
    const counted = anomaly === null && cleanQuantity !== 0;

    positions.push({
      instrument,
      categoryId,
      quantity: cleanQuantity,
      costBasis: counted ? costBasis : 0,
      averagePrice,
      realizedPnl: cleanRealized,
      income,
      feesPaid,
      taxesPaid,
      lastPrice,
      marketValue: counted ? marketValue : 0,
      unrealizedPnl: counted ? unrealizedPnl : 0,
      totalPnl: cleanRealized + (counted ? unrealizedPnl : 0) + income - taxesPaid,
      currency: instrument.currency,
      fxRate: instrument.currency === baseCurrency ? 1 : (fxRates.get(instrument.currency) ?? 1),
      firstTradeDate,
      anomaly,
      excludedValue: counted ? 0 : marketValue,
    });
  }

  return positions.sort((a, b) => b.marketValue * b.fxRate - a.marketValue * a.fxRate);
}

/** Free cash in the portfolio, per currency, derived from the ledger. */
export function cashBalances(transactions: Transaction[]): Map<string, number> {
  const balances = new Map<string, number>();
  for (const tx of transactions) {
    balances.set(tx.currency, (balances.get(tx.currency) ?? 0) + cashEffect(tx));
  }
  for (const [currency, value] of balances) {
    if (Math.abs(value) < 1e-6) balances.delete(currency);
  }
  return balances;
}

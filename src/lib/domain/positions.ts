import type { Instrument, Transaction, TxType } from "@/lib/types";

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

    positions.push({
      instrument,
      categoryId,
      quantity: cleanQuantity,
      costBasis: cleanQuantity === 0 ? 0 : costBasis,
      averagePrice: cleanQuantity > 0 ? costBasis / cleanQuantity : 0,
      realizedPnl: cleanRealized,
      income,
      feesPaid,
      taxesPaid,
      lastPrice,
      marketValue: cleanQuantity === 0 ? 0 : marketValue,
      unrealizedPnl: cleanQuantity === 0 ? 0 : unrealizedPnl,
      totalPnl: cleanRealized + (cleanQuantity === 0 ? 0 : unrealizedPnl) + income - taxesPaid,
      currency: instrument.currency,
      fxRate: instrument.currency === baseCurrency ? 1 : (fxRates.get(instrument.currency) ?? 1),
      firstTradeDate,
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

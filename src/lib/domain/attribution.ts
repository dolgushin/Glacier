import type { Instrument, Transaction } from "@/lib/types";
import { sortLedger } from "@/lib/domain/positions";

/**
 * Разложение прибыли по источникам — как в Sharesight.
 *
 * Одна и та же нереализованная прибыль в рублях может быть ростом бумаги,
 * а может быть падением рубля. Для валютной позиции эти вещи принципиально
 * разные, поэтому здесь они разводятся:
 *
 *   price — изменение цены в валюте инструмента, пересчитанное по текущему курсу
 *   fx    — переоценка от сдвига курса между покупкой лота и сегодня
 *   income — дивиденды, купоны, амортизация (уже факт)
 *   realized — закрытые лоты, где разложение уже не имеет смысла
 *
 * price + fx + realized == весь PnL от сделок в базовой валюте, без остатка.
 */

export interface PnlDecomposition {
  price: number;
  fx: number;
  realized: number;
  income: number;
  /** Полная прибыль от операций с бумагами, для сверки. */
  total: number;
}

interface FxLot {
  quantity: number;
  costPerUnit: number;
  fxRate: number;
}

export function decomposePnl(
  transactions: Transaction[],
  instruments: Map<number, Instrument>,
  fxRates: Map<string, number>,
  baseCurrency: string,
): PnlDecomposition {
  const byInstrument = new Map<number, Transaction[]>();
  for (const tx of sortLedger(transactions)) {
    if (tx.instrument_id === null) continue;
    const list = byInstrument.get(tx.instrument_id);
    if (list) list.push(tx);
    else byInstrument.set(tx.instrument_id, [tx]);
  }

  let price = 0;
  let fx = 0;
  let realized = 0;
  let income = 0;

  for (const [instrumentId, ledger] of byInstrument) {
    const instrument = instruments.get(instrumentId);
    if (!instrument) continue;

    const fxNow =
      instrument.currency === baseCurrency
        ? 1
        : (fxRates.get(instrument.currency) ?? 1);

    const lots: FxLot[] = [];

    for (const tx of ledger) {
      const rate = tx.fx_rate || 1;

      switch (tx.type) {
        case "BUY":
          if (tx.quantity > 0) {
            lots.push({
              quantity: tx.quantity,
              costPerUnit: tx.price + tx.fee / tx.quantity,
              fxRate: rate,
            });
          }
          break;

        case "SELL":
        case "REDEMPTION": {
          let remaining = tx.quantity;
          if (remaining <= 0) break;
          const proceedsPerUnit = tx.price - (tx.fee + tx.tax) / tx.quantity;
          while (remaining > 1e-12 && lots.length > 0) {
            const lot = lots[0];
            const take = Math.min(lot.quantity, remaining);
            realized += take * (proceedsPerUnit * rate - lot.costPerUnit * lot.fxRate);
            lot.quantity -= take;
            remaining -= take;
            if (lot.quantity <= 1e-12) lots.shift();
          }
          break;
        }

        case "SPLIT":
          if (tx.quantity > 0) {
            for (const lot of lots) {
              lot.quantity *= tx.quantity;
              lot.costPerUnit /= tx.quantity;
            }
          }
          break;

        case "DIVIDEND":
        case "COUPON":
        case "AMORTIZATION":
        case "INTEREST":
          income += tx.amount * rate;
          break;

        default:
          break;
      }
    }

    // Открытые лоты: цена против себестоимости — в валюте бумаги по текущему
    // курсу; сдвиг курса между покупкой и сегодня — отдельно.
    const lastPrice = instrument.last_price;
    if (lastPrice === null) continue;

    for (const lot of lots) {
      if (lot.quantity <= 1e-9) continue;
      price += lot.quantity * (lastPrice - lot.costPerUnit) * fxNow;
      fx += lot.quantity * lastPrice * (fxNow - lot.fxRate);
    }
  }

  return { price, fx, realized, income, total: price + fx + realized + income };
}

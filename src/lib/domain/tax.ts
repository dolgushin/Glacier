import { isDerivative, type Instrument, type Transaction } from "@/lib/types";
import { sortLedger, type Position } from "@/lib/domain/positions";


/**
 * Налоговый модуль (НДФЛ по операциям с ценными бумагами).
 *
 * Метод — тот же FIFO, что и в позициях, но здесь важна не текущая позиция, а
 * каждое закрытие лота: именно закрытие создаёт налогооблагаемое событие.
 * Комиссия покупки сидит в себестоимости лота, комиссия продажи уменьшает
 * выручку — так считают российские брокеры.
 *
 * Суммы — в базовой валюте портфеля по курсу, записанному в каждой операции.
 * Для валютных бумаг это и есть налоговая логика: в базу идёт рублёвый
 * результат, включая валютную переоценку.
 *
 * Это оценка для планирования, а не декларация: брокер может учесть то, чего
 * журнал не знает (перенос убытков прошлых лет, сальдирование со срочным
 * рынком, ИИС). Расхождение с брокерским отчётом — повод свериться, а не
 * ошибка.
 */

/** НДФЛ по инвестиционным доходам: 13 % до порога, 15 % свыше. */
export const TAX_THRESHOLD = 2_400_000;
export const TAX_RATE_LOW = 0.13;
export const TAX_RATE_HIGH = 0.15;

/**
 * ЛДВ считается календарными годами, а не днями: три года — это та же дата
 * три года спустя. 3 × 365 врёт на високосный день, и на рубеже льготы
 * однодневная ошибка — это налог на всю прибыль лота.
 */
const addYears = (iso: string, years: number): string => {
  const date = new Date(Date.parse(iso));
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
};

/** Дата, с которой лот получает право на ЛДВ. */
export const ldvEligibleAt = (boughtAt: string): string => addYears(boughtAt.slice(0, 10), 3);

export interface LotClosure {
  instrumentId: number;
  symbol: string;
  name: string;
  kind: Instrument["kind"];
  /** Дата продажи (ISO). */
  soldAt: string;
  /** Дата покупки закрытого лота (ISO). */
  boughtAt: string;
  quantity: number;
  /** Выручка за закрытую часть, нетто комиссий продажи, в базовой валюте. */
  proceeds: number;
  /** Себестоимость закрытой части с комиссией покупки, в базовой валюте. */
  cost: number;
  /** proceeds - cost. */
  pnl: number;
  holdingDays: number;
  /** Владение ≥ 3 лет — кандидат на ЛДВ (льготу на долгосрочное владение). */
  longTermEligible: boolean;
}

export interface TaxYear {
  year: number;
  closures: LotClosure[];
  /** Прибыль и убыток от закрытых лотов, в базовой валюте. */
  tradingGains: number;
  tradingLosses: number;
  /** Сальдо: gains + losses (losses отрицательные). */
  tradingPnl: number;
  /** Часть прибыли по лотам старше трёх лет — потенциально освобождается ЛДВ. */
  ldvEligibleGains: number;
  /** Дивиденды и купоны, полученные за год (gross, в базовой валюте). */
  dividends: number;
  coupons: number;
  /** Налог, который брокер уже удержал (операции TAX за год). */
  taxWithheld: number;
  /** Оценка базы и налога до вычета удержанного. */
  estimatedBase: number;
  estimatedTax: number;
  /** Сколько примерно доплатить по декларации: estimatedTax − taxWithheld. */
  estimatedDue: number;
}

/** Позиция с бумажным убытком — кандидат на продажу ради уменьшения базы. */
export interface HarvestCandidate {
  symbol: string;
  name: string;
  quantity: number;
  unrealizedLoss: number;
  /** В какой валюте убыток. */
  currency: string;
  fxRate: number;
}

/** Открытый лот, которому скоро исполнится три года. */
export interface LdvUpcoming {
  symbol: string;
  name: string;
  quantity: number;
  boughtAt: string;
  /** Дата, с которой лот становится кандидатом на ЛДВ. */
  eligibleAt: string;
}

interface WalkedLot {
  quantity: number;
  costPerUnit: number;
  date: string;
  /** Курс к базовой валюте на дату покупки. */
  fxRate: number;
}

const daysBetween = (from: string, to: string): number =>
  Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000);

const dayInYear = (ts: string, year: number): boolean => ts.slice(0, 4) === String(year);

/**
 * Все закрытия лотов по всем инструментам, в хронологическом порядке.
 * Внутренний проход — тот же FIFO, что в buildPositions, но каждая продажа
 * оставляет след.
 */
export function walkClosures(
  transactions: Transaction[],
  instruments: Map<number, Instrument>,
): LotClosure[] {
  const byInstrument = new Map<number, Transaction[]>();
  for (const tx of sortLedger(transactions)) {
    if (tx.instrument_id === null) continue;
    const list = byInstrument.get(tx.instrument_id);
    if (list) list.push(tx);
    else byInstrument.set(tx.instrument_id, [tx]);
  }

  const closures: LotClosure[] = [];

  for (const [instrumentId, ledger] of byInstrument) {
    const instrument = instruments.get(instrumentId);
    if (!instrument) continue;
    // Производные — отдельная налоговая база (срочный рынок), здесь не считаем.
    if (isDerivative(instrument.kind)) continue;

    const lots: WalkedLot[] = [];

    for (const tx of ledger) {
      if (tx.type === "BUY" && tx.quantity > 0) {
        lots.push({
          quantity: tx.quantity,
          costPerUnit: tx.price + tx.fee / tx.quantity,
          date: tx.ts,
          fxRate: tx.fx_rate || 1,
        });
        continue;
      }

      if (tx.type === "SPLIT" && tx.quantity > 0) {
        for (const lot of lots) {
          lot.quantity *= tx.quantity;
          lot.costPerUnit /= tx.quantity;
        }
        continue;
      }

      if ((tx.type === "SELL" || tx.type === "REDEMPTION") && tx.quantity > 0) {
        const sellFx = tx.fx_rate || 1;
        const proceedsPerUnit = tx.price - (tx.fee + tx.tax) / tx.quantity;
        let remaining = tx.quantity;

        while (remaining > 1e-12 && lots.length > 0) {
          const lot = lots[0];
          const take = Math.min(lot.quantity, remaining);
          const proceeds = take * proceedsPerUnit * sellFx;
          const cost = take * lot.costPerUnit * lot.fxRate;
          const holdingDays = daysBetween(lot.date, tx.ts);

          closures.push({
            instrumentId,
            symbol: instrument.symbol,
            name: instrument.name,
            kind: instrument.kind,
            soldAt: tx.ts,
            boughtAt: lot.date,
            quantity: take,
            proceeds,
            cost,
            pnl: proceeds - cost,
            holdingDays,
            longTermEligible:
              !isDerivative(instrument.kind) && ldvEligibleAt(lot.date) <= tx.ts.slice(0, 10),
          });

          lot.quantity -= take;
          remaining -= take;
          if (lot.quantity <= 1e-12) lots.shift();
        }
      }
    }
  }

  return closures.sort((a, b) => a.soldAt.localeCompare(b.soldAt));
}

/** Годовой налоговый отчёт по портфелю. */
export function taxYear(
  transactions: Transaction[],
  instruments: Map<number, Instrument>,
  year: number,
): TaxYear {
  const closures = walkClosures(transactions, instruments).filter((closure) =>
    dayInYear(closure.soldAt, year),
  );

  let tradingGains = 0;
  let tradingLosses = 0;
  let ldvEligibleGains = 0;
  for (const closure of closures) {
    if (closure.pnl >= 0) {
      tradingGains += closure.pnl;
      if (closure.longTermEligible) ldvEligibleGains += closure.pnl;
    } else {
      tradingLosses += closure.pnl;
    }
  }

  let dividends = 0;
  let coupons = 0;
  let taxWithheld = 0;
  for (const tx of transactions) {
    if (!dayInYear(tx.ts, year)) continue;
    const fx = tx.fx_rate || 1;
    if (tx.type === "DIVIDEND") dividends += tx.amount * fx;
    if (tx.type === "COUPON") coupons += tx.amount * fx;
    // У брокеров удержанный налог приходит отдельной операцией, со знаком.
    if (tx.type === "TAX") taxWithheld += Math.abs(tx.amount || tx.tax) * fx;
  }

  const tradingPnl = tradingGains + tradingLosses;
  // База не может быть отрицательной: убыток года переносится, а не возвращается.
  const estimatedBase = Math.max(0, tradingPnl + dividends + coupons);
  const estimatedTax =
    Math.min(estimatedBase, TAX_THRESHOLD) * TAX_RATE_LOW +
    Math.max(0, estimatedBase - TAX_THRESHOLD) * TAX_RATE_HIGH;

  return {
    year,
    closures,
    tradingGains,
    tradingLosses,
    tradingPnl,
    ldvEligibleGains,
    dividends,
    coupons,
    taxWithheld,
    estimatedBase,
    estimatedTax,
    estimatedDue: Math.max(0, estimatedTax - taxWithheld),
  };
}

/** Годы, в которых в журнале есть хоть одна операция — для переключателя. */
export function taxYears(transactions: Transaction[]): number[] {
  const years = new Set<number>();
  for (const tx of transactions) {
    const year = Number(tx.ts.slice(0, 4));
    if (Number.isFinite(year)) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

/** Прогрессивная ставка НДФЛ по сумме базы — для подсказок в интерфейсе. */
export function taxRateFor(base: number): number {
  return base > TAX_THRESHOLD ? TAX_RATE_HIGH : TAX_RATE_LOW;
}

/**
 * Позиции с бумажным убытком.
 *
 * Продажа убыточной позиции до конца года уменьшает базу по прибыльным сделкам
 * того же года (tax-loss harvesting). Возвращаем только то, что реально
 * торгуется и учтено в стоимости — исключённые позиции продать «для налога»
 * нельзя, их цифрам нельзя верить.
 */
export function harvestCandidates(positions: Position[]): HarvestCandidate[] {
  return positions
    .filter(
      (position) =>
        position.anomaly === null && position.quantity > 0 && position.unrealizedPnl < -1,
    )
    .map((position) => ({
      symbol: position.instrument.symbol,
      name: position.instrument.name,
      quantity: position.quantity,
      unrealizedLoss: position.unrealizedPnl,
      currency: position.currency,
      fxRate: position.fxRate,
    }))
    .sort((a, b) => a.unrealizedLoss * a.fxRate - b.unrealizedLoss * b.fxRate);
}

/**
 * Открытые лоты, которым три года исполнится в ближайшие `horizonDays`.
 *
 * Продажа такого лота до срока облагается, после — кандидат на освобождение
 * до 3 млн ₽ за каждый год владения. Разница в датах стоит денег, поэтому
 * приближающийся рубеж стоит показать заранее.
 */
export function ldvUpcoming(
  transactions: Transaction[],
  instruments: Map<number, Instrument>,
  asOf = new Date().toISOString().slice(0, 10),
  horizonDays = 180,
): LdvUpcoming[] {
  const byInstrument = new Map<number, Transaction[]>();
  for (const tx of sortLedger(transactions)) {
    if (tx.instrument_id === null) continue;
    const list = byInstrument.get(tx.instrument_id);
    if (list) list.push(tx);
    else byInstrument.set(tx.instrument_id, [tx]);
  }

  const upcoming: LdvUpcoming[] = [];

  for (const [instrumentId, ledger] of byInstrument) {
    const instrument = instruments.get(instrumentId);
    if (!instrument || isDerivative(instrument.kind)) continue;

    const lots: { quantity: number; date: string }[] = [];
    for (const tx of ledger) {
      if (tx.type === "BUY" && tx.quantity > 0) {
        lots.push({ quantity: tx.quantity, date: tx.ts });
      } else if (tx.type === "SPLIT" && tx.quantity > 0) {
        for (const lot of lots) lot.quantity *= tx.quantity;
      } else if ((tx.type === "SELL" || tx.type === "REDEMPTION") && tx.quantity > 0) {
        let remaining = tx.quantity;
        while (remaining > 1e-12 && lots.length > 0) {
          const take = Math.min(lots[0].quantity, remaining);
          lots[0].quantity -= take;
          remaining -= take;
          if (lots[0].quantity <= 1e-12) lots.shift();
        }
      }
    }

    for (const lot of lots) {
      const eligibleAt = ldvEligibleAt(lot.date);
      // Уже имеет право — не «скоро»; дальше горизонта — ещё рано показывать.
      if (eligibleAt <= asOf) continue;
      if (daysBetween(asOf, eligibleAt) > horizonDays) continue;
      upcoming.push({
        symbol: instrument.symbol,
        name: instrument.name,
        quantity: lot.quantity,
        boughtAt: lot.date.slice(0, 10),
        eligibleAt,
      });
    }
  }

  return upcoming.sort((a, b) => a.eligibleAt.localeCompare(b.eligibleAt));
}

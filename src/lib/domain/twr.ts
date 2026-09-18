import type { SeriesPoint } from "@/lib/domain/analytics";
import type { Transaction } from "@/lib/types";

/**
 * Time-weighted return (TWR).
 *
 * XIRR отвечает «сколько заработал я со своими деньгами» и потому зависит от
 * моментов пополнений: удачно внёс крупную сумму — доходность выросла без
 * всякого рынка. Сравнивать её с индексом некорректно. TWR устраняет потоки:
 * ряд стоимости режется на участки между пополнениями и выводами, доходность
 * каждого участка считается отдельно, и они перемножаются. Остаётся чистая
 * доходность решений — сопоставимая с бенчмарком.
 */

/**
 * Дневная цепочка: для дня с потоком F доходность = (V_d − F) / V_{d-1} − 1,
 * то есть поток считается случившимся в конце дня. Начало-дня было бы
 * симметричным приближением, но ряд строится из операций «включая этот день»,
 * поэтому конец дня точнее совпадает с тем, как стоимость реально посчитана.
 * Выплаты (дивиденды, купоны) потоками не являются — это часть доходности.
 *
 * Возвращает null, когда сказать нечего: меньше двух точек ряда.
 */
export function twr(series: SeriesPoint[], transactions: Transaction[]): number | null {
  if (series.length < 2) return null;

  const flows = new Map<string, number>();
  for (const tx of transactions) {
    let amount = 0;
    if (tx.type === "DEPOSIT") amount = tx.amount;
    else if (tx.type === "WITHDRAWAL") amount = -Math.abs(tx.amount);
    else continue;

    const day = tx.ts.slice(0, 10);
    flows.set(day, (flows.get(day) ?? 0) + amount * (tx.fx_rate || 1));
  }

  let product = 1;
  for (let index = 1; index < series.length; index++) {
    const flow = flows.get(series[index].date) ?? 0;
    const base = series[index - 1].value;
    // Нулевая или отрицательная база не даёт осмысленного звена — пропускаем,
    // а не делим на ноль.
    if (base <= 1e-9) continue;
    product *= (series[index].value - flow) / base;
  }

  return product - 1;
}

/**
 * Изменение ряда (индекса) за то же окно, что покрывает портфель: от первой
 * доступной точки не раньше `fromDate` до последней известной.
 */
export function seriesChange(history: Map<string, number>, fromDate: string): number | null {
  let first: number | null = null;
  let last: number | null = null;

  for (const [date, value] of history) {
    if (date < fromDate || value <= 0) continue;
    if (first === null) first = value;
    last = value;
  }

  if (first === null || last === null) return null;
  return last / first - 1;
}

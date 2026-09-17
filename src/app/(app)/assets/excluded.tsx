import Link from "next/link";
import { money } from "@/lib/format";
import type { PositionAnomaly } from "@/lib/domain/positions";
import type { AssetRow } from "./table";

/**
 * Holdings deliberately left out of portfolio value.
 *
 * Excluding them silently would be its own kind of lie, so the money is named
 * and so is the missing operation. Every case here is the ledger disagreeing
 * with reality in a way that makes multiplication meaningless — not a rounding
 * difference, but a quantity and a price that describe different worlds.
 */

const REASONS: Record<
  PositionAnomaly,
  { title: string; what: string; fix: string; countsValue: boolean }
> = {
  "suspect-split": {
    title: "Похоже на неучтённый сплит",
    what:
      "Рыночная цена отличается от средней цены покупки более чем в 50 раз. Так бумаги " +
      "не растут — так выглядит сплит или консолидация, о которой брокер не прислал " +
      "операцию: в журнале осталось количество «до», а котировка приходит «после».",
    fix:
      "Добавьте операцию «Сплит» на дату корпоративного действия — коэффициент " +
      "пересчитает и количество, и себестоимость. Для обратного сплита 1:5000 " +
      "коэффициент равен 0,0002.",
    countsValue: true,
  },
  "expired-derivative": {
    title: "Истёкшие контракты",
    what:
      "Срок обращения прошёл, но в журнале контракт всё ещё числится открытым: " +
      "экспирация — не сделка, и ни один брокер не отдаёт её в списке операций.",
    fix: "Ничего делать не нужно — в стоимость портфеля такие контракты не входят.",
    countsValue: false,
  },
  derivative: {
    title: "Производные инструменты",
    what:
      "Фьючерсы и опционы — это не владение активом, а обязательство с вариационной " +
      "маржой. Метод FIFO считает себестоимость купленного, поэтому к таким позициям " +
      "он неприменим.",
    fix:
      "Деньги, которые контракты реально принесли или забрали, остаются в " +
      "реализованной прибыли портфеля.",
    countsValue: false,
  },
};

/** Stable order: the one that costs real money first. */
const ORDER: PositionAnomaly[] = ["suspect-split", "expired-derivative", "derivative"];

export function ExcludedNotice({
  rows,
  baseCurrency,
}: {
  rows: AssetRow[];
  baseCurrency: string;
}) {
  const groups = ORDER.map((reason) => ({
    reason,
    spec: REASONS[reason],
    items: rows.filter((row) => row.anomaly === reason),
  })).filter((group) => group.items.length > 0);

  if (groups.length === 0) return null;

  return (
    <div className="rounded-lg border border-rule bg-sunk">
      <div className="border-b border-rule px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Не учтено в стоимости портфеля</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-mute">
          По этим позициям в журнале не хватает операции, которую брокер не присылает.
          Учитывать их — значит показать сумму, которой нет.
        </p>
      </div>

      <div className="divide-y divide-rule">
        {groups.map(({ reason, spec, items }) => {
          const total = items.reduce((sum, item) => sum + item.excludedValue, 0);

          return (
            <div key={reason} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-[13px] font-semibold text-ink">
                  {spec.title}
                  <span className="ml-2 font-normal text-ink-mute">
                    {items.length}{" "}
                    {items.length === 1 ? "позиция" : items.length < 5 ? "позиции" : "позиций"}
                  </span>
                </h3>
                {spec.countsValue && total > 0 && (
                  <span className="tnum text-[13px] font-semibold text-loss">
                    {money(total, baseCurrency)} исключено
                  </span>
                )}
              </div>

              <p className="mt-1.5 text-xs leading-relaxed text-ink-mute">{spec.what}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{spec.fix}</p>

              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {items.slice(0, 12).map((item) => (
                  <span key={item.instrumentId} className="code text-[11px] text-ink-mute">
                    {item.symbol}
                  </span>
                ))}
                {items.length > 12 && (
                  <span className="text-[11px] text-ink-faint">и ещё {items.length - 12}</span>
                )}
              </div>

              {reason === "suspect-split" && (
                <Link
                  href="/transactions"
                  className="mt-2.5 inline-block text-xs font-medium text-accent hover:underline"
                >
                  Добавить операцию «Сплит» →
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadContext } from "@/lib/context";
import { portfolioByShareToken } from "@/lib/repo";
import { allocationByCategory, allocationByKind } from "@/lib/domain/analytics";
import { money, percent, pnlClass, signedMoney, signedPercent } from "@/lib/format";
import { Mark } from "@/components/mark";

export const dynamic = "force-dynamic";

// Публичная ссылка — для людей, а не для поисковиков.
export const metadata: Metadata = {
  title: "Портфель · Glacier",
  robots: { index: false, follow: false },
};

/**
 * Read-only сводка портфеля по публичной ссылке.
 *
 * Что видно: стоимость, доходность, распределение, топ позиций. Чего нет и не
 * будет: журнала сделок, остатков денег по счетам, имени владельца — ссылка
 * делится результатом, а не бухгалтерией.
 */
export default async function PublicPortfolioPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = portfolioByShareToken(token);
  if (!found) notFound();

  const { portfolio } = found;
  const context = loadContext(portfolio.user_id, portfolio.id);
  const { summary, baseCurrency, categories } = context;

  const byCategory = allocationByCategory(summary.positions, categories);
  const byKind = allocationByKind(summary.positions);
  const top = summary.openPositions.slice(0, 10);
  const profitShare = summary.costBasis > 0 ? summary.totalPnl / summary.costBasis : null;

  return (
    <main className="mx-auto min-h-screen max-w-[900px] px-5 py-10 sm:px-8">
      <div className="flex items-center justify-between">
        <Mark size={20} className="text-ink" />
        <span className="text-[11px] font-semibold tracking-[0.13em] text-ink-mute uppercase">
          Публичная сводка · только чтение
        </span>
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-[-0.02em] text-ink">
        {portfolio.name}
      </h1>
      <p className="mt-1 text-sm text-ink-mute">
        Владелец поделился этой страницей. Цифры обновляются при синхронизации портфеля.
      </p>

      <div className="card mt-8 p-6">
        <p className="eyebrow">Стоимость портфеля</p>
        <p className="figure mt-2 text-4xl font-semibold tracking-[-0.02em] text-ink">
          {money(summary.totalValue, baseCurrency)}
        </p>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3 text-sm">
          <span className={`figure ${pnlClass(summary.totalPnl)}`}>
            {signedMoney(summary.totalPnl, baseCurrency)}
          </span>
          <span className="text-ink-soft">{signedPercent(profitShare)} к вложенному</span>
          {summary.xirr !== null && (
            <span className="text-ink-mute">доходность {signedPercent(summary.xirr)} годовых</span>
          )}
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="eyebrow">Позиций</p>
          <p className="tnum mt-1.5 text-lg font-semibold text-ink">
            {summary.openPositions.length}
          </p>
        </div>
        <div className="card p-4">
          <p className="eyebrow">Вложено</p>
          <p className="tnum mt-1.5 text-lg font-semibold text-ink">
            {money(summary.costBasis, baseCurrency)}
          </p>
        </div>
        <div className="card p-4">
          <p className="eyebrow">Выплаты получено</p>
          <p className="tnum mt-1.5 text-lg font-semibold text-ink">
            {money(summary.income, baseCurrency)}
          </p>
        </div>
      </div>

      {byKind.length > 0 && (
        <section className="card mt-6 p-6">
          <h2 className="text-sm font-semibold text-ink">Структура</h2>
          <ul className="mt-3 space-y-2">
            {byCategory.slice(0, 8).map((slice) => (
              <li key={slice.key} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-ink-soft">{slice.label}</span>
                <span className="tnum shrink-0 text-ink">{percent(slice.share, 1)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-rule pt-3 text-xs text-ink-mute">
            {byKind
              .map((slice) => `${slice.label} ${percent(slice.share, 0)}`)
              .join(" · ")}
          </p>
        </section>
      )}

      {top.length > 0 && (
        <section className="card mt-6 p-6">
          <h2 className="text-sm font-semibold text-ink">Крупнейшие позиции</h2>
          <ul className="mt-3 divide-y divide-rule">
            {top.map((position) => (
              <li key={position.instrument.id} className="flex items-baseline justify-between gap-3 py-2">
                <div className="min-w-0">
                  <span className="code text-[13px] font-medium text-ink">
                    {position.instrument.symbol}
                  </span>
                  <span className="ml-2 truncate text-xs text-ink-mute">
                    {position.instrument.name}
                  </span>
                </div>
                <span className="tnum shrink-0 text-sm text-ink">
                  {summary.marketValue > 0
                    ? percent(position.marketValue / summary.marketValue, 1)
                    : "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-10 border-t border-rule pt-4 text-xs leading-relaxed text-ink-mute">
        Сводка сформирована сервисом учёта инвестиций Glacier по данным владельца портфеля.
        Не является инвестиционной рекомендацией. Ссылку можно отозвать в любой момент —
        после отзыва страница перестаёт существовать.
      </footer>
    </main>
  );
}

import { requireUser } from "@/lib/auth";
import { loadContext, loadPreviousCloses, resolvePortfolioId } from "@/lib/context";
import { listPortfolios } from "@/lib/repo";
import { computeDayChange, positionMetrics } from "@/lib/domain/analytics";
import { KIND_LABELS } from "@/lib/types";
import { money, percent, pnlClass, signedMoney } from "@/lib/format";
import { Empty, Metric, Section, Table, Td, Th } from "@/components/ui";
import { PortfolioSwitcher } from "@/components/portfolio-switcher";
import { AssetsTable, type AssetRow } from "./table";
import { ExcludedNotice } from "./excluded";

export const dynamic = "force-dynamic";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const portfolios = listPortfolios(user.id);
  const portfolioId = resolvePortfolioId(portfolios, params.p);
  const context = loadContext(user.id, portfolioId);
  const { summary, baseCurrency, categories, transactions, fxRates } = context;

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

  const dayChange = computeDayChange(
    summary.positions,
    loadPreviousCloses(summary.positions.map((position) => position.instrument.id)),
  );

  const rows: AssetRow[] = summary.positions.map((position) => {
    const rate = position.fxRate;
    const metrics = positionMetrics(position, transactions);
    const marketValue = position.marketValue * rate;

    return {
      instrumentId: position.instrument.id,
      symbol: position.instrument.symbol,
      name: position.instrument.name,
      kindLabel: KIND_LABELS[position.instrument.kind] ?? position.instrument.kind,
      category:
        position.categoryId !== null ? (categoryNames.get(position.categoryId) ?? "—") : "—",
      maturityDate: position.instrument.maturity_date,
      quantity: position.quantity,
      averagePrice: position.averagePrice,
      lastPrice: position.lastPrice,
      priceAt: position.instrument.last_price_at,
      currency: position.currency,
      marketValue,
      costBasis: position.costBasis * rate,
      unrealizedPnl: position.unrealizedPnl * rate,
      realizedPnl: position.realizedPnl * rate,
      income: position.income * rate,
      totalPnl: position.totalPnl * rate,
      share: summary.marketValue > 0 ? marketValue / summary.marketValue : 0,
      xirr: metrics.xirr,
      yieldOnCost: metrics.yieldOnCost,
      trailingYield: metrics.trailingYield,
      dayChange: dayChange.byInstrument.get(position.instrument.id) ?? null,
      isOpen: position.quantity > 0,
      anomaly: position.anomaly,
      excludedValue: position.excludedValue * rate,
    };
  });

  const openCount = rows.filter((row) => row.isOpen && row.anomaly === null).length;
  const excluded = rows.filter((row) => row.anomaly !== null);
  const trailingIncome = rows.reduce(
    (sum, row) => sum + (row.trailingYield !== null ? row.trailingYield * row.marketValue : 0),
    0,
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Активы</h1>
          <p className="mt-1 text-sm text-ink-mute">
            Позиции рассчитаны методом FIFO: комиссия покупки входит в себестоимость
          </p>
        </div>
        <PortfolioSwitcher portfolios={portfolios} selectedId={portfolioId} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Позиций открыто" value={openCount} />
        <Metric label="Рыночная стоимость" value={money(summary.marketValue, baseCurrency)} />
        <Metric
          label="Нереализованная прибыль"
          value={signedMoney(summary.unrealizedPnl, baseCurrency)}
          tone={
            summary.unrealizedPnl > 0 ? "good" : summary.unrealizedPnl < 0 ? "bad" : "neutral"
          }
          hint={`себестоимость ${money(summary.costBasis, baseCurrency)}`}
        />
        <Metric
          label="Выплаты за 12 месяцев"
          value={money(trailingIncome, baseCurrency)}
          hint={
            summary.marketValue > 0
              ? `${percent(trailingIncome / summary.marketValue, 1)} к стоимости`
              : "фактически получено"
          }
        />
      </div>

      {excluded.length > 0 && (
        <div className="mt-4">
          <ExcludedNotice rows={excluded} baseCurrency={baseCurrency} />
        </div>
      )}

      <div className="mt-4">
        <Section
          title="Позиции"
          subtitle="Столбцы сортируются, «Доходность» — годовых по каждой бумаге отдельно"
        >
          {rows.length === 0 ? (
            <Empty title="Позиций нет" hint="Добавьте покупку на странице «Сделки»." />
          ) : (
            <AssetsTable rows={rows} baseCurrency={baseCurrency} />
          )}
        </Section>
      </div>

      {summary.cashByCurrency.size > 0 && (
        <div className="mt-4">
          <Section title="Свободные деньги" subtitle="Остаток выведен из журнала операций">
            <Table minWidth={420}>
              <thead>
                <tr>
                  <Th>Валюта</Th>
                  <Th align="right">Остаток</Th>
                  <Th align="right">В базовой валюте</Th>
                </tr>
              </thead>
              <tbody>
                {[...summary.cashByCurrency.entries()].map(([currency, value]) => (
                  <tr key={currency}>
                    <Td className="code">{currency}</Td>
                    <Td align="right" className={`tnum ${pnlClass(value)}`}>
                      {money(value, currency)}
                    </Td>
                    <Td align="right" className="tnum text-ink-soft">
                      {money(
                        value * (currency === baseCurrency ? 1 : (fxRates.get(currency) ?? 1)),
                        baseCurrency,
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-3 text-xs text-ink-mute">
              Отрицательный остаток означает, что покупки внесены без соответствующего пополнения
              счёта — добавьте операцию «Внесение средств», чтобы картина сошлась.
            </p>
          </Section>
        </div>
      )}
    </>
  );
}

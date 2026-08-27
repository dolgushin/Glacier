import { requireUser } from "@/lib/auth";
import { loadContext, resolvePortfolioId } from "@/lib/context";
import { listPortfolios } from "@/lib/repo";
import { KIND_LABELS } from "@/lib/types";
import {
  date as formatDate,
  money,
  number,
  percent,
  pnlClass,
  relativeTime,
  signedMoney,
  signedPercent,
} from "@/lib/format";
import { Tag, Section, Empty, Metric, Table, Td, Th } from "@/components/ui";
import { PortfolioSwitcher } from "@/components/portfolio-switcher";

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
  const { summary, baseCurrency, categories } = context;

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const open = summary.openPositions;
  const closed = summary.positions.filter((position) => position.quantity <= 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Активы</h1>
          <p className="text-xs text-ink-mute">
            Позиции рассчитаны методом FIFO: комиссия покупки входит в себестоимость
          </p>
        </div>
        <PortfolioSwitcher portfolios={portfolios} selectedId={portfolioId} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Позиций открыто" value={open.length} />
        <Metric label="Рыночная стоимость" value={money(summary.marketValue, baseCurrency)} />
        <Metric label="Себестоимость" value={money(summary.costBasis, baseCurrency)} />
        <Metric
          label="Нереализованная прибыль"
          value={signedMoney(summary.unrealizedPnl, baseCurrency)}
          tone={
            summary.unrealizedPnl > 0 ? "good" : summary.unrealizedPnl < 0 ? "bad" : "neutral"
          }
        />
      </div>

      <Section title="Открытые позиции">
        {open.length === 0 ? (
          <Empty title="Открытых позиций нет" hint="Добавьте покупку на странице «Сделки»." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Актив</Th>
                <Th>Категория</Th>
                <Th align="right">Кол-во</Th>
                <Th align="right">Средняя</Th>
                <Th align="right">Текущая</Th>
                <Th align="right">Стоимость</Th>
                <Th align="right">Доля</Th>
                <Th align="right">Прибыль</Th>
                <Th align="right">Выплаты</Th>
              </tr>
            </thead>
            <tbody>
              {open.map((position) => {
                const value = position.marketValue * position.fxRate;
                const share = summary.marketValue > 0 ? value / summary.marketValue : 0;
                const pnl = position.unrealizedPnl * position.fxRate;
                const pnlPercent =
                  position.costBasis > 0 ? position.unrealizedPnl / position.costBasis : null;
                const stale = position.lastPrice === null;

                return (
                  <tr key={position.instrument.id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">
                          {position.instrument.symbol}
                        </span>
                        <Tag>{KIND_LABELS[position.instrument.kind]}</Tag>
                      </div>
                      <div className="max-w-[220px] truncate text-xs text-ink-mute">
                        {position.instrument.name}
                      </div>
                      {position.instrument.maturity_date && (
                        <div className="text-[11px] text-ink-mute">
                          погашение {formatDate(position.instrument.maturity_date)}
                        </div>
                      )}
                    </Td>
                    <Td className="text-xs text-ink-mute">
                      {position.categoryId !== null
                        ? (categoryNames.get(position.categoryId) ?? "—")
                        : "—"}
                    </Td>
                    <Td align="right" className="tnum text-ink-soft">
                      {number(position.quantity, 8)}
                    </Td>
                    <Td align="right" className="tnum text-ink-soft">
                      {money(position.averagePrice, position.currency, 2)}
                    </Td>
                    <Td align="right" className="tnum">
                      {stale ? (
                        <span className="text-ink-mute">нет цены</span>
                      ) : (
                        <>
                          {money(position.lastPrice as number, position.currency, 2)}
                          <div className="text-[11px] text-ink-mute">
                            {relativeTime(position.instrument.last_price_at)}
                          </div>
                        </>
                      )}
                    </Td>
                    <Td align="right" className="tnum font-medium">
                      {money(value, baseCurrency)}
                    </Td>
                    <Td align="right" className="tnum text-ink-soft">
                      {percent(share, 1)}
                    </Td>
                    <Td align="right" className={`tnum ${pnlClass(pnl)}`}>
                      {signedMoney(pnl, baseCurrency)}
                      <div className="text-[11px] opacity-75">{signedPercent(pnlPercent)}</div>
                    </Td>
                    <Td align="right" className="tnum text-ink-soft">
                      {position.income > 0 ? money(position.income * position.fxRate, baseCurrency) : "—"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>

      {closed.length > 0 && (
        <Section
          title="Закрытые позиции"
          subtitle="История: реализованный результат и полученные выплаты"
        >
          <Table>
            <thead>
              <tr>
                <Th>Актив</Th>
                <Th align="right">Реализовано</Th>
                <Th align="right">Выплаты</Th>
                <Th align="right">Комиссии</Th>
                <Th align="right">Налоги</Th>
                <Th align="right">Итого</Th>
              </tr>
            </thead>
            <tbody>
              {closed.map((position) => (
                <tr key={position.instrument.id}>
                  <Td>
                    <div className="font-medium text-ink">{position.instrument.symbol}</div>
                    <div className="max-w-[220px] truncate text-xs text-ink-mute">
                      {position.instrument.name}
                    </div>
                  </Td>
                  <Td align="right" className={`tnum ${pnlClass(position.realizedPnl)}`}>
                    {signedMoney(position.realizedPnl * position.fxRate, baseCurrency)}
                  </Td>
                  <Td align="right" className="tnum text-ink-soft">
                    {money(position.income * position.fxRate, baseCurrency)}
                  </Td>
                  <Td align="right" className="tnum text-ink-mute">
                    {money(position.feesPaid * position.fxRate, baseCurrency)}
                  </Td>
                  <Td align="right" className="tnum text-ink-mute">
                    {money(position.taxesPaid * position.fxRate, baseCurrency)}
                  </Td>
                  <Td align="right" className={`tnum font-medium ${pnlClass(position.totalPnl)}`}>
                    {signedMoney(position.totalPnl * position.fxRate, baseCurrency)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      {summary.cashByCurrency.size > 0 && (
        <Section title="Свободные деньги" subtitle="Остаток выведен из журнала операций">
          <Table>
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
                  <Td>{currency}</Td>
                  <Td align="right" className={`tnum ${pnlClass(value)}`}>
                    {money(value, currency)}
                  </Td>
                  <Td align="right" className="tnum text-ink-soft">
                    {money(
                      value * (currency === baseCurrency ? 1 : (context.fxRates.get(currency) ?? 1)),
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
      )}
    </div>
  );
}

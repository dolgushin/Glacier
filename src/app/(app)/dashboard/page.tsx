import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { loadContext, loadPriceHistory, resolvePortfolioId } from "@/lib/context";
import { listPortfolios } from "@/lib/repo";
import { refreshIfStale } from "@/lib/sync";
import {
  allocationByCategory,
  allocationByInstrument,
  allocationByKind,
  valueSeries,
} from "@/lib/domain/analytics";
import { buildCalendar, byMonth, forwardIncome } from "@/lib/domain/payouts";
import { money, percent, pnlClass, signedMoney, signedPercent } from "@/lib/format";
import {
  AllocationList,
  Button,
  Empty,
  Hero,
  Metric,
  Section,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { DonutChart, PayoutBars, ValueChart } from "@/components/charts";
import { PortfolioSwitcher } from "@/components/portfolio-switcher";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  // Keep quotes and FX reasonably fresh without requiring a cron daemon.
  await refreshIfStale();

  const portfolios = listPortfolios(user.id);
  const portfolioId = resolvePortfolioId(portfolios, params.p);
  const context = loadContext(user.id, portfolioId);
  const { summary, baseCurrency, categories, transactions, instruments, fxRates } = context;
  const selected = portfolios.find((portfolio) => portfolio.id === portfolioId);

  if (portfolios.length === 0) {
    return (
      <Section title="Обзор">
        <Empty
          title="У вас пока нет портфелей"
          hint="Создайте портфель, чтобы начать вести учёт сделок и следить за доходностью."
          action={
            <Link href="/portfolios">
              <Button>Создать портфель</Button>
            </Link>
          }
        />
      </Section>
    );
  }

  const heading = (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">
        {selected?.name ?? "Все портфели"}
      </h1>
      <PortfolioSwitcher portfolios={portfolios} selectedId={portfolioId} />
    </div>
  );

  if (transactions.length === 0) {
    return (
      <>
        {heading}
        <Section title="Начало">
          <Empty
            title="В портфеле ещё нет операций"
            hint="Добавьте первую сделку вручную, загрузите CSV или подключите брокера — дальше всё считается само."
            action={
              <div className="flex flex-wrap gap-3">
                <Link href="/transactions">
                  <Button>Добавить сделку</Button>
                </Link>
                <Link href="/connections">
                  <Button variant="ghost">Подключить брокера</Button>
                </Link>
              </div>
            }
          />
        </Section>
      </>
    );
  }

  const priceHistory = loadPriceHistory([...instruments.keys()]);
  const series = valueSeries(transactions, priceHistory, instruments, fxRates, baseCurrency);

  const calendar = buildCalendar(summary.positions, context.payouts, transactions);
  const expected = forwardIncome(calendar, fxRates, baseCurrency);
  const payoutMonths = byMonth(calendar, fxRates, baseCurrency);

  const byCategory = allocationByCategory(summary.positions, categories);
  const byKind = allocationByKind(summary.positions);
  const byInstrument = allocationByInstrument(summary.positions, 10);

  const profitShare = summary.costBasis > 0 ? summary.totalPnl / summary.costBasis : null;
  const forwardYield = summary.marketValue > 0 ? expected / summary.marketValue : null;

  const top = summary.openPositions.slice(0, 8);
  const compact = (value: number) => money(value, baseCurrency);

  return (
    <>
      {heading}

      {/* Headline figure on the left, supporting numbers in a 2x2 beside it. */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Hero
            label="Стоимость портфеля"
            value={money(summary.totalValue, baseCurrency)}
            meta={
              <>
                <span className={`figure ${pnlClass(summary.totalPnl)}`}>
                  {signedMoney(summary.totalPnl, baseCurrency)}
                </span>
                <span className="text-sm text-ink-soft">
                  {signedPercent(profitShare)} к вложенному
                </span>
              </>
            }
          />
        </div>

        <dl className="grid grid-cols-2 gap-4 lg:col-span-5">
          <Metric
            label="Доходность"
            value={summary.xirr !== null ? signedPercent(summary.xirr) : "—"}
            tone={summary.xirr === null ? "neutral" : summary.xirr > 0 ? "good" : "bad"}
            hint={summary.xirr !== null ? "годовых, XIRR" : "недостаточно данных"}
          />
          <Metric
            label="Выплаты за год"
            value={money(expected, baseCurrency)}
            hint={forwardYield !== null ? `${percent(forwardYield)} к стоимости` : "ожидается"}
          />
          <Metric label="Вложено" value={money(summary.costBasis, baseCurrency)} hint="себестоимость позиций" />
          <Metric
            label="Свободные деньги"
            value={money(summary.cash, baseCurrency)}
            tone={summary.cash < 0 ? "bad" : "neutral"}
            hint={summary.cash < 0 ? "не хватает пополнений" : "остаток по журналу"}
          />
        </dl>
      </div>

      <div className="mt-4">
        <Section
          title="Стоимость и вложенный капитал"
          subtitle="Сплошная линия — рыночная стоимость, пунктир — вложено"
        >
          {series.length > 1 ? (
            <ValueChart data={series} currency={baseCurrency} />
          ) : (
            <Empty
              title="История ещё копится"
              hint="График строится по сохранённым дневным котировкам. Загрузите историю на странице настроек, чтобы он наполнился сразу."
            />
          )}
        </Section>
      </div>

      {/* Donut carries the proportion, the list carries the figures. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Section title="По категориям" subtitle="Цель показана рядом с текущей долей">
          <DonutChart data={byCategory} currency={baseCurrency} />
          <div className="mt-3">
            <AllocationList items={byCategory} formatValue={compact} />
          </div>
        </Section>
        <Section title="По классам активов">
          <DonutChart data={byKind} currency={baseCurrency} />
          <div className="mt-3">
            <AllocationList items={byKind} formatValue={compact} />
          </div>
        </Section>
        <Section title="По инструментам">
          <DonutChart data={byInstrument} currency={baseCurrency} />
          <div className="mt-3">
            <AllocationList items={byInstrument} formatValue={compact} />
          </div>
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section
          title="Календарь выплат"
          subtitle="Сплошные столбцы — объявленные, контурные — прогноз"
          action={
            <Link href="/calendar" className="text-accent hover:text-accent-ink">
              Подробно
            </Link>
          }
        >
          <PayoutBars data={payoutMonths} currency={baseCurrency} />
        </Section>

        <Section
          flush
          title="Крупнейшие позиции"
          action={
            <Link href="/assets" className="text-accent hover:text-accent-ink">
              Все активы
            </Link>
          }
        >
          {top.length === 0 ? (
            <Empty title="Открытых позиций нет" />
          ) : (
            <Table minWidth={400}>
              <thead>
                <tr>
                  <Th>Актив</Th>
                  <Th align="right">Стоимость</Th>
                  <Th align="right">Доля</Th>
                  <Th align="right">Прибыль</Th>
                </tr>
              </thead>
              <tbody>
                {top.map((position) => {
                  const value = position.marketValue * position.fxRate;
                  const share = summary.marketValue > 0 ? value / summary.marketValue : 0;
                  const pnl = (position.unrealizedPnl + position.realizedPnl) * position.fxRate;
                  const pnlPercent =
                    position.costBasis > 0 ? position.unrealizedPnl / position.costBasis : null;
                  return (
                    <tr key={position.instrument.id}>
                      <Td>
                        <span className="code text-[13px] font-medium">
                          {position.instrument.symbol}
                        </span>
                        <div className="max-w-[190px] truncate text-xs text-ink-mute">
                          {position.instrument.name}
                        </div>
                      </Td>
                      <Td align="right" className="tnum">
                        {money(value, baseCurrency)}
                      </Td>
                      <Td align="right" className="tnum text-ink-soft">
                        {percent(share, 1)}
                      </Td>
                      <Td align="right" className={`tnum ${pnlClass(pnl)}`}>
                        {signedMoney(pnl, baseCurrency)}
                        <div className="text-xs">{signedPercent(pnlPercent)}</div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Section>
      </div>

      <div className="mt-4">
        <Section title="Итоги за всё время">
          <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              bare
              label="Полученные выплаты"
              value={money(summary.income, baseCurrency)}
              hint="дивиденды, купоны, амортизация"
            />
            <Metric
              bare
              label="Реализованная прибыль"
              value={signedMoney(summary.realizedPnl, baseCurrency)}
              // Zero is not a gain: colouring it teal claims a result that isn't there.
              tone={
                summary.realizedPnl > 0 ? "good" : summary.realizedPnl < 0 ? "bad" : "neutral"
              }
              hint="по закрытым позициям"
            />
            <Metric
              bare
              label="Комиссии"
              value={money(summary.feesPaid, baseCurrency)}
              hint="уплачено брокеру"
            />
            <Metric bare label="Налоги" value={money(summary.taxesPaid, baseCurrency)} hint="удержано" />
          </dl>
        </Section>
      </div>
    </>
  );
}

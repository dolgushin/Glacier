import { requireUser } from "@/lib/auth";
import { loadContext, resolvePortfolioId } from "@/lib/context";
import { listPortfolios } from "@/lib/repo";
import { buildCalendar, byMonth, forwardIncome, receivedByYear } from "@/lib/domain/payouts";
import { date as formatDate, money, monthLabel, number, percent } from "@/lib/format";
import { Tag, Section, Empty, Metric, Table, Td, Th } from "@/components/ui";
import { PayoutBars, YearBars } from "@/components/charts";
import { PortfolioSwitcher } from "@/components/portfolio-switcher";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const portfolios = listPortfolios(user.id);
  const portfolioId = resolvePortfolioId(portfolios, params.p);
  const context = loadContext(user.id, portfolioId);
  const { summary, baseCurrency, transactions, fxRates, payouts } = context;

  const calendar = buildCalendar(summary.positions, payouts, transactions);
  const expected = forwardIncome(calendar, fxRates, baseCurrency);
  const months = byMonth(calendar, fxRates, baseCurrency);
  const received = receivedByYear(transactions);

  const announcedCount = calendar.filter((entry) => entry.status === "announced").length;
  const forwardYield = summary.marketValue > 0 ? expected / summary.marketValue : null;
  const yieldOnCost = summary.costBasis > 0 ? expected / summary.costBasis : null;
  const monthlyAverage = expected / 12;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Календарь выплат</h1>
          <p className="text-xs text-ink-mute">Дивиденды, купоны и амортизация на 12 месяцев вперёд</p>
        </div>
        <PortfolioSwitcher portfolios={portfolios} selectedId={portfolioId} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Ожидается за год"
          value={money(expected, baseCurrency)}
          hint={`${announcedCount} из ${calendar.length} выплат объявлены`}
        />
        <Metric
          label="В среднем в месяц"
          value={money(monthlyAverage, baseCurrency)}
          hint="равномерно распределённый пассивный доход"
        />
        <Metric
          label="Доходность к стоимости"
          value={percent(forwardYield)}
          hint="forward yield к текущей цене"
        />
        <Metric
          label="Доходность к вложенному"
          value={percent(yieldOnCost)}
          hint="yield on cost — к вашей себестоимости"
        />
      </div>

      <Section
        title="Выплаты по месяцам"
        subtitle="Синим — объявленные эмитентом, серым — прогноз по истории ваших начислений"
      >
        <PayoutBars data={months} currency={baseCurrency} />
      </Section>

      <Section
        title="Ближайшие выплаты"
        subtitle="Прогнозные строки помечены — это оценка, а не обещание эмитента"
      >
        {calendar.length === 0 ? (
          <Empty
            title="Ожидаемых выплат нет"
            hint="Для облигаций купоны подтягиваются с MOEX автоматически. Для акций прогноз строится после того, как в журнале появятся минимум два начисления по бумаге."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Дата выплаты</Th>
                <Th>Отсечка</Th>
                <Th>Актив</Th>
                <Th>Тип</Th>
                <Th align="right">На единицу</Th>
                <Th align="right">Количество</Th>
                <Th align="right">Сумма</Th>
              </tr>
            </thead>
            <tbody>
              {calendar.slice(0, 100).map((entry, index) => (
                <tr key={`${entry.instrument.id}-${entry.payDate}-${index}`}>
                  <Td className="whitespace-nowrap text-ink-soft">{formatDate(entry.payDate)}</Td>
                  <Td className="whitespace-nowrap text-xs text-ink-mute">
                    {formatDate(entry.exDate)}
                  </Td>
                  <Td>
                    <div className="font-medium text-ink">{entry.instrument.symbol}</div>
                    <div className="max-w-[200px] truncate text-xs text-ink-mute">
                      {entry.instrument.name}
                    </div>
                  </Td>
                  <Td>
                    <Tag tone={entry.status === "announced" ? "good" : "neutral"}>
                      {entry.kind === "coupon"
                        ? "Купон"
                        : entry.kind === "amortization"
                          ? "Амортизация"
                          : "Дивиденд"}
                      {entry.status === "forecast" ? " · прогноз" : ""}
                    </Tag>
                  </Td>
                  <Td align="right" className="tnum text-ink-soft">
                    {money(entry.perUnit, entry.currency, 2)}
                  </Td>
                  <Td align="right" className="tnum text-ink-soft">
                    {number(entry.quantity, 8)}
                  </Td>
                  <Td align="right" className="tnum font-medium">
                    {money(entry.gross, entry.currency)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Получено по годам" subtitle="Фактические начисления из журнала операций">
          <YearBars data={received} currency={baseCurrency} />
        </Section>

        <Section title="Как это считается">
          <div className="space-y-3 text-xs leading-relaxed text-ink-mute">
            <p>
              <span className="text-ink">Объявленные выплаты</span> по облигациям берутся из
              графика купонов MOEX — это подтверждённые эмитентом даты и суммы.
            </p>
            <p>
              <span className="text-ink">Прогноз</span> строится по вашей же истории начислений:
              нужно минимум два платежа, чтобы определить периодичность. Частота округляется до
              ближайшей разумной — месяц, квартал, полугодие, год. Сумма берётся как средняя за
              последний год, чтобы разовая крупная выплата не превратилась в вечный прогноз.
            </p>
            <p>
              Публичный API MOEX не отдаёт дивиденды по акциям, поэтому для них работает только
              прогноз по истории. Строки с прогнозом всегда помечены — выдавать оценку за факт
              нельзя.
            </p>
            <p>
              Суммы указаны <span className="text-ink">до удержания налога</span>.
            </p>
          </div>
        </Section>
      </div>

      {months.length > 0 && (
        <Section title="Помесячная разбивка">
          <Table>
            <thead>
              <tr>
                <Th>Месяц</Th>
                <Th align="right">Объявлено</Th>
                <Th align="right">Прогноз</Th>
                <Th align="right">Итого</Th>
              </tr>
            </thead>
            <tbody>
              {months.map((month) => (
                <tr key={month.month}>
                  <Td>{monthLabel(month.month)}</Td>
                  <Td align="right" className="tnum text-accent">
                    {month.announced > 0 ? money(month.announced, baseCurrency) : "—"}
                  </Td>
                  <Td align="right" className="tnum text-ink-mute">
                    {month.forecast > 0 ? money(month.forecast, baseCurrency) : "—"}
                  </Td>
                  <Td align="right" className="tnum font-medium">
                    {money(month.announced + month.forecast, baseCurrency)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}
    </div>
  );
}

import { requireUser } from "@/lib/auth";
import { loadContext, resolvePortfolioId } from "@/lib/context";
import { listPortfolios } from "@/lib/repo";
import {
  buildCalendar,
  byMonth,
  dividendMatrix,
  forwardIncome,
  payoutSustainability,
  receivedByYear,
} from "@/lib/domain/payouts";
import { date as formatDate, money, monthLabel, number, percent } from "@/lib/format";
import { Tag, Section, Empty, Metric, Table, Td, Th } from "@/components/ui";
import { PayoutBars, YearBars } from "@/components/charts";
import { PortfolioSwitcher } from "@/components/portfolio-switcher";

export const dynamic = "force-dynamic";

const MONTH_SHORT = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

const TREND_LABELS: Record<string, string> = {
  growing: "растёт",
  stable: "стабильно",
  falling: "снижается",
  interrupted: "перестала платить",
  insufficient: "мало данных",
};

const TREND_TONES: Record<string, "good" | "neutral" | "warn" | "bad"> = {
  growing: "good",
  stable: "neutral",
  falling: "warn",
  interrupted: "bad",
  insufficient: "neutral",
};

/** 1 год, 2 года, 5 лет. */
function yearsLabel(count: number): string {
  const mod100 = count % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return "лет";
  if (mod10 === 1) return "год";
  if (mod10 >= 2 && mod10 <= 4) return "года";
  return "лет";
}

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
  const matrix = dividendMatrix(transactions);
  const matrixMax = Math.max(
    1,
    ...matrix.flatMap((row) => row.months.map((amount) => amount ?? 0)),
  );
  const sustainability = payoutSustainability(transactions, context.instruments);

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

        <Section
          title="Устойчивость выплат"
          subtitle="Серия лет и тренд по вашей истории начислений — без выдуманных факторов"
        >
          {sustainability.length === 0 ? (
            <Empty
              title="Пока нечего оценивать"
              hint="Оценка появится, когда в журнале будут начисления хотя бы по одной бумаге."
            />
          ) : (
            <ul className="divide-y divide-rule">
              {sustainability.slice(0, 10).map((item) => (
                <li key={item.instrumentId} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <span className="code text-[13px] font-medium text-ink">{item.symbol}</span>
                    <span className="ml-2 text-xs text-ink-mute">
                      {item.streak > 0 ? `платит ${item.streak} ${yearsLabel(item.streak)} подряд` : "—"}
                    </span>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tnum text-xs text-ink-mute">
                      {money(item.trailing, baseCurrency, 0)} за 12 мес
                    </span>
                    <Tag tone={TREND_TONES[item.trend]}>{TREND_LABELS[item.trend]}</Tag>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {matrix.length > 0 && (
        <Section
          title="Матрица выплат"
          subtitle="Годы по строкам, месяцы по колонкам — структура пассивного дохода"
        >
          <Table minWidth={900}>
            <thead>
              <tr>
                <Th>Год</Th>
                {MONTH_SHORT.map((month) => (
                  <Th key={month} align="right">
                    {month}
                  </Th>
                ))}
                <Th align="right">Итого</Th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.year}>
                  <Td className="font-medium text-ink">{row.year}</Td>
                  {row.months.map((amount, index) => (
                    <Td key={index} align="right" className="tnum">
                      {amount === null ? (
                        <span className="text-ink-faint">·</span>
                      ) : amount > 0 ? (
                        <span
                          className="inline-block rounded-sm px-1"
                          style={{
                            // Последовательная шкала одного оттенка: насыщенность
                            // — величина выплаты. Сравнение колонки «июнь» по
                            // годам читается без легенды.
                            background: `color-mix(in oklab, var(--color-accent) ${Math.round(
                              (amount / matrixMax) * 70 + 10,
                            )}%, transparent)`,
                          }}
                        >
                          {money(amount, baseCurrency, 0)}
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </Td>
                  ))}
                  <Td align="right" className="tnum font-semibold text-ink">
                    {money(row.total, baseCurrency, 0)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

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

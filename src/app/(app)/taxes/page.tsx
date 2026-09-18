import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { loadContext, resolvePortfolioId } from "@/lib/context";
import { listPortfolios } from "@/lib/repo";
import {
  TAX_RATE_HIGH,
  TAX_RATE_LOW,
  TAX_THRESHOLD,
  harvestCandidates,
  ldvUpcoming,
  taxRateFor,
  taxYear,
  taxYears,
} from "@/lib/domain/tax";
import { KIND_LABELS } from "@/lib/types";
import { date as formatDate, money, number, pnlClass, signedMoney } from "@/lib/format";
import { Empty, Metric, Section, Table, Tag, Td, Th } from "@/components/ui";
import { PortfolioSwitcher } from "@/components/portfolio-switcher";

export const dynamic = "force-dynamic";

/**
 * Годовой налоговый отчёт: что брокер уже удержал и что предстоит декларировать.
 *
 * Это оценка для планирования, построенная на FIFO-лотах журнала. Она не
 * подменяет брокерский отчёт: брокер знает переносы убытков прошлых лет и
 * сальдирование со срочным рынком, журнал — нет. Поэтому страница говорит
 * «оценка», а не «декларация».
 */
export default async function TaxesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const portfolios = listPortfolios(user.id);
  const portfolioId = resolvePortfolioId(portfolios, params.p);
  const ctx = loadContext(user.id, portfolioId);
  const { transactions, instruments, summary, baseCurrency } = ctx;

  const years = taxYears(transactions);
  const currentYear = Number((Array.isArray(params.year) ? params.year[0] : params.year) ?? 0);
  const year = years.includes(currentYear) ? currentYear : (years[0] ?? new Date().getFullYear());

  const report = taxYear(transactions, instruments, year);
  const harvest = harvestCandidates(summary.positions);
  const upcoming = ldvUpcoming(transactions, instruments);
  const rate = taxRateFor(report.estimatedBase);

  const yearHref = (value: number) =>
    `/taxes?year=${value}${portfolioId !== null ? `&p=${portfolioId}` : ""}`;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Налоги</h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-mute">
            Оценка НДФЛ по методу FIFO: комиссия покупки в себестоимости, комиссия продажи из
            выручки. Для валютных бумаг база считается в рублях по курсам дней операций — с
            валютной переоценкой, как у брокера
          </p>
        </div>
        <PortfolioSwitcher portfolios={ctx.portfolios} selectedId={portfolioId} />
      </div>

      {years.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {years.map((value) => (
            <Link
              key={value}
              href={yearHref(value)}
              className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                value === year
                  ? "border-accent bg-accent text-white"
                  : "border-rule text-ink-soft hover:border-accent hover:text-accent"
              }`}
            >
              {value}
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={`Налоговая база ${year}`}
          value={money(report.estimatedBase, baseCurrency)}
          hint={`ставка ${rate === TAX_RATE_LOW ? `${TAX_RATE_LOW * 100} %` : `${TAX_RATE_HIGH * 100} %`} · порог ${money(TAX_THRESHOLD, baseCurrency, 0)}`}
        />
        <Metric
          label="Оценка налога"
          value={money(report.estimatedTax, baseCurrency)}
          hint="13 % до порога, 15 % свыше"
        />
        <Metric
          label="Удержано брокером"
          value={money(report.taxWithheld, baseCurrency)}
          hint="по операциям «Налог» в журнале"
        />
        <Metric
          label="К доплате по декларации"
          value={money(report.estimatedDue, baseCurrency)}
          tone={report.estimatedDue > 0 ? "bad" : "good"}
          hint={report.estimatedDue > 0 ? "подать 3-НДФЛ до 30 апреля" : "всё удержано"}
        />
      </div>

      {report.ldvEligibleGains > 0 && (
        <div className="mt-4 rounded-lg border border-gain bg-sunk px-4 py-3 text-sm leading-relaxed text-ink-soft">
          По закрытым лотам старше трёх лет прибыль{" "}
          <span className="tnum font-semibold text-gain">
            {money(report.ldvEligibleGains, baseCurrency)}
          </span>{" "}
          — кандидат на освобождение по ЛДВ: до 3 млн ₽ за каждый год владения. Заявляется у
          брокера или через вычет в декларации.
        </div>
      )}

      <div className="mt-4">
        <Section
          title={`Закрытые лоты ${year}`}
          subtitle="Каждая строка — продажа, закрывшая конкретный лот покупки"
        >
          {report.closures.length === 0 ? (
            <Empty title="Продаж не было" hint="В этом году журнал не знает закрытых лотов." />
          ) : (
            <Table minWidth={880}>
              <thead>
                <tr>
                  <Th>Бумага</Th>
                  <Th>Куплен</Th>
                  <Th>Продан</Th>
                  <Th align="right">Дней</Th>
                  <Th align="right">Кол-во</Th>
                  <Th align="right">Себестоимость</Th>
                  <Th align="right">Выручка</Th>
                  <Th align="right">Результат</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {report.closures.map((closure, index) => (
                  <tr key={`${closure.instrumentId}-${index}`}>
                    <Td>
                      <span className="code text-[13px] font-medium text-ink">
                        {closure.symbol}
                      </span>
                      <div className="max-w-[180px] truncate text-xs text-ink-mute">
                        {closure.name}
                      </div>
                      <div className="text-[11px] text-ink-faint">
                        {KIND_LABELS[closure.kind]}
                      </div>
                    </Td>
                    <Td className="text-xs text-ink-soft">{formatDate(closure.boughtAt)}</Td>
                    <Td className="text-xs text-ink-soft">{formatDate(closure.soldAt)}</Td>
                    <Td align="right" className="tnum text-ink-soft">
                      {closure.holdingDays}
                    </Td>
                    <Td align="right" className="tnum text-ink-soft">
                      {number(closure.quantity, 8)}
                    </Td>
                    <Td align="right" className="tnum text-ink-soft">
                      {money(closure.cost, baseCurrency)}
                    </Td>
                    <Td align="right" className="tnum text-ink-soft">
                      {money(closure.proceeds, baseCurrency)}
                    </Td>
                    <Td align="right" className={`tnum font-medium ${pnlClass(closure.pnl)}`}>
                      {signedMoney(closure.pnl, baseCurrency)}
                    </Td>
                    <Td>{closure.longTermEligible && <Tag tone="good">ЛДВ</Tag>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section
          title="Уменьшить базу"
          subtitle="Бумажный убыток можно превратить в налоговый: продажа до конца года сальдируется с прибылью"
        >
          {harvest.length === 0 ? (
            <Empty title="Убыточных позиций нет" hint="Продавать ради налога нечего — и хорошо." />
          ) : (
            <ul className="divide-y divide-rule">
              {harvest.slice(0, 8).map((candidate) => (
                <li
                  key={candidate.symbol}
                  className="flex items-baseline justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="code text-[13px] font-medium text-ink">
                      {candidate.symbol}
                    </span>
                    <span className="ml-2 text-xs text-ink-mute">
                      {number(candidate.quantity, 8)} шт
                    </span>
                  </div>
                  <span className="tnum text-[13px] font-medium text-loss">
                    {signedMoney(candidate.unrealizedLoss * candidate.fxRate, baseCurrency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="ЛДВ приближается"
          subtitle="Лотам, которым скоро три года, продажа после рубежа может обойтись без налога"
        >
          {upcoming.length === 0 ? (
            <Empty
              title="Ничего в ближайшие полгода"
              hint="Лотов, приближающихся к трём годам владения, нет."
            />
          ) : (
            <ul className="divide-y divide-rule">
              {upcoming.slice(0, 8).map((lot, index) => (
                <li
                  key={`${lot.symbol}-${index}`}
                  className="flex items-baseline justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="code text-[13px] font-medium text-ink">{lot.symbol}</span>
                    <span className="ml-2 text-xs text-ink-mute">
                      куплен {formatDate(lot.boughtAt)} · {number(lot.quantity, 8)} шт
                    </span>
                  </div>
                  <span className="text-xs text-ink-soft">
                    с {formatDate(lot.eligibleAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <p className="mt-4 max-w-2xl text-xs leading-relaxed text-ink-mute">
        Страница — оценка для планирования, а не декларация. Брокер дополнительно сальдирует
        срочный рынок, переносит убытки прошлых лет и знает ИИС; журнал этого не видит.
        Производные инструменты здесь не учитываются: у них отдельная налоговая база. За
        окончательной цифрой — брокерский налоговый отчёт.
      </p>
    </>
  );
}

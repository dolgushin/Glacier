import { requireUser } from "@/lib/auth";
import { loadContext, resolvePortfolioId } from "@/lib/context";
import { listPortfolios } from "@/lib/repo";
import { computeDrift, planPurchases, planWithdrawal } from "@/lib/domain/rebalance";
import { money, number, percent, signedPercent } from "@/lib/format";
import { Tag, Button, Section, Empty, Input, Metric, Table, Td, Th } from "@/components/ui";
import { PortfolioSwitcher } from "@/components/portfolio-switcher";
import { CategoryEditor } from "./category-editor";

export const dynamic = "force-dynamic";

export default async function RebalancePage({
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

  const budgetRaw = Array.isArray(params.budget) ? params.budget[0] : params.budget;
  const budget = Math.max(0, Number(String(budgetRaw ?? "").replace(/[\s,]/g, "")) || 0);

  const withdrawRaw = Array.isArray(params.withdraw) ? params.withdraw[0] : params.withdraw;
  const withdraw = Math.max(0, Number(String(withdrawRaw ?? "").replace(/[\s,]/g, "")) || 0);

  const drift = computeDrift(summary.positions, categories);
  const plan = budget > 0 ? planPurchases(summary.positions, categories, budget, baseCurrency) : null;
  const sellPlan = withdraw > 0 ? planWithdrawal(summary.positions, categories, withdraw) : null;

  const targetTotal = categories.reduce((sum, category) => sum + category.target_weight, 0);
  const maxDrift = drift.reduce((max, row) => Math.max(max, Math.abs(row.drift)), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Ребалансировка</h1>
          <p className="text-xs text-ink-mute">
            План докупок восстанавливает целевые доли, не продавая — продажа означает налог
          </p>
        </div>
        <PortfolioSwitcher portfolios={portfolios} selectedId={portfolioId} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Стоимость портфеля" value={money(summary.marketValue, baseCurrency)} />
        <Metric
          label="Максимальное отклонение"
          value={percent(maxDrift, 1)}
          tone={maxDrift > 0.05 ? "bad" : "good"}
          hint={maxDrift > 0.05 ? "стоит подравнять" : "портфель в целевых долях"}
        />
        <Metric
          label="Сумма целевых долей"
          value={`${number(targetTotal, 1)} %`}
          tone={Math.abs(targetTotal - 100) < 0.5 || targetTotal === 0 ? "neutral" : "bad"}
          hint={
            targetTotal === 0
              ? "цели не заданы"
              : Math.abs(targetTotal - 100) < 0.5
                ? "сходится к 100 %"
                : "доли не складываются в 100 %"
          }
        />
      </div>

      <Section
        title="Целевые доли по категориям"
        subtitle="Задайте, какую часть портфеля должна занимать каждая категория"
      >
        {portfolioId === null && portfolios.length > 1 ? (
          <Empty
            title="Выберите конкретный портфель"
            hint="Целевые доли задаются внутри одного портфеля — в сводном режиме их редактировать нельзя."
          />
        ) : (
          <CategoryEditor
            categories={categories}
            portfolioId={portfolioId ?? portfolios[0]?.id ?? 0}
            drift={drift}
            currency={baseCurrency}
          />
        )}
      </Section>

      <Section
        title="Помощь с покупками"
        subtitle="Сколько чего купить на заданную сумму, чтобы приблизиться к целям"
      >
        <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
          {portfolioId !== null && <input type="hidden" name="p" value={portfolioId} />}
          <div className="w-48">
            <span className="mb-1.5 block text-xs font-medium text-ink-soft">
              Сумма пополнения
            </span>
            <Input
              name="budget"
              defaultValue={budget || ""}
              inputMode="decimal"
              placeholder="100000"
            />
          </div>
          <Button type="submit">Рассчитать план</Button>
        </form>

        {!plan ? (
          <Empty
            title="Укажите сумму"
            hint="Алгоритм подбирает целые лоты так, чтобы после покупки доли категорий были максимально близки к целевым."
          />
        ) : plan.suggestions.length === 0 ? (
          <Empty
            title="Не на что распределить"
            hint="Суммы не хватает даже на один лот, либо в портфеле нет позиций с известной ценой."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Актив</Th>
                  <Th>Категория</Th>
                  <Th align="right">Цена</Th>
                  <Th align="right">Лотов</Th>
                  <Th align="right">Штук</Th>
                  <Th align="right">Сумма</Th>
                </tr>
              </thead>
              <tbody>
                {plan.suggestions.map((suggestion) => (
                  <tr key={suggestion.symbol}>
                    <Td>
                      <div className="font-medium text-ink">{suggestion.symbol}</div>
                      <div className="max-w-[200px] truncate text-xs text-ink-mute">
                        {suggestion.name}
                      </div>
                    </Td>
                    <Td className="text-xs text-ink-mute">{suggestion.categoryName}</Td>
                    <Td align="right" className="tnum text-ink-soft">
                      {money(suggestion.lastPrice, baseCurrency, 2)}
                    </Td>
                    <Td align="right" className="tnum">
                      {suggestion.lots}
                      {suggestion.lotSize > 1 && (
                        <div className="text-[11px] text-ink-mute">по {suggestion.lotSize} шт</div>
                      )}
                    </Td>
                    <Td align="right" className="tnum text-ink-soft">
                      {number(suggestion.quantity)}
                    </Td>
                    <Td align="right" className="tnum font-medium">
                      {money(suggestion.cost, baseCurrency)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
              <span className="text-ink-soft">
                Распределено: <span className="tnum font-medium text-ink">
                  {money(plan.spent, baseCurrency)}
                </span>
              </span>
              <span className="text-ink-mute">
                Остаток: <span className="tnum">{money(plan.leftover, baseCurrency)}</span>
              </span>
            </div>

            <div className="mt-5 border-t border-rule pt-4">
              <h3 className="mb-3 text-xs font-medium text-ink-soft">Доли после покупки</h3>
              <div className="space-y-2">
                {plan.resulting.map((row) => (
                  <div key={row.name} className="flex items-center gap-3 text-xs">
                    <span className="w-40 shrink-0 truncate text-ink-mute">{row.name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden bg-sunk">
                      <div
                        className="h-full bg-accent"
                        style={{ width: `${Math.min(100, row.share * 100)}%` }}
                      />
                    </div>
                    <span className="tnum w-28 shrink-0 text-right text-ink-soft">
                      {percent(row.share, 1)} / {percent(row.targetShare, 1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </Section>

      <Section
        title="Частичный вывод средств"
        subtitle="Что продать, чтобы забрать сумму и одновременно выровнять перевесы"
      >
        <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
          {portfolioId !== null && <input type="hidden" name="p" value={portfolioId} />}
          <div className="w-48">
            <span className="mb-1.5 block text-xs font-medium text-ink-soft">Нужная сумма</span>
            <Input
              name="withdraw"
              defaultValue={withdraw || ""}
              inputMode="decimal"
              placeholder="50000"
            />
          </div>
          <Button type="submit" variant="ghost">
            Подобрать
          </Button>
        </form>

        {!sellPlan ? (
          <Empty title="Укажите сумму вывода" />
        ) : sellPlan.length === 0 ? (
          <Empty title="Нечего продавать" hint="Нет позиций с известной ценой и целым лотом." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Актив</Th>
                  <Th align="right">Продать, шт</Th>
                  <Th align="right">Выручка</Th>
                </tr>
              </thead>
              <tbody>
                {sellPlan.map((suggestion) => (
                  <tr key={suggestion.symbol}>
                    <Td>
                      <div className="font-medium text-ink">{suggestion.symbol}</div>
                      <div className="max-w-[220px] truncate text-xs text-ink-mute">
                        {suggestion.name}
                      </div>
                    </Td>
                    <Td align="right" className="tnum">
                      {number(suggestion.quantity)}
                    </Td>
                    <Td align="right" className="tnum font-medium">
                      {money(suggestion.proceeds, baseCurrency)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-4 text-xs text-ink-mute">
              Продажа с прибылью создаёт налоговую базу. Перед исполнением проверьте срок владения:
              бумаги на брокерском счёте дольше трёх лет могут попадать под льготу на долгосрочное
              владение.
            </p>
          </>
        )}
      </Section>

      <Section title="Текущие отклонения">
        {drift.length === 0 ? (
          <Empty
            title="Категории не заданы"
            hint="Создайте категории выше и назначьте их активам на странице «Сделки»."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Категория</Th>
                <Th align="right">Стоимость</Th>
                <Th align="right">Текущая доля</Th>
                <Th align="right">Целевая</Th>
                <Th align="right">Отклонение</Th>
                <Th align="right">Нужно докупить</Th>
              </tr>
            </thead>
            <tbody>
              {drift.map((row) => (
                <tr key={String(row.categoryId)}>
                  <Td>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0"
                        style={{ background: row.color }}
                      />
                      {row.name}
                    </span>
                  </Td>
                  <Td align="right" className="tnum text-ink-soft">
                    {money(row.value, baseCurrency)}
                  </Td>
                  <Td align="right" className="tnum">
                    {percent(row.currentShare, 1)}
                  </Td>
                  <Td align="right" className="tnum text-ink-mute">
                    {percent(row.targetShare, 1)}
                  </Td>
                  <Td align="right">
                    <Tag
                      tone={
                        Math.abs(row.drift) < 0.02 ? "good" : Math.abs(row.drift) < 0.05 ? "warn" : "bad"
                      }
                    >
                      {signedPercent(row.drift, 1)}
                    </Tag>
                  </Td>
                  <Td align="right" className="tnum text-ink-soft">
                    {row.gap > 0 ? money(row.gap, baseCurrency) : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </div>
  );
}

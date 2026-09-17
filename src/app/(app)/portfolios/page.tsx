import { requireUser } from "@/lib/auth";
import { brokersByPortfolio, listCategories, listPortfolios, listTransactions } from "@/lib/repo";
import { getAdapter } from "@/lib/brokers/registry";
import { date as formatDate, money } from "@/lib/format";
import { loadContext } from "@/lib/context";
import { Section, Empty, Table, Td, Th } from "@/components/ui";
import { CreatePortfolio, PortfolioRow } from "./manage";

export const dynamic = "force-dynamic";

/** Broker id as stored -> the name the user knows it by. */
const adapterName = (id: string) => getAdapter(id)?.name ?? id;

export default async function PortfoliosPage() {
  const user = await requireUser();
  const portfolios = listPortfolios(user.id, true);

  const linkedBrokers = brokersByPortfolio(user.id);

  const rows = portfolios.map((portfolio) => {
    const context = loadContext(user.id, portfolio.id);
    const linked = linkedBrokers.get(portfolio.id) ?? [];
    return {
      portfolio,
      // The live link is the truth; the typed-in name is only a fallback for a
      // portfolio kept by hand.
      broker:
        linked.length > 0
          ? linked.map((id) => adapterName(id)).join(", ")
          : portfolio.broker || "—",
      value: context.summary.totalValue,
      positions: context.summary.openPositions.length,
      operations: listTransactions(user.id, { portfolioId: portfolio.id }).length,
      categories: listCategories(portfolio.id).length,
      cashKnown: context.summary.cashKnown,
    };
  });

  const withoutCash = rows.filter((row) => !row.cashKnown);

  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Портфели</h1>
        <p className="text-xs text-ink-mute">
          Несколько портфелей — это несколько стратегий или счетов у разных брокеров. В обзоре их
          можно смотреть по отдельности и сводно.
        </p>
      </div>

      <Section title="Ваши портфели" subtitle={`Совокупная стоимость: ${money(total, "RUB")}`}>
        {portfolios.length === 0 ? (
          <Empty title="Портфелей пока нет" hint="Создайте первый ниже." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Название</Th>
                <Th>Брокер</Th>
                <Th align="right">Стоимость</Th>
                <Th align="right">Позиций</Th>
                <Th align="right">Операций</Th>
                <Th align="right">Категорий</Th>
                <Th>Создан</Th>
                <Th align="right">Действия</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <PortfolioRow
                  key={row.portfolio.id}
                  portfolio={row.portfolio}
                  broker={row.broker}
                  value={row.value}
                  positions={row.positions}
                  operations={row.operations}
                  categories={row.categories}
                  createdAt={formatDate(row.portfolio.created_at)}
                />
              ))}
            </tbody>
          </Table>
        )}

        {withoutCash.length > 0 && (
          <p className="mt-3 text-xs leading-relaxed text-ink-mute">
            <span className="text-ink-soft">
              {withoutCash.map((row) => row.portfolio.name).join(", ")}
            </span>
            {withoutCash.length === 1 ? " — в стоимости" : " — в стоимости"} только бумаги:
            брокер отдаёт сделки, но не пополнения и выводы, поэтому свободных денег на счёте
            журнал не знает. Добавить их можно операцией «Внесение средств» на странице
            «Сделки» — тогда остаток начнёт считаться.
          </p>
        )}
      </Section>

      <Section title="Новый портфель">
        <CreatePortfolio />
      </Section>
    </div>
  );
}

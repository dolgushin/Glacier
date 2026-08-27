import { requireUser } from "@/lib/auth";
import { listCategories, listPortfolios, listTransactions } from "@/lib/repo";
import { date as formatDate, money } from "@/lib/format";
import { loadContext } from "@/lib/context";
import { Section, Empty, Table, Td, Th } from "@/components/ui";
import { CreatePortfolio, PortfolioRow } from "./manage";

export const dynamic = "force-dynamic";

export default async function PortfoliosPage() {
  const user = await requireUser();
  const portfolios = listPortfolios(user.id, true);

  const rows = portfolios.map((portfolio) => {
    const context = loadContext(user.id, portfolio.id);
    return {
      portfolio,
      value: context.summary.totalValue,
      positions: context.summary.openPositions.length,
      operations: listTransactions(user.id, { portfolioId: portfolio.id }).length,
      categories: listCategories(portfolio.id).length,
    };
  });

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
      </Section>

      <Section title="Новый портфель">
        <CreatePortfolio />
      </Section>
    </div>
  );
}

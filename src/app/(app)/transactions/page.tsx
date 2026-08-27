import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listCategories, listPortfolios, listTransactions } from "@/lib/repo";
import { resolvePortfolioId } from "@/lib/context";
import { all } from "@/lib/db";
import { cashEffect } from "@/lib/domain/positions";
import { TX_TYPE_LABELS, type Instrument } from "@/lib/types";
import { date as formatDate, money, number, pnlClass } from "@/lib/format";
import { Tag, Button, Section, Empty, Table, Td, Th } from "@/components/ui";
import { PortfolioSwitcher } from "@/components/portfolio-switcher";
import { TransactionForm } from "@/components/transaction-form";
import { DeleteTransactionButton } from "./delete-button";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const portfolios = listPortfolios(user.id);
  const portfolioId = resolvePortfolioId(portfolios, params.p);

  if (portfolios.length === 0) {
    return (
      <Section>
        <Empty
          title="Сначала создайте портфель"
          action={
            <Link href="/portfolios">
              <Button>Создать портфель</Button>
            </Link>
          }
        />
      </Section>
    );
  }

  const categories = portfolios.flatMap((portfolio) => listCategories(portfolio.id));
  const transactions = listTransactions(user.id, {
    portfolioId: portfolioId ?? undefined,
    limit: 500,
  });

  const instrumentRows = all<Instrument>(
    `SELECT DISTINCT i.* FROM instruments i
       JOIN transactions t ON t.instrument_id = i.id
       JOIN portfolios p ON p.id = t.portfolio_id
      WHERE p.user_id = ?`,
    user.id,
  );
  const instruments = new Map(instrumentRows.map((instrument) => [instrument.id, instrument]));
  const portfolioNames = new Map(portfolios.map((portfolio) => [portfolio.id, portfolio.name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Сделки и операции</h1>
          <p className="text-xs text-ink-mute">
            Журнал операций — единственный источник правды. Все показатели считаются из него.
          </p>
        </div>
        <PortfolioSwitcher portfolios={portfolios} selectedId={portfolioId} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Section title="Новая операция">
          <TransactionForm
            portfolios={portfolios}
            categories={categories}
            defaultPortfolioId={portfolioId}
          />
        </Section>

        <Section
          title="История"
          subtitle={`${transactions.length} ${transactions.length === 1 ? "операция" : "операций"}`}
        >
          {transactions.length === 0 ? (
            <Empty
              title="Операций пока нет"
              hint="Добавьте первую слева или импортируйте CSV в настройках."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Дата</Th>
                  <Th>Операция</Th>
                  <Th>Актив</Th>
                  <Th align="right">Кол-во</Th>
                  <Th align="right">Цена</Th>
                  <Th align="right">Сумма</Th>
                  <Th align="right"></Th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => {
                  const instrument = transaction.instrument_id
                    ? instruments.get(transaction.instrument_id)
                    : null;
                  const effect = cashEffect(transaction);
                  return (
                    <tr key={transaction.id}>
                      <Td>
                        <div className="whitespace-nowrap text-ink-soft">
                          {formatDate(transaction.ts)}
                        </div>
                        {portfolioId === null && (
                          <div className="text-[11px] text-ink-mute">
                            {portfolioNames.get(transaction.portfolio_id)}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <Tag
                          tone={
                            transaction.type === "BUY"
                              ? "info"
                              : transaction.type === "SELL"
                                ? "warn"
                                : transaction.type === "DIVIDEND" || transaction.type === "COUPON"
                                  ? "good"
                                  : "neutral"
                          }
                        >
                          {TX_TYPE_LABELS[transaction.type]}
                        </Tag>
                        {transaction.source !== "manual" && (
                          <div className="mt-1 text-[11px] text-ink-mute">{transaction.source}</div>
                        )}
                      </Td>
                      <Td>
                        {instrument ? (
                          <>
                            <div className="font-medium text-ink">{instrument.symbol}</div>
                            <div className="max-w-[160px] truncate text-xs text-ink-mute">
                              {instrument.name}
                            </div>
                          </>
                        ) : (
                          <span className="text-ink-mute">—</span>
                        )}
                      </Td>
                      <Td align="right" className="tnum text-ink-soft">
                        {transaction.quantity ? number(transaction.quantity, 8) : "—"}
                      </Td>
                      <Td align="right" className="tnum text-ink-soft">
                        {transaction.price
                          ? money(transaction.price, transaction.currency, 2)
                          : "—"}
                      </Td>
                      <Td align="right" className={`tnum ${pnlClass(effect)}`}>
                        {money(effect, transaction.currency)}
                        {(transaction.fee > 0 || transaction.tax > 0) && (
                          <div className="text-[11px] text-ink-mute">
                            {transaction.fee > 0 && `комиссия ${number(transaction.fee, 2)}`}
                            {transaction.fee > 0 && transaction.tax > 0 && " · "}
                            {transaction.tax > 0 && `налог ${number(transaction.tax, 2)}`}
                          </div>
                        )}
                      </Td>
                      <Td align="right">
                        <DeleteTransactionButton transactionId={transaction.id} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Section>
      </div>
    </div>
  );
}

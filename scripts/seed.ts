/**
 * Demo data for a fresh install, and an end-to-end exercise of the whole stack:
 * catalog lookup against MOEX, ledger writes, quote sync, position and return
 * maths. Run with:  npm run seed
 */
import { all, get, run } from "@/lib/db";
import { createUser, findUserByEmail } from "@/lib/accounts";
import { addTransaction, createCategory, createPortfolio, listCategories } from "@/lib/repo";
import { searchSecurities, fetchSecurityDetails } from "@/lib/providers/moex";
import { upsertInstrument } from "@/lib/repo";
import { refreshFx, refreshPayouts, refreshQuotes, latestFxRates } from "@/lib/sync";
import { summarize, allocationByCategory } from "@/lib/domain/analytics";
import { buildCalendar, forwardIncome } from "@/lib/domain/payouts";
import { computeDrift } from "@/lib/domain/rebalance";
import { money, percent, signedPercent } from "@/lib/format";
import type { Instrument, Transaction } from "@/lib/types";

const EMAIL = "demo@glacier.local";
const PASSWORD = "demo12345";

const HOLDINGS = [
  { ticker: "SBER", category: "Акции РФ", quantity: 100, price: 250.4, date: "2025-02-14" },
  { ticker: "GAZP", category: "Акции РФ", quantity: 200, price: 128.9, date: "2025-03-05" },
  { ticker: "LKOH", category: "Акции РФ", quantity: 5, price: 6800, date: "2025-04-11" },
  { ticker: "SU26238RMFS4", category: "Облигации", quantity: 30, price: 520, date: "2025-05-20" },
];

async function main() {
  console.log("→ Готовим демо-данные\n");

  let user = findUserByEmail(EMAIL);
  if (user) {
    console.log(`   Пользователь ${EMAIL} уже существует, пересоздаём его портфели`);
    run("DELETE FROM portfolios WHERE user_id = ?", user.id);
  } else {
    user = createUser({ email: EMAIL, password: PASSWORD, name: "Демо", role: "admin" });
    console.log(`   Создан пользователь ${EMAIL} / ${PASSWORD}`);
  }

  const portfolio = createPortfolio(user.id, "Демо-портфель", "RUB", "Т-Инвестиции");
  createCategory(user.id, portfolio.id, "Акции РФ", 60, "#38bdf8");
  createCategory(user.id, portfolio.id, "Облигации", 40, "#34d399");
  const categories = listCategories(portfolio.id);
  const categoryId = (name: string) =>
    categories.find((category) => category.name === name)?.id ?? null;

  addTransaction(user.id, {
    portfolioId: portfolio.id,
    instrumentId: null,
    type: "DEPOSIT",
    ts: "2025-02-01",
    amount: 300_000,
    currency: "RUB",
  });

  console.log("\n→ Ищем инструменты на MOEX");
  for (const holding of HOLDINGS) {
    const found = await searchSecurities(holding.ticker, 5);
    const match = found.find((security) => security.secid === holding.ticker);
    if (!match) {
      console.log(`   ✗ ${holding.ticker} — не найден, пропускаем`);
      continue;
    }

    const details = await fetchSecurityDetails(match.secid, match.kind, match.board);
    const instrument = upsertInstrument({
      kind: match.kind,
      symbol: match.secid,
      name: details.name || match.name,
      currency: details.currency || "RUB",
      source: "moex",
      sourceId: match.board,
      board: match.board,
      exchange: "MOEX",
      country: "RU",
      isin: match.isin || null,
      lotSize: details.lotSize ?? 1,
      faceValue: details.faceValue ?? null,
      couponValue: details.couponValue ?? null,
      couponPeriod: details.couponPeriod ?? null,
      maturityDate: details.maturityDate ?? null,
    });

    console.log(
      `   ✓ ${instrument.symbol} — ${instrument.name} (${instrument.kind}, лот ${instrument.lot_size})`,
    );

    addTransaction(user.id, {
      portfolioId: portfolio.id,
      instrumentId: instrument.id,
      categoryId: categoryId(holding.category),
      type: "BUY",
      ts: holding.date,
      quantity: holding.quantity,
      price: holding.price,
      fee: Math.round(holding.quantity * holding.price * 0.0004),
      currency: "RUB",
    });
  }

  // A couple of dividends, so the payout forecast has a pattern to learn from.
  const sber = get<Instrument>("SELECT * FROM instruments WHERE symbol = 'SBER'");
  if (sber) {
    for (const [date, amount] of [
      ["2025-07-18", 3400],
      ["2026-07-17", 3550],
    ] as const) {
      addTransaction(user.id, {
        portfolioId: portfolio.id,
        instrumentId: sber.id,
        categoryId: categoryId("Акции РФ"),
        type: "DIVIDEND",
        ts: date,
        amount,
        tax: Math.round(amount * 0.13),
        currency: "RUB",
      });
    }
  }

  console.log("\n→ Загружаем курсы валют и котировки");
  const fx = await refreshFx();
  console.log(`   Курсы ЦБ: ${fx.updated}`);
  const quotes = await refreshQuotes();
  console.log(`   Котировки MOEX: обновлено ${quotes.updated}, не удалось ${quotes.failed}`);
  const payouts = await refreshPayouts();
  console.log(`   Графики купонов: ${payouts.upserted} записей`);

  // ---- Recompute everything from the ledger and print it, as the UI would.
  const transactions = all<Transaction>(
    "SELECT * FROM transactions WHERE portfolio_id = ?",
    portfolio.id,
  );
  const instrumentRows = all<Instrument>(
    `SELECT DISTINCT i.* FROM instruments i
       JOIN transactions t ON t.instrument_id = i.id
      WHERE t.portfolio_id = ?`,
    portfolio.id,
  );
  const instruments = new Map(instrumentRows.map((instrument) => [instrument.id, instrument]));
  const fxRates = latestFxRates();

  const summary = summarize({ transactions, instruments, fxRates, baseCurrency: "RUB" });

  console.log("\n────────── Итог по демо-портфелю ──────────");
  console.log(`Рыночная стоимость   ${money(summary.marketValue)}`);
  console.log(`Себестоимость        ${money(summary.costBasis)}`);
  console.log(`Свободные деньги     ${money(summary.cash)}`);
  console.log(`Полученные выплаты   ${money(summary.income)}`);
  console.log(`Комиссии / налоги    ${money(summary.feesPaid)} / ${money(summary.taxesPaid)}`);
  console.log(`Прибыль              ${money(summary.totalPnl)}`);
  console.log(`Доходность (XIRR)    ${signedPercent(summary.xirr)}`);

  console.log("\nПозиции:");
  for (const position of summary.openPositions) {
    console.log(
      `  ${position.instrument.symbol.padEnd(14)} ${String(position.quantity).padStart(6)} шт ` +
        `× ${money(position.lastPrice ?? 0, "RUB", 2).padStart(14)} = ` +
        `${money(position.marketValue * position.fxRate).padStart(14)}  ` +
        `(${signedPercent(position.costBasis > 0 ? position.unrealizedPnl / position.costBasis : null)})`,
    );
  }

  console.log("\nРаспределение по категориям:");
  for (const slice of allocationByCategory(summary.positions, categories)) {
    console.log(
      `  ${slice.label.padEnd(14)} ${percent(slice.share, 1).padStart(9)}` +
        `${slice.targetShare !== undefined ? `  цель ${percent(slice.targetShare, 0)}` : ""}`,
    );
  }

  const payoutList = all<never>("SELECT * FROM payouts");
  const calendar = buildCalendar(summary.positions, payoutList, transactions);
  console.log(
    `\nОжидаемые выплаты за 12 мес: ${money(forwardIncome(calendar, fxRates, "RUB"))} ` +
      `(${calendar.length} событий, из них объявленных ${
        calendar.filter((entry) => entry.status === "announced").length
      })`,
  );

  const drift = computeDrift(summary.positions, categories);
  console.log("\nОтклонения от целей:");
  for (const row of drift) {
    console.log(
      `  ${row.name.padEnd(14)} ${percent(row.currentShare, 1).padStart(9)} vs ` +
        `${percent(row.targetShare, 0).padStart(7)}  → ${signedPercent(row.drift, 1)}`,
    );
  }

  console.log(`\n✓ Готово. Войдите как ${EMAIL} / ${PASSWORD}`);
}

main().catch((error) => {
  console.error("\n✗ Сид завершился ошибкой:", error);
  process.exit(1);
});

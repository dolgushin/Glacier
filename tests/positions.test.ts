import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPositions, cashBalances, cashEffect } from "../src/lib/domain/positions.ts";

const instrument = {
  id: 1,
  owner_user_id: null,
  kind: "share",
  symbol: "SBER",
  name: "Сбербанк",
  currency: "RUB",
  source: "moex",
  source_id: "TQBR",
  isin: null,
  figi: null,
  exchange: "MOEX",
  board: "TQBR",
  sector: "",
  country: "RU",
  lot_size: 10,
  face_value: null,
  coupon_value: null,
  coupon_period: null,
  maturity_date: null,
  last_price: 300,
  last_price_at: null,
  meta: "{}",
  created_at: "2024-01-01",
} as never;

let nextId = 1;
function tx(partial: Record<string, unknown>) {
  return {
    id: nextId++,
    portfolio_id: 1,
    instrument_id: 1,
    category_id: null,
    type: "BUY",
    ts: "2024-01-01",
    quantity: 0,
    price: 0,
    amount: 0,
    fee: 0,
    tax: 0,
    currency: "RUB",
    fx_rate: 1,
    note: "",
    source: "manual",
    external_id: null,
    created_at: "2024-01-01",
    ...partial,
  } as never;
}

const build = (transactions: unknown[]) =>
  buildPositions({
    transactions: transactions as never,
    instruments: new Map([[1, instrument]]),
    fxRates: new Map(),
    baseCurrency: "RUB",
  });

test("average price capitalises the buy commission", () => {
  const [position] = build([
    tx({ type: "BUY", ts: "2024-01-10", quantity: 100, price: 250, fee: 100 }),
  ]);
  assert.equal(position.quantity, 100);
  // (100 * 250 + 100) / 100 = 251
  assert.equal(position.averagePrice, 251);
  assert.equal(position.costBasis, 25100);
  assert.equal(position.marketValue, 30000);
  assert.equal(position.unrealizedPnl, 4900);
});

test("FIFO consumes the oldest lot first", () => {
  const [position] = build([
    tx({ type: "BUY", ts: "2024-01-10", quantity: 100, price: 200 }),
    tx({ type: "BUY", ts: "2024-02-10", quantity: 100, price: 300 }),
    tx({ type: "SELL", ts: "2024-03-10", quantity: 100, price: 350 }),
  ]);
  // Sold the 200-rouble lot: (350 - 200) * 100 = 15000
  assert.equal(position.realizedPnl, 15000);
  assert.equal(position.quantity, 100);
  // The 300-rouble lot remains
  assert.equal(position.averagePrice, 300);
});

test("a partial sale keeps the remainder of the lot", () => {
  const [position] = build([
    tx({ type: "BUY", ts: "2024-01-10", quantity: 100, price: 200 }),
    tx({ type: "SELL", ts: "2024-03-10", quantity: 40, price: 250 }),
  ]);
  assert.equal(position.realizedPnl, 2000);
  assert.equal(position.quantity, 60);
  assert.equal(position.costBasis, 12000);
});

test("sale commission and tax reduce the realised result", () => {
  const [position] = build([
    tx({ type: "BUY", ts: "2024-01-10", quantity: 100, price: 200 }),
    tx({ type: "SELL", ts: "2024-03-10", quantity: 100, price: 250, fee: 50, tax: 650 }),
  ]);
  // (250 * 100) - 50 - 650 - (200 * 100) = 4300
  assert.equal(position.realizedPnl, 4300);
  assert.equal(position.quantity, 0);
  assert.equal(position.marketValue, 0);
});

test("a split rescales quantity and cost without inventing profit", () => {
  const [position] = build([
    tx({ type: "BUY", ts: "2024-01-10", quantity: 100, price: 200 }),
    tx({ type: "SPLIT", ts: "2024-02-01", quantity: 2 }),
  ]);
  assert.equal(position.quantity, 200);
  assert.equal(position.averagePrice, 100);
  assert.equal(position.costBasis, 20000);
});

test("dividends accumulate as income, not as cost basis", () => {
  const [position] = build([
    tx({ type: "BUY", ts: "2024-01-10", quantity: 100, price: 200 }),
    tx({ type: "DIVIDEND", ts: "2024-05-10", amount: 3400, tax: 442 }),
  ]);
  assert.equal(position.income, 3400);
  assert.equal(position.taxesPaid, 442);
  assert.equal(position.costBasis, 20000);
  // realized 0 + unrealized (30000-20000) + income 3400 - tax 442
  assert.equal(position.totalPnl, 12958);
});

test("a fully closed position reports zero quantity, not float dust", () => {
  const [position] = build([
    tx({ type: "BUY", ts: "2024-01-10", quantity: 0.1, price: 100 }),
    tx({ type: "BUY", ts: "2024-01-11", quantity: 0.2, price: 100 }),
    tx({ type: "SELL", ts: "2024-02-11", quantity: 0.3, price: 100 }),
  ]);
  assert.equal(position.quantity, 0);
  assert.equal(position.marketValue, 0);
});

test("cash effect signs are right for each transaction type", () => {
  assert.equal(cashEffect(tx({ type: "BUY", quantity: 10, price: 100, fee: 5 })), -1005);
  assert.equal(cashEffect(tx({ type: "SELL", quantity: 10, price: 100, fee: 5, tax: 10 })), 985);
  assert.equal(cashEffect(tx({ type: "DIVIDEND", amount: 500, tax: 65 })), 435);
  assert.equal(cashEffect(tx({ type: "DEPOSIT", amount: 10000 })), 10000);
  assert.equal(cashEffect(tx({ type: "WITHDRAWAL", amount: 10000 })), -10000);
  assert.equal(cashEffect(tx({ type: "FEE", amount: 99 })), -99);
  assert.equal(cashEffect(tx({ type: "SPLIT", quantity: 2 })), 0);
});

test("cash balance is derived per currency", () => {
  const balances = cashBalances([
    tx({ type: "DEPOSIT", amount: 100000, instrument_id: null }),
    tx({ type: "BUY", quantity: 100, price: 250, fee: 100 }),
    tx({ type: "DIVIDEND", amount: 3400, tax: 442 }),
  ] as never);
  // 100000 - 25100 + 2958
  assert.equal(Math.round(balances.get("RUB") as number), 77858);
});

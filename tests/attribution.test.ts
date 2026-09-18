import { test } from "node:test";
import assert from "node:assert/strict";
import { decomposePnl } from "../src/lib/domain/attribution.ts";

let nextId = 1;
function tx(partial: Record<string, unknown>) {
  return {
    id: nextId++,
    portfolio_id: 1,
    instrument_id: 1,
    type: "BUY",
    ts: "2025-01-10",
    quantity: 0,
    price: 0,
    amount: 0,
    fee: 0,
    tax: 0,
    currency: "RUB",
    fx_rate: 1,
    ...partial,
  } as never;
}

const ruble = {
  id: 1,
  kind: "share",
  symbol: "SBER",
  currency: "RUB",
  last_price: 300,
} as never;

const dollar = {
  id: 1,
  kind: "share",
  symbol: "AAPL",
  currency: "USD",
  last_price: 110,
} as never;

test("ruble instrument: everything is price, nothing is fx", () => {
  const result = decomposePnl(
    [tx({ type: "BUY", quantity: 10, price: 250 })] as never,
    new Map([[1, ruble]]),
    new Map(),
    "RUB",
  );

  assert.equal(result.price, 500); // 10 * (300 - 250)
  assert.equal(result.fx, 0);
  assert.equal(result.total, 500);
});

test("dollar instrument: price move and fx move separate exactly", () => {
  // Куплено 10 по $100 при курсе 90. Сейчас $110 и курс 100.
  const result = decomposePnl(
    [tx({ type: "BUY", quantity: 10, price: 100, currency: "USD", fx_rate: 90 })] as never,
    new Map([[1, dollar]]),
    new Map([["USD", 100]]),
    "RUB",
  );

  // Цена: 10 * ($110 − $100) * 100 = 10 000
  assert.ok(Math.abs(result.price - 10_000) < 1e-9);
  // Валюта: 10 * $110 * (100 − 90) = 11 000
  assert.ok(Math.abs(result.fx - 11_000) < 1e-9);
  // Сумма сходится с прямым расчётом: 10*110*100 − 10*100*90 = 21 000
  assert.ok(Math.abs(result.total - 21_000) < 1e-9);
});

test("closed lots land in realized, income is its own line", () => {
  const result = decomposePnl(
    [
      tx({ type: "BUY", ts: "2025-01-10", quantity: 10, price: 100 }),
      tx({ type: "DIVIDEND", ts: "2025-06-01", amount: 300 }),
      tx({ type: "SELL", ts: "2025-07-01", quantity: 10, price: 130 }),
    ] as never,
    new Map([[1, ruble]]),
    new Map(),
    "RUB",
  );

  assert.equal(result.realized, 300);
  assert.equal(result.income, 300);
  assert.equal(result.price, 0); // позиция закрыта
  assert.equal(result.total, 600);
});

test("a split rescales open lots without inventing profit", () => {
  const result = decomposePnl(
    [
      tx({ type: "BUY", ts: "2025-01-10", quantity: 10, price: 600 }),
      tx({ type: "SPLIT", ts: "2025-03-01", quantity: 2 }),
    ] as never,
    new Map([[1, ruble]]),
    new Map(),
    "RUB",
  );

  // 20 шт, себестоимость 300, текущая 300: прибыли нет.
  assert.equal(result.price, 0);
  assert.equal(result.total, 0);
});

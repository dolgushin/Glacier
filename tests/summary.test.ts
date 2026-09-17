import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../src/lib/domain/analytics.ts";

const instrument = {
  id: 1,
  kind: "share",
  symbol: "SBER",
  name: "Сбербанк",
  currency: "RUB",
  source: "moex",
  board: "TQBR",
  lot_size: 10,
  face_value: null,
  maturity_date: null,
  last_price: 300,
  last_price_at: null,
} as never;

let nextId = 1;
function tx(partial: Record<string, unknown>) {
  return {
    id: nextId++,
    portfolio_id: 1,
    instrument_id: 1,
    category_id: null,
    type: "BUY",
    ts: "2025-01-01",
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
    created_at: "2025-01-01",
    ...partial,
  } as never;
}

const sum = (transactions: unknown[]) =>
  summarize({
    transactions: transactions as never,
    instruments: new Map([[1, instrument]]),
    fxRates: new Map(),
    baseCurrency: "RUB",
  });

test("a trades-only ledger does not report a negative portfolio", () => {
  // Alor reports trades and nothing else. Summing them gives what the purchases
  // consumed, not a cash balance — the account was funded by money the ledger
  // never saw. A real one showed −142 025 ₽ as its portfolio value.
  const summary = sum([tx({ type: "BUY", ts: "2025-02-01", quantity: 100, price: 250 })]);

  assert.equal(summary.cashKnown, false);
  assert.equal(summary.totalValue, 30_000); // 100 * 300, holdings only
  assert.ok(summary.totalValue > 0);
  // The derived figure is still reported, just not added to the value.
  assert.equal(summary.cash, -25_000);
});

test("cash counts once the ledger knows where the money came from", () => {
  const summary = sum([
    tx({ type: "DEPOSIT", ts: "2025-01-01", instrument_id: null, amount: 40_000 }),
    tx({ type: "BUY", ts: "2025-02-01", quantity: 100, price: 250 }),
  ]);

  assert.equal(summary.cashKnown, true);
  assert.equal(summary.cash, 15_000); // 40 000 - 25 000
  assert.equal(summary.totalValue, 45_000); // 30 000 of shares + 15 000 free
});

test("expired contracts are not counted as open positions", () => {
  const contract = {
    ...(instrument as object),
    id: 2,
    kind: "futures",
    symbol: "SI-12.23",
    maturity_date: "2023-12-28",
    last_price: null,
  } as never;

  const summary = summarize({
    transactions: [
      tx({ type: "BUY", ts: "2023-09-01", quantity: 5, price: 90_000, instrument_id: 2 }),
      tx({ type: "DEPOSIT", ts: "2023-01-01", instrument_id: null, amount: 500_000 }),
    ] as never,
    instruments: new Map([[2, contract]]),
    fxRates: new Map(),
    baseCurrency: "RUB",
  });

  assert.equal(summary.openPositions.length, 0);
  assert.equal(summary.marketValue, 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  harvestCandidates,
  ldvUpcoming,
  taxRateFor,
  taxYear,
  taxYears,
  walkClosures,
} from "../src/lib/domain/tax.ts";

const instrument = {
  id: 1,
  kind: "share",
  symbol: "SBER",
  name: "Сбербанк",
  currency: "RUB",
  board: "TQBR",
  last_price: 300,
  maturity_date: null,
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

const instruments = new Map([[1, instrument]]);

test("a sale closes the oldest lot and reports its own dates", () => {
  const closures = walkClosures(
    [
      tx({ type: "BUY", ts: "2025-01-10", quantity: 100, price: 250 }),
      tx({ type: "BUY", ts: "2025-03-10", quantity: 100, price: 270 }),
      tx({ type: "SELL", ts: "2025-06-10", quantity: 150, price: 300 }),
    ] as never,
    instruments,
  );

  assert.equal(closures.length, 2);
  // FIFO: the January lot closes first, entirely; March loses half.
  assert.equal(closures[0].boughtAt, "2025-01-10");
  assert.equal(closures[0].quantity, 100);
  assert.equal(closures[0].pnl, 5000); // 100 * (300 - 250)
  assert.equal(closures[1].boughtAt, "2025-03-10");
  assert.equal(closures[1].quantity, 50);
  assert.equal(closures[1].pnl, 1500); // 50 * (300 - 270)
});

test("buy commission goes into cost, sell commission out of proceeds", () => {
  const [closure] = walkClosures(
    [
      tx({ type: "BUY", ts: "2025-01-10", quantity: 10, price: 100, fee: 50 }),
      tx({ type: "SELL", ts: "2025-06-10", quantity: 10, price: 120, fee: 30 }),
    ] as never,
    instruments,
  );

  assert.equal(closure.cost, 1050); // 10 * (100 + 50/10)
  assert.equal(closure.proceeds, 1170); // 10 * (120 - 30/10)
  assert.equal(closure.pnl, 120);
});

test("a lot older than three years is flagged for ЛДВ", () => {
  const [closure] = walkClosures(
    [
      tx({ type: "BUY", ts: "2021-06-01", quantity: 10, price: 100 }),
      tx({ type: "SELL", ts: "2025-06-02", quantity: 10, price: 200 }),
    ] as never,
    instruments,
  );

  assert.ok(closure.holdingDays >= 3 * 365);
  assert.equal(closure.longTermEligible, true);
});

test("foreign currency lots convert at the rate of each operation's day", () => {
  // Налоговая база по валютным бумагам — рублёвая: покупка и продажа
  // пересчитываются по курсам своих дней, валютная переоценка входит в базу.
  const usd = { ...(instrument as object), currency: "USD" } as never;
  const [closure] = walkClosures(
    [
      tx({ type: "BUY", ts: "2025-01-10", quantity: 10, price: 100, fx_rate: 90 }),
      tx({ type: "SELL", ts: "2025-06-10", quantity: 10, price: 100, fx_rate: 100 }),
    ] as never,
    new Map([[1, usd]]),
  );

  // Цена в долларах не изменилась, а рублёвая прибыль есть: 10*100*(100-90).
  assert.equal(closure.cost, 90_000);
  assert.equal(closure.proceeds, 100_000);
  assert.equal(closure.pnl, 10_000);
});

test("the year report nets gains with losses and withholdings", () => {
  const report = taxYear(
    [
      tx({ type: "BUY", ts: "2025-01-10", quantity: 10, price: 100 }),
      tx({ type: "SELL", ts: "2025-03-01", quantity: 10, price: 150 }), // +500
      tx({ type: "BUY", ts: "2025-04-01", quantity: 10, price: 200 }),
      tx({ type: "SELL", ts: "2025-05-01", quantity: 10, price: 160 }), // −400
      tx({ type: "DIVIDEND", ts: "2025-07-01", amount: 1000 }),
      tx({ type: "TAX", ts: "2025-07-01", instrument_id: null, amount: 130 }),
    ] as never,
    instruments,
    2025,
  );

  assert.equal(report.tradingGains, 500);
  assert.equal(report.tradingLosses, -400);
  assert.equal(report.tradingPnl, 100);
  assert.equal(report.dividends, 1000);
  assert.equal(report.taxWithheld, 130);
  // База 1100, налог 13 % = 143, к доплате 13.
  assert.equal(report.estimatedBase, 1100);
  assert.equal(report.estimatedTax, 143);
  assert.equal(report.estimatedDue, 13);
});

test("a losing year has no negative base and nothing to pay", () => {
  const report = taxYear(
    [
      tx({ type: "BUY", ts: "2025-01-10", quantity: 10, price: 100 }),
      tx({ type: "SELL", ts: "2025-03-01", quantity: 10, price: 50 }), // −500
    ] as never,
    instruments,
    2025,
  );

  assert.equal(report.estimatedBase, 0);
  assert.equal(report.estimatedTax, 0);
  assert.equal(report.estimatedDue, 0);
});

test("the 15% bracket kicks in above the threshold", () => {
  assert.equal(taxRateFor(2_400_000), 0.13);
  assert.equal(taxRateFor(2_400_001), 0.15);

  const report = taxYear(
    [
      tx({ type: "BUY", ts: "2025-01-10", quantity: 1000, price: 1000 }),
      tx({ type: "SELL", ts: "2025-06-01", quantity: 1000, price: 4000 }), // +3 000 000
    ] as never,
    instruments,
    2025,
  );
  // 2.4M * 13% + 0.6M * 15% = 312 000 + 90 000 = 402 000
  assert.equal(report.estimatedTax, 402_000);
});

test("tax years come from the ledger, newest first", () => {
  assert.deepEqual(
    taxYears([
      tx({ ts: "2024-05-01" }),
      tx({ ts: "2026-01-01" }),
      tx({ ts: "2024-06-01" }),
    ] as never),
    [2026, 2024],
  );
});

test("open lots approaching three years are surfaced for ЛДВ", () => {
  const upcoming = ldvUpcoming(
    [
      // Три года исполнятся 2026-11-01 — через полтора месяца, в горизонте.
      tx({ type: "BUY", ts: "2023-11-01", quantity: 10, price: 100 }),
      // Уже старше трёх лет — не «скоро», а уже имеет право, сюда не попадает.
      tx({ type: "BUY", ts: "2023-05-01", quantity: 7, price: 100 }),
      // Куплен недавно — тоже не попадает.
      tx({ type: "BUY", ts: "2026-06-01", quantity: 5, price: 100 }),
    ] as never,
    instruments,
    "2026-09-17",
  );

  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].quantity, 10);
  assert.equal(upcoming[0].eligibleAt, "2026-11-01"); // 2023-11-01 + 3 года
});

test("harvest candidates are losing, counted positions, worst first", () => {
  const candidates = harvestCandidates([
    {
      instrument: { ...(instrument as object), symbol: "LOSER" },
      quantity: 10,
      unrealizedPnl: -5000,
      currency: "RUB",
      fxRate: 1,
      anomaly: null,
    },
    {
      instrument: { ...(instrument as object), symbol: "WINNER" },
      quantity: 10,
      unrealizedPnl: 9000,
      currency: "RUB",
      fxRate: 1,
      anomaly: null,
    },
    {
      // Исключённая позиция не годится: её цифрам нельзя верить.
      instrument: { ...(instrument as object), symbol: "BROKEN" },
      quantity: 10,
      unrealizedPnl: -99_000,
      currency: "RUB",
      fxRate: 1,
      anomaly: "suspect-split",
    },
  ] as never);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].symbol, "LOSER");
});

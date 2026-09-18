import { test } from "node:test";
import assert from "node:assert/strict";
import { seriesChange, twr } from "../src/lib/domain/twr.ts";

let nextId = 1;
function tx(partial: Record<string, unknown>) {
  return {
    id: nextId++,
    portfolio_id: 1,
    instrument_id: null,
    type: "DEPOSIT",
    ts: "2025-01-01",
    amount: 0,
    quantity: 0,
    price: 0,
    fee: 0,
    tax: 0,
    currency: "RUB",
    fx_rate: 1,
    ...partial,
  } as never;
}

test("no flows: TWR is the plain growth of the series", () => {
  const series = [
    { date: "2025-01-01", value: 100, invested: 100 },
    { date: "2025-01-02", value: 110, invested: 100 },
  ];
  assert.ok(Math.abs(twr(series, [])! - 0.1) < 1e-12);
});

test("a deposit does not become return", () => {
  // День 1: 100 → 110 (+10 %). День 2: внесено 1000, закрытие 1110.
  // XIRR скажет «заработал», рынок тут ни при чём. TWR обязан сказать +10 %.
  const series = [
    { date: "2025-01-01", value: 100, invested: 100 },
    { date: "2025-01-02", value: 110, invested: 100 },
    { date: "2025-01-03", value: 1110, invested: 1100 },
  ];
  const flows = [tx({ type: "DEPOSIT", ts: "2025-01-03", amount: 1000 })];

  assert.ok(Math.abs(twr(series, flows)! - 0.1) < 1e-9);
});

test("a withdrawal shrinks the base, not the return", () => {
  // День 2: вывод 50 при стоимости до потока 110 (+10 %). Осталось 60.
  // День 3: 60 → 66 (ещё +10 %). Участки перемножаются: 1.1 × 1.1 = +21 %.
  const series = [
    { date: "2025-01-01", value: 100, invested: 100 },
    { date: "2025-01-02", value: 60, invested: 50 },
    { date: "2025-01-03", value: 66, invested: 50 },
  ];
  const flows = [tx({ type: "WITHDRAWAL", ts: "2025-01-02", amount: 50 })];

  assert.ok(Math.abs(twr(series, flows)! - 0.21) < 1e-9);
});

test("income inside the series counts as return, not as a flow", () => {
  // Купон не DEPOSIT: потоков нет, рост 100 → 103 это доходность +3 %.
  const series = [
    { date: "2025-01-01", value: 100, invested: 100 },
    { date: "2025-01-02", value: 103, invested: 100 },
  ];
  assert.ok(Math.abs(twr(series, [])! - 0.03) < 1e-12);
});

test("single point says nothing", () => {
  assert.equal(twr([{ date: "2025-01-01", value: 100, invested: 100 }], []), null);
});

test("seriesChange measures the window from the first covered date", () => {
  const history = new Map([
    ["2024-12-30", 1000], // до начала окна — не участвует
    ["2025-01-05", 2000],
    ["2025-06-01", 2400],
  ]);
  assert.ok(Math.abs(seriesChange(history, "2025-01-01")! - 0.2) < 1e-12);
  assert.equal(seriesChange(new Map(), "2025-01-01"), null);
  assert.equal(seriesChange(history, "2026-01-01"), null);
});

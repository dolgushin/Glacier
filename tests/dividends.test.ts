import { test } from "node:test";
import assert from "node:assert/strict";
import { dividendMatrix, payoutSustainability } from "../src/lib/domain/payouts.ts";

const instrument = {
  id: 1,
  kind: "share",
  symbol: "SBER",
  name: "Сбербанк",
  currency: "RUB",
  last_price: 300,
} as never;

let nextId = 1;
function tx(partial: Record<string, unknown>) {
  return {
    id: nextId++,
    portfolio_id: 1,
    instrument_id: 1,
    type: "DIVIDEND",
    ts: "2025-06-15",
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

test("matrix groups income into year × month and caps the current year", () => {
  const matrix = dividendMatrix(
    [
      tx({ ts: "2025-01-15", amount: 100 }),
      tx({ ts: "2025-01-20", amount: 50 }), // тот же месяц — складывается
      tx({ ts: "2025-06-15", amount: 200 }),
      tx({ ts: "2024-06-15", amount: 150 }),
    ] as never,
    "2025-07-01",
  );

  assert.equal(matrix.length, 2);
  const [y2025, y2024] = matrix; // новые годы первыми
  assert.equal(y2025.year, 2025);
  assert.equal(y2025.months[0], 150); // январь 100 + 50
  assert.equal(y2025.months[5], 200); // июнь
  assert.equal(y2025.months[6], 0); // июль — текущий месяц, виден как ноль
  assert.equal(y2025.months[7], null); // август 2025 ещё не наступил
  assert.equal(y2025.months[3], 0); // апрель наступил — честный ноль
  assert.equal(y2024.months[3], 0);
  assert.equal(y2024.total, 150);
});

test("streak counts unbroken payment years backwards from the last one", () => {
  const [row] = payoutSustainability(
    [
      tx({ ts: "2022-06-15", amount: 100 }),
      tx({ ts: "2023-06-15", amount: 100 }),
      // 2024 провален
      tx({ ts: "2025-06-15", amount: 100 }),
      tx({ ts: "2026-06-15", amount: 100 }),
    ] as never,
    new Map([[1, instrument]]),
    "2026-09-18",
  );

  assert.equal(row.streak, 2); // 2025–2026, серия 2022–2023 оборвана
});

test("growing, falling and interrupted are told apart", () => {
  const growing = payoutSustainability(
    [
      tx({ ts: "2024-09-20", amount: 100 }),
      tx({ ts: "2025-09-20", amount: 200 }),
      tx({ ts: "2026-09-10", amount: 200 }),
    ] as never,
    new Map([[1, instrument]]),
    "2026-09-18",
  );
  assert.equal(growing[0].trend, "growing");

  const falling = payoutSustainability(
    [
      // Трейлинг-год: 300 + 50 = 350; предыдущий год: 600. Снижение вдвое.
      tx({ ts: "2024-09-25", amount: 600 }),
      tx({ ts: "2025-09-20", amount: 300 }),
      tx({ ts: "2026-09-10", amount: 50 }),
    ] as never,
    new Map([[1, instrument]]),
    "2026-09-18",
  );
  assert.equal(falling[0].trend, "falling");

  // Последняя выплата больше полутора лет назад — бумага перестала платить.
  const interrupted = payoutSustainability(
    [
      tx({ ts: "2023-06-15", amount: 100 }),
      tx({ ts: "2024-06-15", amount: 100 }),
    ] as never,
    new Map([[1, instrument]]),
    "2026-09-18",
  );
  assert.equal(interrupted[0].trend, "interrupted");
});

test("one payment is a fact, not a trend", () => {
  const [row] = payoutSustainability(
    [tx({ ts: "2026-06-15", amount: 100 })] as never,
    new Map([[1, instrument]]),
    "2026-09-18",
  );
  assert.equal(row.trend, "insufficient");
});

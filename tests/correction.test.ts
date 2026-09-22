import { test } from "node:test";
import assert from "node:assert/strict";
import { correctionRatio } from "../src/lib/domain/correction.ts";

test("broker fewer than ledger: the consolidation coefficient", () => {
  // VTBR как в реальном счёте: 9 336 в журнале, 340 у брокера.
  const result = correctionRatio(9_336.0044, 340);
  assert.ok("ratio" in result);
  assert.ok(Math.abs(result.ratio - 340 / 9_336.0044) < 1e-12);
  assert.ok(result.ratio < 1);
});

test("equal quantities are not a correction", () => {
  const result = correctionRatio(100, 100);
  assert.ok("error" in result);
});

test("broker MORE than ledger is refused: those are missing buys, not a split", () => {
  const result = correctionRatio(100, 150);
  assert.ok("error" in result);
  assert.match(result.error, /покупки/);
});

test("zero at the broker means a full write-off and is allowed", () => {
  const result = correctionRatio(100, 0);
  assert.ok("ratio" in result);
  assert.equal(result.ratio, 0);
});

test("absurd coefficients and broken inputs are rejected", () => {
  assert.ok("error" in correctionRatio(10_000_000, 1)); // ratio 1e-7 — не консолидация
  assert.ok("error" in correctionRatio(0, 100)); // нечего масштабировать
  assert.ok("error" in correctionRatio(100, -5)); // мусорные данные
});

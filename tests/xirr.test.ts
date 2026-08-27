import { test } from "node:test";
import assert from "node:assert/strict";
import { xirr } from "../src/lib/domain/xirr.ts";

const close = (actual: number | null, expected: number, tolerance = 1e-6) => {
  assert.notEqual(actual, null, "expected a rate, got null");
  assert.ok(
    Math.abs((actual as number) - expected) < tolerance,
    `expected ~${expected}, got ${actual}`,
  );
};

test("exact one-year 10% gain", () => {
  close(
    xirr([
      { date: "2021-01-01", amount: -1000 },
      { date: "2022-01-01", amount: 1100 },
    ]),
    0.1,
  );
});

test("matches the documented Excel XIRR example", () => {
  // Microsoft's own worked example: expected 0.373362535
  close(
    xirr([
      { date: "2008-01-01", amount: -10000 },
      { date: "2008-03-01", amount: 2750 },
      { date: "2008-10-30", amount: 4250 },
      { date: "2009-02-15", amount: 3250 },
      { date: "2009-04-01", amount: 2750 },
    ]),
    0.373362535,
    1e-6,
  );
});

test("handles a loss", () => {
  close(
    xirr([
      { date: "2021-01-01", amount: -1000 },
      { date: "2022-01-01", amount: 800 },
    ]),
    -0.2,
  );
});

test("handles a total loss without diverging", () => {
  const rate = xirr([
    { date: "2021-01-01", amount: -1000 },
    { date: "2022-01-01", amount: 0.01 },
  ]);
  assert.notEqual(rate, null);
  assert.ok((rate as number) < -0.99, `expected near -100%, got ${rate}`);
});

test("handles sign-alternating flows where Newton's method diverges", () => {
  // Buy, sell out completely, buy back in, end with a terminal value.
  const rate = xirr([
    { date: "2020-01-01", amount: -1000 },
    { date: "2020-06-01", amount: 1400 },
    { date: "2021-01-01", amount: -1600 },
    { date: "2023-01-01", amount: 2100 },
  ]);
  assert.notEqual(rate, null);
  assert.ok(Number.isFinite(rate as number));
  // Sanity: reinvesting the gain and ending up ahead must beat zero.
  assert.ok((rate as number) > 0, `expected a positive rate, got ${rate}`);
});

test("monthly contributions then a terminal value", () => {
  const flows = [];
  for (let month = 0; month < 12; month++) {
    flows.push({ date: `2023-${String(month + 1).padStart(2, "0")}-01`, amount: -10000 });
  }
  flows.push({ date: "2024-01-01", amount: 132000 });
  const rate = xirr(flows);
  assert.notEqual(rate, null);
  // ~120k invested on average for ~half a year, +12k profit -> roughly 19% годовых
  assert.ok((rate as number) > 0.15 && (rate as number) < 0.25, `got ${rate}`);
});

test("returns null when all flows share a sign", () => {
  assert.equal(
    xirr([
      { date: "2021-01-01", amount: -100 },
      { date: "2022-01-01", amount: -100 },
    ]),
    null,
  );
});

test("returns null for a single flow", () => {
  assert.equal(xirr([{ date: "2021-01-01", amount: -100 }]), null);
});

test("returns null when every flow lands on the same day", () => {
  assert.equal(
    xirr([
      { date: "2021-01-01", amount: -100 },
      { date: "2021-01-01", amount: 120 },
    ]),
    null,
  );
});

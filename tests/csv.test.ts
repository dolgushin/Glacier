import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/lib/import/csv.ts";

test("parses a semicolon file with Russian headers", () => {
  const result = parseCsv(
    [
      "дата;тип;тикер;количество;цена;комиссия;налог;валюта",
      "15.01.2026;покупка;SBER;100;250,40;25;0;RUB",
      "20.05.2026;дивиденд;SBER;;;0;442;RUB",
    ].join("\n"),
  );

  // The dividend row has no amount column, so it is rejected rather than
  // imported as a zero-value payout.
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].type, "BUY");
  assert.equal(result.rows[0].date, "2026-01-15");
  assert.equal(result.rows[0].price, 250.4);
  assert.equal(result.rows[0].amount, 25040);
  assert.equal(result.errors.length, 1);
});

test("parses comma-delimited English headers", () => {
  const result = parseCsv(
    ["date,type,symbol,quantity,price", "2026-01-15,buy,SBER,100,250.40"].join("\n"),
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].symbol, "SBER");
  assert.equal(result.rows[0].quantity, 100);
});

test("handles both decimal conventions", () => {
  const result = parseCsv(
    [
      "date;type;symbol;quantity;price",
      "2026-01-15;buy;SBER;1;1 234,56",
      "2026-01-16;buy;SBER;1;1,234.56",
      "2026-01-17;buy;SBER;1;1234.56",
    ].join("\n"),
  );
  assert.equal(result.rows.length, 3);
  for (const row of result.rows) assert.equal(row.price, 1234.56);
});

test("respects quoted fields containing the delimiter", () => {
  const result = parseCsv(
    [
      "date;type;symbol;quantity;price;note",
      '2026-01-15;buy;SBER;100;250;"Куплено дёшево; довольно"',
    ].join("\n"),
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].note, "Куплено дёшево; довольно");
});

test("cash operations need no ticker", () => {
  const result = parseCsv(
    ["date;type;amount", "2026-01-10;пополнение;300000"].join("\n"),
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].type, "DEPOSIT");
  assert.equal(result.rows[0].amount, 300000);
});

test("a negative amount keeps its magnitude; the type decides the sign", () => {
  const result = parseCsv(["date;type;amount", "2026-01-10;вывод;-50000"].join("\n"));
  assert.equal(result.rows[0].type, "WITHDRAWAL");
  assert.equal(result.rows[0].amount, 50000);
});

test("reports the offending line instead of skipping it silently", () => {
  const result = parseCsv(
    [
      "date;type;symbol;quantity;price",
      "2026-01-15;buy;SBER;100;250",
      "не-дата;buy;GAZP;10;100",
      "2026-01-17;телепортация;LKOH;1;100",
      "2026-01-18;buy;;10;100",
    ].join("\n"),
  );

  assert.equal(result.rows.length, 1);
  assert.equal(result.errors.length, 3);
  assert.deepEqual(
    result.errors.map((issue) => issue.line),
    [3, 4, 5],
  );
  assert.match(result.errors[1].message, /Неизвестный тип/);
  assert.match(result.errors[2].message, /тикер/);
});

test("rejects a file with no recognisable date column", () => {
  const result = parseCsv(["a;b;c", "1;2;3"].join("\n"));
  assert.equal(result.rows.length, 0);
  assert.match(result.errors[0].message, /дат/);
});

test("strips a UTF-8 BOM and tolerates CRLF", () => {
  const result = parseCsv("﻿date;type;amount\r\n2026-01-10;deposit;1000\r\n");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].amount, 1000);
});

test("derives the trade amount when the column is absent", () => {
  const result = parseCsv(
    ["date;type;symbol;quantity;price", "2026-01-15;buy;SBER;3;100,5"].join("\n"),
  );
  assert.equal(result.rows[0].amount, 301.5);
});

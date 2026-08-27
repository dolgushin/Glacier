import { test } from "node:test";
import assert from "node:assert/strict";
import {
  kindFromBoard,
  marketOf,
  portfoliosFromJwt,
  splitAccountId,
} from "../src/lib/brokers/alor.ts";

/**
 * The Alor adapter cannot be exercised end to end without a real token, but the
 * parts that decide what an operation *means* — which portfolios a token can
 * see, and what kind of instrument a board code refers to — are pure and worth
 * pinning. A bond misread as a share corrupts the position, not just the label.
 */

function makeJwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${body}.signature`;
}

test("reads portfolios from a space-separated JWT claim", () => {
  const jwt = makeJwt({ sub: "P00000", portfolios: "D39004 G39004 7500ABC" });
  assert.deepEqual(portfoliosFromJwt(jwt), ["D39004", "G39004", "7500ABC"]);
});

test("reads portfolios from an array claim", () => {
  const jwt = makeJwt({ portfolios: ["D39004", "7500ABC"] });
  assert.deepEqual(portfoliosFromJwt(jwt), ["D39004", "7500ABC"]);
});

test("falls back to the agreements claim", () => {
  const jwt = makeJwt({ agreements: "D39004" });
  assert.deepEqual(portfoliosFromJwt(jwt), ["D39004"]);
});

test("returns nothing rather than throwing on a malformed token", () => {
  assert.deepEqual(portfoliosFromJwt("not-a-jwt"), []);
  assert.deepEqual(portfoliosFromJwt("a.!!!not-base64!!!.c"), []);
  assert.deepEqual(portfoliosFromJwt(""), []);
  assert.deepEqual(portfoliosFromJwt(makeJwt({ sub: "P1" })), []);
});

test("names the market from the portfolio code prefix", () => {
  assert.equal(marketOf("D39004"), "Фондовый рынок");
  assert.equal(marketOf("G39004"), "Валютный рынок");
  assert.equal(marketOf("7500ABC"), "Срочный рынок");
  assert.equal(marketOf("ZZZ"), "Счёт");
});

test("bond boards are not mistaken for shares", () => {
  for (const board of ["TQCB", "TQOB", "TQIR", "TQRD"]) {
    assert.equal(kindFromBoard(board), "bond", board);
  }
});

test("fund and share boards map to their own kinds", () => {
  assert.equal(kindFromBoard("TQTF"), "etf");
  assert.equal(kindFromBoard("TQIF"), "etf");
  assert.equal(kindFromBoard("TQBR"), "share");
  assert.equal(kindFromBoard("SMAL"), "share");
  // Unknown board: a share is the safe default on the stock market.
  assert.equal(kindFromBoard(""), "share");
});

test("account id carries the exchange alongside the portfolio", () => {
  assert.deepEqual(splitAccountId("MOEX:D39004"), { exchange: "MOEX", portfolio: "D39004" });
  assert.deepEqual(splitAccountId("SPBX:D39004"), { exchange: "SPBX", portfolio: "D39004" });
  // A bare code from an older mapping still resolves.
  assert.deepEqual(splitAccountId("D39004"), { exchange: "MOEX", portfolio: "D39004" });
});

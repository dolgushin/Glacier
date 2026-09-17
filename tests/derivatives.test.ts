import { test } from "node:test";
import assert from "node:assert/strict";
import { derivativeKind, expiryFromSymbol } from "../src/lib/brokers/derivatives.ts";
import { kindFromBoard } from "../src/lib/brokers/alor.ts";

// Tickers taken verbatim from a real Alor account that reported all of them
// as "Акция" with no price.
const FUTURES = [
  "SI-12.23", "GAZR-3.24", "BR-12.23", "NG-10.23", "SBRF-12.23",
  "GOLD-3.24", "RTS-9.26", "USDRUBF", "CNYRUBF",
];
const OPTIONS = ["RTS-9.26M160726CA105000", "SI-9.26M170926CA86000"];
const SECURITIES = ["SBER", "VTBR", "GAZP", "LKOH", "TGLD", "SU26238RMFS4"];

test("dated and perpetual futures are recognised from the ticker alone", () => {
  for (const symbol of FUTURES) {
    assert.equal(derivativeKind(symbol), "futures", symbol);
  }
});

test("option contracts are told apart from the futures they settle into", () => {
  for (const symbol of OPTIONS) {
    assert.equal(derivativeKind(symbol), "option", symbol);
  }
});

test("ordinary securities are not mistaken for contracts", () => {
  for (const symbol of SECURITIES) {
    assert.equal(derivativeKind(symbol), null, symbol);
  }
});

test("the board wins over the ticker when the broker sends one", () => {
  assert.equal(derivativeKind("SBER", "RFUD"), "futures");
  assert.equal(derivativeKind("SBER", "ROPD"), "option");
  assert.equal(derivativeKind("SBER", "TQBR"), null);
});

test("Alor classifies contracts even with the board field empty", () => {
  // Alor's trade feed routinely omits the board; before this, everything
  // unrecognised fell through to "share".
  assert.equal(kindFromBoard("", "SI-12.23"), "futures");
  assert.equal(kindFromBoard("", "SI-9.26M170926CA86000"), "option");
  assert.equal(kindFromBoard("", "SBER"), "share");
  assert.equal(kindFromBoard("TQCB", "SU26238RMFS4"), "bond");
});

test("expiry is read off a dated contract", () => {
  assert.equal(expiryFromSymbol("SI-12.23"), "2023-12-28");
  assert.equal(expiryFromSymbol("GAZR-3.24"), "2024-03-28");
  assert.equal(expiryFromSymbol("USDRUBF"), null);
  assert.equal(expiryFromSymbol("SBER"), null);
});

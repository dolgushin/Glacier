import { test } from "node:test";
import assert from "node:assert/strict";
import { signQuery, splitPair } from "../src/lib/brokers/binance.ts";
import { sign, signaturePayload } from "../src/lib/brokers/bybit.ts";

/**
 * A wrong request signature is the single most common way a broker integration
 * fails, and it fails identically to a wrong key — "401, check your credentials"
 * — which sends you looking in the wrong place. Binance publishes a worked
 * example in its API docs, so that one is pinned exactly.
 */

test("Binance signature matches the worked example from the API docs", () => {
  const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
  const query =
    "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1" +
    "&recvWindow=5000&timestamp=1499827319559";

  assert.equal(
    signQuery(query, secret),
    "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71",
  );
});

test("Binance signature is sensitive to the exact query text", () => {
  const secret = "secret";
  // Reordering produces a different signature: the string must be signed as sent.
  assert.notEqual(signQuery("a=1&b=2", secret), signQuery("b=2&a=1", secret));
});

test("Binance pair splitting recognises the quote asset", () => {
  assert.deepEqual(splitPair("BTCUSDT"), { base: "BTC", quote: "USDT" });
  assert.deepEqual(splitPair("ETHBTC"), { base: "ETH", quote: "BTC" });
  assert.deepEqual(splitPair("SOLFDUSD"), { base: "SOL", quote: "FDUSD" });
});

test("Binance pair splitting refuses to guess", () => {
  // No known quote asset suffix, and a bare quote asset is not a pair.
  assert.equal(splitPair("WEIRDTOKEN"), null);
  assert.equal(splitPair("USDT"), null);
});

test("Bybit signs timestamp, key, recv window and query in that order", () => {
  assert.equal(
    signaturePayload("1700000000000", "myKey", "20000", "category=spot&limit=100"),
    "1700000000000myKey20000category=spot&limit=100",
  );
});

test("Bybit signature is a stable HMAC-SHA256 hex digest", () => {
  const payload = signaturePayload("1700000000000", "myKey", "20000", "category=spot");
  const signature = sign(payload, "mySecret");

  assert.match(signature, /^[0-9a-f]{64}$/);
  // Deterministic for the same inputs, different for a different secret.
  assert.equal(signature, sign(payload, "mySecret"));
  assert.notEqual(signature, sign(payload, "otherSecret"));
});

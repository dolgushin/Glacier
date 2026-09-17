import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cronSecretMatches,
  describeRound,
  parseIntervalMinutes,
} from "../src/lib/brokers/scheduler.ts";

test("interval falls back to the default on garbage and on absurd values", () => {
  assert.equal(parseIntervalMinutes(undefined), 60);
  assert.equal(parseIntervalMinutes(""), 60);
  assert.equal(parseIntervalMinutes("abc"), 60);
  assert.equal(parseIntervalMinutes("0"), 60);
  // Below the floor is a rate-limit fire, not a preference.
  assert.equal(parseIntervalMinutes("1"), 60);
});

test("interval accepts sane values, rounded down", () => {
  assert.equal(parseIntervalMinutes("30"), 30);
  assert.equal(parseIntervalMinutes("5"), 5);
  assert.equal(parseIntervalMinutes("90.7"), 90);
});

test("cron secret comparison is exact and never passes on empty", () => {
  assert.equal(cronSecretMatches("s3cret", "s3cret"), true);
  assert.equal(cronSecretMatches("s3cret", "S3CRET"), false);
  assert.equal(cronSecretMatches("s3cret ", "s3cret"), false);
  assert.equal(cronSecretMatches("", "s3cret"), false);
  assert.equal(cronSecretMatches("s3cret", ""), false);
  assert.equal(cronSecretMatches("", ""), false);
});

test("round summary names errors when there are any", () => {
  const clean = describeRound({ users: 2, accounts: 3, inserted: 14, errors: [] });
  assert.equal(clean, "пользователей: 2, счетов: 3, новых операций: 14");

  const dirty = describeRound({ users: 1, accounts: 1, inserted: 0, errors: ["токен истёк"] });
  assert.match(dirty, /ошибки: токен истёк/);
});

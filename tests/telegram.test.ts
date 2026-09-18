import { test } from "node:test";
import assert from "node:assert/strict";
import { handleUpdate } from "../src/lib/telegram.ts";

// DB-ветки (/start с кодом, /week) требуют базы и покрываются вживую;
// здесь — контракт разбора: что отвечаем и что игнорируем.

test("an update without a text message is ignored", () => {
  assert.equal(handleUpdate({}), null);
  assert.equal(handleUpdate({ message: {} }), null);
  assert.equal(handleUpdate({ message: { text: "hi" } }), null); // нет chat id
});

test("plain chatter is not a command", () => {
  assert.equal(
    handleUpdate({ message: { text: "привет", chat: { id: 42 } } }),
    null,
  );
});

test("/start without a code asks for one", () => {
  const result = handleUpdate({ message: { text: "/start", chat: { id: 42 } } });
  assert.equal(result?.chatId, "42");
  assert.match(result?.reply ?? "", /код/i);
});

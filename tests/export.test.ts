import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, csvDocument, exportFilename } from "../src/lib/export/csv.ts";

test("plain values pass through, specials get quoted", () => {
  assert.equal(csvCell("Сбербанк"), "Сбербанк");
  assert.equal(csvCell(123.45), "123.45");
  // Разделитель внутри значения — ячейка в кавычках.
  assert.equal(csvCell("а;б"), '"а;б"');
  // Кавычка удваивается.
  assert.equal(csvCell('фонд "Альфа"'), '"фонд ""Альфа"""');
  // Перенос строки тоже требует кавычек.
  assert.equal(csvCell("a\nb"), '"a\nb"');
});

test("document starts with a BOM and joins rows with CRLF", () => {
  const doc = csvDocument(["Один", "Два"], [["1", "2"], ["3", "4"]]);
  assert.ok(doc.charCodeAt(0) === 0xfeff, "первый символ — BOM для Excel");
  assert.match(doc, /Один;Два\r\n1;2\r\n3;4\r\n$/);
});

test("filename carries the kind and the date", () => {
  assert.equal(
    exportFilename("positions", new Date("2026-09-18T12:00:00Z")),
    "glacier-positions-2026-09-18.csv",
  );
});

/**
 * Экспорт данных пользователя в CSV.
 *
 * Формат — зеркальный нашему же импорту: разделитель «;» (русская локаль
 * Excel), UTF-8 с BOM, чтобы Excel открывал кириллицу без танцев. Числа —
 * как есть, с точкой: наш импорт понимает оба формата, а «обратная
 * совместимость с самим собой» означает, что выгруженное можно загрузить
 * обратно без потерь.
 */

const BOM = "﻿";

/** Одна ячейка: кавычки удваиваются, всё со спецсимволами оборачивается. */
export function csvCell(value: string | number): string {
  const text = String(value);
  if (/[";\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvDocument(header: string[], rows: (string | number)[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(";"));
  return BOM + lines.join("\r\n") + "\r\n";
}

/** Имя файла для Content-Disposition: ASCII-транслит + дата. */
export function exportFilename(what: string, date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  return `glacier-${what}-${stamp}.csv`;
}

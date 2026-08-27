import type { TxType } from "@/lib/types";

/**
 * CSV import.
 *
 * Deliberately forgiving about column naming and number formatting: people
 * paste from Excel, from a broker report, from another tracker. Anything that
 * cannot be understood becomes a reported error row rather than a silent skip —
 * a partial import you were not told about is worse than a failed one.
 */

export interface ParsedRow {
  line: number;
  date: string;
  type: TxType;
  symbol: string;
  source: "moex" | "coingecko" | "manual";
  name: string;
  quantity: number;
  price: number;
  amount: number;
  fee: number;
  tax: number;
  currency: string;
  note: string;
  externalId: string | null;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: { line: number; message: string }[];
}

/** Header aliases, lowercased. */
const COLUMNS: Record<string, string[]> = {
  date: ["date", "дата", "дата сделки", "datetime", "ts"],
  type: ["type", "тип", "операция", "тип операции", "operation"],
  symbol: ["symbol", "ticker", "тикер", "код", "secid", "инструмент"],
  name: ["name", "название", "наименование"],
  quantity: ["quantity", "qty", "количество", "кол-во", "штук"],
  price: ["price", "цена", "цена за штуку"],
  amount: ["amount", "сумма", "итого", "payment"],
  fee: ["fee", "commission", "комиссия"],
  tax: ["tax", "налог", "ндфл"],
  currency: ["currency", "валюта", "cur"],
  note: ["note", "comment", "комментарий", "примечание"],
  source: ["source", "источник", "биржа", "exchange"],
  externalId: ["id", "external_id", "operation_id", "идентификатор"],
};

const TYPE_ALIASES: Record<string, TxType> = {
  buy: "BUY", покупка: "BUY", купля: "BUY", приобретение: "BUY",
  sell: "SELL", продажа: "SELL",
  dividend: "DIVIDEND", дивиденд: "DIVIDEND", дивиденды: "DIVIDEND",
  coupon: "COUPON", купон: "COUPON",
  amortization: "AMORTIZATION", амортизация: "AMORTIZATION",
  redemption: "REDEMPTION", погашение: "REDEMPTION",
  deposit: "DEPOSIT", пополнение: "DEPOSIT", ввод: "DEPOSIT", внесение: "DEPOSIT",
  withdrawal: "WITHDRAWAL", вывод: "WITHDRAWAL", снятие: "WITHDRAWAL",
  fee: "FEE", комиссия: "FEE",
  tax: "TAX", налог: "TAX",
  interest: "INTEREST", проценты: "INTEREST",
  split: "SPLIT", сплит: "SPLIT",
};

/** Split one CSV line, honouring quoted fields containing the delimiter. */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/** "1 234,56" and "1,234.56" both mean the same thing to a human. */
function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[\s ]/g, "").replace(/[^\d.,\-]/g, "");
  if (!cleaned) return 0;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalised: string;

  if (lastComma > lastDot) {
    // Comma is the decimal separator: strip dots used as thousands separators.
    normalised = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalised = cleaned.replace(/,/g, "");
  }

  const value = Number(normalised);
  return Number.isFinite(value) ? value : 0;
}

/** Accepts ISO, DD.MM.YYYY and DD/MM/YYYY. */
function parseDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

export function parseCsv(content: string): ParseResult {
  const clean = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = clean.split("\n").filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return { rows: [], errors: [{ line: 0, message: "Файл пуст или содержит только заголовок" }] };
  }

  // Pick whichever delimiter appears most often in the header.
  const header = lines[0];
  const delimiter = [";", ",", "\t"]
    .map((candidate) => ({ candidate, count: header.split(candidate).length }))
    .sort((a, b) => b.count - a.count)[0].candidate;

  const headerCells = splitLine(header, delimiter).map((cell) => cell.toLowerCase());
  const index: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMNS)) {
    const position = headerCells.findIndex((cell) => aliases.includes(cell));
    if (position >= 0) index[field] = position;
  }

  const errors: { line: number; message: string }[] = [];
  if (index.date === undefined) errors.push({ line: 1, message: "Не найдена колонка с датой" });
  if (index.type === undefined) errors.push({ line: 1, message: "Не найдена колонка с типом операции" });
  if (errors.length > 0) return { rows: [], errors };

  const rows: ParsedRow[] = [];
  const cell = (cells: string[], field: string): string =>
    index[field] !== undefined ? (cells[index[field]] ?? "") : "";

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const cells = splitLine(lines[i], delimiter);

    const date = parseDate(cell(cells, "date"));
    if (!date) {
      errors.push({ line: lineNumber, message: `Не разобрана дата: «${cell(cells, "date")}»` });
      continue;
    }

    const typeRaw = cell(cells, "type").toLowerCase();
    const type = TYPE_ALIASES[typeRaw];
    if (!type) {
      errors.push({ line: lineNumber, message: `Неизвестный тип операции: «${cell(cells, "type")}»` });
      continue;
    }

    const symbol = cell(cells, "symbol").toUpperCase();
    const cashOnly = type === "DEPOSIT" || type === "WITHDRAWAL" || type === "FEE" || type === "TAX";
    if (!cashOnly && !symbol) {
      errors.push({ line: lineNumber, message: "Для этой операции нужен тикер" });
      continue;
    }

    const quantity = parseNumber(cell(cells, "quantity"));
    const price = parseNumber(cell(cells, "price"));
    const amountCell = parseNumber(cell(cells, "amount"));
    // Amount may be omitted for trades: derive it, and take it as absolute —
    // the sign is decided by the operation type, not by the file.
    const amount =
      type === "BUY" || type === "SELL"
        ? quantity * price
        : Math.abs(amountCell);

    if ((type === "BUY" || type === "SELL") && (quantity <= 0 || price <= 0)) {
      errors.push({ line: lineNumber, message: "Для сделки нужны количество и цена больше нуля" });
      continue;
    }
    if (!["BUY", "SELL", "SPLIT"].includes(type) && amount <= 0) {
      errors.push({ line: lineNumber, message: "Не указана сумма операции" });
      continue;
    }

    const sourceRaw = cell(cells, "source").toLowerCase();
    const source: ParsedRow["source"] =
      sourceRaw.includes("coin") || sourceRaw.includes("crypto")
        ? "coingecko"
        : sourceRaw.includes("manual") || sourceRaw.includes("прочее")
          ? "manual"
          : "moex";

    rows.push({
      line: lineNumber,
      date,
      type,
      symbol,
      source,
      name: cell(cells, "name") || symbol,
      quantity,
      price,
      amount,
      fee: Math.abs(parseNumber(cell(cells, "fee"))),
      tax: Math.abs(parseNumber(cell(cells, "tax"))),
      currency: (cell(cells, "currency") || "RUB").toUpperCase().replace("SUR", "RUB"),
      note: cell(cells, "note"),
      externalId: cell(cells, "externalId") || null,
    });
  }

  return { rows, errors };
}

export const CSV_TEMPLATE = `date;type;symbol;quantity;price;amount;fee;tax;currency;note
2026-01-10;deposit;;;;300000;0;0;RUB;Пополнение счёта
2026-01-15;buy;SBER;100;250,40;;25;0;RUB;Первая покупка
2026-02-10;buy;GAZP;50;128,90;;12;0;RUB;
2026-05-20;dividend;SBER;;;3400;0;442;RUB;Дивиденд за 2025 год
2026-06-01;sell;GAZP;50;140,10;;14;110;RUB;`;

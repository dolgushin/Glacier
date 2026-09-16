"use client";

import { useMemo, useState } from "react";
import { Empty, Input, Table, Tag, Td, Th } from "@/components/ui";
import {
  date as formatDate,
  money,
  number,
  percent,
  pnlClass,
  relativeTime,
  signedMoney,
  signedPercent,
} from "@/lib/format";

/**
 * Everything numeric is computed on the server; this component only decides
 * what to show. Sorting and filtering are client-side because the whole set is
 * already here — a round trip to reorder rows the browser is holding would be
 * pure latency.
 */

export interface AssetRow {
  instrumentId: number;
  symbol: string;
  name: string;
  kindLabel: string;
  category: string;
  maturityDate: string | null;
  quantity: number;
  averagePrice: number;
  lastPrice: number | null;
  priceAt: string | null;
  currency: string;
  /** All money values below are already in the portfolio's base currency. */
  marketValue: number;
  costBasis: number;
  unrealizedPnl: number;
  realizedPnl: number;
  income: number;
  totalPnl: number;
  share: number;
  /** Move since the previous close, null when there is nothing to compare to. */
  dayChange: number | null;
  xirr: number | null;
  yieldOnCost: number | null;
  trailingYield: number | null;
  isOpen: boolean;
}

type SortKey =
  | "symbol"
  | "marketValue"
  | "share"
  | "unrealizedPnl"
  | "totalPnl"
  | "xirr"
  | "dayChange"
  | "income"
  | "trailingYield";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right"; title?: string }[] = [
  { key: "symbol", label: "Актив", align: "left" },
  { key: "marketValue", label: "Стоимость", align: "right" },
  { key: "share", label: "Доля", align: "right" },
  {
    key: "dayChange",
    label: "За день",
    align: "right",
    title: "Изменение с предыдущей известной котировки",
  },
  { key: "income", label: "Выплаты", align: "right", title: "Полученные дивиденды и купоны" },
  {
    key: "trailingYield",
    label: "Див. дох.",
    align: "right",
    title: "Выплаты за 12 месяцев к текущей стоимости",
  },
  { key: "unrealizedPnl", label: "Прибыль", align: "right", title: "Нереализованная прибыль" },
  {
    key: "xirr",
    label: "Доходность",
    align: "right",
    title: "Годовых по этой позиции, XIRR",
  },
];

export function AssetsTable({
  rows,
  baseCurrency,
}: {
  rows: AssetRow[];
  baseCurrency: string;
}) {
  const [query, setQuery] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("marketValue");
  const [descending, setDescending] = useState(true);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (!showClosed && !row.isOpen) return false;
      if (!needle) return true;
      return (
        row.symbol.toLowerCase().includes(needle) ||
        row.name.toLowerCase().includes(needle) ||
        row.category.toLowerCase().includes(needle)
      );
    });

    const direction = descending ? -1 : 1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "symbol") return direction * a.symbol.localeCompare(b.symbol);
      const left = a[sortKey];
      const right = b[sortKey];
      // Nulls always sink, whichever way the column is sorted.
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return direction * (Number(left) - Number(right));
    });
  }, [rows, query, showClosed, sortKey, descending]);

  const closedCount = rows.filter((row) => !row.isOpen).length;

  function toggleSort(key: SortKey) {
    if (key === sortKey) setDescending(!descending);
    else {
      setSortKey(key);
      setDescending(key !== "symbol");
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-64">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по тикеру, названию, категории"
          />
        </div>

        {closedCount > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-mute">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(event) => setShowClosed(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
            />
            Показывать проданные ({closedCount})
          </label>
        )}

        <span className="ml-auto text-xs text-ink-mute">
          {visible.length} из {rows.length}
        </span>
      </div>

      {visible.length === 0 ? (
        <Empty
          title="Ничего не найдено"
          hint={query ? "Измените запрос или очистите поиск." : "В портфеле нет открытых позиций."}
        />
      ) : (
        <Table minWidth={920}>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <Th key={column.key} align={column.align}>
                  <button
                    type="button"
                    title={column.title}
                    onClick={() => toggleSort(column.key)}
                    className={`inline-flex items-center gap-1 uppercase transition-colors hover:text-ink ${
                      sortKey === column.key ? "text-ink" : ""
                    }`}
                  >
                    {column.label}
                    <span className={sortKey === column.key ? "opacity-100" : "opacity-0"}>
                      {descending ? "↓" : "↑"}
                    </span>
                  </button>
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.instrumentId} className={row.isOpen ? "" : "opacity-60"}>
                <Td>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="code text-[13px] font-medium text-ink">{row.symbol}</span>
                    <Tag>{row.kindLabel}</Tag>
                    {!row.isOpen && <Tag tone="neutral">продана</Tag>}
                  </div>
                  <div className="max-w-[230px] truncate text-xs text-ink-mute">{row.name}</div>
                  <div className="text-[11px] text-ink-faint">
                    {row.isOpen
                      ? `${number(row.quantity, 8)} шт · средняя ${money(row.averagePrice, row.currency, 2)}`
                      : row.category}
                    {row.maturityDate && ` · погашение ${formatDate(row.maturityDate)}`}
                  </div>
                </Td>

                <Td align="right" className="tnum">
                  {row.isOpen ? (
                    <>
                      <div className="font-medium text-ink">{money(row.marketValue, baseCurrency)}</div>
                      <div className="text-[11px] text-ink-faint">
                        {row.lastPrice === null ? (
                          "нет цены"
                        ) : (
                          <>
                            {money(row.lastPrice, row.currency, 2)} · {relativeTime(row.priceAt)}
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </Td>

                <Td align="right" className="tnum text-ink-soft">
                  {row.isOpen ? percent(row.share, 1) : "—"}
                </Td>

                <Td align="right" className="tnum">
                  {row.isOpen && row.dayChange !== null ? (
                    <span className={pnlClass(row.dayChange)}>
                      {signedMoney(row.dayChange, baseCurrency)}
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </Td>

                <Td align="right" className="tnum text-ink-soft">
                  {row.income > 0 ? money(row.income, baseCurrency) : "—"}
                </Td>

                <Td align="right" className="tnum text-ink-soft">
                  {row.trailingYield !== null && row.trailingYield > 0 ? (
                    <>
                      <div>{percent(row.trailingYield, 1)}</div>
                      {row.yieldOnCost !== null && row.yieldOnCost > 0 && (
                        <div className="text-[11px] text-ink-faint">
                          {percent(row.yieldOnCost, 1)} к вложенному
                        </div>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </Td>

                <Td align="right" className={`tnum ${pnlClass(row.isOpen ? row.unrealizedPnl : row.realizedPnl)}`}>
                  {signedMoney(row.isOpen ? row.unrealizedPnl : row.realizedPnl, baseCurrency)}
                  <div className="text-[11px] opacity-80">
                    {signedPercent(row.costBasis > 0 ? row.unrealizedPnl / row.costBasis : null)}
                  </div>
                </Td>

                <Td align="right" className="tnum">
                  {row.xirr !== null ? (
                    <span className={pnlClass(row.xirr)}>{signedPercent(row.xirr)}</span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                  <div className="text-[11px] text-ink-faint">
                    {row.totalPnl !== 0 && `итого ${signedMoney(row.totalPnl, baseCurrency)}`}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

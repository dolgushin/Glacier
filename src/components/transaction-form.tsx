"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addTransactionAction, type ActionState } from "@/app/actions/data";
import { Notice, Button, Field, Input, Select } from "@/components/ui";
import type { Category, Portfolio, TxType } from "@/lib/types";
import { TX_TYPE_LABELS } from "@/lib/types";
import type { SearchHit } from "@/app/api/search/route";

const initial: ActionState = {};

const TYPE_GROUPS: { label: string; types: TxType[] }[] = [
  { label: "Сделки", types: ["BUY", "SELL"] },
  { label: "Начисления", types: ["DIVIDEND", "COUPON", "AMORTIZATION", "REDEMPTION"] },
  { label: "Деньги", types: ["DEPOSIT", "WITHDRAWAL", "FEE", "TAX"] },
  { label: "Корпоративные действия", types: ["SPLIT"] },
];

/** Operations that touch cash only and need no instrument. */
const CASH_ONLY: TxType[] = ["DEPOSIT", "WITHDRAWAL", "FEE", "TAX"];
/** Operations priced per unit. */
const PRICED: TxType[] = ["BUY", "SELL", "REDEMPTION"];

export function TransactionForm({
  portfolios,
  categories,
  defaultPortfolioId,
}: {
  portfolios: Portfolio[];
  categories: Category[];
  defaultPortfolioId: number | null;
}) {
  const [state, action, pending] = useActionState(addTransactionAction, initial);
  const [type, setType] = useState<TxType>("BUY");
  const [portfolioId, setPortfolioId] = useState(
    String(defaultPortfolioId ?? portfolios[0]?.id ?? ""),
  );
  const [picked, setPicked] = useState<SearchHit | null>(null);
  const [manual, setManual] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the picked instrument once a submit succeeds, so the next entry starts clean.
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      setPicked(null);
    }
  }, [state.success]);

  const needsInstrument = !CASH_ONLY.includes(type);
  const needsPrice = PRICED.includes(type);
  const needsAmount = !needsPrice && type !== "SPLIT";
  const visibleCategories = categories.filter(
    (category) => String(category.portfolio_id) === portfolioId,
  );

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {state.error && <Notice>{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.success}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Портфель">
          <Select
            name="portfolioId"
            value={portfolioId}
            onChange={(event) => setPortfolioId(event.target.value)}
            required
          >
            {portfolios.map((portfolio) => (
              <option key={portfolio.id} value={portfolio.id}>
                {portfolio.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Тип операции">
          <Select
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value as TxType)}
          >
            {TYPE_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.types.map((item) => (
                  <option key={item} value={item}>
                    {TX_TYPE_LABELS[item]}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
      </div>

      {needsInstrument && (
        <InstrumentPicker
          picked={picked}
          onPick={setPicked}
          manual={manual}
          onManualChange={setManual}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Дата">
          <Input
            name="date"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </Field>

        {type === "SPLIT" ? (
          <Field label="Коэффициент" hint="2 — каждая бумага превращается в две">
            <Input name="ratio" type="text" inputMode="decimal" placeholder="2" required />
          </Field>
        ) : needsPrice ? (
          <>
            <Field label="Количество">
              <Input name="quantity" type="text" inputMode="decimal" placeholder="10" required />
            </Field>
            <Field label="Цена за единицу">
              <Input name="price" type="text" inputMode="decimal" placeholder="250,40" required />
            </Field>
          </>
        ) : null}

        {needsAmount && (
          <Field
            label="Сумма"
            hint={
              type === "DIVIDEND" || type === "COUPON"
                ? "Начислено до удержания налога"
                : undefined
            }
          >
            <Input name="amount" type="text" inputMode="decimal" placeholder="1000" required />
          </Field>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Комиссия">
          <Input name="fee" type="text" inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Налог">
          <Input name="tax" type="text" inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Валюта">
          <Select name="currency" defaultValue="RUB">
            <option value="RUB">RUB — рубль</option>
            <option value="USD">USD — доллар</option>
            <option value="EUR">EUR — евро</option>
            <option value="CNY">CNY — юань</option>
          </Select>
        </Field>
      </div>

      {needsInstrument && visibleCategories.length > 0 && (
        <Field label="Категория" hint="Нужна для ребалансировки по целевым долям">
          <Select name="categoryId" defaultValue="">
            <option value="">Без категории</option>
            {visibleCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Комментарий">
        <Input name="note" placeholder="Необязательно" />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? "Сохранение…" : "Добавить операцию"}
      </Button>
    </form>
  );
}

/** Type-ahead over MOEX and CoinGecko, with a manual fallback for custom assets. */
function InstrumentPicker({
  picked,
  onPick,
  manual,
  onManualChange,
}: {
  picked: SearchHit | null;
  onPick: (hit: SearchHit | null) => void;
  manual: boolean;
  onManualChange: (value: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (manual || picked || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    // Debounce: the MOEX and CoinGecko endpoints are rate-limited.
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as { results?: SearchHit[] };
        setResults(payload.results ?? []);
        setOpen(true);
      } catch {
        // Aborted or offline — leave the previous list alone.
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, manual, picked]);

  if (manual) {
    return (
      <div className="space-y-4 border border-rule-mid bg-surface p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-ink-soft">Произвольный актив</span>
          <button
            type="button"
            onClick={() => onManualChange(false)}
            className="text-xs text-accent hover:underline"
          >
            Искать на бирже
          </button>
        </div>
        <input type="hidden" name="source" value="manual" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Код" hint="Например DEPOSIT-SBER или FLAT-MSK">
            <Input name="symbol" required placeholder="DEPOSIT-SBER" className="uppercase" />
          </Field>
          <Field label="Название">
            <Input name="instrumentName" required placeholder="Вклад в Сбербанке" />
          </Field>
        </div>
        <p className="text-xs text-ink-mute">
          У произвольного актива нет источника котировок — его стоимость берётся из указанной вами
          цены.
        </p>
      </div>
    );
  }

  if (picked) {
    return (
      <div className="flex items-center justify-between gap-3 border border-accent bg-ice px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{picked.symbol}</span>
            <span className="border border-rule-mid bg-sunk px-2 py-0.5 text-[11px] text-ink-soft">
              {picked.kindLabel}
            </span>
            <span className="text-[11px] text-ink-mute">
              {picked.source === "moex" ? "MOEX" : "CoinGecko"}
            </span>
          </div>
          <div className="truncate text-xs text-ink-mute">{picked.name}</div>
        </div>
        <button
          type="button"
          onClick={() => {
            onPick(null);
            setQuery("");
          }}
          className="shrink-0 text-xs text-ink-mute hover:text-ink"
        >
          Изменить
        </button>

        <input type="hidden" name="source" value={picked.source} />
        <input type="hidden" name="symbol" value={picked.symbol} />
        <input type="hidden" name="instrumentName" value={picked.name} />
        <input type="hidden" name="kind" value={picked.kind} />
        <input type="hidden" name="board" value={picked.board} />
        <input type="hidden" name="sourceId" value={picked.sourceId} />
        <input type="hidden" name="isin" value={picked.isin} />
      </div>
    );
  }

  return (
    <div className="relative">
      <Field
        label="Инструмент"
        hint={
          <button
            type="button"
            onClick={() => onManualChange(true)}
            className="text-accent hover:underline"
          >
            Не нашли? Добавить произвольный актив (вклад, недвижимость)
          </button>
        }
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Тикер или название: SBER, ОФЗ, bitcoin…"
          autoComplete="off"
        />
      </Field>

      {open && (loading || results.length > 0) && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto border border-rule-mid bg-sunk">
          {loading && <div className="px-3 py-2.5 text-xs text-ink-mute">Поиск…</div>}
          {results.map((hit) => (
            <button
              key={`${hit.source}-${hit.symbol}-${hit.sourceId}`}
              type="button"
              onClick={() => {
                onPick(hit);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-sunk"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{hit.symbol}</div>
                <div className="truncate text-xs text-ink-mute">{hit.name}</div>
              </div>
              <span className="shrink-0 text-[11px] text-ink-mute">{hit.kindLabel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

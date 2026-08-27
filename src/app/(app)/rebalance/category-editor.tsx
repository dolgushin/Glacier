"use client";

import { useActionState } from "react";
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
  type ActionState,
} from "@/app/actions/data";
import { Notice, Button, Input } from "@/components/ui";
import { money, percent } from "@/lib/format";
import type { Category } from "@/lib/types";
import type { DriftRow } from "@/lib/domain/rebalance";

const initial: ActionState = {};

const PRESET_COLORS = [
  "#3699ff", "#8950fc", "#1bc5bd", "#6930c3",
  "#ffa800", "#f64e60", "#187de4", "#0bb7af",
];

export function CategoryEditor({
  categories,
  portfolioId,
  drift,
  currency,
}: {
  categories: Category[];
  portfolioId: number;
  drift: DriftRow[];
  currency: string;
}) {
  const [createState, createAction, creating] = useActionState(createCategoryAction, initial);
  const driftByCategory = new Map(drift.map((row) => [row.categoryId, row]));

  return (
    <div className="space-y-5">
      {createState.error && <Notice>{createState.error}</Notice>}

      {categories.length > 0 && (
        <div className="space-y-2">
          {categories.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              row={driftByCategory.get(category.id)}
              currency={currency}
            />
          ))}
        </div>
      )}

      <form
        action={createAction}
        className="flex flex-wrap items-end gap-3 border-t border-rule pt-5"
      >
        <input type="hidden" name="portfolioId" value={portfolioId} />
        <input
          type="hidden"
          name="color"
          value={PRESET_COLORS[categories.length % PRESET_COLORS.length]}
        />
        <div className="min-w-[180px] flex-1">
          <span className="mb-1.5 block text-xs font-medium text-ink-soft">Новая категория</span>
          <Input name="name" required placeholder="Например: Акции РФ" />
        </div>
        <div className="w-32">
          <span className="mb-1.5 block text-xs font-medium text-ink-soft">Целевая доля, %</span>
          <Input name="target" inputMode="decimal" placeholder="40" defaultValue="0" />
        </div>
        <Button type="submit" variant="ghost" disabled={creating}>
          {creating ? "Добавление…" : "Добавить"}
        </Button>
      </form>
    </div>
  );
}

function CategoryRow({
  category,
  row,
  currency,
}: {
  category: Category;
  row: DriftRow | undefined;
  currency: string;
}) {
  const [, updateAction, updating] = useActionState(updateCategoryAction, initial);
  const [, deleteAction] = useActionState(deleteCategoryAction, initial);

  return (
    <div className="flex flex-wrap items-center gap-3 border border-rule bg-surface px-4 py-3">
      <span
        className="h-2.5 w-2.5 shrink-0"
        style={{ background: category.color }}
      />

      <form action={updateAction} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <input type="hidden" name="categoryId" value={category.id} />
        <Input name="name" defaultValue={category.name} className="min-w-[140px] flex-1" />
        <div className="flex items-center gap-1.5">
          <Input
            name="target"
            defaultValue={category.target_weight}
            inputMode="decimal"
            className="w-20 text-right"
          />
          <span className="text-xs text-ink-mute">%</span>
        </div>
        <button
          type="submit"
          disabled={updating}
          className="border border-rule-mid px-2.5 py-2 text-xs text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {updating ? "…" : "Сохранить"}
        </button>
      </form>

      <div className="tnum shrink-0 text-right text-xs text-ink-mute">
        <div>{row ? money(row.value, currency) : money(0, currency)}</div>
        <div className="text-[11px]">
          сейчас {percent(row?.currentShare ?? 0, 1)}
        </div>
      </div>

      <form
        action={deleteAction}
        onSubmit={(event) => {
          if (!confirm(`Удалить категорию «${category.name}»? Активы останутся без категории.`)) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="categoryId" value={category.id} />
        <button
          type="submit"
          className="px-2 py-1.5 text-xs text-ink-mute transition-colors hover:bg-surface hover:text-loss"
          title="Удалить категорию"
        >
          ✕
        </button>
      </form>
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";
import {
  createPortfolioAction,
  deletePortfolioAction,
  renamePortfolioAction,
  type ActionState,
} from "@/app/actions/data";
import { Notice, Button, Field, Input, Select, Td } from "@/components/ui";
import { money } from "@/lib/format";
import type { Portfolio } from "@/lib/types";

const initial: ActionState = {};

export function CreatePortfolio() {
  const [state, action, pending] = useActionState(createPortfolioAction, initial);

  return (
    <form action={action} className="space-y-4">
      {state.error && <Notice>{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.success}</Notice>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Название">
          <Input name="name" required placeholder="ИИС, Долгосрочный, Крипта…" />
        </Field>
        <Field label="Базовая валюта" hint="В ней считаются все итоги портфеля">
          <Select name="currency" defaultValue="RUB">
            <option value="RUB">RUB — рубль</option>
            <option value="USD">USD — доллар</option>
            <option value="EUR">EUR — евро</option>
          </Select>
        </Field>
        <Field label="Брокер" hint="Необязательно, для вашей же навигации">
          <Input name="broker" placeholder="Т-Инвестиции" />
        </Field>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Создание…" : "Создать портфель"}
      </Button>
    </form>
  );
}

export function PortfolioRow({
  portfolio,
  broker,
  value,
  positions,
  operations,
  categories,
  createdAt,
}: {
  portfolio: Portfolio;
  /** Resolved upstream from the live broker link, not from the stored column. */
  broker: string;
  value: number;
  positions: number;
  operations: number;
  categories: number;
  createdAt: string;
}) {
  const [renameState, renameAction, renaming] = useActionState(renamePortfolioAction, initial);
  const [deleteState, deleteAction, deleting] = useActionState(deletePortfolioAction, initial);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <tr>
      <Td>
        {editing ? (
          <form action={renameAction} className="flex items-center gap-2">
            <input type="hidden" name="portfolioId" value={portfolio.id} />
            <Input name="name" defaultValue={portfolio.name} className="w-40" autoFocus />
            <button
              type="submit"
              disabled={renaming}
              className="border border-rule-mid px-2 py-1.5 text-xs text-ink hover:border-accent"
            >
              ОК
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs text-ink-mute hover:text-ink"
            >
              Отмена
            </button>
          </form>
        ) : (
          <div className="font-medium text-ink">{portfolio.name}</div>
        )}
        {renameState.error && <p className="text-[11px] text-loss">{renameState.error}</p>}
      </Td>

      <Td className="text-xs text-ink-mute">{broker}</Td>

      <Td align="right" className="tnum font-medium">
        {money(value, portfolio.base_currency)}
      </Td>
      <Td align="right" className="tnum text-ink-soft">
        {positions}
      </Td>
      <Td align="right" className="tnum text-ink-soft">
        {operations}
      </Td>
      <Td align="right" className="tnum text-ink-soft">
        {categories}
      </Td>
      <Td className="whitespace-nowrap text-xs text-ink-mute">{createdAt}</Td>

      <Td align="right">
        {confirming ? (
          <form action={deleteAction} className="flex flex-col items-end gap-1.5">
            <input type="hidden" name="portfolioId" value={portfolio.id} />
            <span className="text-[11px] text-ink-mute">
              Введите «{portfolio.name}» для подтверждения
            </span>
            <div className="flex items-center gap-2">
              <Input name="confirm" className="w-36" placeholder={portfolio.name} autoFocus />
              <button
                type="submit"
                disabled={deleting}
                className="border border-loss bg-surface px-2.5 py-1.5 text-xs text-loss hover:bg-loss hover:text-paper"
              >
                Удалить
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-xs text-ink-mute hover:text-ink"
              >
                Отмена
              </button>
            </div>
            {deleteState.error && (
              <span className="text-[11px] text-loss">{deleteState.error}</span>
            )}
          </form>
        ) : (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="px-2 py-1 text-xs text-ink-mute hover:text-ink"
            >
              Переименовать
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="px-2 py-1 text-xs text-ink-mute hover:text-loss"
            >
              Удалить
            </button>
          </div>
        )}
      </Td>
    </tr>
  );
}

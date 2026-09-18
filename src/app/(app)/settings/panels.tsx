"use client";

import { useActionState, useState, useTransition } from "react";
import {
  backfillHistoryAction,
  refreshAllAction,
  type ActionState,
} from "@/app/actions/data";
import { changePasswordAction, type FormState } from "@/app/actions/auth";
import { telegramLinkAction, telegramUnlinkAction } from "@/app/actions/telegram";
import { importCsvAction, type ImportState } from "@/app/actions/import";
import { Notice, Button, Field, Input, Select, Textarea } from "@/components/ui";
import type { Portfolio } from "@/lib/types";

const initialAction: ActionState = {};
const initialImport: ImportState = {};
const initialForm: FormState = {};

function Issues({ issues }: { issues?: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!issues || issues.length === 0) return null;
  const shown = expanded ? issues : issues.slice(0, 5);

  return (
    <div className="border border-amber-600 bg-surface px-3.5 py-2.5">
      <p className="mb-1.5 text-xs font-medium text-amber-700">
        Замечания по импорту ({issues.length})
      </p>
      <ul className="space-y-0.5 text-xs text-amber-700">
        {shown.map((issue, index) => (
          <li key={index}>· {issue}</li>
        ))}
      </ul>
      {issues.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1.5 text-xs text-amber-700 underline"
        >
          {expanded ? "Свернуть" : `Показать все ${issues.length}`}
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------ quotes sync

export function RefreshPanel() {
  const [backfillState, backfillAction, backfilling] = useActionState(
    backfillHistoryAction,
    initialAction,
  );
  const [refreshResult, setRefreshResult] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      {refreshResult.success && <Notice tone="success">{refreshResult.success}</Notice>}
      {refreshResult.error && <Notice>{refreshResult.error}</Notice>}
      {backfillState.success && <Notice tone="success">{backfillState.success}</Notice>}
      {backfillState.error && <Notice>{backfillState.error}</Notice>}

      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setRefreshResult(await refreshAllAction());
          })
        }
      >
        {pending ? "Обновление…" : "Обновить котировки сейчас"}
      </Button>

      <form action={backfillAction} className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <span className="mb-1.5 block text-xs font-medium text-ink-soft">Загрузить историю</span>
          <Select name="days" defaultValue="365">
            <option value="90">за 3 месяца</option>
            <option value="365">за год</option>
            <option value="1095">за 3 года</option>
            <option value="1825">за 5 лет</option>
          </Select>
        </div>
        <Button type="submit" variant="ghost" disabled={backfilling}>
          {backfilling ? "Загрузка…" : "Загрузить"}
        </Button>
      </form>
      <p className="text-xs text-ink-mute">
        История дневных котировок нужна для графика стоимости портфеля. Без неё график начнёт
        строиться только с сегодняшнего дня.
      </p>
    </div>
  );
}

// ------------------------------------------------------------ CSV import

export function CsvImportPanel({
  portfolios,
  template,
}: {
  portfolios: Portfolio[];
  template: string;
}) {
  const [state, action, pending] = useActionState(importCsvAction, initialImport);
  const [showTemplate, setShowTemplate] = useState(false);

  return (
    <div className="space-y-4">
      {state.error && <Notice>{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.success}</Notice>}
      <Issues issues={state.issues} />

      <form action={action} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Портфель">
            <Select name="portfolioId" required>
              {portfolios.map((portfolio) => (
                <option key={portfolio.id} value={portfolio.id}>
                  {portfolio.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Файл CSV">
            <input
              type="file"
              name="file"
              accept=".csv,text/csv,text/plain"
              className="w-full border border-rule-mid bg-surface px-3 py-1.5 text-sm text-ink-soft file:mr-3 file: file:border-0 file:bg-sunk file:px-3 file:py-1.5 file:text-xs file:text-ink"
            />
          </Field>
        </div>

        <Field label="…или вставьте содержимое" hint="Разделитель определяется автоматически: ; , или таб">
          <Textarea name="pasted" rows={5} placeholder="date;type;symbol;quantity;price;…" />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Импорт…" : "Импортировать"}
          </Button>
          <button
            type="button"
            onClick={() => setShowTemplate(!showTemplate)}
            className="text-xs text-accent hover:underline"
          >
            {showTemplate ? "Скрыть пример" : "Показать пример файла"}
          </button>
        </div>
      </form>

      {showTemplate && (
        <div className="space-y-2">
          <pre className="overflow-x-auto border border-rule bg-surface p-3 text-[11px] leading-relaxed text-ink-soft">
            {template}
          </pre>
          <p className="text-xs text-ink-mute">
            Распознаются как английские, так и русские заголовки: <code>date/дата</code>,{" "}
            <code>type/тип</code>, <code>symbol/тикер</code>, <code>quantity/количество</code>,{" "}
            <code>price/цена</code>, <code>amount/сумма</code>, <code>fee/комиссия</code>,{" "}
            <code>tax/налог</code>. Числа принимаются и с запятой, и с точкой.
          </p>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------- password

export function PasswordPanel() {
  const [state, action, pending] = useActionState(changePasswordAction, initialForm);

  return (
    <form action={action} className="space-y-4">
      {state.error && <Notice>{state.error}</Notice>}

      <Field label="Текущий пароль">
        <Input name="current" type="password" required autoComplete="current-password" />
      </Field>
      <Field label="Новый пароль" hint="Не короче 8 символов">
        <Input name="next" type="password" required minLength={8} autoComplete="new-password" />
      </Field>

      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? "Сохранение…" : "Сменить пароль"}
      </Button>
    </form>
  );
}

/** Привязка Telegram-бота: выплаты и сбои синхронизации приходят в чат. */
export function TelegramPanel({ linked }: { linked: boolean }) {
  const [linkState, linkAction, linking] = useActionState(telegramLinkAction, {});
  const [unlinkState, unlinkAction, unlinking] = useActionState(telegramUnlinkAction, {});

  const state = linkState.error || linkState.success ? linkState : unlinkState;

  return (
    <div className="space-y-3">
      {state.error && <Notice>{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.success}</Notice>}

      {linked ? (
        <>
          <p className="text-xs leading-relaxed text-ink-soft">
            Чат привязан. Приходят: новые выплаты из автосинхронизации и её сбои. Команда боту
            /week — выплаты на ближайшие 7 дней.
          </p>
          <form action={unlinkAction}>
            <Button type="submit" variant="ghost" disabled={unlinking}>
              {unlinking ? "Отвязываю…" : "Отключить уведомления"}
            </Button>
          </form>
        </>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-ink-mute">
            Бот пришлёт в личку новые дивиденды и купоны, а также предупредит, если
            синхронизация с брокером упала. Нажмите «Получить код», затем отправьте его боту
            командой <span className="code">/start КОД</span>
            {linkState.botName ? (
              <>
                {" "}
                — бот: <span className="code">@{linkState.botName}</span>
              </>
            ) : null}
            .
          </p>

          {linkState.code && (
            <div className="rounded-md border border-accent bg-sunk px-3 py-2.5">
              <p className="text-[11px] font-medium tracking-wide text-ink-mute uppercase">
                Ваш код привязки
              </p>
              <p className="code mt-1 text-lg font-semibold tracking-[0.2em] text-accent">
                {linkState.code}
              </p>
              <p className="mt-1 text-[11px] text-ink-mute">
                Одноразовый: после привязки сгорает. /start {linkState.code}
              </p>
            </div>
          )}

          <form action={linkAction}>
            <Button type="submit" variant="ghost" disabled={linking}>
              {linking ? "Выпускаю…" : linkState.code ? "Перевыпустить код" : "Получить код привязки"}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";
import {
  checkAndSaveConnectionAction,
  deleteConnectionAction,
  linkAccountAction,
  refreshAccountsAction,
  renameConnectionAction,
  setAutoSyncAction,
  syncAllAction,
  syncLinkAction,
  unlinkAccountAction,
  type BrokerState,
} from "@/app/actions/brokers";
import { Notice, Tag, Button, Section, Empty, Field, Input, Select } from "@/components/ui";
import { dateTime, relativeTime } from "@/lib/format";
import type { RemoteAccount } from "@/lib/brokers/types";
import type { BrokerInfo } from "@/lib/brokers/registry";
import type { ConnectionView } from "@/lib/brokers/engine";
import { ReconcilePanel } from "./reconcile";

const initial: BrokerState = {};

type PortfolioOption = { id: number; name: string };

/** Error plus the actionable hint that goes with it. */
function Feedback({ state }: { state: BrokerState }) {
  return (
    <>
      {state.error && (
        <Notice>
          <div>{state.error}</div>
          {state.hint && <div className="mt-1.5 text-xs opacity-90">{state.hint}</div>}
        </Notice>
      )}
      {state.success && (
        <Notice tone="success">
          <div>{state.success}</div>
          {state.hint && <div className="mt-1.5 text-xs opacity-90">{state.hint}</div>}
        </Notice>
      )}
    </>
  );
}

export function ConnectionsManager({
  connections,
  portfolios,
  brokers,
  extraCaConfigured,
}: {
  connections: ConnectionView[];
  portfolios: PortfolioOption[];
  brokers: BrokerInfo[];
  extraCaConfigured: boolean;
}) {
  const [adding, setAdding] = useState(connections.length === 0);
  const [syncAllState, syncAllFormAction, syncingAll] = useActionState(syncAllAction, initial);

  return (
    <div className="space-y-6">
      {connections.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form action={syncAllFormAction}>
            <Button type="submit" disabled={syncingAll}>
              {syncingAll ? "Синхронизация…" : "Синхронизировать все счета"}
            </Button>
          </form>
          <Button type="button" variant="ghost" onClick={() => setAdding(!adding)}>
            {adding ? "Свернуть" : "Добавить подключение"}
          </Button>
        </div>
      )}

      <Feedback state={syncAllState} />

      {adding && (
        <AddConnection
          brokers={brokers}
          portfolios={portfolios}
          extraCaConfigured={extraCaConfigured}
          onDone={() => setAdding(false)}
        />
      )}

      {connections.length === 0 && !adding && (
        <Section>
          <Empty
            title="Подключений пока нет"
            hint="Добавьте API-ключ брокера, чтобы сделки подтягивались автоматически."
            action={<Button onClick={() => setAdding(true)}>Добавить подключение</Button>}
          />
        </Section>
      )}

      {connections.map((connection) => (
        <ConnectionCard
          key={connection.id}
          connection={connection}
          portfolios={portfolios}
          broker={brokers.find((item) => item.id === connection.broker)}
        />
      ))}
    </div>
  );
}

// ------------------------------------------------------------- add flow

function AddConnection({
  brokers,
  portfolios,
  extraCaConfigured,
  onDone,
}: {
  brokers: BrokerInfo[];
  portfolios: PortfolioOption[];
  extraCaConfigured: boolean;
  onDone: () => void;
}) {
  const [brokerId, setBrokerId] = useState(brokers[0]?.id ?? "");
  const [state, action, pending] = useActionState(checkAndSaveConnectionAction, initial);
  const broker = brokers.find((item) => item.id === brokerId);

  // Once the key is accepted the form is replaced by the account mapping step.
  if (state.connectionId && state.accounts) {
    return (
      <Section title="Шаг 2. Куда загружать счета">
        <Feedback state={state} />
        <div className="mt-4">
          <AccountMapper
            connectionId={state.connectionId}
            accounts={state.accounts}
            portfolios={portfolios}
            onDone={onDone}
          />
        </div>
      </Section>
    );
  }

  return (
    <Section title="Шаг 1. Ключ брокера">
      <form action={action} className="space-y-5">
        <Feedback state={state} />

        <div>
          <span className="mb-2 block text-xs font-medium text-ink-soft">Брокер</span>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {brokers.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setBrokerId(item.id)}
                className={` border px-3.5 py-3 text-left transition-colors ${
                  brokerId === item.id
                    ? "border-accent bg-ice"
                    : "border-rule-mid hover:border-rule-mid"
                }`}
              >
                <div className="text-sm font-medium text-ink">{item.name}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-ink-mute">{item.summary}</div>
              </button>
            ))}
          </div>
        </div>

        <input type="hidden" name="broker" value={brokerId} />

        {broker && (
          <>
            {broker.id === "tinvest" && !extraCaConfigured && (
              <Notice tone="info">
                API Т-Инвестиций использует сертификат российского УЦ Минцифры. Node.js ему не
                доверяет, и запрос сорвётся на этапе TLS. Скачайте корневой сертификат на{" "}
                <span className="underline">gosuslugi.ru/crt</span> и запускайте сервис с
                переменной <code>NODE_EXTRA_CA_CERTS</code> — подробности в README.
              </Notice>
            )}

            {!broker.providesCashFlow && (
              <Notice tone="info">
                {broker.name} отдаёт только сделки — пополнения и выводы в API не приходят. Остаток
                денег в портфеле по этому счёту будет неполным; при необходимости добавьте операции
                «Внесение средств» вручную.
              </Notice>
            )}

            <Field label="Название подключения" hint="Чтобы различать несколько ключей одного брокера">
              <Input name="label" placeholder={`${broker.name} — основной`} />
            </Field>

            {broker.credentialFields.map((field) => (
              <Field key={field.key} label={field.label} hint={field.hint}>
                <Input
                  name={`cred_${field.key}`}
                  type={field.type === "password" ? "password" : "text"}
                  required={field.required}
                  placeholder={field.placeholder}
                  autoComplete="off"
                />
              </Field>
            ))}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={pending}>
                {pending ? "Проверяем ключ…" : "Проверить и сохранить"}
              </Button>
              <a
                href={broker.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent hover:underline"
              >
                {broker.docsLabel} ↗
              </a>
              <button
                type="button"
                onClick={onDone}
                className="ml-auto text-xs text-ink-mute hover:text-ink"
              >
                Отмена
              </button>
            </div>
          </>
        )}
      </form>
    </Section>
  );
}

/** Map each broker account to a portfolio, one row at a time. */
function AccountMapper({
  connectionId,
  accounts,
  portfolios,
  onDone,
}: {
  connectionId: number;
  accounts: RemoteAccount[];
  portfolios: PortfolioOption[];
  onDone?: () => void;
}) {
  return (
    <div className="space-y-3">
      {accounts.map((account) => (
        <AccountRow
          key={account.id}
          connectionId={connectionId}
          account={account}
          portfolios={portfolios}
        />
      ))}
      {onDone && (
        <button
          type="button"
          onClick={onDone}
          className="text-xs text-ink-mute hover:text-ink"
        >
          Готово
        </button>
      )}
    </div>
  );
}

function AccountRow({
  connectionId,
  account,
  portfolios,
}: {
  connectionId: number;
  account: RemoteAccount;
  portfolios: PortfolioOption[];
}) {
  const [state, action, pending] = useActionState(linkAccountAction, initial);
  const [choice, setChoice] = useState<string>(portfolios.length > 0 ? String(portfolios[0].id) : "new");

  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 border border-rule bg-surface px-4 py-3"
    >
      <input type="hidden" name="connectionId" value={connectionId} />
      <input type="hidden" name="remoteAccountId" value={account.id} />
      <input type="hidden" name="remoteAccountName" value={account.name} />

      <div className="min-w-[160px] flex-1">
        <div className="text-sm font-medium text-ink">{account.name}</div>
        <div className="text-[11px] text-ink-mute">
          {account.kind ? `${account.kind} · ` : ""}
          {account.id}
        </div>
      </div>

      <div className="w-52">
        <span className="mb-1.5 block text-xs font-medium text-ink-soft">Портфель</span>
        <Select name="portfolioId" value={choice} onChange={(event) => setChoice(event.target.value)}>
          {portfolios.map((portfolio) => (
            <option key={portfolio.id} value={portfolio.id}>
              {portfolio.name}
            </option>
          ))}
          <option value="new">+ Создать новый</option>
        </Select>
      </div>

      {choice === "new" && (
        <div className="w-48">
          <span className="mb-1.5 block text-xs font-medium text-ink-soft">Название</span>
          <Input name="newPortfolioName" placeholder={account.name} />
        </div>
      )}

      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? "…" : "Привязать"}
      </Button>

      {(state.error || state.success) && (
        <div className="w-full">
          <Feedback state={state} />
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------- existing connection

function ConnectionCard({
  connection,
  portfolios,
  broker,
}: {
  connection: ConnectionView;
  portfolios: PortfolioOption[];
  broker: BrokerInfo | undefined;
}) {
  const [refreshState, refreshAction, refreshing] = useActionState(refreshAccountsAction, initial);
  const [renameState, renameAction] = useActionState(renameConnectionAction, initial);
  const [deleteState, deleteAction] = useActionState(deleteConnectionAction, initial);
  const [replacingKey, setReplacingKey] = useState(false);
  const [renaming, setRenaming] = useState(false);

  // Accounts not yet mapped to a portfolio, after a refresh.
  const mapped = new Set(connection.links.map((link) => link.remoteAccountId));
  const unmapped = (refreshState.accounts ?? []).filter((account) => !mapped.has(account.id));

  return (
    <Section
      title={
        renaming ? (
          <form action={renameAction} className="flex items-center gap-2">
            <input type="hidden" name="connectionId" value={connection.id} />
            <Input name="label" defaultValue={connection.label} className="w-56" autoFocus />
            <button
              type="submit"
              onClick={() => setRenaming(false)}
              className="border border-rule-mid px-2 py-1.5 text-xs text-ink hover:border-accent"
            >
              ОК
            </button>
          </form>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            {connection.label}
            <Tag tone="neutral">{connection.brokerName}</Tag>
            {connection.status === "error" ? (
              <Tag tone="bad">ошибка</Tag>
            ) : connection.status === "ok" ? (
              <Tag tone="good">ключ работает</Tag>
            ) : null}
          </span>
        )
      }
      subtitle={
        connection.lastCheckAt
          ? `Ключ проверялся ${relativeTime(connection.lastCheckAt)}`
          : "Ключ ещё не проверялся"
      }
      action={
        <div className="flex flex-wrap items-center gap-2">
          <form action={refreshAction}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <button
              type="submit"
              disabled={refreshing}
              className="border border-rule-mid px-2.5 py-1.5 text-xs text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {refreshing ? "…" : "Обновить список счетов"}
            </button>
          </form>
          <button
            type="button"
            onClick={() => setRenaming(!renaming)}
            className="px-2 py-1.5 text-xs text-ink-mute hover:text-ink"
          >
            Переименовать
          </button>
          <button
            type="button"
            onClick={() => setReplacingKey(!replacingKey)}
            className="px-2 py-1.5 text-xs text-ink-mute hover:text-ink"
          >
            Заменить ключ
          </button>
          <form
            action={deleteAction}
            onSubmit={(event) => {
              if (
                !confirm(
                  `Удалить подключение «${connection.label}»? Ключ будет стёрт, загруженные операции останутся в портфелях.`,
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="connectionId" value={connection.id} />
            <button
              type="submit"
              className="px-2 py-1.5 text-xs text-ink-mute hover:text-loss"
            >
              Удалить
            </button>
          </form>
        </div>
      }
    >
      <div className="space-y-4">
        {connection.status === "error" && connection.statusDetail && (
          <Notice>{connection.statusDetail}</Notice>
        )}
        <Feedback state={refreshState} />
        <Feedback state={renameState} />
        <Feedback state={deleteState} />

        {replacingKey && broker && (
          <ReplaceKey
            connectionId={connection.id}
            broker={broker}
            onDone={() => setReplacingKey(false)}
          />
        )}

        {connection.links.length === 0 ? (
          <Empty
            title="Ни один счёт не привязан"
            hint="Нажмите «Обновить список счетов», чтобы выбрать, куда загружать операции."
          />
        ) : (
          <div className="space-y-2">
            {connection.links.map((link) => (
              <LinkRowView key={link.id} link={link} />
            ))}
          </div>
        )}

        {unmapped.length > 0 && (
          <div className="border-t border-rule pt-4">
            <h3 className="mb-3 text-xs font-medium text-ink-soft">
              Ещё не привязаны ({unmapped.length})
            </h3>
            <AccountMapper
              connectionId={connection.id}
              accounts={unmapped}
              portfolios={portfolios}
            />
          </div>
        )}
      </div>
    </Section>
  );
}

function ReplaceKey({
  connectionId,
  broker,
  onDone,
}: {
  connectionId: number;
  broker: BrokerInfo;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(checkAndSaveConnectionAction, initial);

  return (
    <form action={action} className="space-y-4 border border-rule-mid bg-surface p-4">
      <input type="hidden" name="broker" value={broker.id} />
      <input type="hidden" name="connectionId" value={connectionId} />
      <Feedback state={state} />

      <p className="text-xs text-ink-mute">
        Новый ключ заменит старый. Привязки счетов к портфелям сохранятся.
      </p>

      {broker.credentialFields.map((field) => (
        <Field key={field.key} label={field.label} hint={field.hint}>
          <Input
            name={`cred_${field.key}`}
            type={field.type === "password" ? "password" : "text"}
            required={field.required}
            placeholder={field.placeholder}
            autoComplete="off"
          />
        </Field>
      ))}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="ghost" disabled={pending}>
          {pending ? "Проверяем…" : "Заменить ключ"}
        </Button>
        <button type="button" onClick={onDone} className="text-xs text-ink-mute hover:text-ink">
          Отмена
        </button>
      </div>
    </form>
  );
}

function LinkRowView({ link }: { link: ConnectionView["links"][number] }) {
  const [syncState, syncAction, syncing] = useActionState(syncLinkAction, initial);
  const [, autoSyncAction] = useActionState(setAutoSyncAction, initial);
  const [, unlinkAction] = useActionState(unlinkAccountAction, initial);

  const failed = link.lastSyncStatus.startsWith("ошибка");

  return (
    <div className="border border-rule bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[160px] flex-1">
          <div className="text-sm text-ink">
            {link.remoteAccountName || link.remoteAccountId}
            <span className="mx-1.5 text-ink-mute">→</span>
            <span className="text-accent">{link.portfolioName}</span>
          </div>
          <div className="text-[11px] text-ink-mute">
            {link.lastSyncAt ? `Синхронизировано ${dateTime(link.lastSyncAt)}` : "Ещё не синхронизировано"}
            {link.lastSyncStatus && (
              <span className={failed ? "text-loss" : "text-ink-mute"}> · {link.lastSyncStatus}</span>
            )}
          </div>
        </div>

        <form action={autoSyncAction}>
          <input type="hidden" name="linkId" value={link.id} />
          <input type="hidden" name="enabled" value={link.autoSync ? "0" : "1"} />
          <button
            type="submit"
            title="Участвует ли счёт в кнопке «Синхронизировать все»"
            className={` border px-2.5 py-1.5 text-xs transition-colors ${
              link.autoSync
                ? "border-gain bg-surface text-gain"
                : "border-rule-mid text-ink-mute"
            }`}
          >
            автосинк {link.autoSync ? "вкл" : "выкл"}
          </button>
        </form>

        <form action={syncAction}>
          <input type="hidden" name="linkId" value={link.id} />
          <button
            type="submit"
            disabled={syncing}
            className="border border-rule-mid px-2.5 py-1.5 text-xs text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {syncing ? "Синхронизация…" : "Синхронизировать"}
          </button>
        </form>

        <form action={syncAction}>
          <input type="hidden" name="linkId" value={link.id} />
          <input type="hidden" name="full" value="1" />
          <button
            type="submit"
            disabled={syncing}
            title="Перечитать максимальную доступную историю"
            className="border border-rule-mid px-2.5 py-1.5 text-xs text-ink-mute transition-colors hover:text-ink disabled:opacity-50"
          >
            Полная
          </button>
        </form>

        <form
          action={unlinkAction}
          onSubmit={(event) => {
            if (!confirm("Убрать привязку счёта к портфелю? Операции останутся в портфеле.")) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="linkId" value={link.id} />
          <button
            type="submit"
            className="px-2 py-1.5 text-xs text-ink-mute hover:text-loss"
          >
            Отвязать
          </button>
        </form>
      </div>

      {(syncState.error || syncState.success) && (
        <div className="mt-3">
          <Feedback state={syncState} />
        </div>
      )}

      <div className="mt-3 border-t border-rule pt-3">
        <ReconcilePanel linkId={link.id} />
      </div>
    </div>
  );
}

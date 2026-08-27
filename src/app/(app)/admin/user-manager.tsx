"use client";

import { useActionState, useState } from "react";
import {
  createUserAction,
  deleteUserAction,
  resetPasswordAction,
  revokeInviteAction,
  setActiveAction,
  setRoleAction,
  type AdminState,
} from "@/app/actions/admin";
import { Button, Field, Input, Notice, Section, Select, Table, Tag, Td, Th } from "@/components/ui";
import { date as formatDate, dateTime } from "@/lib/format";

const initial: AdminState = {};

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  portfolios: number;
  transactions: number;
  connections: number;
}

export interface AdminInvite {
  code: string;
  note: string;
  expiresAt: string | null;
  createdAt: string;
  usedAt: string | null;
  usedByEmail: string | null;
}

function Feedback({ state }: { state: AdminState }) {
  if (!state.error && !state.success) return null;
  return (
    <div className="mb-4">
      {state.error && <Notice>{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.success}</Notice>}
    </div>
  );
}

// ------------------------------------------------------------ create user

export function CreateUser() {
  const [state, action, pending] = useActionState(createUserAction, initial);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button onClick={() => setOpen(true)}>Создать пользователя</Button>
        <span className="text-xs text-ink-mute">
          Быстрее, чем инвайт: вы сами задаёте пароль и роль
        </span>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <Feedback state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Имя">
          <Input name="name" required placeholder="Андрей" />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" required placeholder="andrey@example.com" />
        </Field>
        <Field label="Пароль" hint="Не короче 8 символов. Пользователь сменит его сам">
          <Input name="password" required minLength={8} autoComplete="new-password" />
        </Field>
        <Field label="Роль">
          <Select name="role" defaultValue="user">
            <option value="user">Пользователь</option>
            <option value="admin">Администратор</option>
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Создание…" : "Создать"}
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-ink-mute hover:text-ink"
        >
          Отмена
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------- user table

export function UserTable({ users, currentUserId }: { users: AdminUser[]; currentUserId: number }) {
  return (
    <Table minWidth={780}>
      <thead>
        <tr>
          <Th>Пользователь</Th>
          <Th>Роль</Th>
          <Th>Статус</Th>
          <Th align="right">Данные</Th>
          <Th>Последний вход</Th>
          <Th align="right">Действия</Th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <UserRow key={user.id} user={user} isSelf={user.id === currentUserId} />
        ))}
      </tbody>
    </Table>
  );
}

function UserRow({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const [roleState, roleAction] = useActionState(setRoleAction, initial);
  const [activeState, activeAction] = useActionState(setActiveAction, initial);
  const [deleteState, deleteAction, deleting] = useActionState(deleteUserAction, initial);
  const [passwordState, passwordAction, resetting] = useActionState(resetPasswordAction, initial);

  const [confirming, setConfirming] = useState(false);
  const [resettingOpen, setResettingOpen] = useState(false);

  const error =
    roleState.error || activeState.error || deleteState.error || passwordState.error;
  const success =
    roleState.success || activeState.success || deleteState.success || passwordState.success;

  return (
    <tr>
      <Td>
        <div className="font-medium text-ink">{user.name || "—"}</div>
        <div className="text-xs text-ink-mute">{user.email}</div>
        <div className="text-[11px] text-ink-faint">с {formatDate(user.createdAt)}</div>
      </Td>

      <Td>
        <form action={roleAction} className="flex items-center gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="role" value={user.role === "admin" ? "user" : "admin"} />
          <Tag tone={user.role === "admin" ? "info" : "neutral"}>
            {user.role === "admin" ? "администратор" : "пользователь"}
          </Tag>
          <button
            type="submit"
            className="text-[11px] text-ink-faint underline-offset-2 hover:text-accent hover:underline"
          >
            {user.role === "admin" ? "снять" : "назначить"}
          </button>
        </form>
      </Td>

      <Td>
        <form action={activeAction} className="flex items-center gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="active" value={user.isActive ? "0" : "1"} />
          <Tag tone={user.isActive ? "good" : "bad"}>
            {user.isActive ? "активен" : "отключён"}
          </Tag>
          <button
            type="submit"
            className="text-[11px] text-ink-faint underline-offset-2 hover:text-accent hover:underline"
          >
            {user.isActive ? "отключить" : "включить"}
          </button>
        </form>
      </Td>

      <Td align="right" className="tnum text-xs text-ink-mute">
        <div>{user.portfolios} портф.</div>
        <div>{user.transactions} опер.</div>
        {user.connections > 0 && <div>{user.connections} брокер.</div>}
      </Td>

      <Td className="whitespace-nowrap text-xs text-ink-mute">
        {user.lastLoginAt ? dateTime(user.lastLoginAt) : "никогда"}
      </Td>

      <Td align="right">
        {confirming ? (
          <form action={deleteAction} className="flex flex-col items-end gap-1.5">
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="email" value={user.email} />
            <span className="text-[11px] text-ink-mute">
              Будут стёрты {user.portfolios} портфелей и {user.transactions} операций.
              <br />
              Введите <span className="text-ink">{user.email}</span> для подтверждения
            </span>
            <div className="flex items-center gap-2">
              <Input name="confirm" className="w-52" placeholder={user.email} autoFocus />
              <Button type="submit" variant="danger" disabled={deleting}>
                {deleting ? "…" : "Удалить"}
              </Button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-xs text-ink-mute hover:text-ink"
              >
                Отмена
              </button>
            </div>
          </form>
        ) : resettingOpen ? (
          <form action={passwordAction} className="flex items-center justify-end gap-2">
            <input type="hidden" name="userId" value={user.id} />
            <Input
              name="password"
              className="w-40"
              minLength={8}
              placeholder="Новый пароль"
              autoFocus
            />
            <Button type="submit" variant="ghost" disabled={resetting}>
              {resetting ? "…" : "Задать"}
            </Button>
            <button
              type="button"
              onClick={() => setResettingOpen(false)}
              className="text-xs text-ink-mute hover:text-ink"
            >
              Отмена
            </button>
          </form>
        ) : (
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setResettingOpen(true)}
              className="text-xs text-ink-mute hover:text-accent"
            >
              Сбросить пароль
            </button>
            {!isSelf && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="text-xs text-ink-faint hover:text-loss"
              >
                Удалить
              </button>
            )}
          </div>
        )}

        {error && <p className="mt-1.5 text-right text-[11px] text-loss">{error}</p>}
        {success && <p className="mt-1.5 text-right text-[11px] text-gain">{success}</p>}
      </Td>
    </tr>
  );
}

// ---------------------------------------------------------------- invites

export function InviteTable({ invites }: { invites: AdminInvite[] }) {
  const now = new Date().toISOString();

  return (
    <Table minWidth={640}>
      <thead>
        <tr>
          <Th>Код</Th>
          <Th>Комментарий</Th>
          <Th>Статус</Th>
          <Th>Действует до</Th>
          <Th align="right"></Th>
        </tr>
      </thead>
      <tbody>
        {invites.map((invite) => (
          <InviteRow
            key={invite.code}
            invite={invite}
            expired={!invite.usedAt && invite.expiresAt !== null && invite.expiresAt < now}
          />
        ))}
      </tbody>
    </Table>
  );
}

function InviteRow({ invite, expired }: { invite: AdminInvite; expired: boolean }) {
  const [state, action] = useActionState(revokeInviteAction, initial);

  return (
    <tr>
      <Td>
        <code className="code rounded bg-sunk px-2 py-1 text-xs tracking-wider text-ink">
          {invite.code}
        </code>
      </Td>
      <Td className="text-xs text-ink-mute">{invite.note || "—"}</Td>
      <Td>
        {invite.usedAt ? (
          <Tag tone="neutral">использован · {invite.usedByEmail ?? "—"}</Tag>
        ) : expired ? (
          <Tag tone="bad">истёк</Tag>
        ) : (
          <Tag tone="good">активен</Tag>
        )}
      </Td>
      <Td className="whitespace-nowrap text-xs text-ink-mute">{formatDate(invite.expiresAt)}</Td>
      <Td align="right">
        {!invite.usedAt && (
          <form action={action}>
            <input type="hidden" name="code" value={invite.code} />
            <button
              type="submit"
              className="text-xs text-ink-faint hover:text-loss"
              title="Код перестанет действовать"
            >
              Отозвать
            </button>
          </form>
        )}
        {state.error && <p className="mt-1 text-[11px] text-loss">{state.error}</p>}
      </Td>
    </tr>
  );
}

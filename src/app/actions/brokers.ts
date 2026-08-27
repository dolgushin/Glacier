"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { listPortfolios } from "@/lib/repo";
import { refreshQuotes } from "@/lib/sync";
import { requireAdapter } from "@/lib/brokers/registry";
import {
  deleteConnection,
  linkAccount,
  probeCredentials,
  refreshAccounts,
  renameConnection,
  saveConnection,
  setAutoSync,
  syncAll,
  syncLink,
  unlinkAccount,
  updateCredentials,
} from "@/lib/brokers/engine";
import { BrokerError, type Credentials, type RemoteAccount } from "@/lib/brokers/types";

/**
 * Broker connection actions.
 *
 * Credentials travel from the browser exactly once: the "check" step validates
 * and immediately persists them encrypted, returning only a connection id and
 * the account list. Nothing after that carries a key through the client.
 */

export interface BrokerState {
  error?: string;
  hint?: string;
  success?: string;
  /** Set when a key was accepted and stored. */
  connectionId?: number;
  accounts?: RemoteAccount[];
}

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

function toState(error: unknown): BrokerState {
  if (error instanceof BrokerError) {
    return { error: error.message, hint: error.hint };
  }
  return { error: error instanceof Error ? error.message : "Не удалось выполнить операцию" };
}

/** Collect the credential fields this broker declared. */
function readCredentials(broker: string, data: FormData): Credentials {
  const adapter = requireAdapter(broker);
  const credentials: Credentials = {};
  for (const field of adapter.credentialFields) {
    credentials[field.key] = String(data.get(`cred_${field.key}`) ?? "").trim();
  }
  return credentials;
}

/**
 * Validate a key against the broker, store it, and report the accounts it sees.
 * When `connectionId` is present the key replaces the one on that connection,
 * which is how a rotated or expired key is fixed without losing the mappings.
 */
export async function checkAndSaveConnectionAction(
  _previous: BrokerState,
  data: FormData,
): Promise<BrokerState> {
  const user = await requireUser();
  const broker = text(data, "broker");
  const existingId = Number(data.get("connectionId")) || 0;

  try {
    const adapter = requireAdapter(broker);
    const credentials = readCredentials(broker, data);
    const accounts = await probeCredentials(broker, credentials);

    const connectionId = existingId
      ? (updateCredentials(user.id, existingId, credentials), existingId)
      : saveConnection({
          userId: user.id,
          broker,
          label: text(data, "label") || adapter.name,
          credentials,
        });

    revalidatePath("/connections");
    return {
      success: `Ключ принят. Доступно счетов: ${accounts.length}. Осталось указать, в какой портфель загружать каждый.`,
      connectionId,
      accounts,
    };
  } catch (error) {
    return toState(error);
  }
}

/** Re-read the account list for a stored connection. */
export async function refreshAccountsAction(
  _previous: BrokerState,
  data: FormData,
): Promise<BrokerState> {
  const user = await requireUser();
  const connectionId = Number(data.get("connectionId"));
  try {
    const accounts = await refreshAccounts(user.id, connectionId);
    revalidatePath("/connections");
    return { success: `Доступно счетов: ${accounts.length}`, connectionId, accounts };
  } catch (error) {
    return toState(error);
  }
}

/** Map one broker account to a portfolio, creating the portfolio if asked. */
export async function linkAccountAction(
  _previous: BrokerState,
  data: FormData,
): Promise<BrokerState> {
  const user = await requireUser();
  const portfolioRaw = text(data, "portfolioId");

  try {
    linkAccount({
      userId: user.id,
      connectionId: Number(data.get("connectionId")),
      remoteAccountId: text(data, "remoteAccountId"),
      remoteAccountName: text(data, "remoteAccountName"),
      // "new" means: make a portfolio named after the account.
      portfolioId: portfolioRaw === "new" ? 0 : Number(portfolioRaw),
      newPortfolioName: text(data, "newPortfolioName"),
    });
  } catch (error) {
    return toState(error);
  }

  revalidatePath("/connections");
  revalidatePath("/portfolios");
  revalidatePath("/dashboard");
  return { success: "Счёт привязан к портфелю. Теперь можно синхронизировать." };
}

export async function unlinkAccountAction(
  _previous: BrokerState,
  data: FormData,
): Promise<BrokerState> {
  const user = await requireUser();
  try {
    unlinkAccount(user.id, Number(data.get("linkId")));
  } catch (error) {
    return toState(error);
  }
  revalidatePath("/connections");
  return { success: "Привязка удалена. Загруженные операции остались в портфеле." };
}

export async function setAutoSyncAction(
  _previous: BrokerState,
  data: FormData,
): Promise<BrokerState> {
  const user = await requireUser();
  try {
    setAutoSync(user.id, Number(data.get("linkId")), text(data, "enabled") === "1");
  } catch (error) {
    return toState(error);
  }
  revalidatePath("/connections");
  return {};
}

export async function renameConnectionAction(
  _previous: BrokerState,
  data: FormData,
): Promise<BrokerState> {
  const user = await requireUser();
  try {
    renameConnection(user.id, Number(data.get("connectionId")), text(data, "label"));
  } catch (error) {
    return toState(error);
  }
  revalidatePath("/connections");
  return { success: "Название обновлено" };
}

export async function deleteConnectionAction(
  _previous: BrokerState,
  data: FormData,
): Promise<BrokerState> {
  const user = await requireUser();
  try {
    deleteConnection(user.id, Number(data.get("connectionId")));
  } catch (error) {
    return toState(error);
  }
  revalidatePath("/connections");
  return { success: "Подключение удалено вместе с ключом. Операции остались в журнале." };
}

export async function syncLinkAction(
  _previous: BrokerState,
  data: FormData,
): Promise<BrokerState> {
  const user = await requireUser();
  const linkId = Number(data.get("linkId"));
  const fullHistory = text(data, "full") === "1";

  try {
    const outcome = await syncLink(user.id, linkId, { fullHistory });
    await refreshQuotes();

    revalidatePath("/connections");
    revalidatePath("/dashboard");
    revalidatePath("/assets");
    revalidatePath("/transactions");

    return {
      success:
        `«${outcome.accountName}» → «${outcome.portfolioName}»: загружено ${outcome.inserted}` +
        `${outcome.skipped > 0 ? `, дубликатов пропущено ${outcome.skipped}` : ""}`,
      hint:
        outcome.unresolved > 0
          ? `Не удалось распознать инструмент у ${outcome.unresolved} операций — они пропущены, ` +
            "чтобы не испортить расчёт позиций. Обычно это валютные операции или бумаги вне справочника."
          : undefined,
    };
  } catch (error) {
    return toState(error);
  }
}

/** Sync every enabled mapping across every connection. */
export async function syncAllAction(_previous: BrokerState): Promise<BrokerState> {
  const user = await requireUser();
  const { results, errors } = await syncAll(user.id);

  if (results.length > 0) await refreshQuotes();

  revalidatePath("/connections");
  revalidatePath("/dashboard");
  revalidatePath("/assets");
  revalidatePath("/transactions");

  if (results.length === 0 && errors.length === 0) {
    return { error: "Нет подключённых счетов с включённой автосинхронизацией" };
  }

  const inserted = results.reduce((sum, result) => sum + result.inserted, 0);
  return {
    success: `Синхронизировано счетов: ${results.length}, новых операций: ${inserted}`,
    hint: errors.length > 0 ? `Ошибки: ${errors.join("; ")}` : undefined,
  };
}

/** Portfolio list for the mapping selectors. */
export async function portfolioOptionsAction(): Promise<{ id: number; name: string }[]> {
  const user = await requireUser();
  return listPortfolios(user.id).map((portfolio) => ({ id: portfolio.id, name: portfolio.name }));
}

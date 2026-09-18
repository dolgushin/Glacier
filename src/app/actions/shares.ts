"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { activeShare, createShare, requirePortfolio, revokeShare } from "@/lib/repo";

export interface ShareState {
  error?: string;
  success?: string;
  /** Полный URL свежесозданной ссылки — показывается один раз. */
  url?: string;
}

/**
 * Публичная read-only ссылка на портфель.
 *
 * Модель доступа — как у ссылок Snowball и «поделиться документом»: ссылку
 * знает тот, кому её дали. Внутри — только сводка (стоимость, доходность,
 * распределение, топ позиций), без журнала сделок и без имени владельца.
 */
export async function sharePortfolioAction(
  _previous: ShareState,
  data: FormData,
): Promise<ShareState> {
  const user = await requireUser();
  const portfolioId = Number(data.get("portfolioId"));
  const origin = String(data.get("origin") ?? "").trim();

  try {
    requirePortfolio(user.id, portfolioId);

    const existing = activeShare(portfolioId);
    if (existing) {
      return { success: "Ссылка уже активна — она под таблицей портфелей." };
    }

    const token = randomBytes(16).toString("base64url");
    createShare(portfolioId, token);

    revalidatePath("/portfolios");
    return {
      success: "Публичная ссылка создана. Покажите её кому хотите — портфель виден в режиме «только чтение».",
      url: origin ? `${origin}/public/${token}` : `/public/${token}`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Не удалось создать ссылку" };
  }
}

export async function revokeShareAction(
  _previous: ShareState,
  data: FormData,
): Promise<ShareState> {
  const user = await requireUser();
  const portfolioId = Number(data.get("portfolioId"));
  const shareId = Number(data.get("shareId"));

  try {
    requirePortfolio(user.id, portfolioId);
    revokeShare(shareId, portfolioId);
    revalidatePath("/portfolios");
    return { success: "Ссылка отозвана: по ней больше ничего не видно." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Не удалось отозвать ссылку" };
  }
}

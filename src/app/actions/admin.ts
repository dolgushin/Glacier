"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  AuthError,
  adminCreateUser,
  adminSetPassword,
  deleteUser,
  revokeInvite,
  setUserActive,
  setUserRole,
} from "@/lib/accounts";
import { createPortfolio } from "@/lib/repo";
import type { Role } from "@/lib/types";

/**
 * Administration.
 *
 * Every action re-checks requireAdmin: a server action is a public endpoint,
 * and hiding a button in the UI is not authorisation.
 */

export interface AdminState {
  error?: string;
  success?: string;
}

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

function fail(error: unknown): AdminState {
  return {
    error: error instanceof AuthError ? error.message : "Не удалось выполнить операцию",
  };
}

function refresh() {
  revalidatePath("/admin");
}

/** Create an account directly, without the invite round-trip. */
export async function createUserAction(
  _previous: AdminState,
  data: FormData,
): Promise<AdminState> {
  await requireAdmin();
  const role = (text(data, "role") === "admin" ? "admin" : "user") as Role;

  try {
    const user = adminCreateUser({
      email: text(data, "email"),
      password: String(data.get("password") ?? ""),
      name: text(data, "name"),
      role,
    });
    // A fresh account with no portfolio is a dead end.
    createPortfolio(user.id, "Основной портфель");
    refresh();
    return {
      success: `Учётная запись ${user.email} создана${
        role === "admin" ? " с правами администратора" : ""
      }. Передайте пароль владельцу — сменить его он сможет в настройках.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function setRoleAction(_previous: AdminState, data: FormData): Promise<AdminState> {
  await requireAdmin();
  const role = (text(data, "role") === "admin" ? "admin" : "user") as Role;
  try {
    setUserRole(Number(data.get("userId")), role);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { success: role === "admin" ? "Права администратора выданы" : "Права администратора сняты" };
}

export async function setActiveAction(_previous: AdminState, data: FormData): Promise<AdminState> {
  await requireAdmin();
  const active = text(data, "active") === "1";
  try {
    setUserActive(Number(data.get("userId")), active);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return {
    success: active
      ? "Учётная запись включена"
      : "Учётная запись отключена, все её сессии завершены",
  };
}

/** Destroys the account and everything under it; the email must be typed back. */
export async function deleteUserAction(
  _previous: AdminState,
  data: FormData,
): Promise<AdminState> {
  const admin = await requireAdmin();
  const userId = Number(data.get("userId"));
  const confirm = text(data, "confirm").toLowerCase();
  const email = text(data, "email").toLowerCase();

  if (userId === admin.id) {
    return { error: "Нельзя удалить учётную запись, под которой вы сейчас работаете" };
  }
  if (confirm !== email) {
    return { error: "Введите email пользователя в точности, чтобы подтвердить удаление" };
  }

  try {
    deleteUser(userId);
  } catch (error) {
    return fail(error);
  }
  refresh();
  revalidatePath("/dashboard");
  return { success: `Учётная запись ${email} удалена вместе со всеми её данными` };
}

export async function resetPasswordAction(
  _previous: AdminState,
  data: FormData,
): Promise<AdminState> {
  await requireAdmin();
  try {
    adminSetPassword(Number(data.get("userId")), String(data.get("password") ?? ""));
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { success: "Пароль изменён, прежние сессии пользователя завершены" };
}

export async function revokeInviteAction(
  _previous: AdminState,
  data: FormData,
): Promise<AdminState> {
  await requireAdmin();
  try {
    revokeInvite(text(data, "code"));
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { success: "Код отозван" };
}

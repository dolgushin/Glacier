"use server";

import { redirect } from "next/navigation";
import {
  AuthError,
  authenticate,
  changePassword,
  createInvite,
  endSession,
  needsBootstrap,
  registerWithInvite,
  requireAdmin,
  requireUser,
  startSession,
} from "@/lib/auth";
import { createPortfolio } from "@/lib/repo";
import { revalidatePath } from "next/cache";

export interface FormState {
  error?: string;
  success?: string;
}

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

export async function loginAction(_previous: FormState, data: FormData): Promise<FormState> {
  let userId: number;
  try {
    const user = authenticate(text(data, "email"), String(data.get("password") ?? ""));
    userId = user.id;
  } catch (error) {
    return { error: error instanceof AuthError ? error.message : "Не удалось войти" };
  }
  await startSession(userId);
  // Outside the try: redirect signals by throwing, and must not be swallowed.
  redirect("/dashboard");
}

export async function registerAction(_previous: FormState, data: FormData): Promise<FormState> {
  let userId: number;
  try {
    const user = registerWithInvite({
      email: text(data, "email"),
      password: String(data.get("password") ?? ""),
      name: text(data, "name"),
      code: text(data, "code"),
    });
    userId = user.id;
    // A brand-new account with no portfolio is a dead end; give it one.
    createPortfolio(userId, "Основной портфель");
  } catch (error) {
    return { error: error instanceof AuthError ? error.message : "Не удалось зарегистрироваться" };
  }
  await startSession(userId);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}

export async function changePasswordAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    changePassword(
      user.id,
      String(data.get("current") ?? ""),
      String(data.get("next") ?? ""),
    );
  } catch (error) {
    return { error: error instanceof AuthError ? error.message : "Не удалось сменить пароль" };
  }
  redirect("/login");
}

export async function createInviteAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const code = createInvite(admin.id, text(data, "note"), Number(data.get("days") ?? 14) || 14);
  revalidatePath("/admin");
  return { success: `Инвайт-код создан: ${code}` };
}

export async function isBootstrapAction(): Promise<boolean> {
  return needsBootstrap();
}

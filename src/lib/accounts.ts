import { all, get, nowIso, run } from "@/lib/db";
import { hashPassword, verifyPassword, inviteCode } from "@/lib/crypto";
import type { Role, User } from "@/lib/types";

/**
 * Account domain: users and invites.
 *
 * Deliberately free of any Next.js request context so it can run from scripts
 * and tests. Cookies and sessions live in lib/auth.ts.
 */

export class AuthError extends Error {}

/** True while the instance has no users: the first registration creates the admin. */
export function needsBootstrap(): boolean {
  return (get<{ n: number }>("SELECT COUNT(*) AS n FROM users")?.n ?? 0) === 0;
}

export function findUserByEmail(email: string): User | undefined {
  return get<User>("SELECT * FROM users WHERE email = ?", email.trim().toLowerCase());
}

export function createUser(params: {
  email: string;
  password: string;
  name: string;
  role?: Role;
}): User {
  const email = params.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AuthError("Некорректный email");
  if (params.password.length < 8) throw new AuthError("Пароль должен быть не короче 8 символов");
  if (findUserByEmail(email)) throw new AuthError("Пользователь с таким email уже существует");

  const result = run(
    `INSERT INTO users (email, name, password_hash, role, base_currency, created_at)
     VALUES (?, ?, ?, ?, 'RUB', ?)`,
    email,
    params.name.trim(),
    hashPassword(params.password),
    params.role ?? "user",
    nowIso(),
  );
  return get<User>("SELECT * FROM users WHERE id = ?", Number(result.lastInsertRowid))!;
}

/**
 * Registration is invite-gated unless this is the very first account.
 * The invite is consumed only after the account is successfully created.
 */
export function registerWithInvite(params: {
  email: string;
  password: string;
  name: string;
  code: string;
}): User {
  if (needsBootstrap()) {
    return createUser({ ...params, role: "admin" });
  }

  const code = params.code.trim().toUpperCase();
  const invite = get<{ code: string; used_by: number | null; expires_at: string | null }>(
    "SELECT code, used_by, expires_at FROM invites WHERE code = ?",
    code,
  );
  if (!invite) throw new AuthError("Инвайт-код не найден");
  if (invite.used_by !== null) throw new AuthError("Этот инвайт-код уже использован");
  if (invite.expires_at && invite.expires_at < nowIso()) {
    throw new AuthError("Срок действия инвайт-кода истёк");
  }

  const user = createUser({ ...params, role: "user" });
  run("UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?", user.id, nowIso(), code);
  return user;
}

export function authenticate(email: string, password: string): User {
  const user = findUserByEmail(email);
  // Hash even when the user is missing, so a wrong email and a wrong password
  // take the same amount of time.
  if (!user) {
    verifyPassword(password, hashPassword("decoy-value-for-constant-time"));
    throw new AuthError("Неверный email или пароль");
  }
  if (!verifyPassword(password, user.password_hash)) throw new AuthError("Неверный email или пароль");
  if (!user.is_active) throw new AuthError("Учётная запись отключена");

  run("UPDATE users SET last_login_at = ? WHERE id = ?", nowIso(), user.id);
  return user;
}

export function changePassword(userId: number, current: string, next: string): void {
  const user = get<User>("SELECT * FROM users WHERE id = ?", userId);
  if (!user) throw new AuthError("Пользователь не найден");
  if (!verifyPassword(current, user.password_hash)) throw new AuthError("Текущий пароль неверен");
  if (next.length < 8) throw new AuthError("Новый пароль должен быть не короче 8 символов");

  run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(next), userId);
  // Every other device is logged out.
  run("DELETE FROM sessions WHERE user_id = ?", userId);
}

// ------------------------------------------------------ administration

/**
 * The instance must always keep at least one enabled administrator. Without
 * this guard it is one click to lock everyone out of user management with no
 * way back except editing the database by hand.
 */
function assertNotLastAdmin(userId: number, what: string): void {
  const user = get<User>("SELECT * FROM users WHERE id = ?", userId);
  if (!user || user.role !== "admin" || !user.is_active) return;

  const others = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?",
    userId,
  )!.n;
  if (others === 0) {
    throw new AuthError(
      `Это последний администратор сервиса — ${what} нельзя. Сначала назначьте администратором кого-то ещё.`,
    );
  }
}

export function listUsers(): User[] {
  return all<User>("SELECT * FROM users ORDER BY created_at");
}

/** Create an account directly, bypassing the invite flow. */
export function adminCreateUser(params: {
  email: string;
  password: string;
  name: string;
  role: Role;
}): User {
  return createUser(params);
}

export function setUserRole(userId: number, role: Role): void {
  if (role !== "admin") assertNotLastAdmin(userId, "снять права администратора");
  run("UPDATE users SET role = ? WHERE id = ?", role, userId);
}

/** Disabling keeps the data but blocks login and kills existing sessions. */
export function setUserActive(userId: number, active: boolean): void {
  if (!active) assertNotLastAdmin(userId, "отключить учётную запись");
  run("UPDATE users SET is_active = ? WHERE id = ?", active ? 1 : 0, userId);
  if (!active) run("DELETE FROM sessions WHERE user_id = ?", userId);
}

/**
 * Destroys the account and everything under it: portfolios, ledger, broker
 * connections. Cascades are declared in the schema, so this is one statement.
 */
export function deleteUser(userId: number): void {
  assertNotLastAdmin(userId, "удалить учётную запись");
  const user = get<User>("SELECT * FROM users WHERE id = ?", userId);
  if (!user) throw new AuthError("Пользователь не найден");
  run("DELETE FROM users WHERE id = ?", userId);
}

/** Set a password without knowing the old one, for a locked-out user. */
export function adminSetPassword(userId: number, password: string): void {
  if (password.length < 8) throw new AuthError("Пароль должен быть не короче 8 символов");
  const user = get<User>("SELECT * FROM users WHERE id = ?", userId);
  if (!user) throw new AuthError("Пользователь не найден");

  run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(password), userId);
  // Everything that user had open is invalidated.
  run("DELETE FROM sessions WHERE user_id = ?", userId);
}

/** How much data an account holds — shown before a destructive confirmation. */
export interface UserFootprint {
  portfolios: number;
  transactions: number;
  connections: number;
}

export function userFootprint(userId: number): UserFootprint {
  return {
    portfolios:
      get<{ n: number }>("SELECT COUNT(*) AS n FROM portfolios WHERE user_id = ?", userId)?.n ?? 0,
    transactions:
      get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM transactions t
           JOIN portfolios p ON p.id = t.portfolio_id WHERE p.user_id = ?`,
        userId,
      )?.n ?? 0,
    connections:
      get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM broker_connections WHERE user_id = ?",
        userId,
      )?.n ?? 0,
  };
}

// --------------------------------------------------------------- invites

export function createInvite(createdBy: number, note: string, days = 14): string {
  const code = inviteCode();
  const expires = new Date(Date.now() + days * 86_400_000).toISOString();
  run(
    "INSERT INTO invites (code, created_by, note, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    code,
    createdBy,
    note.trim(),
    expires,
    nowIso(),
  );
  return code;
}

export interface InviteRow {
  code: string;
  note: string;
  expires_at: string | null;
  created_at: string;
  used_at: string | null;
  used_by_email: string | null;
}

export function listInvites(): InviteRow[] {
  return all<InviteRow>(
    `SELECT i.code, i.note, i.expires_at, i.created_at, i.used_at, u.email AS used_by_email
       FROM invites i
       LEFT JOIN users u ON u.id = i.used_by
      ORDER BY i.created_at DESC`,
  );
}

/** Withdraw an unused code. A code already redeemed is history and stays. */
export function revokeInvite(code: string): void {
  const invite = get<{ used_by: number | null }>(
    "SELECT used_by FROM invites WHERE code = ?",
    code,
  );
  if (!invite) throw new AuthError("Код не найден");
  if (invite.used_by !== null) {
    throw new AuthError("Код уже использован — отозвать его нельзя, удалите саму учётную запись");
  }
  run("DELETE FROM invites WHERE code = ?", code);
}

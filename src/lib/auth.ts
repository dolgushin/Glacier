import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { get, nowIso, run } from "@/lib/db";
import { hashToken, randomToken } from "@/lib/crypto";
import type { User } from "@/lib/types";

/**
 * Request-scoped session handling. The account domain itself lives in
 * lib/accounts.ts so that scripts and tests can use it without a request.
 */

export {
  AuthError,
  authenticate,
  changePassword,
  createInvite,
  createUser,
  findUserByEmail,
  listInvites,
  needsBootstrap,
  registerWithInvite,
  type InviteRow,
} from "@/lib/accounts";

const COOKIE = "glacier_session";
const SESSION_DAYS = 30;

/**
 * Whether to mark the session cookie Secure.
 *
 * Deriving this from NODE_ENV is the usual shortcut and it is wrong here: a
 * production build served over plain HTTP on a LAN address emits a Secure
 * cookie, which every browser then refuses to store on a non-localhost origin.
 * The symptom is the worst kind — the password is accepted, no error is shown,
 * and the user is bounced straight back to the login page.
 *
 * So: follow the actual protocol. Behind a TLS-terminating proxy the header is
 * present and the cookie is hardened; over direct HTTP it is not.
 * GLACIER_SECURE_COOKIES=1 forces it on for setups that do not set the header.
 */
async function useSecureCookie(): Promise<boolean> {
  if (process.env.GLACIER_SECURE_COOKIES === "1") return true;
  const proto = (await headers()).get("x-forwarded-proto");
  return proto?.split(",")[0].trim() === "https";
}

export async function startSession(userId: number): Promise<void> {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const agent = (await headers()).get("user-agent") ?? "";

  run(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)",
    // Sessions are stored hashed: a database leak must not hand out live sessions.
    hashToken(token),
    userId,
    nowIso(),
    expires.toISOString(),
    agent.slice(0, 200),
  );

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await useSecureCookie(),
    path: "/",
    expires,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) run("DELETE FROM sessions WHERE id = ?", hashToken(token));
  store.delete(COOKIE);
}

/** Current user, or null. Expired sessions are reaped on the way past. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const id = hashToken(token);
  const session = get<{ user_id: number; expires_at: string }>(
    "SELECT user_id, expires_at FROM sessions WHERE id = ?",
    id,
  );
  if (!session) return null;
  if (session.expires_at < nowIso()) {
    run("DELETE FROM sessions WHERE id = ?", id);
    return null;
  }

  return get<User>("SELECT * FROM users WHERE id = ? AND is_active = 1", session.user_id) ?? null;
}

/** Use in every protected page: redirects to /login when unauthenticated. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

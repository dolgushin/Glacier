/**
 * Mint a session cookie for a user without going through the login form.
 * Used by the smoke check; handy for debugging a rendered page too.
 *   node --import ./scripts/register-alias.mjs scripts/make-session.ts <email>
 */
import { nowIso, run } from "@/lib/db";
import { findUserByEmail } from "@/lib/accounts";
import { hashToken, randomToken } from "@/lib/crypto";

const email = process.argv[2] ?? "demo@glacier.local";
const user = findUserByEmail(email);
if (!user) {
  console.error(`Пользователь ${email} не найден`);
  process.exit(1);
}

const token = randomToken();
run(
  "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, 'smoke-check')",
  hashToken(token),
  user.id,
  nowIso(),
  new Date(Date.now() + 3600_000).toISOString(),
);

process.stdout.write(token);

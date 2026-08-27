import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";

/**
 * Secret used to derive the token-encryption key. In production this must come
 * from the environment; a dev fallback keeps `npm run dev` working out of the box
 * but is deliberately unusable for anything real.
 */
function secret(): Buffer {
  const raw = process.env.GLACIER_SECRET;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("GLACIER_SECRET is required in production");
    }
    return createHash("sha256").update("glacier-insecure-dev-secret").digest();
  }
  return createHash("sha256").update(raw).digest();
}

// ---------------------------------------------------------------- passwords

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ----------------------------------------------------------------- tokens

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Sessions are stored as a hash so a database leak does not hand out sessions. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Human-friendly invite code: 4-4-4, unambiguous alphabet. */
export function inviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = () =>
    Array.from(randomBytes(4))
      .map((byte) => alphabet[byte % alphabet.length])
      .join("");
  return `${pick()}-${pick()}-${pick()}`;
}

// ------------------------------------------------- broker token encryption

/** AES-256-GCM. Broker tokens are never written to disk in plaintext. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", secret(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** Show only the tail of a broker token in the UI. */
export function maskSecret(value: string): string {
  return value.length <= 8 ? "••••" : `••••${value.slice(-4)}`;
}

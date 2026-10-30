import crypto from "node:crypto";
import util from "node:util";

const scryptAsync = util.promisify(crypto.scrypt);

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 24;

export const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

export function isLoopbackAddress(ip) {
  if (!ip || typeof ip !== "string") return false;
  return loopbackAddresses.has(ip) || ip.startsWith("127.") || ip === "::1" || ip === "localhost" || ip.endsWith("127.0.0.1");
}

// CoreServer{n} and Server{n}, and CoreServer-<PC>-{n}: the logins a launcher gives the servers it hosts on another PC
// for a friend's backend (Core-Launcher #6), so they don't share accounts with the backend PC's own CoreServer{n}.
export function isServerAccountName(name) {
  if (typeof name !== "string") return false;
  return /^(?:(?:CoreServer|Server)[_\s-]?\d+|CoreServer[_-][a-z0-9]{1,16}[_-]\d+)$/i.test(name.trim());
}

export function validatePassword(plain) {
  if (typeof plain !== "string") return "Password must be a string";
  const trimmed = plain.trim();
  if (trimmed.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (trimmed.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  return null;
}

export function validateUsername(name) {
  if (typeof name !== "string") return "Username must be a string";
  const trimmed = name.trim();
  if (trimmed.length < MIN_USERNAME_LENGTH) return `Username must be at least ${MIN_USERNAME_LENGTH} characters`;
  if (trimmed.length > MAX_USERNAME_LENGTH) return `Username must be at most ${MAX_USERNAME_LENGTH} characters`;
  if (!/^[a-zA-Z0-9_\- ]+$/.test(trimmed)) {
    return "Username can only contain letters, numbers, spaces, underscores, and hyphens";
  }
  return null;
}

export async function hashPassword(plain) {
  const trimmed = String(plain ?? "").trim();
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scryptAsync(trimmed, salt, 64);
  return { salt, hash: derived.toString("hex") };
}

export async function verifyPassword(plain, stored) {
  if (!stored || !stored.salt || !stored.hash || typeof plain !== "string") return false;
  const trimmed = plain.trim();
  try {
    const derived = await scryptAsync(trimmed, stored.salt, 64);
    const storedBuffer = Buffer.from(stored.hash, "hex");
    if (derived.length !== storedBuffer.length) return false;
    return crypto.timingSafeEqual(derived, storedBuffer);
  } catch {
    return false;
  }
}


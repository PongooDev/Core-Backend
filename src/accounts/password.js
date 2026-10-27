import crypto from "node:crypto";

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 24;

export function isServerAccountName(name) {
  if (typeof name !== "string") return false;
  return /^(?:CoreServer|Server)[_\s-]?\d+$/i.test(name.trim());
}

export function validatePassword(plain) {
  if (typeof plain !== "string") return "Password must be a string";
  if (plain.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (plain.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
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


export function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyPassword(plain, stored) {
  if (!stored || !stored.salt || !stored.hash || typeof plain !== "string") return false;
  try {
    const derived = crypto.scryptSync(plain, stored.salt, 64);
    const storedBuffer = Buffer.from(stored.hash, "hex");
    if (derived.length !== storedBuffer.length) return false;
    return crypto.timingSafeEqual(derived, storedBuffer);
  } catch {
    return false;
  }
}

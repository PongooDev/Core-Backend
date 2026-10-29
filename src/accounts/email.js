// A player's contact email (Core-Backend #120): optional, linked at registration or later, and a way to sign in.
// It is not the address the game sees: every account keeps its <name>@core.com (store.js accountEmail, #64) for that.

export const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;

// The synthetic addresses' domain. No contact email may use it, so one can never pass for another account's.
export const CORE_EMAIL_DOMAIN = "core.com";

// Emails compare case-insensitively and ignore surrounding whitespace: this is the form they are stored and looked up in.
export const normalizeEmail = (raw) => String(raw ?? "").trim().toLowerCase();

const domainOf = (address) => address.slice(address.lastIndexOf("@") + 1);
export const isCoreAddress = (address) => {
  const domain = domainOf(normalizeEmail(address));
  return domain === CORE_EMAIL_DOMAIN || domain.endsWith(`.${CORE_EMAIL_DOMAIN}`);
};

// A login that names a contact email: it has an @ and isn't a <name>@core.com.
export const isContactEmailLogin = (login) => {
  const text = normalizeEmail(login);
  return text.includes("@") && !isCoreAddress(text);
};

const localPart = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const domainLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// null when the address is usable, else why not. It is normalized first.
export function validateEmail(raw) {
  if (typeof raw !== "string") return "Email must be a string";
  const address = normalizeEmail(raw);
  if (!address) return "Enter an email address";
  if (address.length > MAX_EMAIL_LENGTH) return `Email must be at most ${MAX_EMAIL_LENGTH} characters`;
  const at = address.lastIndexOf("@");
  if (at < 1 || at !== address.indexOf("@")) return "Enter a valid email address, like name@example.com";
  const local = address.slice(0, at);
  const labels = address.slice(at + 1).split(".");
  if (local.length > MAX_LOCAL_LENGTH || !localPart.test(local) || labels.length < 2 || !labels.every((label) => domainLabel.test(label))
    || !/^[a-z][a-z0-9-]*[a-z0-9]$/.test(labels.at(-1))) {
    return "Enter a valid email address, like name@example.com";
  }
  if (isCoreAddress(address)) return `@${CORE_EMAIL_DOMAIN} addresses belong to Core's own accounts; use your own email`;
  return null;
}

import crypto from "node:crypto";

// Exchange codes (GET /account/api/oauth/exchange, services/account/oauth.js): a short-lived, single-use code for the
// account whose access token asked for it, redeemed by the exchange_code token grant or by the purchase flow's sign-on
// page (/exchange, services/fortnite/purchase.js). As Epic's: 32 hex characters, good for 300 seconds. Kept in memory
// only, so a backend restart drops the codes still waiting.
export const exchangeCodeSeconds = 300;
const maxCodes = 10_000;

export function createExchangeCodeStore() {
  const codes = new Map();

  function prune(now) {
    for (const [code, entry] of codes) if (entry.expiresAt <= now) codes.delete(code);
  }

  return {
    // A new code for the session's account, as Epic's answer: {expiresInSeconds, code, creatingClientId}.
    issue(session) {
      const now = Date.now();
      prune(now);
      // Never more than maxCodes waiting: the oldest go first.
      while (codes.size >= maxCodes) codes.delete(codes.keys().next().value);
      const code = crypto.randomBytes(16).toString("hex");
      codes.set(code, { accountId: session.accountId, clientId: session.clientId, expiresAt: now + exchangeCodeSeconds * 1000 });
      return { expiresInSeconds: exchangeCodeSeconds, code, creatingClientId: session.clientId };
    },

    // The code's {accountId, clientId}, using it up, or null for an unknown, used or expired one.
    redeem(code) {
      if (typeof code !== "string" || !codes.has(code)) return null;
      const entry = codes.get(code);
      codes.delete(code);
      return entry.expiresAt > Date.now() ? entry : null;
    }
  };
}

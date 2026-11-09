import express from "express";
import path from "node:path";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";
import { readJson, writeJson } from "../../json-file.js";
import { sendError } from "../../errors.js";

// The client's privacy settings (4.5 on, Core-Backend #303): GET /fortnite/api/game/v2/privacy/account/{accountId}
// answers {accountId, optOutOfPublicLeaderboards} and POST with the same body sets it (a field left out keeps its
// value), answering with the settings as saved. An account that never set it has opted in (false). Kept per
// account in <dataDir>/accounts/<accountId>/privacy.json; only the account's own token may change it.
export function privacyRoutes({ tokens, dataDir }) {
  const router = express.Router();
  const file = (accountId) => path.join(dataDir, "accounts", accountId, "privacy.json");
  const load = (accountId) => {
    try { return readJson(file(accountId)); } catch { return {}; }
  };
  const reply = (accountId) => ({ accountId, optOutOfPublicLeaderboards: load(accountId).optOutOfPublicLeaderboards === true });
  const validId = (id) => /^[0-9a-zA-Z_-]+$/.test(id);

  router.get("/fortnite/api/game/v2/privacy/account/:accountId", requireAuth(tokens), (req, res) => {
    if (!validId(req.params.accountId)) return sendError(res, 404, "errors.com.epicgames.common.not_found", "Account not found");
    res.json(reply(req.params.accountId));
  });

  router.post("/fortnite/api/game/v2/privacy/account/:accountId", requireAuth(tokens), requireOwnAccount, (req, res) => {
    const { accountId } = req.params;
    if (!validId(accountId)) return sendError(res, 404, "errors.com.epicgames.common.not_found", "Account not found");
    const value = req.body?.optOutOfPublicLeaderboards;
    if (value !== undefined && typeof value !== "boolean") {
      return sendError(res, 400, "errors.com.epicgames.validation.validation_failed", "optOutOfPublicLeaderboards must be a boolean");
    }
    if (value !== undefined) writeJson(file(accountId), { ...load(accountId), optOutOfPublicLeaderboards: value });
    res.json(reply(accountId));
  });

  return router;
}

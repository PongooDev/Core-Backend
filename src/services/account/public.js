import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { sendError } from "../../errors.js";

export function publicAccountRoutes({ accounts, tokens }) {
  const router = express.Router();

  function findAccount(req, res, next) {
    req.account = accounts.get(req.params.accountId);
    if (!req.account) {
      return sendError(res, 404, "errors.com.epicgames.account.account_not_found",
        `Sorry, we couldn't find an account for ${req.params.accountId}`);
    }
    next();
  }

  router.get("/account/api/public/account/:accountId", requireAuth(tokens), findAccount, (req, res) => {
    const { id, displayName, lastLogin } = req.account;
    res.json({ id, displayName, lastLogin, headless: false });
  });

  router.get("/account/api/public/account/:accountId/externalAuths", requireAuth(tokens), findAccount, (req, res) => {
    res.json([]);
  });

  router.get("/account/api/epicdomains/ssodomains", (req, res) => {
    res.json([]);
  });

  return router;
}

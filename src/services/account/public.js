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

  const accountJson = ({ id, displayName, lastLogin }) => ({ id, displayName, lastLogin, headless: false });

  // QueryUserInfo (sub_37F0AC0): ?accountId=a&accountId=b, an array of accounts; unknown ids are left out.
  router.get("/account/api/public/account", requireAuth(tokens), (req, res) => {
    const ids = [req.query.accountId ?? []].flat().map(String);
    res.json(ids.map((id) => accounts.get(id)).filter(Boolean).map((account) => ({ ...accountJson(account), externalAuths: {} })));
  });

  // QueryUserIdFromDisplayName (sub_378C700) reads id: how "add a friend by name" finds the account.
  router.get("/account/api/public/account/displayName/:displayName", requireAuth(tokens), (req, res) => {
    const account = accounts.findByName(req.params.displayName);
    if (!account) {
      return sendError(res, 404, "errors.com.epicgames.account.account_not_found",
        `Sorry, we couldn't find an account for ${req.params.displayName}`);
    }
    res.json(accountJson(account));
  });

  router.get("/account/api/public/account/:accountId", requireAuth(tokens), findAccount, (req, res) => {
    res.json(accountJson(req.account));
  });

  router.get("/account/api/public/account/:accountId/externalAuths", requireAuth(tokens), findAccount, (req, res) => {
    res.json([]);
  });

  router.get("/account/api/epicdomains/ssodomains", (req, res) => {
    res.json([]);
  });

  return router;
}

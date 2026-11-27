import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";
import { hashPassword, verifyPassword } from "../../accounts/password.js";
import { sendError } from "../../errors.js";

// Epic's content-controls service (parental controls, content-controls-prod.ol.epicgames.net).
// FOnlineContentControlsServiceMcp (9.21 IDA ctor 0x3AE420, vtable 0x4104868) holds five paths (21.40 PDB names):
//   DownloadUserUrl  "/'UserId"                              GET  -> FContentControlsDownloadUserResult
//   CreateUserUrl    "" (empty: the service root)            body FContentControlsServiceCreateUserParams
//   VerifyUserUrl    "/'UserId/verify-pin"                   body FContentControlsServiceVerifyUserParams
//   DownloadRulesUrl "/'UserId/rules/namespaces/'Namespace"  GET  -> FContentControlsDownloadRulesResult
//   UpdateRulesUrl   "/'UserId/rules/namespaces/'Namespace"  body FContentControlsServiceUpdateRulesParams
// CreateUser, VerifyUser and UpdateRules complete with FOnlineError only, so the client reads just success or the
// error. 🟡 Their HTTP verbs aren't confirmed in IDA yet (POST assumed; see D:\CoreWork\HANDOFF.md).
//
// Saved per account as account.contentControls: { enabled, pin: {salt, hash} (scrypt, never plain), ageGate,
// pinGatedPurchasingEnabled, rules }. No record means no controls, so nobody is locked out.

// FContentControlsRules' JSON names (9.21 strings 0x41045B8..; canRecieveInGameItems is Epic's spelling). 9.30's
// client reads these; later fields (21.40: voiceChat, canUseTextChat, ugcViewing, ...) aren't in 9.21's string table.
const ruleDefaults = {
  allowedToAcquire: true,
  allowedToMakePurchases: true,
  canSeeMatureLanguage: true,
  canAcceptFriendRequest: true,
  canRecieveInGameItems: true,
  canSeeThirdPartyNames: true,
  canDisplayMyUserName: true,
  canSeeOtherPlayersNames: true,
  canUseVoiceChat: true,
  canVoiceChatWithUnknowns: true,
  playtimeReportingFrequency: "none",
  purchaseReportingEnabled: false,
};

export function contentControlsUser(account) {
  const controls = account?.contentControls;
  return {
    principalId: account?.id,
    ageGate: controls?.ageGate ?? 0,
    contentControlsEnabled: Boolean(controls?.enabled),
    pinGatedPurchasingEnabled: Boolean(controls?.enabled && controls?.pinGatedPurchasingEnabled),
  };
}

export function contentControlsRules(account) {
  const saved = account?.contentControls?.enabled ? account.contentControls.rules : null;
  const rules = { ...ruleDefaults };
  for (const [key, fallback] of Object.entries(ruleDefaults)) {
    if (saved && typeof saved[key] === typeof fallback) rules[key] = saved[key];
  }
  return rules;
}

const validPin = (pin) => typeof pin === "string" && /^\d{4,8}$/.test(pin);

const pinError = (res) => sendError(res, 403, "errors.com.epicgames.oss.onlinecontentcontrolsservicemcp.invalid_pin",
  "The PIN is incorrect");

export function contentControlsRoutes({ tokens, accounts }) {
  const router = express.Router();
  const auth = requireAuth(tokens);

  const accountFor = (req, res) => {
    const account = accounts.get(req.params.accountId ?? req.session.accountId);
    if (!account) sendError(res, 404, "errors.com.epicgames.account.account_not_found", "Account not found");
    return account;
  };

  // DownloadUser: {"data": FContentControlsUser} (#444, 9.21 0x3CDC80; parse 0x418A20/0x419010).
  router.get("/content-controls/:accountId", auth, (req, res) => {
    const account = accounts.get(req.params.accountId);
    res.json({ data: account ? contentControlsUser(account) : contentControlsUser({ id: req.params.accountId }) });
  });

  // CreateUser: FContentControlsServiceCreateUserParams {principalId, pin, pinConfirm} on the service root (CreateUserUrl
  // is empty). Sets the PIN and turns controls on.
  router.post("/content-controls", auth, async (req, res) => {
    const { principalId, pin, pinConfirm } = req.body ?? {};
    if (principalId && principalId !== req.session.accountId) {
      return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "This token cannot act for that account");
    }
    const account = accounts.get(req.session.accountId);
    if (!account) return sendError(res, 404, "errors.com.epicgames.account.account_not_found", "Account not found");
    if (account.contentControls?.enabled) {
      return sendError(res, 409, "errors.com.epicgames.oss.onlinecontentcontrolsservicemcp.already_exists",
        "Content controls are already set up for this account");
    }
    if (!validPin(pin) || pin !== pinConfirm) {
      return sendError(res, 400, "errors.com.epicgames.common.json_mapping_error", "pin and pinConfirm must be the same 4-8 digits");
    }
    accounts.setContentControls(account, {
      enabled: true, pin: await hashPassword(pin), ageGate: 0, pinGatedPurchasingEnabled: true, rules: { ...ruleDefaults },
    });
    res.json({ data: contentControlsUser(account) });
  });

  // VerifyUser: FContentControlsServiceVerifyUserParams {pin}.
  router.post("/content-controls/:accountId/verify-pin", auth, requireOwnAccount, async (req, res) => {
    const account = accountFor(req, res);
    if (!account) return;
    const controls = account.contentControls;
    if (!controls?.enabled) return res.status(204).end();
    if (!(await verifyPassword(String(req.body?.pin ?? ""), controls.pin))) return pinError(res);
    res.status(204).end();
  });

  // DownloadRules (9.30 0x3DEDC0, parse 0x42B2A0): {"data": {"result", "namespaceSetting", "userSetting"}}; the
  // manager keeps "result" (0x17535A0).
  router.get("/content-controls/:accountId/rules/namespaces/:namespace", auth, (req, res) => {
    const rules = contentControlsRules(accounts.get(req.params.accountId));
    res.json({ data: { result: rules, namespaceSetting: rules, userSetting: rules } });
  });

  // UpdateRules: FContentControlsServiceUpdateRulesParams, the rules plus {pin}.
  router.post("/content-controls/:accountId/rules/namespaces/:namespace", auth, requireOwnAccount, async (req, res) => {
    const account = accountFor(req, res);
    if (!account) return;
    const controls = account.contentControls;
    if (!controls?.enabled) {
      return sendError(res, 404, "errors.com.epicgames.oss.onlinecontentcontrolsservicemcp.user_not_found",
        "Content controls aren't set up for this account");
    }
    if (!(await verifyPassword(String(req.body?.pin ?? ""), controls.pin))) return pinError(res);
    const rules = { ...ruleDefaults, ...controls.rules };
    for (const [key, fallback] of Object.entries(ruleDefaults)) {
      if (typeof req.body?.[key] === typeof fallback) rules[key] = req.body[key];
    }
    accounts.setContentControls(account, { ...controls, rules });
    res.json({ data: { result: rules, namespaceSetting: rules, userSetting: rules } });
  });

  return router;
}

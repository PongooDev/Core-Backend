import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";
import { requireLoopback } from "../../admin/local.js";
import { McpError, sendError } from "../../errors.js";
import { recordUnknown } from "../../log.js";
import { isKnownProfile } from "../../profiles/ids.js";
import { openSession } from "../../profiles/session.js";
import { adminCommands, clientCommands } from "./commands/index.js";
import { publicCommands, serverCommands } from "./commands/server.js";

function runCommand(commands, context) {
  const { profiles, dataDir } = context;
  return (req, res) => {
    const profileId = String(req.params.profileId ?? req.query.profileId ?? "");

    if (!isKnownProfile(profileId)) {
      recordUnknown(dataDir, req, "profile");
      return sendError(res, 400, "errors.com.epicgames.modules.profiles.invalid_profile_id", `Unknown profile ${profileId}`);
    }

    const command = commands[req.params.command];
    if (!command) {
      recordUnknown(dataDir, req, "mcp");
      return sendError(res, 400, "errors.com.epicgames.fortnite.operation_not_found", `Unknown command ${req.params.command}`);
    }

    const session = openSession(profiles, req.params.accountId);
    const tracker = session.profile(profileId);
    const notifications = [];
    // Some server commands change several players at once (EarnScore); each other player gets their own session.
    const others = new Map();
    const sessionFor = (accountId) => {
      if (accountId === req.params.accountId) return session;
      if (!context.accounts.get(accountId)) return null;
      if (!others.has(accountId)) others.set(accountId, openSession(profiles, accountId));
      return others.get(accountId);
    };

    try {
      command({ req, profile: tracker.profile, tracker, session, notifications, profileId, sessionFor, context });
    } catch (error) {
      if (error instanceof McpError) return sendError(res, 400, error.errorCode, error.message);
      throw error;
    }
    session.commit();
    for (const other of others.values()) other.commit();

    res.json(session.response(profileId, Number(req.query.rvn ?? -1), notifications));
  };
}

function requireExistingAccount({ accounts }) {
  return (req, res, next) => {
    if (accounts.get(req.params.accountId)) return next();
    sendError(res, 404, "errors.com.epicgames.account.account_not_found", `Sorry, we couldn't find an account for ${req.params.accountId}`);
  };
}

export function profileRoutes(context) {
  const router = express.Router();

  router.post("/fortnite/api/game/v2/profile/:accountId/client/:command",
    requireAuth(context.tokens), requireOwnAccount, runCommand(clientCommands, context));

  // Other accounts' profiles (a party member's banner and heroes), read only.
  router.post("/fortnite/api/game/v2/profile/:accountId/public/:command",
    requireAuth(context.tokens), requireExistingAccount(context), runCommand(publicCommands, context));

  // The gameserver acting for its players. Any logged-in token may call it: Core's servers log in as ordinary accounts.
  router.post("/fortnite/api/game/v2/profile/:accountId/dedicated_server/:command",
    requireAuth(context.tokens), requireExistingAccount(context), runCommand(serverCommands, context));

  // The client's DevSkipTutorial cheat posts here.
  router.post("/fortnite/api/admin/account/:accountId/:profileId/command/:command",
    requireLoopback, requireAuth(context.tokens), requireOwnAccount, runCommand(adminCommands, context));

  return router;
}

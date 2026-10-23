import express from "express";
import { requireAuth, requireDedicatedServer, requireOwnAccount } from "../../accounts/auth.js";
import { requireLoopback } from "../../admin/local.js";
import { McpError, sendError } from "../../errors.js";
import { recordUnknown } from "../../log.js";
import { isKnownProfile } from "../../profiles/ids.js";
import { lockTimeout } from "../../profiles/locks.js";
import { openSession } from "../../profiles/session.js";
import { adminCommands, clientCommands } from "./commands/index.js";
import { publicCommands, serverCommands } from "./commands/server.js";

const unlockCommands = new Set(["UnlockProfiles", "UnlockProfileForWrite"]);

// The gameserver's world profile locks (profiles/locks.js): taken, given back or renewed by its commands.
function trackLock(locks, req) {
  const accountId = req.params.accountId;
  if (req.params.command === "LockProfiles" || req.params.command === "LockProfileForWrite") {
    locks.lock(accountId, lockTimeout(req.get("x-epicgames-profilewritelock")));
  } else if (unlockCommands.has(req.params.command)) locks.unlock(accountId);
  else locks.renew(accountId);
}

function withLockExpiration(locks, accountId, result) {
  for (const update of [result, ...(result.multiUpdate ?? [])]) {
    const lockExpiration = locks.expiration(accountId, update.profileId);
    if (lockExpiration) update.lockExpiration = lockExpiration;
  }
  return result;
}

// What the gameserver changes reaches the player's client as MCP profile notifications on its STOMP topic
// (/topic/fn/profile/<accountId>/<app>, McpProfileGroup.ProfileNotificationsStompTopic): FOnlineNotification
// {type: "profile/<profileId>/update", ...FProfileUpdateNotification {changes, lockExpiration, commandRevision,
// revision}} (UMcpProfileGroup's handler sub_390C5A0 splits the type at "/", McpProfileState sub_390D460 reads the
// rest). The client applies one when its revision follows the client's ("Delta profile update ... from
// notifications"), which is how its quests move in the zone.
function notifyProfiles(context, session) {
  for (const { profileId, changes, revision, commandRevision } of session.changedProfiles()) {
    context.stomp?.publishProfile(session.accountId, { type: `profile/${profileId}/update`, changes, commandRevision, revision });
  }
}

function runCommand(commands, context, { deliverMail = false, locks = null, notify = false } = {}) {
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
    if (notify) for (const changed of [session, ...others.values()]) notifyProfiles(context, changed);
    if (deliverMail) notifications.push(...(context.mailbox?.take(req.params.accountId) ?? []));

    const result = session.response(profileId, Number(req.query.rvn ?? -1), notifications);
    if (locks) {
      trackLock(locks, req);
      withLockExpiration(locks, req.params.accountId, result);
    }
    res.json(result);
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
    requireAuth(context.tokens), requireOwnAccount, runCommand(clientCommands, context, { deliverMail: true }));

  // Other accounts' profiles (a party member's banner and heroes), read only.
  router.post("/fortnite/api/game/v2/profile/:accountId/public/:command",
    requireAuth(context.tokens), requireExistingAccount(context), runCommand(publicCommands, context));

  // The gameserver acting for its players, with its DedicatedServer client token (UMcpProfileGroup::SendRequestNow's
  // dedicated-server branch, restored by CoreV2).
  router.post("/fortnite/api/game/v2/profile/:accountId/dedicated_server/:command",
    requireAuth(context.tokens), requireDedicatedServer, requireExistingAccount(context), runCommand(serverCommands, context, { locks: context.locks, notify: true }));

  // The client's DevSkipTutorial cheat posts here.
  router.post("/fortnite/api/admin/account/:accountId/:profileId/command/:command",
    requireLoopback, requireAuth(context.tokens), requireOwnAccount, runCommand(adminCommands, context));

  return router;
}

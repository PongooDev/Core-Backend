import express from "express";
import { requireAuth, requireDedicatedServer, requireOwnAccount } from "../../accounts/auth.js";
import { requireLoopback } from "../../admin/local.js";
import { currentBuild } from "../../builds/context.js";
import { McpError, sendError } from "../../errors.js";
import { log, recordUnknown } from "../../log.js";
import { isKnownProfile } from "../../profiles/ids.js";
import { lockTimeout } from "../../profiles/locks.js";
import { settleCloudSaves } from "../../profiles/outposts.js";
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
// notifications"), which is how its quests move in the zone. The admin panel's changes go out the same way.
export function notifyProfiles(context, session) {
  for (const { profileId, changes, revision, commandRevision } of session.changedProfiles()) {
    context.stomp?.publishProfile(session.accountId, { type: `profile/${profileId}/update`, changes, commandRevision, revision });
  }
}

// Another player's Battle Royale banner (the lobby's player menu: PlayerBanner's SetBannerIconAndColorFromProfile,
// UFortMcpContext::GetLoadoutForPlayer, 1.8's sub_709B80) comes from their athena profile in the profile group the
// viewer's client keeps for them. 1.8's UFortRegisteredPlayerInfo makes that group with an athena profile in it
// (sub_617700) but queries athena only for its own player or on a server (sub_61C940: NetMode or IsLocalController);
// for a party member it queries profile0 alone. Their athena stayed empty and its banner ids None, what the widget had
// just cleared to (ClearBannerState), so it kept the banner it last drew: the viewer's own. The client applies a
// response's multiUpdate to the group's profiles by profileId (sub_3C3D970), so another player's profile0 now brings
// their athena along: its stats and cosmetics, the loadout's (sub_41B610 reads banner_icon, banner_color and the
// favorite_* items), without their challenges.
const firstAthenaBuild = 3724489;

function publicCompanions(profileId) {
  return profileId === "profile0" && Number(currentBuild()) >= firstAthenaBuild ? ["athena"] : [];
}

function withoutQuests(update) {
  for (const change of update.profileChanges) {
    if (change.changeType !== "fullProfileUpdate") continue;
    const items = Object.entries(change.profile.items).filter(([, item]) => !item.templateId.toLowerCase().startsWith("quest:"));
    change.profile = { ...change.profile, items: Object.fromEntries(items) };
  }
}

// companions(profileId): the account's other profiles that go along whole (session.response). logReads logs who read
// whose profile0, which tells a party's two sides apart.
function runCommand(commands, context, {
  deliverMail = false, deliverScores = false, locks = null, notify = false, companions = () => [], logReads = false
} = {}) {
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
    // Storm shields go where the requesting build's client looks for them: profile0, or metadata from 1.7.2.
    if (profileId === "profile0" || profileId === "metadata") settleCloudSaves(session);
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
    // Another player's EarnScore XP for this one (profiles/scores.js), first: the server's handler finalizes the player
    // on the first earnScore it gets.
    if (deliverScores) notifications.unshift(...(context.heldScores?.take(req.params.accountId) ?? []));

    const whole = companions(profileId);
    const result = session.response(profileId, Number(req.query.rvn ?? -1), notifications, whole);
    const companionUpdates = (result.multiUpdate ?? []).filter((update) => whole.includes(update.profileId));
    for (const update of companionUpdates) withoutQuests(update);
    if (logReads && profileId === "profile0") {
      const sent = [profileId, ...companionUpdates.map((update) => update.profileId)];
      log("MCP", `${req.session.accountId ?? req.session.clientId} reads ${req.params.accountId}'s ${sent.join(" and ")}`);
    }
    if (locks) {
      trackLock(locks, req);
      withLockExpiration(locks, req.params.accountId, result);
    }
    res.json(result);
  };
}

// The players' EndPrimaryMissions go out on their own MCP queues right after the EarnScore sent through one of them,
// so one can arrive first: it waits for the game session's EarnScore, whose XP its response then carries
// (profiles/scores.js).
function waitForEarnScore({ heldScores, sessions }) {
  return async (req, res, next) => {
    const sessionId = req.params.command === "EndPrimaryMission" ? req.body?.matchmakingSessionId : null;
    if (heldScores && typeof sessionId === "string" && sessions.get(sessionId)) await heldScores.waitForScore(sessionId);
    next();
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

  // Other accounts' profiles (a party member's banner, power and heroes; from 1.8 their athena with profile0), read only.
  router.post("/fortnite/api/game/v2/profile/:accountId/public/:command",
    requireAuth(context.tokens), requireExistingAccount(context),
    runCommand(publicCommands, context, { companions: publicCompanions, logReads: true }));

  // The gameserver acting for its players, with its DedicatedServer client token (UMcpProfileGroup::SendRequestNow's
  // dedicated-server branch, restored by CoreV2).
  router.post("/fortnite/api/game/v2/profile/:accountId/dedicated_server/:command",
    requireAuth(context.tokens), requireDedicatedServer, requireExistingAccount(context), waitForEarnScore(context),
    runCommand(serverCommands, context, { deliverScores: true, locks: context.locks, notify: true }));

  // The client's DevSkipTutorial cheat posts here.
  router.post("/fortnite/api/admin/account/:accountId/:profileId/command/:command",
    requireLoopback, requireAuth(context.tokens), requireOwnAccount, runCommand(adminCommands, context));

  return router;
}

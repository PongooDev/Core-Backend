import express from "express";
import { requireAuth, requireDedicatedServer, requireOwnAccount } from "../../accounts/auth.js";
import { requireLoopback } from "../../admin/local.js";
import { currentBuild } from "../../builds/context.js";
import { McpError, sendError } from "../../errors.js";
import { log, recordUnknown } from "../../log.js";
import { mtxProfileId, noteClientBuild, usesCommonProfiles } from "../../profiles/common.js";
import { isKnownProfile } from "../../profiles/ids.js";
import { lockTimeout } from "../../profiles/locks.js";
import { settleCloudSaves } from "../../profiles/outposts.js";
import { openSession, storedProfileId } from "../../profiles/session.js";
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
// favorite_* items), without their challenges. From 3.5 a party member's first query is common_public (3.5.1's
// SynchronizeProfile 0xC86520 queries it for every player, campaign only out of Battle Royale), which brings athena.
const firstAthenaBuild = 3724489;
const publicProfileId = () => (usesCommonProfiles() ? "common_public" : "profile0");

function publicCompanions(profileId) {
  return profileId === publicProfileId() && Number(currentBuild()) >= firstAthenaBuild ? ["athena"] : [];
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
// A Battle Royale client never hears of what the gameserver changes in its profile0. Its V-Bucks are profile0's
// (UFortMcpContext::GetLocalAccountInfo, 3.0 0xCDC8F0: MtxBalance is profile0's GetMtxBalance, 0xD2F140), and a match's
// V-Bucks are paid into profile0 (services/fortnite/battleroyale.js), but in Battle Royale the client neither subscribes
// to its STOMP profile topic (it connects to STOMP on entering Save the World) nor asks for profile0 after a match: it
// queries athena alone (QueryProfile, ClientQuestLogin). So the lobby kept the balance it logged in with, 0 for a
// Battle Royale player, until the game was restarted (Core-Backend #236). A client command on another profile now
// brings profile0 along, whole, in its multiUpdate when it has changed since the client was last sent it; the client
// applies a multiUpdate to its profiles by profileId (1.8 sub_3C3D970). A client subscribed to its profile topic (Save
// the World) gets profile0's changes as notifications, so it isn't sent it again.
//
// From 3.5 the V-Bucks are common_core's (profiles/common.js), Core's view of profile0, and that is the one brought
// along, by its own revision.
//
// A purchase on the store page (services/fortnite/purchase.js) reaches the client the same way: its V-Bucks are the
// profile0 (common_core) change above, and a Starter Pack's cosmetics a change of athena, which a Battle Royale client
// doesn't hear of either (Core-Backend #294: the Wingman Starter Pack's V-Bucks came, its outfit and back bling stayed
// out of the locker until the game was restarted). So athena is brought along the same way, whole, once it has changed
// since the client was last sent it (a revision the client never had is not caught up: its login query is what it holds).
//
// sent: accountId -> {profileId -> the revision of that profile last sent to that account's client, in a response or a
// multiUpdate}.
function catchUpProfiles(session, stomp) {
  return [mtxProfileId(session.accountId), ...(Number(currentBuild()) >= firstAthenaBuild && session.hasProfile("athena") ? ["athena"] : [])]
    .filter((id) => session.hasProfile(id) && !stomp?.hasProfileSubscription?.(session.accountId));
}

function mtxCatchUp(sent, session, profileId, stomp) {
  const known = sent.get(session.accountId);
  const mtxProfile = mtxProfileId(session.accountId);
  return catchUpProfiles(session, stomp).filter((id) => id !== profileId
    && (id === mtxProfile ? known?.get(id) === undefined || session.revision(id) > known.get(id)
      : known?.get(id) !== undefined && session.revision(id) > known.get(id)));
}

function noteMtxSent(sent, accountId, result) {
  const known = sent.get(accountId) ?? new Map();
  for (const update of [result, ...(result.multiUpdate ?? [])]) {
    if (update.profileId === mtxProfileId(accountId) || update.profileId === "athena") known.set(update.profileId, update.profileRevision);
  }
  sent.set(accountId, known);
}

function runCommand(commands, context, {
  deliverMail = false, deliverScores = false, locks = null, notify = false, companions = () => [], logReads = false, catchUp = null,
  ownClient = false
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

    if (ownClient) noteClientBuild(req.params.accountId, currentBuild());
    const session = openSession(profiles, req.params.accountId);
    // 3.5's campaign, common_core and common_public are kept in profile0 (profiles/common.js). To the commands a command
    // on campaign is profile0's, by which they tell Save the World's profile; common_core and common_public keep their
    // own ids.
    const storedId = storedProfileId(profileId);
    const commandProfileId = profileId === "campaign" ? storedId : profileId;
    // Storm shields go where the requesting build's client looks for them: profile0, or metadata from 1.7.2.
    if (storedId === "profile0" || profileId === "metadata") settleCloudSaves(session);
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
      command({ req, profile: tracker.profile, tracker, session, notifications, profileId: commandProfileId, sessionFor, context });
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
    const caughtUp = catchUp ? mtxCatchUp(catchUp, session, profileId, context.stomp) : [];
    const result = session.response(profileId, Number(req.query.rvn ?? -1), notifications, [...whole, ...caughtUp]);
    if (catchUp) noteMtxSent(catchUp, req.params.accountId, result);
    const companionUpdates = (result.multiUpdate ?? []).filter((update) => whole.includes(update.profileId));
    for (const update of companionUpdates) withoutQuests(update);
    if (logReads && profileId === publicProfileId()) {
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
    requireAuth(context.tokens), requireOwnAccount, runCommand(clientCommands, context, { deliverMail: true, catchUp: new Map(), ownClient: true }));

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

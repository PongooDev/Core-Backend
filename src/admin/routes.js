import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isBookPage } from "../collectionbook/book.js";
import { bannerTemplateId } from "../gamedata/banners.js";
import { notFound, sendError } from "../errors.js";
import { getNode } from "../gamedata/homebase.js";
import { getItem } from "../gamedata/items.js";
import { getQuest, questName } from "../gamedata/quests.js";
import { athenaCosmetics } from "../gamedata/athena.js";
import { dataBuilds, readGameData } from "../gamedata/read.js";
import { recentLogs } from "../log.js";
import { sessionSummary } from "../matchmaking/sessions.js";
import { defaultHostingIps, hostingIp, httpsProxied, maxHostingIps } from "../network.js";
import { alertsRemaining, clearedAlertRecord, emptyAlertRecord, withQuotaSlots } from "../profiles/alerts.js";
import { fullLockerState, grantCosmetic, grantFullLocker, grantShopCosmetics, lockerCosmeticId, lockerCosmetics, maxSeasonLevel, ownsCosmetic, removeFullLocker, removeLockerCosmetic,
  setSeasonLevel } from "../profiles/athena.js";
import { levelRest, restBalance, restValue } from "../profiles/boosts.js";
import { foundersEditionOf, foundersEditions, setFoundersEdition } from "../profiles/founders.js";
import { findItem, grantItem, grantPlainItem, worldStacksNeeded } from "../profiles/items.js";
import { claimQuest, completeQuest, grant, skipTutorial } from "../profiles/progress.js";
import { createOutpost, storedCloudSaveProfile } from "../profiles/outposts.js";
import { questIdOf, tutorialCompleted } from "../profiles/quests.js";
import { openSession } from "../profiles/session.js";
import { backpackState, inOverflow, vaultState, worldStackCap } from "../profiles/vault.js";
import { maxLevel, xpForLevel } from "../profiles/xp.js";
import { notifyProfiles } from "../services/mcp/profile.js";
import { catalogEntry, categories, currencies, describeCosmetics, describeItem, isSingleItem, isWorldType, knownTemplate, searchCatalog,
  stormShields } from "./describe.js";
import { createAdminGate } from "./local.js";
import { clearSessionCookie, extractAdminToken } from "./auth.js";
import { createRateLimiter, getClientIp } from "../services/portal/ratelimit.js";
import { defaultBattleRoyaleNews, defaultLoginMessage, defaultSubgameSelect } from "../services/content/pages.js";
import { maxNewsImageBytes, maxNewsImagePixels, newsImageValue, pruneNewsImages, saveNewsImage } from "../services/content/images.js";
import { inBuild } from "../builds/context.js";
import { allowedBuildList, otherBuilds } from "../builds/allowed.js";
import { battleRoyaleBuilds, battleRoyaleSeasons, buildVersions, certBuild, seasonName, seasonVersions, versionOf } from "../builds/detect.js";
import { contentUpdateStates, defaultContentUpdates } from "../events/contentupdates.js";
import { cosmeticRarity, cosmeticType, eligibleCosmetics, generateRandomShop, itemShopOffers, nextRotation, seasonEnd, seasonMoment, seasonStart, shopDay, soldCosmeticIds, weeklyStoreEnd, withoutSeasonStartRecording } from "../store/itemshop.js";
import { activeEventFlags, fortnitemares, mutantStorms } from "../events/events.js";
import { convertLeftoverCandy } from "../events/candyllamas.js";
import { ltmIds, ltmSchedule } from "../events/ltms.js";
import { convertLeftoverStormTickets } from "../events/stormllamas.js";
import { defaultEvents, defaultMatchmakingModes, defaultServerLimits } from "../settings/store.js";
import { calendarCacheMinutes } from "../services/fortnite/calendar.js";
import { defaultBattlePass, enrichedMilestones } from "../battlepass/season1.js";
import { bundleTiers, seasonPassConfig, seasonTiers, tierPrice } from "../battlepass/season2.js";
import { battlePassSeasons, resetBattlePass } from "../battlepass/reset.js";
import { buildOfSeason, inProfileSeason, profileSeason } from "../profiles/seasons.js";

import { isServerAccountName, validatePassword } from "../accounts/password.js";
import { EmailError } from "../accounts/store.js";
import { rewardItem } from "../friendcodes/rewards.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const panel = path.join(here, "panel.html");
const root = path.join(here, "..", "..");
const startedAt = new Date().toISOString();
const profileIds = ["profile0", "metadata", "theater0", "outpost0", "collection_book_people0", "collection_book_schematics0"];

function backendVersion() {
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  let commit = null;
  try {
    const head = fs.readFileSync(path.join(root, ".git", "HEAD"), "utf8").trim();
    const ref = head.startsWith("ref: ") ? head.slice(5) : null;
    commit = (ref ? fs.readFileSync(path.join(root, ".git", ref), "utf8") : head).trim().slice(0, 7);
  } catch {
    // Not a git checkout (a release): the version is enough.
  }
  return { version, commit };
}

// The most single items (heroes, survivors, schematics, defenders, llamas...; describe.js isSingleItem) one grant may
// make: each unit is a profile item of its own, which the game's vault counts one by one (its limit starts at 200,
// profiles/vault.js) and every login downloads in full (#34). The panel asks before granting more than
// singleGrantConfirm of them.
export const singleGrantCap = 500;
export const singleGrantConfirm = 10;

const categoryOrder = (key) => categories.findIndex(([category]) => category === key);
const invalid = (res, message) => sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", message);
const sum = (profile, templates) => Object.values(profile?.items ?? {})
  .filter((item) => templates.some((templateId) => templateId.toLowerCase() === item.templateId.toLowerCase()))
  .reduce((total, item) => total + item.quantity, 0);

export function adminRoutes(context) {
  const { accounts, profiles, tokens, sessions, matchmaker, xmpp, stomp, settings, network, dataDir, resetTokens, reports, adminAuth } = context;
  const router = express.Router();
  router.use("/admin", createAdminGate({ adminAuth, settings }));
  // Sign-in attempts from another device, on top of auth.js's per-credential lockout (this PC is exempt).
  const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, message: "Too many sign-in attempts. Please wait a few minutes." });

  const loadIfExists = (accountId, profileId) => (profiles.exists(accountId, profileId) ? profiles.load(accountId, profileId) : null);
  const online = (accountId) => xmpp?.isOnline(accountId) ?? false;
  const sessionsOf = (accountId) => sessions.list()
    .filter((session) => [...session.publicPlayers, ...session.privatePlayers].includes(accountId) || session.ownerId === accountId)
    .map(sessionSummary);

  function summary(account) {
    const profile = loadIfExists(account.id, "profile0");
    return {
      id: account.id,
      displayName: account.displayName,
      email: account.email ?? null,
      // The player's own email (#120), which they sign in with; email is the <name>@core.com the game sees.
      contactEmail: account.contactEmail ?? null,
      created: account.created,
      lastLogin: account.lastLogin ?? null,
      level: profile?.stats.attributes.level ?? null,
      vbucks: profile ? sum(profile, currencies[0].templates) : 0,
      tutorialCompleted: profile ? tutorialCompleted(profile) : false,
      online: online(account.id),
      banned: account.banned ?? null,
      // The Custom Matchmaking permission (#186): the player's party may open a custom matchmaking key.
      customMatchmaking: account.customMatchmaking === true,
      hasPassword: Boolean(account.password),
      isServer: isServerAccountName(account.displayName)
    };
  }

  const inventory = (profile) => Object.entries(profile?.items ?? {})
    .filter(([, item]) => !questIdOf(item))
    .map(([itemId, item]) => ({
      itemId, ...describeItem(item.templateId), quantity: item.quantity, level: item.attributes.level ?? null,
      favorite: Boolean(item.attributes.favorite), squad: item.attributes.squad_id || null, packSource: item.attributes.pack_source ?? null,
      overflow: inOverflow(item)
    }))
    .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category) || a.name.localeCompare(b.name));

  function details(account) {
    const profile = loadIfExists(account.id, "profile0");
    const stats = profile?.stats.attributes ?? {};
    const level = stats.level ?? 1;
    // Every quest profile0 holds, whatever its state: the tutorial's (Onboarding) and the completed and claimed ones too,
    // which stay in the profile (Core-Backend #216; only a claimed daily quest leaves it, at the next day's rollover, as
    // Epic's did). Its name is the game's (gamedata questnames), its date the last state change (quest_state's
    // last_state_change_time: for a Completed or Claimed quest, when it got there).
    const stateOrder = { Active: 0, Completed: 1, Claimed: 2 };
    const quests = Object.entries(profile?.items ?? {})
      .filter(([, item]) => questIdOf(item))
      .map(([itemId, item]) => {
        const questId = questIdOf(item);
        const quest = getQuest(questId);
        const objectives = (quest?.objectives ?? []).map(({ name, count }) => ({ name, count, progress: item.attributes[`completion_${name}`] ?? 0 }));
        return {
          itemId, questId, name: questName(questId) ?? null, type: quest?.type ?? null, state: item.attributes.quest_state,
          tutorial: quest?.type === "Onboarding", hidden: quest?.hidden === true, stateChanged: item.attributes.last_state_change_time ?? null,
          objectives
        };
      })
      .sort((a, b) => Number(b.tutorial) - Number(a.tutorial) || (stateOrder[a.state] ?? 3) - (stateOrder[b.state] ?? 3)
        || (a.name ?? a.questId).localeCompare(b.name ?? b.questId));
    const record = stats.mission_alert_redemption_record;
    const restItem = profile && Object.values(profile.items).find((item) => item.templateId.toLowerCase() === "quota:restxp");
    const items = inventory(profile);
    const worldItems = inventory(loadIfExists(account.id, "theater0"));
    // profile0's up to 1.2, metadata's from 1.7.2 (profiles/outposts.js).
    const shieldProfile = loadIfExists(account.id, storedCloudSaveProfile((profileId) => profiles.exists(account.id, profileId), (profileId) => profiles.load(account.id, profileId)));

    return {
      ...summary(account),
      homebaseName: stats.homebase?.townName ?? "",
      xp: stats.xp ?? 0,
      maxLevel: maxLevel(),
      xpForLevel: level < maxLevel() ? xpForLevel(level) : null,
      currencies: currencies.map(({ key, label, templates }) => ({ key, label, quantity: sum(profile, templates) })),
      restXp: restItem ? { value: restValue(restItem.attributes), max: restItem.attributes.max_quota ?? 0 } : null,
      missionAlerts: record ? { remaining: alertsRemaining(withQuotaSlots(record)), pending: record.pendingMissionAlertRewards?.items?.length ?? 0 } : null,
      stormShields: stormShields.map((templateId) => {
        const itemId = shieldProfile && findItem(shieldProfile, templateId);
        const info = getItem(templateId);
        return { templateId, name: info?.name ?? templateId, level: itemId ? shieldProfile.items[itemId].attributes.level ?? 0 : null, maxLevel: info?.maxLevel ?? 10 };
      }),
      // The founder's pack edition (profiles/founders.js): the highest Token:FoundersPack_<n> held.
      founders: { edition: profile ? foundersEditionOf(profile) : null, editions: foundersEditions.map(({ edition, name }) => ({ edition, name })) },
      quests,
      items,
      worldItems,
      // The vault ("Inventory n / limit" in the game) and the backpack: what counts toward each limit.
      vault: profile ? vaultState(profile) : null,
      backpack: profile ? backpackState(loadIfExists(account.id, "theater0") ?? { items: {} }, profile) : null,
      storage: inventory(loadIfExists(account.id, "outpost0")),
      // The book profiles' slotted items; their page items are the unlocked pages.
      collectionBook: [...inventory(loadIfExists(account.id, "collection_book_people0")), ...inventory(loadIfExists(account.id, "collection_book_schematics0"))]
        .filter((item) => !item.templateId.toLowerCase().startsWith("collectionbookpage:")),
      // Battle Royale's full locker (profiles/athena.js): what the account holds of every cosmetic and banner.
      locker: fullLockerState(loadIfExists(account.id, "athena"), profile),
      // Battle Royale's season level (profiles/athena.js), once the account has an athena profile.
      battleRoyale: battleRoyaleLevel(loadIfExists(account.id, "athena")),
      sessions: sessionsOf(account.id),
      profiles: profiles.ids(account.id)
    };
  }

  // The season the profile is in (1.11's Season 2 with its Battle Pass, profiles/seasons.js), with that season's cap.
  function battleRoyaleLevel(athena) {
    const attributes = athena?.stats?.attributes;
    if (!attributes) return null;
    return {
      level: attributes.level ?? 1, xp: attributes.xp ?? 0, maxLevel: inProfileSeason(athena, maxSeasonLevel), season: profileSeason(athena),
      ...(profileSeason(athena) > 1 ? { bookLevel: attributes.book_level ?? 1, bookXp: attributes.book_xp ?? 0, bookPurchased: attributes.book_purchased === true } : {}),
      // Each season's Battle Pass, for its reset (Core-Backend #201): the profile's season's from its stats, the others'
      // from their records, and the V-Bucks paid Core for it that a reset refunds.
      battlePasses: battlePassSeasons().map((season) => {
        const record = season === profileSeason(athena) ? attributes : athena.coreSeasons?.[season] ?? {};
        const paid = Object.values(athena.coreBattlePassSpend?.[String(season)] ?? {}).reduce((sum, amount) => sum + amount, 0);
        return { season, tier: record.book_level ?? 1, purchased: record.book_purchased === true, paid };
      })
    };
  }

  // Runs a change on an account's profiles and answers with its new details. A player in the game gets the change as
  // MCP profile notifications on STOMP, as with the gameserver's commands (services/mcp/profile.js).
  function change(handler) {
    return (req, res) => {
      const account = accounts.get(req.params.accountId);
      if (!account) return notFound(res, req.originalUrl);
      const session = openSession(profiles, account.id);
      const result = handler({ req, res, account, session });
      if (res.headersSent) return;
      session.commit();
      notifyProfiles(context, session);
      res.json({ ...details(account), ...(result && typeof result === "object" ? result : {}) });
    };
  }

  function kick(account) {
    tokens.revokeAccount(account.id);
    xmpp?.kick(account.id);
    stomp?.kick(account.id);
  }

  router.get("/admin", (req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(panel);
  });
  // Browsers ask for this on any page; the panel has its own icon.
  router.get("/favicon.ico", (req, res) => res.status(204).end());

  // Admin sign-in (Core-Backend #134). createAdminGate (local.js) has already let the request in: this PC always, and
  // another device only with remote admin on and, past these sign-in routes, a session.
  const remoteAdminOn = () => settings?.get?.().remoteAdmin === true && Boolean(adminAuth?.hasUsers());
  const localOnly = (req, res) => {
    if (req.adminLocal) return false;
    sendError(res, 403, "errors.com.epicgames.common.missing_permission", "Admin credentials are managed on the backend's own PC");
    return true;
  };

  router.get("/admin/api/auth/me", (req, res) => {
    const local = Boolean(req.adminLocal);
    const signedIn = Boolean(req.adminSession);
    res.json({
      authenticated: local || signedIn,
      requireAuth: !local && !signedIn,
      hasUsers: adminAuth ? adminAuth.hasUsers() : false,
      remoteAdmin: remoteAdminOn(),
      isLoopback: local,
      user: signedIn ? req.adminUser : (local ? { username: "Local", isLocal: true } : null),
      // A cookie came but its session is gone (signed out elsewhere, password changed, or a backend restart).
      sessionExpired: !local && !signedIn && Boolean(extractAdminToken(req))
    });
  });

  router.post("/admin/api/auth/login", loginLimiter, async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", "Username and password are required");
    }
    if (!adminAuth) {
      return sendError(res, 500, "errors.com.epicgames.common.server_error", "Admin auth not configured");
    }
    const result = await adminAuth.verifyCredentials(username, password, getClientIp(req));
    if (!result.success) {
      if (result.lockedOut) {
        res.setHeader("Retry-After", String(result.retryAfter || 900));
        return res.status(429).json({
          errorCode: "errors.com.epicgames.common.throttled",
          errorMessage: result.error,
          retryAfter: result.retryAfter
        });
      }
      return res.status(401).json({
        errorCode: "errors.com.epicgames.common.authentication.authentication_failed",
        errorMessage: result.error,
        ipMismatch: Boolean(result.ipMismatch)
      });
    }
    // A new token on every sign-in, and the one the browser came with (if any) ends: no session fixation.
    const previous = extractAdminToken(req);
    if (previous) adminAuth.revokeSession(previous);
    const session = adminAuth.issueSession(result.user, req.socket.remoteAddress);
    res.setHeader("Set-Cookie", session.cookie);
    res.json({ success: true, token: session.token, user: result.user });
  });

  // Signs this session's credential out everywhere. Only a valid session can do that: who to sign out is never taken
  // from the body, or anyone who reaches the sign-in page could end every admin's sessions.
  router.post("/admin/api/auth/logout", (req, res) => {
    const token = extractAdminToken(req);
    if (adminAuth && token) {
      if (req.adminSession?.userId) adminAuth.revokeUserSessions(req.adminSession.userId);
      adminAuth.revokeSession(token);
    }
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.json({ success: true });
  });

  // Admin credentials: listed to any admin, changed only on this PC (a signed-in device may change its own password).
  router.get("/admin/api/admin-users", (req, res) => {
    res.json({ users: adminAuth ? adminAuth.listUsers() : [] });
  });

  router.post("/admin/api/admin-users", async (req, res) => {
    if (localOnly(req, res)) return;
    if (!adminAuth) return sendError(res, 500, "errors.com.epicgames.common.server_error", "Admin auth not configured");
    try {
      const { username, password, allowedIp } = req.body ?? {};
      if (allowedIp !== undefined && allowedIp !== null && typeof allowedIp !== "string") throw new Error("Invalid IP address format");
      const user = await adminAuth.addUser({ username, password, allowedIp });
      // A credential alone doesn't open the admin to other devices: remoteAdmin stays as the owner set it.
      res.status(201).json({ success: true, user });
    } catch (error) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", error.message);
    }
  });

  router.post("/admin/api/admin-users/:id/password", async (req, res) => {
    if (!req.adminLocal && req.adminSession?.userId !== req.params.id) {
      return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "Another credential's password is changed on the backend's own PC");
    }
    if (!adminAuth) return sendError(res, 500, "errors.com.epicgames.common.server_error", "Admin auth not configured");
    try {
      const { newPassword } = req.body ?? {};
      await adminAuth.updatePassword(req.params.id, newPassword);
      res.json({ success: true });
    } catch (error) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", error.message);
    }
  });

  router.post("/admin/api/admin-users/:id/ip", (req, res) => {
    if (localOnly(req, res)) return;
    if (!adminAuth) return sendError(res, 500, "errors.com.epicgames.common.server_error", "Admin auth not configured");
    try {
      const { allowedIp } = req.body ?? {};
      if (allowedIp !== undefined && allowedIp !== null && typeof allowedIp !== "string") throw new Error("Invalid IP address format");
      const user = adminAuth.updateAllowedIp(req.params.id, allowedIp);
      res.json({ success: true, user });
    } catch (error) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", error.message);
    }
  });

  router.delete("/admin/api/admin-users/:id", (req, res) => {
    if (localOnly(req, res)) return;
    if (!adminAuth) return sendError(res, 500, "errors.com.epicgames.common.server_error", "Admin auth not configured");
    try {
      res.json(adminAuth.deleteUser(req.params.id));
    } catch (error) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", error.message);
    }
  });

  // Core's gameservers sign in as accounts too (CoreServer{n}, CoreServer-<PC>-{n}): they aren't players, so the panel's
  // counts, online list, recent logins and account list leave them out (Core-Backend #137).
  const isPlayer = (account) => !isServerAccountName(account.displayName);

  router.get("/admin/api/overview", (req, res) => {
    const list = accounts.list().filter(isPlayer);
    res.json({
      ...backendVersion(),
      startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      port: req.socket.localPort,
      dataDir,
      accounts: list.length,
      banned: list.filter((account) => account.banned).length,
      online: (xmpp?.onlineAccounts() ?? []).map(({ accountId, resources }) => ({ accountId, displayName: accounts.get(accountId)?.displayName ?? accountId, resources }))
        .filter(({ displayName }) => !isServerAccountName(displayName)),
      sessions: sessions.list().map(sessionSummary),
      recentLogins: list.filter((account) => account.lastLogin).sort((a, b) => b.lastLogin.localeCompare(a.lastLogin)).slice(0, 8).map(summary)
    });
  });

  router.get("/admin/api/accounts", (req, res) => {
    const query = String(req.query.search ?? "").trim().toLowerCase();
    const list = accounts.list()
      .filter(isPlayer)
      .filter((account) => !query || account.displayName.toLowerCase().includes(query) || account.id.includes(query)
        || account.contactEmail?.includes(query))
      .map(summary);
    list.sort((a, b) => (b.lastLogin ?? b.created).localeCompare(a.lastLogin ?? a.created));
    res.json(list);
  });

  router.get("/admin/api/accounts/:accountId", (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    res.json(details(account));
  });

  router.get("/admin/api/catalog", (req, res) => {
    res.json({ categories, items: searchCatalog(req.query.search, req.query.category, Math.min(Number(req.query.limit) || 60, 500)), singleGrantCap, singleGrantConfirm });
  });

  // Kept for scripts: every template id the panel can give.
  router.get("/admin/api/items", (req, res) => {
    res.json(searchCatalog("", "", Infinity).map((entry) => entry.templateId).sort());
  });

  // Give by id (Core-Backend #109): what a template id the admin typed is. A Battle Royale cosmetic is the newest build's
  // with Battle Royale that has it (it goes to the locker); anything else is known when some build's data has it.
  // A template no build has is given only with force, as a plain item in the profile its type belongs in.
  const templatePattern = /^[A-Za-z][A-Za-z0-9_]*:[^\s:]+$/;
  const malformed = (res, templateId) => invalid(res, `${templateId ? `"${templateId}"` : "An empty id"} isn't a template id: write it as Type:name, e.g. Hero:hid_constructor_007hw_sr_t01`);
  const isCosmeticType = (type) => type.toLowerCase().startsWith("athena");
  // The newest build with Battle Royale whose locker has the cosmetic, and its id as that build spells it.
  const lockerCosmeticOf = (templateId) => [...battleRoyaleBuilds].reverse()
    .map((build) => ({ build, templateId: inBuild(build, () => lockerCosmeticId(templateId)) })).find((found) => found.templateId);
  const anyCosmetic = (templateId) => battleRoyaleBuilds.some((build) => inBuild(build, () => Object.keys(athenaCosmetics())
    .some((id) => id.toLowerCase() === templateId.toLowerCase())));
  const forcedProfileId = (type) => (isCosmeticType(type) ? "athena" : isWorldType(type) ? "theater0" : "profile0");
  // Collection book pages, from Cert's data when it has the page, else the newest build's that has it.
  const pageBuild = (name) => [certBuild, ...dataBuilds.filter((build) => build !== certBuild).sort((a, b) => Number(b) - Number(a))]
    .find((build) => inBuild(build, () => isBookPage(name)));

  // ?templateId=: whether a grant knows the template ({known, item}: its catalog entry), or where force would put it
  // ({known: false, profileId}). The panel asks before giving a template no build has.
  router.get("/admin/api/catalog/lookup", (req, res) => {
    const templateId = String(req.query.templateId ?? "").trim();
    if (!templatePattern.test(templateId)) return malformed(res, templateId);
    const [type, name] = templateId.split(":");
    const other = (item) => res.json({ known: true, item: { templateId, name: templateId, category: "other", single: false, builds: null, ...item } });
    if (isCosmeticType(type)) {
      const cosmetic = lockerCosmeticOf(templateId);
      if (cosmetic) {
        const [described] = inBuild(cosmetic.build, () => describeCosmetics([cosmetic.templateId]));
        const first = battleRoyaleBuilds.find((build) => inBuild(build, () => lockerCosmeticId(templateId)));
        return other({ templateId: cosmetic.templateId, name: described.name, builds: `${versionOf(first)}+` });
      }
      if (anyCosmetic(templateId)) return other({});
    } else if (type.toLowerCase() === "collectionbookpage") {
      if (pageBuild(name)) return other({ name: `Collection book page ${name}` });
      return invalid(res, `Unknown collection book page ${name}`);
    } else if (knownTemplate(templateId)) {
      return res.json({ known: true, item: catalogEntry(templateId) });
    }
    res.json({ known: false, templateId, profileId: forcedProfileId(type) });
  });

  // Gives an item the normal way, so quests that wait on it move on too. {templateId, quantity, force}: any template some
  // build's data has, checked and given with that build's data (describe.js knownTemplate); with force, one none has.
  router.post("/admin/api/accounts/:accountId/grant", change(({ req, res, session }) => {
    const templateId = String(req.body?.templateId ?? "").trim();
    const quantity = Number(req.body?.quantity ?? 1);
    const force = req.body?.force === true;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) return invalid(res, "Quantity must be 1 to 1000000");
    if (!templatePattern.test(templateId)) return malformed(res, templateId);
    const [type, name] = templateId.split(":");
    const unknown = () => invalid(res, `Unknown item ${templateId}: no build's game data has it, so the game may not know it. Give it with force to add it anyway`);

    if (isCosmeticType(type)) {
      const cosmetic = lockerCosmeticOf(templateId);
      if (!cosmetic && anyCosmetic(templateId)) return invalid(res, `${templateId} is never a locker item`);
      if (!cosmetic && !force) return unknown();
      const given = inBuild(cosmetic?.build ?? battleRoyaleBuilds.at(-1), () => grantCosmetic(session, cosmetic?.templateId ?? templateId, { force: !cosmetic }));
      return { granted: given ? 1 : 0 };
    }
    if (type.toLowerCase() === "collectionbookpage") {
      const build = pageBuild(name);
      if (!build) return invalid(res, `Unknown collection book page ${name}`);
      return inBuild(build, () => ({ granted: grant(session, templateId, quantity).length }));
    }

    const known = knownTemplate(templateId);
    if (!known) {
      if (!force) return unknown();
      const profileId = forcedProfileId(type);
      if (profileId === "theater0" && Object.keys(session.profile("theater0").profile.items).length >= worldStackCap) {
        return invalid(res, `The backpack already holds ${worldStackCap} stacks, the most it can`);
      }
      return { granted: 1, forced: grantPlainItem(session, profileId, templateId, quantity) };
    }
    // The checks and the grant read the data of the build a grant of it uses (Cert's when Cert has it).
    return inBuild(known.build, () => {
      const info = getItem(known.templateId);
      if (isSingleItem(known.templateId) && quantity > singleGrantCap) {
        return invalid(res, `${describeItem(known.templateId).name} is kept one per item: give at most ${singleGrantCap} at a time`);
      }
      // bNeverPersisted items (ability ammo, quest pickups) only exist in a zone; the game never saves one to a profile.
      if (info?.neverPersisted) return invalid(res, `${known.templateId} only exists in a zone and is never kept in a profile`);
      // The world inventory holds at most 512 stacks (profiles/vault.js); past that the game keeps nothing.
      if (info?.profile === "theater") {
        const theater = session.profile("theater0").profile;
        const needed = worldStacksNeeded(theater, known.templateId, quantity);
        const stacks = Object.keys(theater.items).length;
        if (stacks + needed > worldStackCap) return invalid(res, `That needs ${needed} new backpack stacks; the backpack holds ${stacks} of at most ${worldStackCap}`);
      }
      return { granted: grant(session, known.templateId, quantity).length };
    });
  }));

  // {key, quantity}: sets one of the panel's balances (V-Bucks, skill points…) to exactly quantity.
  router.post("/admin/api/accounts/:accountId/currency", change(({ req, res, session }) => {
    const currency = currencies.find((entry) => entry.key === req.body?.key);
    const quantity = Number(req.body?.quantity);
    if (!currency) return invalid(res, `Unknown balance ${req.body?.key}`);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1_000_000_000) return invalid(res, "The amount must be 0 to 1000000000");
    const tracker = session.profile("profile0");
    for (const [itemId, item] of Object.entries(tracker.profile.items)) {
      if (currency.templates.some((templateId) => templateId.toLowerCase() === item.templateId.toLowerCase())) tracker.removeItem(itemId);
    }
    if (quantity > 0) grantItem(session, currency.setAs ?? currency.templates[0], quantity);
  }));

  // {level}: the account level, at its start (no XP into it); rest XP takes the level's cap and rate.
  router.post("/admin/api/accounts/:accountId/level", change(({ req, res, session }) => {
    const level = Number(req.body?.level);
    if (!Number.isInteger(level) || level < 1 || level > maxLevel()) return invalid(res, `The level must be 1 to ${maxLevel()}`);
    const tracker = session.profile("profile0");
    tracker.setStat("level", level);
    tracker.setStat("xp", 0);
    levelRest(session, level);
  }));

  // {profileId, itemId, quantity?, level?}
  router.post("/admin/api/accounts/:accountId/items/update", change(({ req, res, session }) => {
    const { profileId = "profile0", itemId, quantity, level } = req.body ?? {};
    if (!profileIds.includes(profileId)) return invalid(res, `Unknown profile ${profileId}`);
    const tracker = session.profile(profileId);
    const item = tracker.profile.items[itemId];
    if (!item) return invalid(res, `No item ${itemId}`);
    if (quantity !== undefined) {
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1_000_000_000) return invalid(res, "The quantity must be 0 to 1000000000");
      if (quantity === 0) return void tracker.removeItem(itemId);
      tracker.setQuantity(itemId, quantity);
    }
    if (level !== undefined) {
      const cap = describeItem(item.templateId).maxLevel ?? 50;
      if (!Number.isInteger(level) || level < 0 || level > cap) return invalid(res, `The level must be 0 to ${cap}`);
      tracker.setItemAttribute(itemId, "level", level);
    }
  }));

  // {profileId, itemId}
  router.post("/admin/api/accounts/:accountId/items/remove", change(({ req, res, session }) => {
    const { profileId = "profile0", itemId } = req.body ?? {};
    if (!profileIds.includes(profileId)) return invalid(res, `Unknown profile ${profileId}`);
    const tracker = session.profile(profileId);
    if (!tracker.profile.items[itemId]) return invalid(res, `No item ${itemId}`);
    tracker.removeItem(itemId);
  }));

  // {profileId, templateId, keep = 0}: removes the copies of a template past the first keep, for an account given too
  // many (#34). Items in a squad stay (the game would find an empty slot); favourites go after the rest, and items in
  // the vault's overflow first. Answers with removed and kept counts.
  router.post("/admin/api/accounts/:accountId/items/remove-template", change(({ req, res, session }) => {
    const { profileId = "profile0", templateId, keep = 0 } = req.body ?? {};
    if (!profileIds.includes(profileId)) return invalid(res, `Unknown profile ${profileId}`);
    if (typeof templateId !== "string" || !templateId) return invalid(res, "Choose a template");
    if (!Number.isInteger(keep) || keep < 0) return invalid(res, "keep must be 0 or more");
    const tracker = session.profile(profileId);
    const copies = Object.entries(tracker.profile.items)
      .filter(([, item]) => item.templateId.toLowerCase() === templateId.toLowerCase() && !questIdOf(item));
    if (!copies.length) return invalid(res, `No ${templateId} in ${profileId}`);
    const rank = ([, item]) => (item.attributes?.squad_id ? 3 : item.attributes?.favorite ? 2 : inOverflow(item) ? 0 : 1);
    // Kept first: squad members, favourites, then the oldest (profile order), overflow last.
    const order = copies.map((entry, index) => ({ entry, index })).sort((a, b) => rank(b.entry) - rank(a.entry) || a.index - b.index);
    const removable = order.slice(keep).filter(({ entry }) => !entry[1].attributes?.squad_id);
    for (const { entry: [itemId] } of removable) tracker.removeItem(itemId);
    return { removed: removable.length, kept: copies.length - removable.length };
  }));

  // {itemId, action: complete | claim | remove}
  router.post("/admin/api/accounts/:accountId/quests", change(({ req, res, session }) => {
    const { itemId, action } = req.body ?? {};
    const tracker = session.profile("profile0");
    const item = tracker.profile.items[itemId];
    if (!item || !questIdOf(item)) return invalid(res, `No quest ${itemId}`);
    if (action === "complete") {
      if (item.attributes.quest_state === "Active") completeQuest(session, itemId);
    } else if (action === "claim") {
      if (item.attributes.quest_state === "Active") completeQuest(session, itemId);
      if (tracker.profile.items[itemId]?.attributes.quest_state === "Completed") claimQuest(session, itemId);
    } else if (action === "remove") {
      tracker.removeItem(itemId);
    } else {
      return invalid(res, `Unknown quest action ${action}`);
    }
  }));

  // {templateId, level}: a storm shield's core, made if the player has none yet; its level counts defenses won.
  router.post("/admin/api/accounts/:accountId/storm-shield", change(({ req, res, session, account }) => {
    const { templateId, level } = req.body ?? {};
    const info = getItem(String(templateId ?? ""));
    if (info?.class !== "FortOutpostItemDefinition") return invalid(res, `No storm shield ${templateId}`);
    if (!Number.isInteger(level) || level < (info.minLevel ?? 0) || level > (info.maxLevel ?? 10)) {
      return invalid(res, `The level must be ${info.minLevel ?? 0} to ${info.maxLevel ?? 10}`);
    }
    const tracker = session.profile(storedCloudSaveProfile((profileId) => session.hasProfile(profileId), (profileId) => session.profile(profileId).profile));
    createOutpost(session, account.id, info.templateId, tracker);
    tracker.setItemAttribute(findItem(tracker.profile, info.templateId), "level", level);
  }));

  // {edition: 1-5}: raises the account's founder's pack edition (Standard, Deluxe, Super Deluxe, Limited, Ultimate) with
  // each missing edition's rewards quest, and the hero bundles of Limited and Ultimate; an edition can't be lowered.
  router.post("/admin/api/accounts/:accountId/founders", change(({ req, res, session }) => {
    const { error, granted } = setFoundersEdition(session, Number(req.body?.edition));
    if (error) return invalid(res, error);
    return { granted };
  }));

  // Battle Royale's full locker (Core-Backend #97): every cosmetic and banner of any build that the account lacks, and
  // taking back what that gave. Answers with how many were given or taken. What only Core's bookkeeping noted (which
  // items the panel gave) is saved even when no item changed.
  const lockerChange = (run) => change(({ session }) => {
    const result = run(session);
    for (const profileId of ["athena", "profile0"]) profiles.save(session.profile(profileId).profile);
    return result;
  });
  // {level}: Battle Royale's season level (Core-Backend #106), at its start, with its chase rewards.
  // The level is the season's the profile is in (profiles/seasons.js), its rewards that season's.
  router.post("/admin/api/accounts/:accountId/battle-royale-level", change(({ req, res, session, account }) => {
    const level = Number(req.body?.level);
    const athena = loadIfExists(account.id, "athena");
    if (!athena) return invalid(res, "The account has no Battle Royale profile yet: it's made when they first play Battle Royale");
    const top = inProfileSeason(athena, maxSeasonLevel);
    if (!Number.isInteger(level) || level < 1 || level > top) return invalid(res, `The season level must be 1 to ${top}`);
    inProfileSeason(athena, () => setSeasonLevel(session, level));
  }));
  // {season}: the season's Battle Pass back to before the player bought it (Core-Backend #201, battlepass/reset.js), the
  // profile's own season when none is named. Answers with what was taken back and refunded.
  router.post("/admin/api/accounts/:accountId/battle-pass/reset", change(({ req, res, session, account }) => {
    const athena = loadIfExists(account.id, "athena");
    if (!athena) return invalid(res, "The account has no Battle Royale profile yet: it's made when they first play Battle Royale");
    const season = req.body?.season === undefined || req.body?.season === "" ? profileSeason(athena) : Number(req.body.season);
    if (!battlePassSeasons().includes(season)) {
      return invalid(res, `Season ${req.body?.season ?? season} has no Battle Pass: pick one of ${battlePassSeasons().join(", ")}`);
    }
    const battlePassReset = resetBattlePass(session, season);
    // What only Core's bookkeeping holds (the season records, the rewards given, the purchases) is saved even when no item changed.
    for (const profileId of ["athena", "profile0"]) profiles.save(session.profile(profileId).profile);
    return { battlePassReset };
  }));
  router.post("/admin/api/accounts/:accountId/locker/grant-all", lockerChange((session) => ({ granted: grantFullLocker(session) })));
  router.post("/admin/api/accounts/:accountId/locker/remove-granted", lockerChange((session) => ({ removed: removeFullLocker(session) })));

  // Battle Royale cosmetics one by one (Core-Backend #108): a build's locker cosmetics, of every type, with which the
  // account owns, and giving some of them. Profiles are shared by every build, so the panel names the build whose
  // cosmetics it shows and gives, one with Battle Royale (detect.js battleRoyaleBuilds), and a cosmetic that build's game
  // data hasn't is refused. The backend doesn't record which build a player last played, so the default is the newest.
  // A grant is for good, as a purchase is (profiles/athena.js grantCosmetic): the full locker's Remove granted keeps it.
  const cosmeticBuilds = battleRoyaleBuilds.map((build) => ({ build, version: versionOf(build) }));
  const cosmeticBuild = (value) => {
    const build = String(value ?? "").trim() || battleRoyaleBuilds.at(-1);
    return battleRoyaleBuilds.includes(build) ? build : null;
  };
  const notBattleRoyaleBuild = (res, value) => invalid(res, `${value} isn't a build with Battle Royale: pick one of ${cosmeticBuilds
    .map(({ build, version }) => `${build} (${version})`).join(", ")}`);

  router.get("/admin/api/accounts/:accountId/cosmetics", (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    const build = cosmeticBuild(req.query.build);
    if (!build) return notBattleRoyaleBuild(res, req.query.build);
    const athena = loadIfExists(account.id, "athena");
    const held = new Set(Object.values(athena?.items ?? {}).map((item) => item.templateId.toLowerCase()));
    const all = inBuild(build, () => describeCosmetics(lockerCosmetics()))
      .map((cosmetic) => ({ ...cosmetic, owned: held.has(cosmetic.templateId.toLowerCase()) }));
    const type = String(req.query.type ?? "");
    const words = String(req.query.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const matches = all.filter((cosmetic) => !type || cosmetic.type === type)
      .filter((cosmetic) => words.every((word) => [cosmetic.name, cosmetic.templateId, cosmetic.type, cosmetic.rarity].some((text) => text.toLowerCase().includes(word))));
    res.json({
      build, version: versionOf(build), builds: cosmeticBuilds, hasProfile: Boolean(athena),
      types: [...new Set(all.map((cosmetic) => cosmetic.type))],
      total: all.length, owned: all.filter((cosmetic) => cosmetic.owned).length, matches: matches.length,
      items: matches.slice(0, Math.min(Number(req.query.limit) || 120, 1000))
    });
  });

  // {build, templateIds}: gives the account those of the build's cosmetics it lacks; one it owns is left as it is.
  router.post("/admin/api/accounts/:accountId/cosmetics/grant", change(({ req, res, session }) => {
    const build = cosmeticBuild(req.body?.build);
    if (!build) return notBattleRoyaleBuild(res, req.body?.build);
    const version = versionOf(build);
    const requested = (Array.isArray(req.body?.templateIds) ? req.body.templateIds : [req.body?.templateId])
      .map((templateId) => (typeof templateId === "string" ? templateId.trim() : "")).filter(Boolean);
    if (!requested.length || requested.length > 1000) return invalid(res, "Pick 1 to 1000 cosmetics to give");
    const unknown = requested.filter((templateId) => !inBuild(build, () => lockerCosmeticId(templateId)));
    if (unknown.length) return invalid(res, `${version} has no locker cosmetic ${unknown.join(", ")}: give only cosmetics that build has`);
    return inBuild(build, () => {
      const granted = [];
      const alreadyOwned = [];
      for (const templateId of new Set(requested.map(lockerCosmeticId))) {
        if (ownsCosmetic(session, templateId)) alreadyOwned.push(templateId);
        else if (grantCosmetic(session, templateId)) granted.push(templateId);
      }
      return { cosmeticGrant: { build, version, granted, alreadyOwned } };
    });
  }));

  // Give all item shop cosmetics (Core-Backend #163): every cosmetic the item shop has sold (each season's history and the
  // custom shop's lists, store/itemshop.js soldCosmeticIds) that is a locker cosmetic in any build's data, as the full
  // locker gives (accounts are shared by every build), not the build picked above. Given as the full locker's are, so
  // Remove granted takes them back (Remove selected takes any one). What only Core's bookkeeping noted is saved even when
  // no item changed.
  router.post("/admin/api/accounts/:accountId/cosmetics/grant-shop", change(({ session }) => {
    const shopGrant = grantShopCosmetics(session, soldCosmeticIds(settings?.get?.()?.itemShop));
    profiles.save(session.profile("athena").profile);
    return { shopGrant };
  }));

  // {build, templateIds}: takes those of the build's cosmetics the account owns out of its locker (Core-Backend #159), the
  // slots showing one back to their default (profiles/athena.js removeLockerCosmetic). A starter or an earned cosmetic
  // would come back, so it stays and the answer says why; with giveAllCosmetics on every one would, so none is taken.
  router.post("/admin/api/accounts/:accountId/cosmetics/remove", change(({ req, res, session }) => {
    const build = cosmeticBuild(req.body?.build);
    if (!build) return notBattleRoyaleBuild(res, req.body?.build);
    const version = versionOf(build);
    const requested = (Array.isArray(req.body?.templateIds) ? req.body.templateIds : [req.body?.templateId])
      .map((templateId) => (typeof templateId === "string" ? templateId.trim() : "")).filter(Boolean);
    if (!requested.length || requested.length > 1000) return invalid(res, "Pick 1 to 1000 cosmetics to remove");
    const unknown = requested.filter((templateId) => !inBuild(build, () => lockerCosmeticId(templateId)));
    if (unknown.length) return invalid(res, `${version} has no locker cosmetic ${unknown.join(", ")}: remove only cosmetics that build has`);
    if (!session.hasProfile("athena")) return invalid(res, "The account has no Battle Royale profile yet, so it owns no cosmetics to remove");
    if (session.settings?.giveAllCosmetics) {
      return invalid(res, "giveAllCosmetics is on (config.json): every cosmetic is given back to every account, so none can be removed");
    }
    return inBuild(build, () => {
      const removed = [];
      const notOwned = [];
      const kept = [];
      for (const templateId of new Set(requested.map(lockerCosmeticId))) {
        const result = removeLockerCosmetic(session, templateId);
        if (result.removed) removed.push(templateId);
        else if (result.kept) kept.push({ templateId, reason: result.kept });
        else notOwned.push(templateId);
      }
      // What only Core's bookkeeping noted (the full locker's and the blanket grant's lists) is saved even when no item changed.
      profiles.save(session.profile("athena").profile);
      return { cosmeticRemoval: { build, version, removed, notOwned, kept } };
    });
  }));

  router.post("/admin/api/accounts/:accountId/skip-tutorial", change(({ session }) => skipTutorial(session)));

  // Today's mission alert quota back to full.
  router.post("/admin/api/accounts/:accountId/mission-alerts/reset", change(({ session }) => {
    const tracker = session.profile("profile0");
    const record = withQuotaSlots(tracker.profile.stats.attributes.mission_alert_redemption_record ?? emptyAlertRecord());
    // The per-category claims of 1.7.2 and later and 2.2's (profiles/alerts.js) too, whichever builds' shapes the record has.
    tracker.setStat("mission_alert_redemption_record", clearedAlertRecord(record));
  }));

  // Rest XP back to its cap.
  router.post("/admin/api/accounts/:accountId/rest-xp/refill", change(({ session }) => {
    restBalance(session);
    const tracker = session.profile("profile0");
    const itemId = findItem(tracker.profile, "Quota:restxp");
    const item = tracker.profile.items[itemId];
    tracker.setItemAttribute(itemId, "current_value", item.attributes.max_quota ?? 0);
    tracker.setItemAttribute(itemId, "last_mod_time", new Date().toISOString());
  }));

  // {profiles: [ids] | "all"}: the profiles start over from the defaults; the player is logged out so the game reloads.
  router.post("/admin/api/accounts/:accountId/reset", (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    const wanted = req.body?.profiles === "all" ? profiles.ids(account.id) : req.body?.profiles;
    if (!Array.isArray(wanted) || !wanted.length || !wanted.every((profileId) => profileIds.includes(profileId))) {
      return invalid(res, `Choose profiles from ${profileIds.join(", ")} or "all"`);
    }
    kick(account);
    for (const profileId of wanted) profiles.remove(account.id, profileId);
    res.json(details(account));
  });

  // Logs the player out everywhere: tokens revoked, XMPP and STOMP closed. The game returns to the login screen.
  router.post("/admin/api/accounts/:accountId/kick", (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    kick(account);
    res.json(details(account));
  });

  // {reason}: a banned account is kicked and can't log in again until unbanned.
  router.post("/admin/api/accounts/:accountId/ban", (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    accounts.setBan(account, { reason: String(req.body?.reason ?? "").trim().slice(0, 200), at: new Date().toISOString() });
    kick(account);
    res.json(details(account));
  });

  // {allowed}: grants or takes back the Custom Matchmaking permission (Core-Backend #186, matchmaking/service.js).
  router.post("/admin/api/accounts/:accountId/custom-matchmaking", (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    if (typeof req.body?.allowed !== "boolean") return invalid(res, "allowed must be true or false");
    accounts.setCustomMatchmaking(account, req.body.allowed);
    res.json(details(account));
  });

  router.post("/admin/api/accounts/:accountId/unban", (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    accounts.setBan(account, null);
    res.json(details(account));
  });

  // {confirm: displayName}: removes the account and everything saved for it.
  router.post("/admin/api/accounts/:accountId/delete", (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    if (req.body?.confirm !== account.displayName) return invalid(res, `Type the account name (${account.displayName}) to confirm`);
    kick(account);
    accounts.remove(account);
    res.json({ deleted: account.id });
  });

  // Admin password reset: sets or replaces the password for any player account.
  router.post("/admin/api/accounts/:accountId/password/reset", async (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    const newPassword = String(req.body?.newPassword ?? "").trim();
    const error = validatePassword(newPassword);
    if (error) return invalid(res, error);
    await accounts.setPassword(account, newPassword);
    kick(account);
    res.json(details(account));
  });

  // {email}: links the player's own email (#120), replacing any linked before; an empty one unlinks it.
  router.post("/admin/api/accounts/:accountId/email", (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    if (isServerAccountName(account.displayName)) return invalid(res, "Dedicated server accounts don't sign in with an email");
    try {
      accounts.setContactEmail(account, String(req.body?.email ?? ""));
    } catch (error) {
      if (!(error instanceof EmailError)) throw error;
      return sendError(res, error.taken ? 409 : 400,
        error.taken ? "errors.com.epicgames.account.email_already_linked" : "errors.com.epicgames.common.invalid_parameter", error.message);
    }
    res.json(details(account));
  });

  function portalUrl(req) {
    const net = network?.settings?.() ?? {};
    const res = network?.resolution?.() ?? {};
    const port = network?.listening?.port || req.socket?.localPort || 5595;
    const protocol = req.protocol || "http";

    // Behind an https reverse proxy the portal is where the proxy serves it.
    const proxied = httpsProxied(req);
    if (proxied) return `https://${proxied.host}/register`;
    const publicHost = net.publicAddress ? (res.address || net.publicAddress) : (res.address || null);
    if (publicHost) {
      return `${protocol}://${publicHost}:${port}/register`;
    }
    return `${protocol}://${req.get("host")}/register`;
  }

  function resetPasswordUrl(req, token) {
    const net = network?.settings?.() ?? {};
    const res = network?.resolution?.() ?? {};
    const port = network?.listening?.port || req.socket?.localPort || 5595;
    const protocol = req.protocol || "http";

    const proxied = httpsProxied(req);
    if (proxied) return `https://${proxied.host}/reset-password?token=${token}`;
    const publicHost = net.publicAddress ? (res.address || net.publicAddress) : (res.address || null);
    if (publicHost) {
      return `${protocol}://${publicHost}:${port}/reset-password?token=${token}`;
    }
    return `${protocol}://${req.get("host")}/reset-password?token=${token}`;
  }

  // Admin generates a single-use, 24-hour Password Reset Link for an account
  router.post("/admin/api/accounts/:accountId/password-reset-link", (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    if (!resetTokens?.createToken) return invalid(res, "Reset token service not available");
    const entry = resetTokens.createToken(account);
    res.json({
      success: true,
      token: entry.token,
      url: resetPasswordUrl(req, entry.token),
      expiresAt: entry.expiresAt
    });
  });

  // Trusted Hosting IPs (Core-Backend #125, network.js allowsHosting): the other PCs whose gameservers may host for this
  // backend, by the IP their connections come from.
  const getHostingIps = (req, res) => {
    const current = settings?.get?.() ?? {};
    res.json({ allowedHostingIps: current.allowedHostingIps ?? defaultHostingIps });
  };
  const addHostingIp = (req, res) => {
    const ip = String(req.body?.ip ?? "").trim();
    if (!ip) return invalid(res, "IP address is required");
    if (!hostingIp(ip)) return invalid(res, `${ip.slice(0, 64)} isn't an IP address (an IPv4 address such as 203.0.113.10, or an IPv6 address)`);
    if ((settings?.get?.().allowedHostingIps ?? []).length >= maxHostingIps) return invalid(res, `At most ${maxHostingIps} hosting IPs can be listed`);
    const updated = settings?.addHostingIp?.(ip) ?? settings?.get?.();
    res.json({ allowedHostingIps: updated.allowedHostingIps });
  };
  const removeHostingIp = (req, res) => {
    const ip = decodeURIComponent(req.params.ip).trim();
    const updated = settings?.removeHostingIp?.(ip) ?? settings?.get?.();
    res.json({ allowedHostingIps: updated.allowedHostingIps });
  };
  router.get("/admin/api/sessions/hosting-ips", getHostingIps);
  router.get("/admin/api/settings/hosting-ips", getHostingIps);
  router.post("/admin/api/sessions/hosting-ips", addHostingIp);
  router.post("/admin/api/settings/hosting-ips", addHostingIp);
  router.delete("/admin/api/sessions/hosting-ips/:ip", removeHostingIp);
  router.delete("/admin/api/settings/hosting-ips/:ip", removeHostingIp);

  // The builds the Allowed Builds card offers (Core-Backend #164): Core's known ones, oldest first, then other builds.
  const knownBuilds = () => [...Object.entries(buildVersions).map(([changelist, version]) => ({ changelist, version })),
    { changelist: otherBuilds, version: null }];

  // Get current server settings
  router.get("/admin/api/settings", (req, res) => {
    const current = settings?.get?.() ?? {};
    const net = network?.settings?.() ?? {};
    const resInfo = network?.resolution?.() ?? {};
    res.json({
      ...current,
      knownBuilds: knownBuilds(),
      publicAddress: net.publicAddress ? (resInfo.address || net.publicAddress) : (resInfo.address || null),
      portalUrl: portalUrl(req)
    });
  });

  // Update server settings
  router.post("/admin/api/settings", (req, res) => {
    if (!settings?.update) return invalid(res, "Settings store not available");
    if (req.body?.remoteAdmin !== undefined) {
      // Opening the admin to other devices, or closing it, is this PC's call alone.
      if (!req.adminLocal) return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "Remote admin is switched on the backend's own PC");
      if (typeof req.body.remoteAdmin !== "boolean") return invalid(res, "remoteAdmin must be true or false");
      if (req.body.remoteAdmin && !adminAuth?.hasUsers()) return invalid(res, "Add an admin credential before allowing admin from other devices");
    }
    const hosts = req.body?.allowedHostingIps;
    if (hosts !== undefined && (!Array.isArray(hosts) || hosts.length > maxHostingIps || !hosts.every(hostingIp))) {
      return invalid(res, `allowedHostingIps must be a list of at most ${maxHostingIps} IP addresses`);
    }
    if (req.body?.allowedBuilds !== undefined && allowedBuildList(req.body.allowedBuilds) === undefined) {
      return invalid(res, "allowedBuilds must be null (every build) or a list of at least one build Core knows, by changelist or version, or \"other\"");
    }
    const updated = settings.update({
      requirePassword: req.body?.requirePassword,
      allowRegistration: req.body?.allowRegistration,
      allowAutoRegistration: req.body?.allowAutoRegistration,
      defaultFoundersAccess: req.body?.defaultFoundersAccess,
      remoteAdmin: req.body?.remoteAdmin,
      seasonalEvents: req.body?.seasonalEvents,
      battleRoyaleVbucks: req.body?.battleRoyaleVbucks,
      battleRoyaleRewards: req.body?.battleRoyaleRewards,
      structureLimit: req.body?.structureLimit,
      structureLimits: req.body?.structureLimits,
      cheats: req.body?.cheats,
      cheatAccounts: req.body?.cheatAccounts,
      matchmakingGatherSeconds: req.body?.matchmakingGatherSeconds,
      warmupSeconds: req.body?.warmupSeconds,
      lateJoin: req.body?.lateJoin,
      regionFallback: req.body?.regionFallback,
      matchStartCountdown: req.body?.matchStartCountdown,
      matchStartBufferSeconds: req.body?.matchStartBufferSeconds,
      serverRegions: req.body?.serverRegions,
      allowedHostingIps: req.body?.allowedHostingIps,
      allowedBuilds: req.body?.allowedBuilds
    });
    const net = network?.settings?.() ?? {};
    const resInfo = network?.resolution?.() ?? {};
    res.json({
      ...updated,
      knownBuilds: knownBuilds(),
      publicAddress: net.publicAddress ? (resInfo.address || net.publicAddress) : (resInfo.address || null),
      portalUrl: portalUrl(req)
    });
  });

  function getNewsPayload() {
    const current = settings?.get?.() ?? {};
    const configNews = context.config?.battleRoyaleNews;
    const configLogin = context.config?.loginMessage;
    const configSubgame = context.config?.subgameSelect;
    const battleRoyaleNewsEnabled = (typeof current.battleRoyaleNewsEnabled === "boolean")
      ? current.battleRoyaleNewsEnabled
      : (typeof context.config?.battleRoyaleNewsEnabled === "boolean"
        ? context.config.battleRoyaleNewsEnabled
        : (context.config?.battleRoyaleNews !== false));
    const loginMessageEnabled = (typeof current.loginMessageEnabled === "boolean")
      ? current.loginMessageEnabled
      : (typeof context.config?.loginMessageEnabled === "boolean"
        ? context.config.loginMessageEnabled
        : (context.config?.loginMessage !== false));

    return {
      battleRoyaleNewsEnabled,
      loginMessageEnabled,
      custom: {
        battleRoyaleNews: current.battleRoyaleNews ?? configNews ?? null,
        loginMessage: current.loginMessage ?? configLogin ?? null,
        subgameSelect: {
          saveTheWorld: current.subgameSelect?.saveTheWorld ?? configSubgame?.saveTheWorld ?? null,
          battleRoyale: current.subgameSelect?.battleRoyale ?? configSubgame?.battleRoyale ?? null
        }
      },
      defaults: {
        battleRoyaleNewsEnabled: true,
        loginMessageEnabled: true,
        battleRoyaleNews: defaultBattleRoyaleNews,
        loginMessage: defaultLoginMessage,
        subgameSelect: defaultSubgameSelect
      },
      battleRoyaleNews: current.battleRoyaleNews ?? configNews ?? defaultBattleRoyaleNews,
      loginMessage: current.loginMessage ?? configLogin ?? defaultLoginMessage,
      subgameSelect: current.subgameSelect ?? configSubgame ?? defaultSubgameSelect
    };
  }

  // In-game news, login messages, and mode select screen text
  router.get("/admin/api/news", (req, res) => {
    res.json(getNewsPayload());
  });

  // A requested season (?season=): one of the Battle Royale seasons, else Season 1.
  const requestedSeasonOf = (value) => battleRoyaleSeasons.find((entry) => String(entry.season) === String(value))?.season ?? 1;

  function getShopPayload(requestedSeason = 1) {
    const now = new Date();
    const config = settings?.get?.()?.itemShop ?? { mode: "fnbr", rotationHour: 0, weeklyDurationDays: 7 };
    const s = requestedSeasonOf(requestedSeason);
    const build = { 1: "3724489", 2: "3807424", 3: "3901517" }[s];
    const offers = inBuild(build, () => itemShopOffers(now, config, s));
    const cosmetics = inBuild(build, () => eligibleCosmetics());
    const currentDay = shopDay(now, config, s);

    const mapOffer = (o) => {
      const match = cosmetics.find((c) => c.templateId.toLowerCase() === o.templateId.toLowerCase());
      let name = o.title || match?.name;
      let type = match?.type;
      let rarity = match?.rarity;
      let rarityCode = match?.rarityCode;
      if (!match) {
        const athenaMatch = inBuild(build, () => {
          const allAthena = athenaCosmetics();
          return Object.entries(allAthena).find(([id]) => id.toLowerCase() === o.templateId.toLowerCase())?.[1];
        });
        if (athenaMatch) {
          name = name || athenaMatch.name?.trim();
          type = type || cosmeticType(athenaMatch.class, o.templateId);
          const r = cosmeticRarity(athenaMatch.rarity);
          rarity = rarity || r.label;
          rarityCode = rarityCode || r.code;
        }
      }
      return {
        templateId: o.templateId,
        name: name || o.templateId,
        price: o.price,
        type: type ?? "Cosmetic",
        rarity: rarity ?? "Uncommon",
        rarityCode: rarityCode ?? "uc"
      };
    };

    return {
      season: s,
      seasonName: seasonName(s),
      mode: config.mode || "fnbr",
      rotationHour: config.rotationHour ?? 0,
      weeklyDurationDays: config.weeklyDurationDays ?? 7,
      currentShop: {
        featured: offers.BRWeeklyStorefront.map(mapOffer),
        daily: offers.BRDailyStorefront.map(mapOffer)
      },
      history: {
        date: currentDay.date,
        featured: currentDay.featured,
        daily: currentDay.daily
      },
      custom: config.custom ?? {
        featured: currentDay.featured,
        daily: currentDay.daily
      },
      random: config.random ?? null,
      nextRotation: nextRotation(now, config).toISOString(),
      weeklyStoreEnd: weeklyStoreEnd(now, config, s).toISOString(),
      seasonEnd: seasonEnd(now, config, s).toISOString(),
      availableCosmetics: cosmetics
    };
  }

  router.get("/admin/api/events/overview", (req, res) => {
    const now = new Date();
    const s = settings?.get?.() ?? {};
    const eventsConfig = s.events ?? defaultEvents;
    const seasonalEventsEnabled = s.seasonalEvents !== false && eventsConfig.mode !== "off";
    const shopConfig = s.itemShop ?? { mode: "fnbr", rotationHour: 0, weeklyDurationDays: 7 };

    const builds = [
      { version: "1.7.2", cl: 3532353, event: "Base Campaign" },
      { version: "1.8 – 1.9", cl: 3724489, event: "Fortnitemares" },
      { version: "1.9.1", cl: 3775276, event: "Mutant Storms" },
      { version: "1.10", cl: 3790078, event: "Mutant Storms" },
      { version: "1.11", cl: 3807424, event: "Survive the Holidays" },
      { version: "2.1", cl: 3825894, event: "Survive the Holidays" },
      { version: "2.2", cl: 3841827, event: "Survive the Holidays" },
      { version: "2.3", cl: 3847564, event: "Mutant Storms" },
      { version: "2.4", cl: 3858292, event: "Mutant Storms" },
      { version: "2.4.2", cl: 3870737, event: "Mutant Storms" },
      { version: "2.5", cl: 3889387, event: "Spring It On!" },
      { version: "3.0", cl: 3901517, event: "Spring It On!" }
    ];

    const sampleBuilds = builds.map((b) => ({
      ...b,
      flags: inBuild(String(b.cl), () => activeEventFlags())
    }));

    const weeklyEnd = weeklyStoreEnd(now, shopConfig);
    const reqSeason = requestedSeasonOf(req.query.season);
    const seasonEnds = seasonEnd(now, shopConfig, reqSeason);
    const dailyEnd = nextRotation(now, shopConfig);
    // Each season's replay: its day 1 and its end; a season not served yet shows as starting today.
    const seasonClocks = withoutSeasonStartRecording(() => Object.fromEntries(battleRoyaleSeasons.map(({ season }) => season).map((season) => [season, {
      start: new Date(seasonStart(season, now, shopConfig)).toISOString().slice(0, 10),
      started: Boolean(eventsConfig.seasonStarts?.[season]) || season === 1,
      end: seasonEnd(now, shopConfig, season).toISOString(),
      shopDay: shopDay(now, shopConfig, season).date
    }])));

    // Season 2's content updates (events/contentupdates.js): each one's state on 1.11 and on 2.1, without starting the
    // season. 2.2 ships them in its own loot tables, so it takes none; 2.3 takes its own, the Chug Jug,
    // and 2.4 its own, the Minigun and the Suppressed Pistol's cut (its tables have the Chug Jug in). 2.4.2's tables have
    // 2.4's in and its paks lack its notes' Crossbow, and 2.5's tables have every one and the Crossbow in, so they take none.
    const contentUpdates = withoutSeasonStartRecording(() => ({
      config: eventsConfig.contentUpdates ?? defaultContentUpdates,
      seasonDate: inBuild("3807424", () => seasonMoment(now, shopConfig, 2).toISOString()),
      builds: [["1.11", "3807424"], ["2.1", "3825894"], ["2.3", "3847564"], ["2.4", "3858292"]].map(([version, cl]) => ({
        version, cl: Number(cl), updates: inBuild(cl, () => contentUpdateStates(now, eventsConfig.contentUpdates))
      }))
    }));

    res.json({
      season: reqSeason,
      seasonName: seasonName(reqSeason),
      availableSeasons,
      seasonalEvents: seasonalEventsEnabled,
      contentUpdates,
      activeFlags: activeEventFlags(),
      sampleBuilds,
      calendar: {
        weeklyStoreEnd: weeklyEnd.toISOString(),
        seasonEnd: seasonEnds.toISOString(),
        dailyStoreEnd: dailyEnd.toISOString(),
        seasons: seasonClocks,
        cacheIntervalMins: eventsConfig.calendarCacheMinutes ?? calendarCacheMinutes,
        currentTime: now.toISOString()
      },
      eventsConfig,
      events: [
        {
          id: "fortnitemares",
          name: "Fortnitemares",
          subtitle: "Halloween 2017 Event",
          buildRange: "1.8 – 1.9 (CL 3724489 – 3757339)",
          flags: ["EventFlag.Fortnitemares"],
          theater: "Hexsylvania",
          theaterZones: [
            { name: "Hexsylvania Start", power: "5+", gate: "None" },
            { name: "Hexsylvania Normal", power: "15+", gate: eventsConfig.hexsylvaniaGates === "open" ? "None (Open Access)" : "Launch the Rocket (Stonewood)" },
            { name: "Hexsylvania Hard", power: "23+", gate: eventsConfig.hexsylvaniaGates === "open" ? "None (Open Access)" : "Launch the Rocket (Plankerton)" },
            { name: "Hexsylvania Nightmare", power: "34+", gate: eventsConfig.hexsylvaniaGates === "open" ? "None (Open Access)" : "Launch the Rocket (Canny Valley)" }
          ],
          currency: "Candy (AccountResource:eventcurrency_candy)",
          llama: `Fortnitemares Llama (CardPack_Event_2017_Halloween, ${eventsConfig.candyPerLlama ?? 500} Candy)`,
          questsCount: 56,
          bookPages: ["Halloween2017_Heroes", "Halloween2017_Workers"]
        },
        {
          id: "mutantstorms",
          name: "Mutant Storms",
          subtitle: "Storm Category Mission Alerts & Vindertech",
          buildRange: "1.9.1 & 1.10 (CL 3775276 – 3790078), and 2.3 – 2.4.2 (CL 3847564 – 3870737)",
          flags: ["EventFlag.Vindertech (1.9.1)", "EventFlag.ActiveStorms (1.10, 2.3 – 2.4.2)", "EventFlag.ActiveMiniBosses (2.4, 2.4.2)"],
          theater: "Standard Zones with Storm Modifiers",
          alertsQuota: `${eventsConfig.stormAlertQuota ?? 10} storm category mission alerts per day`,
          currency: "Storm Tickets (AccountResource:eventcurrency_stormzone)",
          llama: "Vindertech Llama (1.9.1, 1.10); Storm Llama, Hydraulic weapons and storm heroes (2.3 – 2.4.2)",
          questsCount: 15,
          leftoverConversion: `${eventsConfig.candyPerLlama ?? 500} unspent Candy converts to 1 Fortnitemares Llama on 1.9.1+ load`
        },
        {
          id: "winter2017",
          name: "Survive the Holidays",
          subtitle: "Mini-Boss Mission Alerts & Holiday Survival",
          buildRange: "1.11 – 2.2 (CL 3807424 – 3841827)",
          flags: ["EventFlag.Winter2017", "EventFlag.PassiveStorms"],
          theater: "Survive the Storm, and Standard Zones with Mini-Boss Alerts",
          theaterZones: [
            { name: "Survive the Storm Start", power: "15", gate: "None" },
            { name: "Survive the Storm Normal", power: "40", gate: "Launch the Rocket (Stonewood)" },
            { name: "Survive the Storm Hard", power: "70", gate: "Launch the Rocket (Plankerton)" }
          ],
          alertsQuota: "10 Mini-Boss mission alerts, 3 Survive the Storm 3 Day and 1 7 Day alerts, and 4 storms (no tickets) per day",
          currency: "Snowflake Tickets (AccountResource:eventcurrency_snowballs)",
          llama: `Holiday Survival Llama (CardPack_Event_2017_Winter, ${eventsConfig.snowflakePerLlama ?? 1000} Snowflake Tickets)`,
          questsCount: 26,
          leftoverConversion: "1000 unspent Storm Tickets convert to 1 Vindertech Llama on 1.11+ load"
        },
        {
          id: "spring2018",
          name: "Spring It On!",
          subtitle: "Valentine's & Lunar New Year Quests, Passive Storms & Mini-Bosses; continues in 3.0 (Luck Explosion)",
          buildRange: "2.5 – 3.0 (CL 3889387 – 3901517)",
          flags: ["EventFlag.Spring2018Valentines", "EventFlag.Spring2018Phase1", "EventFlag.PassiveStorms", "EventFlag.PassiveMiniBosses"],
          theater: "Standard Zones with passive storm and Mini-Boss alerts",
          alertsQuota: "3 Mini-Boss (General) mission alerts and 4 storms (no tickets) per day",
          currency: "Firecracker Tickets (AccountResource:eventcurrency_spring), Spring It On! Gold in the Event Store",
          llama: "Spring Llama (CardPack_Event_2018_Spring, 1000 Firecracker Tickets)",
          questsCount: 19,
          leftoverConversion: "1000 unspent Storm Tickets convert to 1 Storm Llama, and up to 3000 Seasonal Gold to Firecracker Tickets (3 to 1), on 2.5 load"
        }
      ]
    });
  });

  router.post("/admin/api/events/config", (req, res) => {
    if (typeof req.body !== "object" || req.body === null) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", "Invalid events configuration body");
    }
    const updated = settings.update({ events: req.body });
    res.json({ success: true, events: updated.events });
  });

    router.post("/admin/api/events/actions/convert-storm-tickets", (req, res) => {
    const list = accounts.list();
    let convertedProfiles = 0;
    let totalLlamasGranted = 0;

    inBuild("3807424", () => {
      for (const account of list) {
        try {
          const session = openSession(profiles, account.id);
          const granted = convertLeftoverStormTickets(session, true);
          if (granted && granted.length > 0) {
            session.commit();
            notifyProfiles(context, session);
            convertedProfiles += 1;
            const grantedCount = granted.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
            totalLlamasGranted += grantedCount;
          }
        } catch (err) {
          // Continue with other accounts
        }
      }
    });

    res.json({ success: true, convertedProfiles, totalLlamasGranted, ticketsPerLlama: 1000 });
  });

  router.post("/admin/api/events/actions/convert-candy", (req, res) => {
    const list = accounts.list();
    let convertedProfiles = 0;
    let totalLlamasGranted = 0;
    const currentEvents = settings?.get?.().events;
    const perLlama = currentEvents?.candyPerLlama ?? 500;

    inBuild("3775276", () => {
      for (const account of list) {
        try {
          const session = openSession(profiles, account.id);
          const granted = convertLeftoverCandy(session, true);
          if (granted && granted.length > 0) {
            session.commit();
            notifyProfiles(context, session);
            convertedProfiles += 1;
            const grantedCount = granted.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
            totalLlamasGranted += grantedCount;
          }
        } catch (err) {
          // Continue with other accounts
        }
      }
    });

    res.json({ success: true, convertedProfiles, totalLlamasGranted, candyPerLlama: perLlama });
  });

  router.post("/admin/api/events/actions/reset-quotas", (req, res) => {
    const list = accounts.list();
    let resetProfiles = 0;

    for (const account of list) {
      try {
        const session = openSession(profiles, account.id);
        const tracker = session.profile("profile0");
        if (tracker && tracker.profile) {
          const record = withQuotaSlots(tracker.profile.stats?.attributes?.mission_alert_redemption_record ?? emptyAlertRecord());
          tracker.setStat("mission_alert_redemption_record", clearedAlertRecord(record));
          session.commit();
          notifyProfiles(context, session);
          resetProfiles += 1;
        }
      } catch (err) {
        // Continue with other accounts
      }
    }

    res.json({ success: true, resetProfiles });
  });

  // ?season=2|3: Season 2's Battle Pass (1.11 and 2.1) or Season 3's (3.0), battlepass/season2.js: its prices and its tiers' rewards, from the
  // season's newest data (profiles/seasons.js buildOfSeason).
  // Each season's name by its versions (builds/detect.js battleRoyaleSeasons): Season 2 is 1.11 to 2.5, Season 3 is 3.0 to 3.6.
  const availableSeasons = battleRoyaleSeasons.map(({ season: id }) => ({ id, name: seasonName(id), range: seasonVersions(id), active: true }));
  router.get("/admin/api/battlepass/overview", (req, res) => {
    const s = settings?.get?.() ?? {};
    const bpConfig = s.battlepass ?? defaultBattlePass;
    const now = new Date();
    const shopConfig = s.itemShop ?? { mode: "fnbr", rotationHour: 0, weeklyDurationDays: 7 };
    const seasonEnds = (season) => withoutSeasonStartRecording(() => seasonEnd(now, shopConfig, season).toISOString());

    const passSeason = requestedSeasonOf(req.query.season);
    if (passSeason >= 2) {
      return res.json(inBuild(buildOfSeason(passSeason), () => ({
        season: passSeason,
        seasonName: seasonName(passSeason),
        availableSeasons,
        seasonEnd: seasonEnds(passSeason),
        config: { ...seasonPassConfig(passSeason), tierPrice, bundleTiers, xpMultiplier: bpConfig.xpMultiplier ?? 1 },
        tiers: seasonTiers(),
        // Season 3's weekly challenges: whether every week is given at once (Core-Backend #207, profiles/challenges.js).
        ...(passSeason >= 3 ? { challengesAllUnlocked: s.challengesAllUnlocked === true } : {})
      })));
    }
    res.json({
      season: 1,
      seasonName: seasonName(1),
      availableSeasons,
      seasonEnd: seasonEnds(1),
      config: bpConfig,
      milestones: enrichedMilestones(bpConfig)
    });
  });

  router.post("/admin/api/battlepass/config", (req, res) => {
    if (typeof req.body !== "object" || req.body === null) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", "Invalid battle pass configuration body");
    }
    const updated = settings.update({ battlepass: req.body });
    res.json({
      success: true,
      config: updated.battlepass,
      milestones: enrichedMilestones(updated.battlepass)
    });
  });

  // {allUnlocked}: Season 3's weekly challenges all at once, or a week at a time on the season's replay (Core-Backend #207).
  // A player gets the weeks at their next quest login.
  router.post("/admin/api/battlepass/challenges", (req, res) => {
    if (typeof req.body?.allUnlocked !== "boolean") {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", "allUnlocked must be true or false");
    }
    const updated = settings.update({ challengesAllUnlocked: req.body.allUnlocked });
    res.json({ success: true, challengesAllUnlocked: updated.challengesAllUnlocked });
  });

  router.post("/admin/api/battlepass/actions/reset-defaults", (req, res) => {
    const updated = settings.update({ battlepass: defaultBattlePass });
    res.json({
      success: true,
      config: updated.battlepass,
      milestones: enrichedMilestones(updated.battlepass)
    });
  });

  function getMatchmakingPayload() {
    const s = settings?.get?.() ?? {};
    const modes = s.matchmakingModes ?? defaultMatchmakingModes;
    const serverLimits = s.serverLimits ?? defaultServerLimits;
    const sessionList = (sessions?.list?.() ?? []).map((session) => sessionSummary(session));
    // The LTMs by season, their original dates and whether those hold now (Core-Backend #190, #191).
    const schedule = withoutSeasonStartRecording(() => ltmSchedule(s, new Date()));

    const regions = ["NA", "EU", "OCE", "BR", "ASIA"];
    const modeKeys = ["solo", "duo", "squad", ...ltmIds];
    const serverCounts = {};
    for (const r of regions) {
      serverCounts[r] = Object.fromEntries(modeKeys.map((m) => [m, 0]));
      for (const m of modeKeys) {
        if (matchmaker?.activeServersCount) {
          serverCounts[r][m] = matchmaker.activeServersCount(r, m);
        }
      }
    }

    const playlists = [
      {
        id: "solo",
        name: "Solo",
        playlistId: 2,
        code: "Playlist_DefaultSolo",
        teamCount: 100,
        teamSize: 1,
        squadSize: 1,
        maxPlayers: 100,
        enabled: modes.solo !== false,
        description: "100 solo combatants drop into Battle Royale. Last player standing wins."
      },
      {
        id: "duo",
        name: "Duos",
        playlistId: 10,
        code: "Playlist_DefaultDuo",
        teamCount: 100,
        teamSize: 2,
        squadSize: 2,
        maxPlayers: 100,
        enabled: modes.duo !== false,
        description: "Teams of two drop into Battle Royale. Supports fill and no-fill squad options."
      },
      {
        id: "squad",
        name: "Squads",
        playlistId: 9,
        code: "Playlist_DefaultSquad",
        teamCount: 100,
        teamSize: 4,
        squadSize: 4,
        maxPlayers: 100,
        enabled: modes.squad !== false,
        description: "Squads of up to four players battle for the Victory Royale."
      },
      // The limited-time modes (events/ltms.js): 50v50, then the lobby's event queues.
      {
        id: "fiftyFifty",
        name: "50v50",
        playlistId: 11,
        code: "Playlist_50v50",
        teamCount: 2,
        teamSize: 50,
        squadSize: 4,
        maxPlayers: 100,
        enabled: modes.fiftyFifty !== false,
        description: "Limited-time mode from 1.10: two massive teams of 50 clash in an all-out war."
      },
      {
        id: "shootingTest",
        name: "Shooting Test #1",
        playlistId: 15,
        code: "AthenaEvent1",
        teamCount: 100,
        teamSize: 1,
        squadSize: 1,
        maxPlayers: 100,
        enabled: modes.shootingTest === true,
        description: "Limited-time mode of 2.4 to 2.5: weapon accuracy for a more precise aim (first-shot accuracy, less headshot damage, damage fall-off). Solo from 2.4.2, squads on 2.4. Off by default."
      },
      // The other event queues (Core-Backend #190, #191), squads of the builds whose data has them.
      ...schedule.list.filter((ltm) => ltm.id !== "fiftyFifty" && ltm.id !== "shootingTest").map((ltm) => ({
        id: ltm.id,
        name: ltm.name,
        playlistId: ltm.playlistId,
        code: `AthenaEvent${ltm.queue}`,
        teamCount: 100,
        teamSize: 4,
        squadSize: 4,
        maxPlayers: 100,
        enabled: modes[ltm.id] === true,
        description: `Limited-time mode of ${ltm.builds}: ${ltm.description} Off by default.`
      }))
    ];

    return {
      modes,
      serverLimits,
      serverCounts,
      serverRegions: s.serverRegions ?? [],
      timing: {
        gatherSeconds: s.matchmakingGatherSeconds ?? 10,
        warmupSeconds: s.warmupSeconds ?? null,
        lateJoin: s.lateJoin === true,
        regionFallback: s.regionFallback !== false,
        matchStartCountdown: s.matchStartCountdown !== false,
        matchStartBufferSeconds: s.matchStartBufferSeconds ?? 25
      },
      rewards: {
        enabled: s.battleRoyaleVbucks === true,
        modes: s.battleRoyaleRewards ?? {}
      },
      playlists,
      ltms: schedule,
      // The players with the Custom Matchmaking permission (#186).
      customMatchmaking: accounts.list().filter((account) => account.customMatchmaking === true)
        .map(({ id, displayName }) => ({ id, displayName })).sort((a, b) => a.displayName.localeCompare(b.displayName)),
      sessions: sessionList
    };
  }

  router.get("/admin/api/matchmaking/overview", (req, res) => {
    res.json(getMatchmakingPayload());
  });

  router.post("/admin/api/matchmaking/config", (req, res) => {
    if (typeof req.body !== "object" || req.body === null) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", "Invalid matchmaking configuration body");
    }
    const update = {};
    if (req.body.modes && typeof req.body.modes === "object") {
      update.matchmakingModes = req.body.modes;
    }
    if (req.body.serverLimits && typeof req.body.serverLimits === "object") {
      update.serverLimits = req.body.serverLimits;
    }
    if (req.body.serverRegions !== undefined) update.serverRegions = req.body.serverRegions;
    if (typeof req.body.ltmOriginalDates === "boolean") update.ltmOriginalDates = req.body.ltmOriginalDates;
    if (req.body.timing && typeof req.body.timing === "object") {
      if (req.body.timing.gatherSeconds !== undefined) {
        const g = Number(req.body.timing.gatherSeconds);
        if (Number.isInteger(g) && g >= 0 && g <= 300) update.matchmakingGatherSeconds = g;
      }
      if (req.body.timing.warmupSeconds !== undefined) {
        if (req.body.timing.warmupSeconds === null || req.body.timing.warmupSeconds === "") {
          update.warmupSeconds = null;
        } else {
          const w = Number(req.body.timing.warmupSeconds);
          if (Number.isInteger(w) && w >= 10 && w <= 1800) update.warmupSeconds = w;
        }
      }
      if (typeof req.body.timing.lateJoin === "boolean") update.lateJoin = req.body.timing.lateJoin;
      if (typeof req.body.timing.regionFallback === "boolean") update.regionFallback = req.body.timing.regionFallback;
      if (typeof req.body.timing.matchStartCountdown === "boolean") update.matchStartCountdown = req.body.timing.matchStartCountdown;
      if (req.body.timing.matchStartBufferSeconds !== undefined) update.matchStartBufferSeconds = req.body.timing.matchStartBufferSeconds;
    }
    if (req.body.rewards && typeof req.body.rewards === "object") {
      if (typeof req.body.rewards.enabled === "boolean") update.battleRoyaleVbucks = req.body.rewards.enabled;
      if (req.body.rewards.modes && typeof req.body.rewards.modes === "object") {
        update.battleRoyaleRewards = req.body.rewards.modes;
      }
    }
    settings.update(update);
    res.json({ success: true, ...getMatchmakingPayload() });
  });

  router.post("/admin/api/matchmaking/actions/reset-defaults", (req, res) => {
    settings.update({
      matchmakingModes: defaultMatchmakingModes,
      ltmOriginalDates: false,
      serverLimits: defaultServerLimits,
      matchmakingGatherSeconds: 10,
      warmupSeconds: null,
      lateJoin: false,
      regionFallback: true,
      matchStartCountdown: true,
      matchStartBufferSeconds: 25,
      serverRegions: []
    });
    res.json({ success: true, ...getMatchmakingPayload() });
  });

  router.get("/admin/api/shop", (req, res) => {
    const s = requestedSeasonOf(req.query.season);
    res.json(getShopPayload(s));
  });

  router.post("/admin/api/shop", (req, res) => {
    if (!settings?.update) return invalid(res, "Settings store not available");
    const currentConfig = settings.get?.()?.itemShop ?? { mode: "fnbr", rotationHour: 0, weeklyDurationDays: 7 };
    const mode = ["fnbr", "random", "custom"].includes(req.body?.mode) ? req.body.mode : currentConfig.mode;
    const update = { mode };

    if (req.body?.rotationHour !== undefined) {
      const h = Number(req.body.rotationHour);
      if (Number.isInteger(h) && h >= 0 && h <= 23) update.rotationHour = h;
    }
    if (req.body?.weeklyDurationDays !== undefined) {
      const d = Number(req.body.weeklyDurationDays);
      if (Number.isInteger(d) && d >= 1 && d <= 30) update.weeklyDurationDays = d;
    }

    if (req.body?.custom && typeof req.body.custom === "object") {
      const sanitizeList = (list) => {
        if (!Array.isArray(list)) return [];
        return list
          .filter((item) => Array.isArray(item) && typeof item[0] === "string" && item[0].trim())
          .map(([templateId, price, tile]) => {
            // A history day's tile ({tile, banner}, store/itemshop.js tileOf) carries over into a custom shop seeded from it.
            const kept = tile && typeof tile === "object" ? {
              ...(Math.floor(Number(tile.tile)) > 0 ? { tile: Math.floor(Number(tile.tile)) } : {}),
              ...(typeof tile.banner === "string" && /^[A-Za-z]+$/.test(tile.banner) ? { banner: tile.banner } : {})
            } : {};
            const entry = [templateId.trim(), Math.max(0, Math.floor(Number(price) || 800))];
            return Object.keys(kept).length ? [...entry, kept] : entry;
          });
      };
      update.custom = {
        featured: sanitizeList(req.body.custom.featured),
        daily: sanitizeList(req.body.custom.daily)
      };
    }

    settings.update({ itemShop: update });
    const s = requestedSeasonOf(req.query.season || req.body?.season);
    res.json(getShopPayload(s));
  });

  router.post("/admin/api/shop/randomize", (req, res) => {
    if (!settings?.update) return invalid(res, "Settings store not available");
    const newSeed = crypto.randomBytes(4).toString("hex");
    settings.update({
      itemShop: {
        mode: "random",
        random: {
          seed: newSeed,
          rerolledAt: new Date().toISOString()
        }
      }
    });
    const s = requestedSeasonOf(req.query.season || req.body?.season);
    res.json(getShopPayload(s));
  });

  router.post("/admin/api/shop/reset", (req, res) => {
    if (!settings?.update) return invalid(res, "Settings store not available");
    settings.update({
      itemShop: {
        mode: "fnbr",
        rotationHour: 0,
        weeklyDurationDays: 7,
        custom: null,
        random: null
      }
    });
    const s = requestedSeasonOf(req.query.season || req.body?.season);
    res.json(getShopPayload(s));
  });

  // Redeem Codes & Rewards (Promotional & Friend Codes)
  router.get("/admin/api/codes", (req, res) => {
    if (!context.friendCodes?.list) return res.json([]);
    const folder = req.query.folder ? String(req.query.folder).trim() : null;
    const type = req.query.type ? String(req.query.type).trim() : null;
    if (type === "friend") {
      return res.json(context.friendCodes.listPlayerFriendCodes());
    }
    if (type === "promotional" || folder) {
      return res.json(context.friendCodes.listPromotionalCodes(folder));
    }
    res.json(context.friendCodes.list());
  });

  router.post("/admin/api/codes", (req, res) => {
    if (!context.friendCodes?.create) return invalid(res, "Friend codes store not available");
    // A code promises only items some build has, so redeeming it can give them all.
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const unknownItem = items.find((item) => item && typeof item.templateId === "string" && item.templateId.trim() && !rewardItem(item.templateId));
    if (unknownItem) return invalid(res, `Unknown item ${unknownItem.templateId}: no build's game data has it (a cosmetic must be a locker item)`);
    try {
      const created = context.friendCodes.create(req.body ?? {});
      res.status(201).json(created);
    } catch (err) {
      return invalid(res, err.message);
    }
  });

  router.delete("/admin/api/codes/:code", (req, res) => {
    if (!context.friendCodes?.delete) return invalid(res, "Friend codes store not available");
    const success = context.friendCodes.delete(req.params.code);
    if (!success) return notFound(res, `Code "${req.params.code}" not found`);
    res.json({ success: true, deleted: req.params.code });
  });

  // Code Folders
  router.get("/admin/api/code-folders", (req, res) => {
    if (!context.friendCodes?.listFolders) return res.json([]);
    res.json(context.friendCodes.listFolders());
  });

  router.post("/admin/api/code-folders", (req, res) => {
    if (!context.friendCodes?.createFolder) return invalid(res, "Friend codes store not available");
    try {
      const created = context.friendCodes.createFolder(req.body?.name, req.body?.slug);
      res.status(201).json(created);
    } catch (err) {
      return invalid(res, err.message);
    }
  });

  router.delete("/admin/api/code-folders/:slug", (req, res) => {
    if (!context.friendCodes?.deleteFolder) return invalid(res, "Friend codes store not available");
    try {
      const deleted = context.friendCodes.deleteFolder(req.params.slug);
      if (!deleted) return notFound(res, `Folder "${req.params.slug}" not found`);
      res.json({ success: true, deleted: req.params.slug });
    } catch (err) {
      return invalid(res, err.message);
    }
  });

  // Player Friend Codes
  router.get("/admin/api/accounts/:accountId/friend-codes", (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    if (!context.friendCodes?.listForAccount) return res.json([]);
    res.json(context.friendCodes.listForAccount(account.id));
  });

  router.post("/admin/api/accounts/:accountId/friend-codes", (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    if (!context.friendCodes?.issue) return invalid(res, "Friend codes store not available");
    try {
      const codeType = req.body?.codeType || "CodeToken:founderfriendinvite";
      const issued = context.friendCodes.issue(account.id, codeType, "epic");
      const details = context.friendCodes.get(issued.code);
      res.status(201).json(details || issued);
    } catch (err) {
      return invalid(res, err.message);
    }
  });

  router.get("/admin/api/friend-codes", (req, res) => {
    if (!context.friendCodes?.listPlayerFriendCodes) return res.json([]);
    res.json(context.friendCodes.listPlayerFriendCodes());
  });

  function resolveReportedPlayer(report) {
    let reportedPlayer = report.reportedPlayer;
    if (!reportedPlayer && /^player\s*:\s*/i.test(report.subject ?? "")) {
      reportedPlayer = report.subject.replace(/^player\s*:\s*/i, "").trim();
    }
    let reportedAccountId = report.reportedAccountId;
    let reportedDisplayName = report.reportedDisplayName;
    if (reportedPlayer && !reportedAccountId && accounts) {
      const found = accounts.findByName?.(reportedPlayer) || accounts.get?.(reportedPlayer);
      if (found) {
        reportedAccountId = found.id;
        reportedDisplayName = found.displayName;
      }
    }
    return {
      ...report,
      reportedPlayer,
      reportedAccountId,
      reportedDisplayName
    };
  }

  // Player feedback and bug reports
  router.get("/admin/api/reports", (req, res) => {
    const list = (reports?.list?.() ?? []).map(resolveReportedPlayer);
    res.json(list);
  });

  router.get("/admin/api/reports/:id", (req, res) => {
    const report = reports?.get?.(req.params.id);
    if (!report) return notFound(res, req.originalUrl);
    res.json(resolveReportedPlayer(report));
  });

  router.delete("/admin/api/reports/:id", (req, res) => {
    const deleted = reports?.delete?.(req.params.id);
    if (!deleted) return notFound(res, req.originalUrl);
    res.json({ deleted: req.params.id });
  });

  router.get("/admin/api/reports/:id/attachment/:filename", (req, res) => {
    const filePath = reports?.attachmentPath?.(req.params.id, req.params.filename);
    if (!filePath) return notFound(res, req.originalUrl);
    res.setHeader("X-Content-Type-Options", "nosniff");
    const isImage = /\.(jpe?g|png|webp)$/i.test(path.basename(filePath));
    if (!isImage) {
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
      res.setHeader("Content-Type", "application/octet-stream");
    }
    res.sendFile(filePath);
  });

  router.post("/admin/api/news", (req, res) => {
    if (!settings?.update) return invalid(res, "Settings store not available");
    const updates = {};
    if (typeof req.body?.battleRoyaleNewsEnabled === "boolean") {
      updates.battleRoyaleNewsEnabled = req.body.battleRoyaleNewsEnabled;
    } else if (req.body?.battleRoyaleNewsEnabled === null) {
      updates.battleRoyaleNewsEnabled = null;
    }
    if (req.body?.battleRoyaleNews !== undefined) {
      if (req.body.battleRoyaleNews === null) {
        updates.battleRoyaleNews = null;
      } else if (typeof req.body.battleRoyaleNews === "object") {
        const title = String(req.body.battleRoyaleNews.title ?? "").trim();
        const body = String(req.body.battleRoyaleNews.body ?? "").trim();
        // The picture 1.9+ shows with the message (#215): an http(s) URL, or an upload from /admin/api/news/image.
        const image = newsImageValue(req.body.battleRoyaleNews.image, dataDir);
        if (image === null) return invalid(res, "The image must be an http:// or https:// URL, or an uploaded image");
        updates.battleRoyaleNews = (title || body || image) ? { title, body, image } : null;
      }
    }
    if (typeof req.body?.loginMessageEnabled === "boolean") {
      updates.loginMessageEnabled = req.body.loginMessageEnabled;
    } else if (req.body?.loginMessageEnabled === null) {
      updates.loginMessageEnabled = null;
    }
    if (req.body?.loginMessage !== undefined) {
      if (req.body.loginMessage === null) {
        updates.loginMessage = null;
      } else if (typeof req.body.loginMessage === "object") {
        const title = String(req.body.loginMessage.title ?? "").trim();
        const body = String(req.body.loginMessage.body ?? "").trim();
        updates.loginMessage = (title || body) ? { title, body } : null;
      }
    }
    if (req.body?.subgameSelect !== undefined) {
      if (req.body.subgameSelect === null) {
        updates.subgameSelect = null;
      } else if (typeof req.body.subgameSelect === "object") {
        const currentSub = settings.get?.()?.subgameSelect ?? {};
        const sanitizeSection = (val) => {
          if (val === null) return null;
          if (typeof val === "object") {
            const title = String(val.title ?? "").trim();
            const body = String(val.body ?? "").trim();
            return (title || body) ? { title, body } : null;
          }
          return undefined;
        };

        const newStw = sanitizeSection(req.body.subgameSelect.saveTheWorld);
        const newBr = sanitizeSection(req.body.subgameSelect.battleRoyale);

        const stw = newStw !== undefined ? newStw : (currentSub.saveTheWorld ?? null);
        const br = newBr !== undefined ? newBr : (currentSub.battleRoyale ?? null);

        updates.subgameSelect = (stw || br) ? { saveTheWorld: stw, battleRoyale: br } : null;
      }
    }
    settings.update(updates);
    if (updates.battleRoyaleNews !== undefined) pruneNewsImages(dataDir, [settings.get?.()?.battleRoyaleNews?.image]);
    res.json(getNewsPayload());
  });

  // Uploads a picture for the lobby news (#215) as JSON { data: base64 } (admin writes are JSON, admin/local.js), with
  // its own body limit (app.js leaves this path to it). Returns { image }, the value to save as battleRoyaleNews.image;
  // it is served at /content/api/news-images/ (services/content/images.js).
  router.post("/admin/api/news/image", express.json({ limit: Math.ceil(maxNewsImageBytes * 4 / 3) + 4096 }), (req, res) => {
    const text = String(req.body?.data ?? "").replace(/^data:image\/[a-z+.-]+;base64,/i, "");
    if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return invalid(res, "Send the image as base64 in data");
    const saved = saveNewsImage(dataDir, Buffer.from(text, "base64"));
    if (saved.error) return invalid(res, saved.error);
    res.json({ ...saved, maxBytes: maxNewsImageBytes, maxPixels: maxNewsImagePixels });
  });

  router.get("/admin/api/sessions", (req, res) => {
    const name = (accountId) => accounts.get(accountId)?.displayName ?? accountId;
    res.json(sessions.list().map(sessionSummary).map((session) => ({
      ...session,
      players: [...session.publicPlayers, ...session.privatePlayers].map((accountId) => ({ accountId, displayName: name(accountId) }))
    })));
  });

  // Ends a game session: it leaves matchmaking at once (the server finds out at its next heartbeat or update).
  router.post("/admin/api/sessions/:sessionId/end", (req, res) => {
    if (!sessions.get(req.params.sessionId)) return notFound(res, req.originalUrl);
    sessions.remove(req.params.sessionId);
    res.json({ ended: req.params.sessionId });
  });

  router.get("/admin/api/logs", (req, res) => {
    res.json(recentLogs(Number(req.query.after) || 0, Math.min(Number(req.query.limit) || 500, 2000)));
  });

  // The newest requests Core had no answer for (logs/unknown/<build>.jsonl).
  router.get("/admin/api/unknown", (req, res) => {
    const dir = path.join(dataDir, "logs", "unknown");
    const entries = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl")).flatMap((name) =>
      fs.readFileSync(path.join(dir, name), "utf8").trim().split("\n").filter(Boolean).map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean)) : [];
    entries.sort((a, b) => String(b.time).localeCompare(String(a.time)));
    res.json(entries.slice(0, 100).map(({ time, build, kind, method, host, path: urlPath, url }) => ({ time, build, kind, method, host, path: urlPath, url })));
  });

  return router;
}

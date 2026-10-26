import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isBookPage } from "../collectionbook/book.js";
import { bannerTemplateId } from "../gamedata/banners.js";
import { notFound, sendError } from "../errors.js";
import { getNode } from "../gamedata/homebase.js";
import { getItem } from "../gamedata/items.js";
import { getQuest } from "../gamedata/quests.js";
import { readGameData } from "../gamedata/read.js";
import { recentLogs } from "../log.js";
import { sessionSummary } from "../matchmaking/sessions.js";
import { alertsRemaining, emptyAlertRecord, withQuotaSlots } from "../profiles/alerts.js";
import { levelRest, restBalance, restValue } from "../profiles/boosts.js";
import { foundersEditionOf, foundersEditions, setFoundersEdition } from "../profiles/founders.js";
import { findItem, grantItem, worldStacksNeeded } from "../profiles/items.js";
import { claimQuest, completeQuest, grant, skipTutorial } from "../profiles/progress.js";
import { createOutpost, storedCloudSaveProfile } from "../profiles/outposts.js";
import { questIdOf, tutorialCompleted } from "../profiles/quests.js";
import { openSession } from "../profiles/session.js";
import { backpackState, inOverflow, vaultState, worldStackCap } from "../profiles/vault.js";
import { maxLevel, xpForLevel } from "../profiles/xp.js";
import { notifyProfiles } from "../services/mcp/profile.js";
import { categories, currencies, describeItem, isSingleItem, searchCatalog, stormShields } from "./describe.js";
import { requireLoopback, requirePanelRequest } from "./local.js";

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
  const { accounts, profiles, tokens, sessions, xmpp, stomp, dataDir } = context;
  const router = express.Router();
  router.use("/admin", requireLoopback, requirePanelRequest);

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
      created: account.created,
      lastLogin: account.lastLogin ?? null,
      level: profile?.stats.attributes.level ?? null,
      vbucks: profile ? sum(profile, currencies[0].templates) : 0,
      tutorialCompleted: profile ? tutorialCompleted(profile) : false,
      online: online(account.id),
      banned: account.banned ?? null
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
    const quests = Object.entries(profile?.items ?? {})
      .filter(([, item]) => questIdOf(item))
      .map(([itemId, item]) => {
        const quest = getQuest(questIdOf(item));
        const objectives = (quest?.objectives ?? []).map(({ name, count }) => ({ name, count, progress: item.attributes[`completion_${name}`] ?? 0 }));
        return { itemId, questId: questIdOf(item), type: quest?.type ?? null, state: item.attributes.quest_state, objectives };
      })
      .sort((a, b) => (a.type === "Onboarding" ? 0 : 1) - (b.type === "Onboarding" ? 0 : 1) || a.questId.localeCompare(b.questId));
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
      sessions: sessionsOf(account.id),
      profiles: profiles.ids(account.id)
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

  router.get("/admin", (req, res) => res.sendFile(panel));
  // Browsers ask for this on any page; the panel has its own icon.
  router.get("/favicon.ico", (req, res) => res.status(204).end());

  router.get("/admin/api/overview", (req, res) => {
    const list = accounts.list();
    res.json({
      ...backendVersion(),
      startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      port: req.socket.localPort,
      dataDir,
      accounts: list.length,
      banned: list.filter((account) => account.banned).length,
      online: (xmpp?.onlineAccounts() ?? []).map(({ accountId, resources }) => ({ accountId, displayName: accounts.get(accountId)?.displayName ?? accountId, resources })),
      sessions: sessions.list().map(sessionSummary),
      recentLogins: list.filter((account) => account.lastLogin).sort((a, b) => b.lastLogin.localeCompare(a.lastLogin)).slice(0, 8).map(summary)
    });
  });

  router.get("/admin/api/accounts", (req, res) => {
    const query = String(req.query.search ?? "").trim().toLowerCase();
    const list = accounts.list()
      .filter((account) => !query || account.displayName.toLowerCase().includes(query) || account.id.includes(query))
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

  // Gives an item the normal way, so quests that wait on it move on too.
  router.post("/admin/api/accounts/:accountId/grant", change(({ req, res, session }) => {
    const templateId = String(req.body?.templateId ?? "").trim();
    const quantity = Number(req.body?.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) return invalid(res, "Quantity must be 1 to 1000000");
    const [type, name = ""] = templateId.split(":");
    const known = type.toLowerCase() === "quest" ? Boolean(getQuest(name))
      : type.toLowerCase() === "homebasenode" ? Boolean(getNode(name))
      : type.toLowerCase() === "collectionbookpage" ? isBookPage(name)
      : Boolean(getItem(templateId) ?? bannerTemplateId(templateId));
    if (!known) return invalid(res, `Unknown item ${templateId}`);
    if (isSingleItem(templateId) && quantity > singleGrantCap) {
      return invalid(res, `${describeItem(templateId).name} is kept one per item: give at most ${singleGrantCap} at a time`);
    }
    // bNeverPersisted items (ability ammo, quest pickups) only exist in a zone; the game never saves one to a profile.
    if (getItem(templateId)?.neverPersisted) return invalid(res, `${templateId} only exists in a zone and is never kept in a profile`);
    // The world inventory holds at most 512 stacks (profiles/vault.js); past that the game keeps nothing.
    if (getItem(templateId)?.profile === "theater") {
      const theater = session.profile("theater0").profile;
      const needed = worldStacksNeeded(theater, templateId, quantity);
      const stacks = Object.keys(theater.items).length;
      if (stacks + needed > worldStackCap) return invalid(res, `That needs ${needed} new backpack stacks; the backpack holds ${stacks} of at most ${worldStackCap}`);
    }
    return { granted: grant(session, templateId, quantity).length };
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

  router.post("/admin/api/accounts/:accountId/skip-tutorial", change(({ session }) => skipTutorial(session)));

  // Today's mission alert quota back to full.
  router.post("/admin/api/accounts/:accountId/mission-alerts/reset", change(({ session }) => {
    const tracker = session.profile("profile0");
    const record = withQuotaSlots(tracker.profile.stats.attributes.mission_alert_redemption_record ?? emptyAlertRecord());
    tracker.setStat("mission_alert_redemption_record", { ...record, lastClaimTimes: emptyAlertRecord().lastClaimTimes, oldestClaimIndex: 0 });
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

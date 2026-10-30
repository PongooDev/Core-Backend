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
import { getQuest } from "../gamedata/quests.js";
import { athenaCosmetics } from "../gamedata/athena.js";
import { dataBuilds, readGameData } from "../gamedata/read.js";
import { recentLogs } from "../log.js";
import { sessionSummary } from "../matchmaking/sessions.js";
import { defaultHostingIps, hostingIp, maxHostingIps } from "../network.js";
import { alertsRemaining, emptyAlertRecord, withQuotaSlots } from "../profiles/alerts.js";
import { fullLockerState, grantCosmetic, grantFullLocker, lockerCosmeticId, lockerCosmetics, maxSeasonLevel, ownsCosmetic, removeFullLocker,
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
import { requireLoopback, requirePanelRequest } from "./local.js";
import { defaultBattleRoyaleNews, defaultLoginMessage, defaultSubgameSelect } from "../services/content/pages.js";
import { inBuild } from "../builds/context.js";
import { battleRoyaleBuilds, certBuild, versionOf } from "../builds/detect.js";
import { cosmeticRarity, cosmeticType, eligibleCosmetics, generateRandomShop, itemShopOffers, nextRotation, shopDay, weeklyStoreEnd } from "../store/itemshop.js";

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
  const { accounts, profiles, tokens, sessions, xmpp, stomp, settings, network, dataDir, resetTokens, reports } = context;
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
      // Battle Royale's full locker (profiles/athena.js): what the account holds of every cosmetic and banner.
      locker: fullLockerState(loadIfExists(account.id, "athena"), profile),
      // Battle Royale's season level (profiles/athena.js), once the account has an athena profile.
      battleRoyale: battleRoyaleLevel(loadIfExists(account.id, "athena")),
      sessions: sessionsOf(account.id),
      profiles: profiles.ids(account.id)
    };
  }

  function battleRoyaleLevel(athena) {
    const attributes = athena?.stats?.attributes;
    return attributes ? { level: attributes.level ?? 1, xp: attributes.xp ?? 0, maxLevel: maxSeasonLevel() } : null;
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
  router.post("/admin/api/accounts/:accountId/battle-royale-level", change(({ req, res, session, account }) => {
    const level = Number(req.body?.level);
    if (!Number.isInteger(level) || level < 1 || level > maxSeasonLevel()) return invalid(res, `The season level must be 1 to ${maxSeasonLevel()}`);
    if (!loadIfExists(account.id, "athena")) return invalid(res, "The account has no Battle Royale profile yet: it's made when they first play Battle Royale");
    setSeasonLevel(session, level);
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

  router.post("/admin/api/accounts/:accountId/skip-tutorial", change(({ session }) => skipTutorial(session)));

  // Today's mission alert quota back to full.
  router.post("/admin/api/accounts/:accountId/mission-alerts/reset", change(({ session }) => {
    const tracker = session.profile("profile0");
    const record = withQuotaSlots(tracker.profile.stats.attributes.mission_alert_redemption_record ?? emptyAlertRecord());
    // The per-category claims of 1.7.2 and later (profiles/alerts.js) too, whichever build's shape the record has.
    const never = "0001-01-01T00:00:00.000Z";
    const categories = record.lastClaimTimesMap && Object.fromEntries(Object.entries(record.lastClaimTimesMap).map(([category, claims]) =>
      [category, { missionAlertGUIDs: (claims.missionAlertGUIDs ?? []).map(() => ""), lastClaimedTimes: (claims.lastClaimedTimes ?? []).map(() => never) }]));
    tracker.setStat("mission_alert_redemption_record", { ...record, lastClaimTimes: emptyAlertRecord().lastClaimTimes, oldestClaimIndex: 0,
      ...(categories && { lastClaimTimesMap: categories, oldestClaimIndexForCategory: (record.oldestClaimIndexForCategory ?? []).map(() => 0) }) });
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

  // Get current server settings
  router.get("/admin/api/settings", (req, res) => {
    const current = settings?.get?.() ?? {};
    const net = network?.settings?.() ?? {};
    const resInfo = network?.resolution?.() ?? {};
    res.json({
      ...current,
      publicAddress: net.publicAddress ? (resInfo.address || net.publicAddress) : (resInfo.address || null),
      portalUrl: portalUrl(req)
    });
  });

  // Update server settings
  router.post("/admin/api/settings", (req, res) => {
    if (!settings?.update) return invalid(res, "Settings store not available");
    const hosts = req.body?.allowedHostingIps;
    if (hosts !== undefined && (!Array.isArray(hosts) || hosts.length > maxHostingIps || !hosts.every(hostingIp))) {
      return invalid(res, `allowedHostingIps must be a list of at most ${maxHostingIps} IP addresses`);
    }
    const updated = settings.update({
      requirePassword: req.body?.requirePassword,
      allowRegistration: req.body?.allowRegistration,
      allowAutoRegistration: req.body?.allowAutoRegistration,
      defaultFoundersAccess: req.body?.defaultFoundersAccess,
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
      allowedHostingIps: req.body?.allowedHostingIps
    });
    const net = network?.settings?.() ?? {};
    const resInfo = network?.resolution?.() ?? {};
    res.json({
      ...updated,
      publicAddress: net.publicAddress ? (resInfo.address || net.publicAddress) : (resInfo.address || null),
      portalUrl: portalUrl(req)
    });
  });

  function getNewsPayload() {
    const current = settings?.get?.() ?? {};
    const configNews = context.config?.battleRoyaleNews;
    const configLogin = context.config?.loginMessage;
    const configSubgame = context.config?.subgameSelect;
    const loginMessageEnabled = (typeof current.loginMessageEnabled === "boolean")
      ? current.loginMessageEnabled
      : (typeof context.config?.loginMessageEnabled === "boolean"
        ? context.config.loginMessageEnabled
        : (context.config?.loginMessage !== false));

    return {
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

  function getShopPayload() {
    const now = new Date();
    const config = settings?.get?.()?.itemShop ?? { mode: "fnbr", rotationHour: 0, weeklyDurationDays: 7 };
    const build = "3724489";
    const offers = inBuild(build, () => itemShopOffers(now, config));
    const cosmetics = inBuild(build, () => eligibleCosmetics());
    const currentDay = shopDay(now, config);

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
      weeklyStoreEnd: weeklyStoreEnd(now, config).toISOString(),
      availableCosmetics: cosmetics
    };
  }

  router.get("/admin/api/shop", (req, res) => {
    res.json(getShopPayload());
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
          .map(([templateId, price]) => [templateId.trim(), Math.max(0, Math.floor(Number(price) || 800))]);
      };
      update.custom = {
        featured: sanitizeList(req.body.custom.featured),
        daily: sanitizeList(req.body.custom.daily)
      };
    }

    settings.update({ itemShop: update });
    res.json(getShopPayload());
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
    res.json(getShopPayload());
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
    res.json(getShopPayload());
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
    if (req.body?.battleRoyaleNews !== undefined) {
      if (req.body.battleRoyaleNews === null) {
        updates.battleRoyaleNews = null;
      } else if (typeof req.body.battleRoyaleNews === "object") {
        const title = String(req.body.battleRoyaleNews.title ?? "").trim();
        const body = String(req.body.battleRoyaleNews.body ?? "").trim();
        updates.battleRoyaleNews = (title || body) ? { title, body } : null;
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
    res.json(getNewsPayload());
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

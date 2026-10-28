import crypto from "node:crypto";
import { McpError } from "../errors.js";
import { athenaCosmetics, athenaDailyIds, athenaObjectiveStat, dailyWeight, getAthenaQuest, seasonLevels } from "../gamedata/athena.js";
import { bannerTemplateId } from "../gamedata/banners.js";
import { log } from "../log.js";
import { placements } from "../stats/store.js";
import { findItem } from "./items.js";
import { grant } from "./progress.js";

// Battle Royale's profile from 1.8, athena (UFortMcpProfileAthena, a quest profile): its cosmetics, the loadout the
// locker equips, the banner, the season level and the daily challenges.

// The locker's slots (EAthenaCustomizationCategory, in its order) -> the item type a slot takes and the stat the
// loadout reads it from (1.8's sub_41B610: the item id in favorite_<slot>, "" for the slot's default). The loadout has
// no consumable emote; Core keeps one equipped there all the same (🟡).
const slots = {
  Glider: ["AthenaGlider", "favorite_glider"],
  Pickaxe: ["AthenaPickaxe", "favorite_pickaxe"],
  Hat: ["AthenaHat", "favorite_hat"],
  Backpack: ["AthenaBackpack", "favorite_backpack"],
  Character: ["AthenaCharacter", "favorite_character"],
  LoadingScreen: ["AthenaLoadingScreen", "favorite_loadingscreen"],
  BattleBus: ["AthenaBattleBus", "favorite_battlebus"],
  Dance: ["AthenaDance", "favorite_dance"],
  ConsumableEmote: ["AthenaConsumableEmote", "favorite_consumableemote"],
  VictoryPose: ["AthenaVictoryPose", "favorite_victorypose"]
};
const slotOrder = ["None", ...Object.keys(slots)];

// The slots whose "" the game doesn't fill in: an empty glider reaches clients as a null CustomizationLoadout glider,
// and their pawn's parachute setup (1.8's sub_43D4A0, reading the glider's mesh) crashed the game on loading into a
// match (Core-Backend #74). They hold the build's default item instead, as Epic's accounts did.
const slotDefaults = { Glider: "AthenaGlider:DefaultGlider", Pickaxe: "AthenaPickaxe:DefaultPickaxe" };

// A slot's default item in this profile (its id, as the profile spells it), if the build has one.
function defaultItemId(profile, slot) {
  const templateId = slotDefaults[slot];
  return templateId ? Object.keys(profile.items).find((id) => id.toLowerCase() === templateId.toLowerCase()) ?? "" : "";
}

const emptyDefaultSlots = (profile) => Object.keys(slotDefaults)
  .filter((slot) => !profile.stats.attributes[slots[slot][1]] && defaultItemId(profile, slot));

// The enum comes as its name; its full name or its value are taken too.
function slotOf(value) {
  const name = typeof value === "number" ? slotOrder[value] : String(value ?? "").split("::").pop();
  return Object.keys(slots).find((slot) => slot.toLowerCase() === name?.toLowerCase());
}

const typeOf = (templateId) => templateId.split(":")[0].toLowerCase();

// What the locker holds (Core-Backend #77): each cosmetic under its template id as item id, as Epic's athena profiles
// kept them. A new account starts with the build's starter cosmetics; the rest are bought in the item shop
// (store/itemshop.js), earned (season level chase rewards, victory umbrellas) or, when the host turns giveAllCosmetics on
// (config.json), all given at once.
// The starters: the default glider and pickaxe the empty slots hold (above); AthenaGameData's FallbackDance
// (EID_DanceMoves); the default loading screen and battle bus; and the Founder's Glider: Core's accounts are all founders
// (profiles/founders.js), and 1.7.2's winners answer had a founder_glider type for founders
// (services/fortnite/battleroyale.js), which 1.8 made this item (🟡 who Epic granted it to is inferred from that).
const starters = ["AthenaGlider:defaultglider", "AthenaPickaxe:defaultpickaxe", "AthenaDance:eid_dancemoves",
  "AthenaLoadingScreen:lsid_defaultbg", "AthenaBattleBus:bbid_defaultbus", "AthenaGlider:founderglider"];

// AthenaGameData's RandomCharacters, CID_001-008 (the "Recruit" outfits): an empty character slot plays one of them at
// random, and they're never locker items one can pick (Core-Backend #77). A locker that held them loses them, and a
// character slot holding one goes back to "" (random).
const randomCharacters = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `AthenaCharacter:cid_00${n}_athena_commando_${n <= 4 ? "f" : "m"}_default`);
const isRandomCharacter = (templateId) => randomCharacters.some((id) => id.toLowerCase() === String(templateId).toLowerCase());
const heldRandomCharacters = (profile) => Object.entries(profile.items)
  .filter(([, item]) => isRandomCharacter(item.templateId)).map(([itemId]) => itemId);
const lockerCosmetics = () => Object.keys(athenaCosmetics()).filter((templateId) => !isRandomCharacter(templateId));

// The build's template id for one of its cosmetics, as its game data spells it; undefined if it has none.
function cosmeticId(templateId) {
  const wanted = String(templateId).toLowerCase();
  return Object.keys(athenaCosmetics()).find((id) => id.toLowerCase() === wanted);
}

const starterIds = () => starters.map(cosmeticId).filter(Boolean);
const sameId = (a, b) => a.toLowerCase() === b.toLowerCase();
const migrated = (profile, name) => (profile.coreMigrations ?? []).includes(name);

// The victory umbrellas: a win in a playlist gives its umbrella (Solo_Umbrella "The Umbrella", "The fabled victory
// umbrella."; Duo_Umbrella "Duo Victory Umbrella."; Squad_Umbrella) and the Founder's Umbrella ("Founder's exclusive!",
// 1.7.2's founder_umbrella winner type; every Core account is a founder). 1.8 has no winners question (none of 1.7.2's
// battleroyale/winners or recordwin strings are left): its umbrella is a glider item the locker equips. A playlist that
// is none of the three gives The Umbrella (🟡).
const umbrellas = { 2: "AthenaGlider:solo_umbrella", 10: "AthenaGlider:duo_umbrella", 9: "AthenaGlider:squad_umbrella" };
const founderUmbrella = "AthenaGlider:founderumbrella";
const victoryUmbrellas = (playlistId) => [umbrellas[playlistId] ?? umbrellas[2], founderUmbrella];

// The cosmetics the player has earned: the chase rewards of the season levels reached and the umbrellas of the
// playlists with a recorded win (settings.wonPlaylists, the stats: 1.7.2's recordwin; 1.8's own wins give theirs when
// the gameserver reports them, services/fortnite/battleroyale.js).
function earnedCosmetics(profile, settings) {
  const level = profile.stats.attributes.level ?? 1;
  const rewards = seasonLevels().filter((entry) => entry.level <= level && entry.chaseReward).map((entry) => entry.chaseReward);
  const won = settings.wonPlaylists?.(profile.accountId) ?? [];
  return [...new Set([...rewards, ...won.flatMap(victoryUmbrellas)].map(cosmeticId).filter(Boolean))];
}

// profile.coreBlanketCosmetics (Core's, never sent to the client) lists what giveAllCosmetics put in the locker that the
// player hasn't bought or earned since; with the setting off they leave it. Profiles made before #77, when every account
// got every cosmetic, had nothing to buy or earn them with (the item shop came with #77, and earned cosmetics were already
// held), so everything they held beyond the starters counts as that blanket grant and goes, apart from what the player
// had earned by then (the level 25 Mako, the umbrellas of recorded wins): once, migration athenaLocker.
const blanket = (profile) => profile.coreBlanketCosmetics ?? [];
const missing = (profile, templateIds) => templateIds.filter((templateId) => !findItem(profile, templateId));

export function athenaNeedsSetUp(profile, settings = {}) {
  return !migrated(profile, "athenaLocker") || missing(profile, starterIds()).length > 0
    || missing(profile, earnedCosmetics(profile, settings)).length > 0
    || (settings.giveAllCosmetics ? missing(profile, lockerCosmetics()).length > 0 : blanket(profile).length > 0)
    || emptyDefaultSlots(profile).length > 0 || heldRandomCharacters(profile).length > 0;
}

function addCosmetic(tracker, templateId, seen) {
  tracker.addItem(templateId, { templateId, attributes: { level: 1, item_seen: seen ? 1 : 0, favorite: 0 }, quantity: 1 });
}

// A cosmetic the player now owns for good (bought or earned): added if the locker lacks it, and no longer the blanket
// grant's if that gave it. Returns the grant ({profileId, itemId, templateId, quantity}), or null when the player
// already had it or the build has no such cosmetic.
export function grantCosmetic(session, templateId) {
  const id = cosmeticId(templateId);
  if (!id) return null;
  const tracker = session.profile("athena");
  const { profile } = tracker;
  if (blanket(profile).some((held) => sameId(held, id))) profile.coreBlanketCosmetics = blanket(profile).filter((held) => !sameId(held, id));
  if (findItem(profile, id)) return null;
  addCosmetic(tracker, id, false);
  log("Battle Royale", `${session.accountId} got ${id}`);
  return { profileId: "athena", itemId: id, templateId: id, quantity: 1 };
}

export const ownsCosmetic = (session, templateId) => Boolean(findItem(session.profile("athena").profile, templateId));

// A slot holding an item that leaves the locker goes back to its default (the default glider and pickaxe, "" elsewhere).
function removeCosmetic(tracker, itemId) {
  tracker.removeItem(itemId);
  for (const [slot, [, stat]] of Object.entries(slots)) {
    if (sameId(String(tracker.profile.stats.attributes[stat] ?? ""), itemId)) tracker.setStat(stat, defaultItemId(tracker.profile, slot));
  }
}

export function setUpAthena(session) {
  const tracker = session.profile("athena");
  const { profile } = tracker;
  const { settings = {} } = session;
  if (!migrated(profile, "athenaLocker")) {
    const held = Object.values(profile.items).map((item) => item.templateId)
      .filter((templateId) => cosmeticId(templateId) && !starterIds().some((id) => sameId(id, templateId)));
    profile.coreBlanketCosmetics = [...new Set([...blanket(profile), ...held])];
    profile.coreMigrations = [...(profile.coreMigrations ?? []), "athenaLocker"];
  }
  for (const templateId of missing(profile, starterIds())) addCosmetic(tracker, templateId, true);
  for (const templateId of earnedCosmetics(profile, settings)) grantCosmetic(session, templateId);
  for (const itemId of heldRandomCharacters(profile)) removeCosmetic(tracker, itemId);
  if (settings.giveAllCosmetics) {
    const given = missing(profile, lockerCosmetics());
    for (const templateId of given) addCosmetic(tracker, templateId, true);
    profile.coreBlanketCosmetics = [...blanket(profile), ...given];
  } else if (blanket(profile).length) {
    log("Battle Royale", `${session.accountId}: ${blanket(profile).length} cosmetics given to everyone leave the locker`);
    for (const templateId of blanket(profile)) {
      const itemId = findItem(profile, templateId);
      if (itemId) removeCosmetic(tracker, itemId);
    }
    profile.coreBlanketCosmetics = [];
  }
  for (const slot of emptyDefaultSlots(profile)) {
    tracker.setStat(slots[slot][1], defaultItemId(profile, slot));
  }
}

// A win in a playlist (1.8's, reported by the gameserver): its victory umbrellas the player lacks.
export const awardVictory = (session, playlistId) => victoryUmbrellas(playlistId).map((templateId) => grantCosmetic(session, templateId)).filter(Boolean);

// EquipBattleRoyaleCustomization {slotName, itemToSlot}: an item of the slot's type, or "" for its default.
export function equipCustomization(session, slotName, itemToSlot) {
  const tracker = session.profile("athena");
  const slot = slotOf(slotName);
  if (!slot) throw new McpError("errors.com.epicgames.fortnite.invalid_parameter", `No locker slot ${slotName}`);
  const [type, stat] = slots[slot];
  let itemId = typeof itemToSlot === "string" ? itemToSlot : "";
  itemId ||= defaultItemId(tracker.profile, slot);
  if (itemId) {
    itemId = Object.keys(tracker.profile.items).find((id) => id.toLowerCase() === itemId.toLowerCase());
    const item = itemId && tracker.profile.items[itemId];
    if (!item) throw new McpError("errors.com.epicgames.fortnite.item_not_found", `No item ${itemToSlot}`);
    if (typeOf(item.templateId) !== type.toLowerCase()) {
      throw new McpError("errors.com.epicgames.fortnite.invalid_parameter", `${item.templateId} doesn't go in the ${slot} slot`);
    }
  }
  if (tracker.profile.stats.attributes[stat] !== itemId) tracker.setStat(stat, itemId);
}

// SetBattleRoyaleBanner {homebaseBannerIconId, homebaseBannerColorId}: the banner editor's (ESaveProfileForBanners::
// BattleRoyale; 0x3015C00 sends it in place of SetHomebaseBanner) row names, of banners the player owns in profile0,
// which is where the editor's choices come from. The Battle Royale lobby shows athena's banner_icon and banner_color.
export function setBattleRoyaleBanner(session, iconId, colorId) {
  if (typeof iconId !== "string" || typeof colorId !== "string" || !iconId || !colorId) return;
  const account = session.profile("profile0").profile;
  for (const templateId of [`HomebaseBannerIcon:${iconId}`, `HomebaseBannerColor:${colorId}`]) {
    const banner = bannerTemplateId(templateId);
    if (!banner || !findItem(account, banner)) throw new McpError("errors.com.epicgames.fortnite.item_not_found", `${templateId} isn't one of your banners`);
  }
  const tracker = session.profile("athena");
  if (tracker.profile.stats.attributes.banner_icon !== iconId) tracker.setStat("banner_icon", iconId);
  if (tracker.profile.stats.attributes.banner_color !== colorId) tracker.setStat("banner_color", colorId);
}

// The season level. The lobby (1.8's sub_707030) shows level, xp against the level's XpToNextLevel (so xp is the XP
// into the level, as in profile0) and accountLevel. A level's chase reward (ChaseRewardTemplateId: the BRSeason01
// banner at 10, the Mako glider at 25) is the player's once they reach it. accountLevel was Epic's count of levels over
// every season; 1.8 is the first, so it is the level (🟡). XP past the last level's bar is dropped.
export function addSeasonXp(session, amount) {
  const levels = seasonLevels();
  if (!levels.length || !(amount > 0)) return;
  const tracker = session.profile("athena");
  const { attributes } = tracker.profile.stats;
  const last = levels[levels.length - 1];
  let level = Math.min(Math.max(1, attributes.level ?? 1), last.level);
  let xp = (attributes.xp ?? 0) + Math.floor(amount);
  for (let row = levels.find((entry) => entry.level === level); row && level < last.level && xp >= row.xpToNextLevel;
    row = levels.find((entry) => entry.level === level)) {
    xp -= row.xpToNextLevel;
    level += 1;
  }
  if (level === last.level) xp = Math.min(xp, last.xpToNextLevel);
  if (attributes.xp !== xp) tracker.setStat("xp", xp);
  if (attributes.level !== level) {
    log("Battle Royale", `${session.accountId} reached season level ${level}`);
    tracker.setStat("level", level);
  }
  if (attributes.accountLevel !== level) tracker.setStat("accountLevel", level);
  settleChaseRewards(session);
}

// The chase rewards of the levels reached that the player lacks: banners go to profile0, where the banner editor finds
// them, cosmetics to the locker. One the build's data doesn't have waits for a build that has it.
export function settleChaseRewards(session) {
  const level = session.profile("athena").profile.stats.attributes.level ?? 1;
  for (const { chaseReward } of seasonLevels().filter((entry) => entry.level <= level && entry.chaseReward)) {
    const banner = bannerTemplateId(chaseReward);
    if (banner && !findItem(session.profile("profile0").profile, banner)) grant(session, banner, 1);
    else if (!banner) grantCosmetic(session, chaseReward);
  }
}

// What a match is worth (🟡 Core's: 1.8's server reports no XP and the formula was Epic's backend's): 5 per minute
// alive, 50 per elimination, 300 for a win, 100 within the playlist's first placement (solo top 10, duo top 5, squad
// top 3) and 50 within its second (top 25, 12, 6).
export function matchXp(playlistId, { place, kills, secondsAlive }) {
  const [first, second] = placements[playlistId] ?? [];
  const placement = place === 1 ? 300 : place <= first ? 100 : place <= second ? 50 : 0;
  return Math.floor(secondsAlive / 60) * 5 + kills * 50 + placement;
}

// Quests (the daily challenges): quest items in athena, as in profile0 (quest_state, completion_<objective>).
const questIdOf = (item) => (typeOf(item.templateId) === "quest" ? item.templateId.split(":")[1].toLowerCase() : undefined);
const athenaQuestOf = (item) => getAthenaQuest(questIdOf(item) ?? "");

function activeQuests(tracker) {
  return Object.entries(tracker.profile.items)
    .filter(([, item]) => item.attributes.quest_state === "Active" && athenaQuestOf(item))
    .map(([itemId, item]) => ({ itemId, item, quest: athenaQuestOf(item) }));
}

export function grantAthenaQuest(tracker, questId) {
  const quest = getAthenaQuest(questId);
  if (!quest) return null;
  const now = new Date().toISOString();
  const attributes = { quest_state: "Active", creation_time: now, last_state_change_time: now, sent_new_notification: false };
  for (const objective of quest.objectives) attributes[`completion_${objective.name}`] = 0;
  const itemId = crypto.randomUUID();
  tracker.addItem(itemId, { templateId: `Quest:${questId.toLowerCase()}`, attributes, quantity: 1 });
  return itemId;
}

// A challenge done is claimed at once: Battle Royale's quest log has no rewards screen, its XP (AthenaSeasonalXP) goes
// to the season level. The Archive's Battle Bucks were never given.
function completeQuest(session, itemId) {
  const tracker = session.profile("athena");
  const item = tracker.profile.items[itemId];
  const quest = athenaQuestOf(item);
  for (const objective of quest.objectives) {
    if (item.attributes[`completion_${objective.name}`] !== objective.count) tracker.setItemAttribute(itemId, `completion_${objective.name}`, objective.count);
  }
  tracker.setItemAttribute(itemId, "quest_state", "Claimed");
  tracker.setItemAttribute(itemId, "last_state_change_time", new Date().toISOString());
  log("Battle Royale", `${session.accountId} completed ${questIdOf(item)}`);
  for (const { templateId, quantity } of quest.rewards ?? []) {
    if (templateId.toLowerCase() === "accountresource:athenaseasonalxp") addSeasonXp(session, quantity);
    else if (typeOf(templateId) === "quest") grantAthenaQuest(tracker, templateId.split(":")[1]);
  }
}

function addProgress(session, itemId, objective, count) {
  const tracker = session.profile("athena");
  const item = tracker.profile.items[itemId];
  const key = `completion_${objective.name}`;
  const value = Math.min((item.attributes[key] ?? 0) + count, objective.count);
  if (item.attributes[key] !== value) tracker.setItemAttribute(itemId, key, value);
  const quest = athenaQuestOf(item);
  if (quest.objectives.every((other) => (item.attributes[`completion_${other.name}`] ?? 0) >= other.count)) completeQuest(session, itemId);
}

// Objectives Core counts from the match results the gameserver reports (battleroyale/recordresults): the placement
// ones (AthenaRank: "play matches", "top 25 in solo") and eliminations with any weapon. The gameserver's quest manager
// counts the rest (eliminations by weapon, chests and ammo boxes opened, players outlived) and sends them with
// UpdateQuests; those two kinds are left out of what it sends, so a match counts once (🟡).
const playlistTags = { 2: "athena.playlist.solo", 10: "athena.playlist.duo", 9: "athena.playlist.squad" };
const tagMatches = (tags, tag) => !tags || tags.toLowerCase().split(",").map((one) => one.trim())
  .every((wanted) => tag === wanted || tag.startsWith(`${wanted}.`));

function countedFromResults(stat) {
  const row = stat && athenaObjectiveStat(stat);
  return row?.type === "AthenaRank" || (row?.type === "Kill" && row.sourceTags === "Homebase.Class");
}

function rankMet(condition, place) {
  const match = /Athena\.Rank\s*(<=|==|>=|<|>)\s*(\d+)/i.exec(condition ?? "");
  if (!match) return true;
  const target = Number(match[2]);
  return { "<=": place <= target, "==": place === target, ">=": place >= target, "<": place < target, ">": place > target }[match[1]];
}

export function recordMatchProgress(session, playlistId, { place, kills }) {
  const tag = playlistTags[playlistId] ?? "athena.playlist";
  for (const { itemId, quest } of activeQuests(session.profile("athena"))) {
    for (const objective of quest.objectives) {
      const row = countedFromResults(objective.stat) && athenaObjectiveStat(objective.stat);
      if (!row || !tagMatches(row.contextTags, tag)) continue;
      const count = row.type === "AthenaRank" ? (rankMet(row.condition, place) ? 1 : 0) : kills;
      if (count > 0 && session.profile("athena").profile.items[itemId]?.attributes.quest_state === "Active") addProgress(session, itemId, objective, count);
    }
  }
}

// UpdateQuests (and EndBattleRoyaleGame's Advance) from the gameserver: [{statName, count}], statName an objective's
// BackendName.
export function advanceAthenaObjectives(session, updates) {
  for (const { statName, count } of Array.isArray(updates) ? updates : []) {
    if (typeof statName !== "string" || !Number.isInteger(count) || count <= 0) continue;
    for (const { itemId, quest } of activeQuests(session.profile("athena"))) {
      const objective = quest.objectives.find((candidate) => candidate.name === statName.toLowerCase());
      if (!objective || countedFromResults(objective.stat)) continue;
      if (session.profile("athena").profile.items[itemId]?.attributes.quest_state === "Active") addProgress(session, itemId, objective, count);
    }
  }
}

// Daily challenges, as Core gives STW's (profiles/dailies.js): 1.8's Athena_DailyQuestTrigger and its quest pack name
// none, Epic chose them on its servers. On the first quest login of each UTC day, claimed dailies are cleared, one new
// one (a daily the player doesn't hold, by the quests' weights) is added while fewer than 3 are open, and the daily
// reroll is restored.
const maxOpen = 3;
const rerollsPerDay = 1;
const heldDailies = (tracker) => Object.entries(tracker.profile.items)
  .filter(([, item]) => athenaQuestOf(item)?.type === "AthenaDailyQuest");

function newDaily(tracker) {
  const held = new Set(heldDailies(tracker).map(([, item]) => questIdOf(item)));
  const choices = athenaDailyIds().filter((id) => !held.has(id) && dailyWeight(id) > 0);
  const total = choices.reduce((sum, id) => sum + dailyWeight(id), 0);
  let roll = (crypto.randomInt(1_000_000) / 1_000_000) * total;
  const chosen = choices.find((id) => (roll -= dailyWeight(id)) < 0) ?? choices[choices.length - 1];
  return chosen ? grantAthenaQuest(tracker, chosen) : null;
}

export function refreshAthenaDailies(session, now = new Date()) {
  const tracker = session.profile("athena");
  const manager = tracker.profile.stats.attributes.quest_manager ?? {};
  if ((manager.dailyLoginInterval ?? "").slice(0, 10) >= now.toISOString().slice(0, 10)) return;
  for (const [itemId, item] of heldDailies(tracker)) {
    if (item.attributes.quest_state === "Claimed") tracker.removeItem(itemId);
  }
  if (heldDailies(tracker).length < maxOpen) newDaily(tracker);
  tracker.setStat("quest_manager", { ...manager, dailyLoginInterval: now.toISOString(), dailyQuestRerolls: rerollsPerDay });
}

// FortRerollDailyQuest {questId} on athena: an open daily for another, once a day.
export function rerollAthenaDaily(session, itemId, notifications) {
  const tracker = session.profile("athena");
  const item = typeof itemId === "string" && tracker.profile.items[itemId];
  if (!item || athenaQuestOf(item)?.type !== "AthenaDailyQuest" || item.attributes.quest_state !== "Active") {
    throw new McpError("errors.com.epicgames.fortnite.item_not_found", `No open daily challenge ${itemId}`);
  }
  const manager = tracker.profile.stats.attributes.quest_manager ?? {};
  if (!(manager.dailyQuestRerolls > 0)) throw new McpError("errors.com.epicgames.fortnite.no_rerolls_remaining", "No daily challenge rerolls left today");
  const newQuestId = newDaily(tracker);
  if (!newQuestId) throw new McpError("errors.com.epicgames.fortnite.item_not_found", "No other daily challenge to give");
  tracker.removeItem(itemId);
  tracker.setStat("quest_manager", { ...manager, dailyQuestRerolls: manager.dailyQuestRerolls - 1 });
  notifications.push({ type: "dailyQuestReroll", primary: true, newQuestId });
}

// ClientQuestLogin / ServerQuestLogin on athena.
export function athenaQuestLogin(session) {
  refreshAthenaDailies(session);
  settleChaseRewards(session);
}

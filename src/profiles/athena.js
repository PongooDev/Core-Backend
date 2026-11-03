import crypto from "node:crypto";
import { inBuild } from "../builds/context.js";
import { McpError } from "../errors.js";
import { athenaEventQuestsOf } from "../events/fiftyfifty.js";
import { eventQueueOfPlaylist } from "../events/ltms.js";
import { currentBuild } from "../builds/context.js";
import { athenaBattlePassDailyIds, athenaCosmetics, athenaDailyIds, athenaObjectiveStat, athenaSeason, dailyWeight, getAthenaQuest, seasonLevels } from "../gamedata/athena.js";
import { bannerIds, bannerTemplateId } from "../gamedata/banners.js";
import { dataBuilds } from "../gamedata/read.js";
import { log } from "../log.js";
import { placements } from "../stats/store.js";
import { defaultBanner } from "./defaults.js";
import { findItem } from "./items.js";
import { grant } from "./progress.js";
import { accountLevelOf, addBookXp, namesAthenaBuild, seasonNeedsSwitch, seasonNumber, settleSeasonRewards, switchSeason } from "./seasons.js";

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
// (EID_DanceMoves); the default loading screen and battle bus; and for an account that owns Save the World (a founder,
// settings.ownsSaveTheWorld, profiles/founders.js) the Founder's Glider in place of the Glider, as 1.7.2's winners answer
// had a founder_glider type for founders (services/fortnite/battleroyale.js), which 1.8 made this item (Core-Backend
// #84). The default glider stays everyone's: it is what an empty glider slot holds.
const starters = ["AthenaGlider:defaultglider", "AthenaPickaxe:defaultpickaxe", "AthenaDance:eid_dancemoves",
  "AthenaLoadingScreen:lsid_defaultbg", "AthenaBattleBus:bbid_defaultbus"];
const founderStarters = ["AthenaGlider:founderglider"];
const ownsSaveTheWorld = (accountId, settings = {}) => settings.ownsSaveTheWorld?.(accountId) === true;

// Cosmetics in the game data that are never locker items:
// - AthenaGameData's RandomCharacters, CID_001-008 (the "Recruit" outfits): an empty character slot plays one of them at
//   random, and they're never items one can pick (Core-Backend #77). A character slot holding one goes back to "".
// - Duo_Umbrella ("Duo Victory Umbrella.") and Squad_Umbrella ("Squad Victory Umbrella."), Core-Backend #84: Epic never
//   gave them, every win in every mode gave The Umbrella (Solo_Umbrella, below), and later builds' paks dropped both
//   assets (the report; 1.8 is the last build Core has). 1.8's still have their descriptions unlocalized (no text
//   namespace, where Solo_Umbrella's has its package's). A glider slot holding one goes back to the default glider.
// - What the data shows Epic never gave (Core-Backend #161), in any build's data (neverGiven, below).
// A locker that holds one loses it; nothing gives one.
const randomCharacters = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `AthenaCharacter:cid_00${n}_athena_commando_${n <= 4 ? "f" : "m"}_default`);
const unusedUmbrellas = ["AthenaGlider:duo_umbrella", "AthenaGlider:squad_umbrella"];
const notLockerItems = [...randomCharacters, ...unusedUmbrellas];

// The cosmetics whose definition says they were never anyone's (Core-Backend #161):
// - a consumable emote (AthenaConsumableEmoteItemDefinition): an item with a count that playing it uses up, not a
//   cosmetic. The only one, Cert's EID_GunShow ("GUN SHOW"), is in every build's data and was never given; 1.11's and
//   2.1's emote wheel shows a held one in its own slot, as "GUN SHOW (x1)".
// - a placeholder (its display name "Placeholder"): 1.11's and 2.1's Emoji_Placeholder, the stand-in emoticon.
const neverGiven = (cosmetic) => cosmetic?.class === "AthenaConsumableEmoteItemDefinition"
  || String(cosmetic?.name ?? "").trim().toLowerCase() === "placeholder";
// Their template ids in any build's data, lower-cased: a profile is shared by every build. Made on first use.
let neverGivenIds;
const neverGivenTemplate = (templateId) => {
  neverGivenIds ??= new Set(dataBuilds.flatMap((build) => inBuild(build, () => Object.entries(athenaCosmetics())))
    .filter(([, cosmetic]) => neverGiven(cosmetic)).map(([id]) => id.toLowerCase()));
  return neverGivenIds.has(String(templateId).toLowerCase());
};
// Locker items the shop never sold (Core-Backend #95): the tiered umbrellas and the preseason gliders.
const notShopGliders = ["AthenaGlider:umbrella_bronze", "AthenaGlider:umbrella_silver", "AthenaGlider:umbrella_gold",
  "AthenaGlider:umbrella_platinum", "AthenaGlider:preseasonglider", "AthenaGlider:preseasonglider_elite"];
const isLockerItem = (templateId) => !notLockerItems.some((id) => id.toLowerCase() === String(templateId).toLowerCase())
  && !neverGivenTemplate(templateId);
const heldNonLockerItems = (profile) => Object.entries(profile.items)
  .filter(([, item]) => !isLockerItem(item.templateId)).map(([itemId]) => itemId);
// The build's locker cosmetics, as its game data spells them.
export const lockerCosmetics = () => Object.keys(athenaCosmetics()).filter(isLockerItem);

// The build's template id for one of its cosmetics, as its game data spells it; undefined if it has none.
function cosmeticId(templateId) {
  const wanted = String(templateId).toLowerCase();
  return Object.keys(athenaCosmetics()).find((id) => id.toLowerCase() === wanted);
}

// The build's template id for one of its locker cosmetics; undefined if its data has none or it is never a locker item.
export function lockerCosmeticId(templateId) {
  const id = cosmeticId(templateId);
  return id && isLockerItem(id) ? id : undefined;
}

// The account's starters; without an account, everyone's and the founders' alike.
const starterIds = (profile, settings) => [...starters, ...(!profile || ownsSaveTheWorld(profile.accountId, settings) ? founderStarters : [])]
  .map(cosmeticId).filter(Boolean);
const sameId = (a, b) => a.toLowerCase() === b.toLowerCase();
const migrated = (profile, name) => (profile.coreMigrations ?? []).includes(name);

// The victory umbrellas (Core-Backend #84, #157): a win in a main mode (solo, duo or squad, stats/store.js isMainPlaylist;
// not a limited-time playlist) gives The Umbrella (Solo_Umbrella, "The fabled victory umbrella."), for an account's first
// win in any season, and a first win in a season from Season 2 gives that season's own umbrella too: Season 2's Snowflake
// (Umbrella_Snowflake, in 1.11's and 2.1's data). Season 1 has none beyond The Umbrella, and a season's umbrella isn't
// earned in another season. An account that owns Save the World also gets the Founder's Umbrella ("Founder's exclusive!")
// for a win in any season. 1.7.2's winners answer has one glider a player: "founder_umbrella" for such an account's win,
// "umbrella" for anyone else's (services/fortnite/battleroyale.js, umbrellaTypeOf); the locker's umbrellas come the next
// time the account's athena profile loads. 1.8 has no winners question (none of 1.7.2's battleroyale/winners or recordwin
// strings are left): its umbrella is a glider item the locker equips. An umbrella already in a locker stays.
const victoryUmbrella = "AthenaGlider:solo_umbrella";
const seasonVictoryUmbrellas = { 2: "AthenaGlider:umbrella_snowflake" };
const founderVictoryUmbrella = "AthenaGlider:founderumbrella";
const victoryUmbrellas = [victoryUmbrella, ...Object.values(seasonVictoryUmbrellas), founderVictoryUmbrella];
const victoryUmbrellasOf = (accountId, settings, season) => [victoryUmbrella, seasonVictoryUmbrellas[season],
  ownsSaveTheWorld(accountId, settings) ? founderVictoryUmbrella : undefined].filter(Boolean);

// Non-shop items: cosmetics that are given at start, earned in-game (season chase rewards, victory umbrellas),
// or never locker items (Recruit defaults, unused umbrellas). They are never sold in the item shop (Core-Backend #69).
export const chaseRewardIds = () => seasonLevels().filter((entry) => entry.chaseReward).map((entry) => entry.chaseReward);

// The Battle Pass's cosmetics (1.11's Season 2, profiles/seasons.js): earned, never sold.
const battlePassCosmeticIds = () => [...(athenaSeason()?.bookFreeRewards ?? []), ...(athenaSeason()?.bookPaidRewards ?? [])]
  .flatMap(({ rewards }) => rewards.map(({ templateId }) => templateId)).filter((templateId) => templateId.toLowerCase().startsWith("athena"));

export const nonShopCosmeticIds = () => [
  ...starters,
  ...battlePassCosmeticIds(),
  ...founderStarters,
  ...chaseRewardIds(),
  ...victoryUmbrellas,
  ...unusedUmbrellas,
  ...notShopGliders,
  ...randomCharacters
];

export const isNonShopCosmetic = (templateId) =>
  nonShopCosmeticIds().some((id) => sameId(id, templateId));

// The cosmetics the player has earned: the chase rewards of the season levels reached and, for each season with a
// recorded win in solo, duo or squad (settings.wonSeasons, the stats: 1.7.2's recordwin; 1.8's own wins give theirs when
// the gameserver reports them, services/fortnite/battleroyale.js), the victory umbrellas a win in that season gives.
function earnedCosmetics(profile, settings) {
  const level = profile.stats.attributes.level ?? 1;
  const rewards = seasonLevels().filter((entry) => entry.level <= level && entry.chaseReward).map((entry) => entry.chaseReward);
  const umbrellas = (settings.wonSeasons?.(profile.accountId) ?? []).flatMap((season) => victoryUmbrellasOf(profile.accountId, settings, season));
  return [...new Set([...rewards, ...umbrellas].map(cosmeticId).filter(Boolean))];
}

// profile.coreBlanketCosmetics (Core's, never sent to the client) lists what giveAllCosmetics put in the locker that the
// player hasn't bought or earned since; with the setting off they leave it. Profiles made before #77, when every account
// got every cosmetic, had nothing to buy or earn them with (the item shop came with #77, and earned cosmetics were already
// held), so everything they held beyond the starters counts as that blanket grant and goes, apart from what the player
// had earned by then (the level 25 Mako, the umbrellas of recorded wins): once, migration athenaLocker.
const blanket = (profile) => profile.coreBlanketCosmetics ?? [];
const missing = (profile, templateIds) => templateIds.filter((templateId) => !findItem(profile, templateId));

export function athenaNeedsSetUp(profile, settings = {}) {
  return !migrated(profile, "athenaLocker") || missing(profile, starterIds(profile, settings)).length > 0
    || missing(profile, earnedCosmetics(profile, settings)).length > 0
    || (settings.giveAllCosmetics ? missing(profile, lockerCosmetics()).length > 0 : blanket(profile).length > 0)
    || emptyDefaultSlots(profile).length > 0 || heldNonLockerItems(profile).length > 0
    || seasonNeedsSwitch(profile) || danceSlotsNeedSettling(profile);
}

function addCosmetic(tracker, templateId, seen) {
  tracker.addItem(templateId, { templateId, attributes: { level: 1, item_seen: seen ? 1 : 0, favorite: 0 }, quantity: 1 });
}

// A cosmetic the player now owns for good (bought or earned): added if the locker lacks it, and no longer the blanket
// grant's if that gave it. Returns the grant ({profileId, itemId, templateId, quantity}), or null when the player
// already had it or the build has no such locker cosmetic. force (the admin panel's give by id, Core-Backend #109) gives
// a template no build's data has as it is spelled.
export function grantCosmetic(session, templateId, { force = false } = {}) {
  const id = cosmeticId(templateId) ?? (force ? String(templateId) : undefined);
  if (!id || !isLockerItem(id)) return null;
  const tracker = session.profile("athena");
  const { profile } = tracker;
  if (blanket(profile).some((held) => sameId(held, id))) profile.coreBlanketCosmetics = blanket(profile).filter((held) => !sameId(held, id));
  if (adminGranted(profile).some((held) => sameId(held, id))) profile.coreGrantedCosmetics = adminGranted(profile).filter((held) => !sameId(held, id));
  if (findItem(profile, id)) return null;
  addCosmetic(tracker, id, false);
  log("Battle Royale", `${session.accountId} got ${id}`);
  return { profileId: "athena", itemId: id, templateId: id, quantity: 1 };
}

export const ownsCosmetic = (session, templateId) => Boolean(findItem(session.profile("athena").profile, templateId));

// A slot holding an item that leaves the locker goes back to its default (the default glider and pickaxe, "" elsewhere:
// slotDefaults).
function removeCosmetic(tracker, itemId) {
  tracker.removeItem(itemId);
  for (const [slot, [, stat]] of Object.entries(slots)) {
    const held = tracker.profile.stats.attributes[stat];
    if (Array.isArray(held)) {
      if (held.some((id) => sameId(String(id ?? ""), itemId))) tracker.setStat(stat, held.map((id) => (sameId(String(id ?? ""), itemId) ? "" : id)));
    } else if (sameId(String(held ?? ""), itemId)) tracker.setStat(stat, defaultItemId(tracker.profile, slot));
  }
  // 1.11's other five emote slots, waiting while a 1.8 to 1.10 build has the profile (settleDanceSlots), don't bring it back.
  const { profile } = tracker;
  if (Array.isArray(profile.coreDances)) profile.coreDances = profile.coreDances.map((id) => (sameId(String(id ?? ""), itemId) ? "" : id));
}

// Why a cosmetic the panel would take out of a locker stays (Core-Backend #159): the starters and what the player has
// earned (season level rewards reached, victory umbrellas of recorded wins) are given back the next time the profile is
// set up, so taking them is refused. null for one that can go.
function keptCosmeticReason(profile, settings, templateId) {
  if (starterIds(profile, settings).some((id) => sameId(id, templateId))) return "a starter cosmetic every account is given back";
  if (!earnedCosmetics(profile, settings).some((id) => sameId(id, templateId))) return null;
  return chaseRewardIds().some((id) => sameId(id, templateId)) ? "a season level reward the account has reached" : "a victory umbrella of a recorded win";
}

// The admin panel's Remove selected (Core-Backend #159): a cosmetic leaves the locker, with what it held (its attributes
// and variants are the item's), and the slots showing it go back to their default as when the full locker is taken back
// (removeCosmetic). It is no longer the panel's or the blanket grant's to take back either. Returns { removed: true },
// { kept: reason } for one that would come back, or { removed: false } for one the account doesn't own.
export function removeLockerCosmetic(session, templateId) {
  const tracker = session.profile("athena");
  const { profile } = tracker;
  const itemId = findItem(profile, templateId);
  if (!itemId) return { removed: false };
  const kept = keptCosmeticReason(profile, session.settings ?? {}, profile.items[itemId].templateId);
  if (kept) return { kept };
  removeCosmetic(tracker, itemId);
  profile.coreBlanketCosmetics = blanket(profile).filter((held) => !sameId(held, templateId));
  profile.coreGrantedCosmetics = adminGranted(profile).filter((held) => !sameId(held, templateId));
  log("Battle Royale", `${session.accountId} lost ${templateId} from the admin panel`);
  return { removed: true };
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
  for (const templateId of missing(profile, starterIds(profile, settings))) addCosmetic(tracker, templateId, true);
  for (const templateId of earnedCosmetics(profile, settings)) grantCosmetic(session, templateId);
  for (const itemId of heldNonLockerItems(profile)) removeCosmetic(tracker, itemId);
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
  if (seasonNeedsSwitch(profile)) switchSeason(session);
  if (danceSlotsNeedSettling(profile)) settleDanceSlots(tracker);
}

// The full locker (Core-Backend #97), from the admin panel: every locker cosmetic and every banner the account lacks.
// Accounts are shared by every build, so it is what any build's data has (a build's client isn't sent templates only
// other builds have, gamedata/templates.js). profile.coreGrantedCosmetics (athena) and coreGrantedBanners (profile0), Core's
// and never sent to the client, list what it gave that the player hasn't bought or earned since, so it can be taken back
// (removeFullLocker). What giveAllCosmetics gave counts as the panel's from then on: it stays when the host turns that off.
const adminGranted = (profile) => profile.coreGrantedCosmetics ?? [];
const adminBanners = (profile) => profile.coreGrantedBanners ?? [];

// ids(): a build's template ids. Every data build's, each once (as the first build to have it spells it).
function inEveryBuild(ids) {
  const found = new Map();
  for (const build of dataBuilds) {
    for (const id of inBuild(build, ids)) if (!found.has(id.toLowerCase())) found.set(id.toLowerCase(), id);
  }
  return [...found.values()];
}

// The panel's count of what the full locker holds and what the account has of it. Reads the profiles as saved.
export function fullLockerState(athena, account) {
  const cosmetics = inEveryBuild(lockerCosmetics);
  const banners = inEveryBuild(bannerIds);
  const owned = (profile, ids) => (profile ? ids.filter((id) => findItem(profile, id)).length : 0);
  return {
    cosmetics: { owned: owned(athena, cosmetics), total: cosmetics.length },
    banners: { owned: owned(account, banners), total: banners.length },
    granted: (athena ? adminGranted(athena).length : 0) + (account ? adminBanners(account).length : 0)
  };
}

// The panel's cosmetics of templateIds that the account lacks, noted as the panel's (coreGrantedCosmetics) for Remove
// granted to take back; what the blanket grant gave becomes the panel's. Returns how many were added.
function grantPanelCosmetics(session, templateIds) {
  const tracker = session.profile("athena");
  const { profile } = tracker;
  let cosmetics = 0;
  const given = [];
  for (const templateId of templateIds) {
    const fromBlanket = blanket(profile).some((held) => sameId(held, templateId));
    const held = findItem(profile, templateId);
    if (held && !fromBlanket) continue;
    if (fromBlanket) profile.coreBlanketCosmetics = blanket(profile).filter((id) => !sameId(id, templateId));
    if (!held) {
      addCosmetic(tracker, templateId, true);
      cosmetics += 1;
    }
    given.push(templateId);
  }
  profile.coreGrantedCosmetics = [...adminGranted(profile), ...given];
  return cosmetics;
}

// The item shop's cosmetics (Core-Backend #163), of what it sold ({history, custom}, store/itemshop.js soldCosmeticIds):
// those that are locker cosmetics in any build's data, as the full locker counts them (an account is shared by every
// build; a consumable emote or a placeholder never is, #161), less what no build's shop sells (nonShopCosmeticIds in each
// build's season: starters, Battle Pass rewards, victory umbrellas, season level rewards). A season level reward the
// histories show sold stays, as it was Epic's sale: Season 2's shop sold Season 1's level 24 reward, the Warthog.
// Each once, as the first build to have it spells it.
export function shopLockerCosmetics({ history = [], custom = [] }) {
  const lower = (ids) => new Set(ids.map((id) => String(id).toLowerCase()));
  const recorded = lower(history);
  const levelRewards = lower(dataBuilds.flatMap((build) => inBuild(build, chaseRewardIds)));
  const notSold = lower(dataBuilds.flatMap((build) => inBuild(build, nonShopCosmeticIds)));
  const listed = lower(custom);
  const sold = (id) => (recorded.has(id) || listed.has(id))
    && (!notSold.has(id) || (recorded.has(id) && levelRewards.has(id)));
  return inEveryBuild(lockerCosmetics).filter((id) => sold(id.toLowerCase()));
}

// The admin panel's Give all item shop cosmetics (Core-Backend #163): every shop cosmetic (shopLockerCosmetics) the
// account lacks, given as the full locker gives, so Remove granted takes them back. Returns how many were added, how many
// the account already owned, and how many the shop sold.
export function grantShopCosmetics(session, soldIds) {
  const cosmetics = shopLockerCosmetics(soldIds);
  const granted = grantPanelCosmetics(session, cosmetics);
  log("Battle Royale", `${session.accountId} was given the item shop's cosmetics: ${granted} of ${cosmetics.length}`);
  return { granted, alreadyOwned: cosmetics.length - granted, total: cosmetics.length };
}

// Returns how many cosmetics and banners were added.
export function grantFullLocker(session) {
  const cosmetics = grantPanelCosmetics(session, inEveryBuild(lockerCosmetics));

  const account = session.profile("profile0");
  const banners = inEveryBuild(bannerIds).filter((templateId) => !findItem(account.profile, templateId));
  for (const templateId of banners) account.addItem(crypto.randomUUID(), { templateId, attributes: { item_seen: 1 }, quantity: 1 });
  account.profile.coreGrantedBanners = [...adminBanners(account.profile), ...banners];
  log("Battle Royale", `${session.accountId} was given the full locker: ${cosmetics} cosmetics and ${banners.length} banners`);
  return { cosmetics, banners: banners.length };
}

// Takes back what grantFullLocker gave and the player hasn't bought or earned since. Slots and banners showing an item
// that goes get their default. Returns how many cosmetics and banners were removed.
export function removeFullLocker(session) {
  const tracker = session.profile("athena");
  const { profile } = tracker;
  const keep = [...starterIds(), ...earnedCosmetics(profile, session.settings ?? {})];
  let cosmetics = 0;
  for (const templateId of adminGranted(profile)) {
    const itemId = findItem(profile, templateId);
    if (!itemId || keep.some((id) => sameId(id, templateId))) continue;
    removeCosmetic(tracker, itemId);
    cosmetics += 1;
  }
  // What is never a locker item goes too, however it came (Core-Backend #161: the full locker gave EID_GunShow).
  for (const itemId of heldNonLockerItems(profile)) {
    removeCosmetic(tracker, itemId);
    cosmetics += 1;
  }
  profile.coreGrantedCosmetics = [];

  const account = session.profile("profile0");
  const removed = [];
  for (const templateId of adminBanners(account.profile)) {
    const itemId = findItem(account.profile, templateId);
    if (!itemId) continue;
    account.removeItem(itemId);
    removed.push(templateId.split(":")[1].toLowerCase());
  }
  account.profile.coreGrantedBanners = [];
  const gone = (row) => removed.includes(String(row ?? "").toLowerCase());
  const { attributes } = tracker.profile.stats;
  if (gone(attributes.banner_icon)) tracker.setStat("banner_icon", defaultBanner.bannerIconId);
  if (gone(attributes.banner_color)) tracker.setStat("banner_color", defaultBanner.bannerColorId);
  const homebase = account.profile.stats.attributes.homebase;
  if (homebase && (gone(homebase.bannerIconId) || gone(homebase.bannerColorId))) {
    account.setStat("homebase", { ...homebase,
      bannerIconId: gone(homebase.bannerIconId) ? defaultBanner.bannerIconId : homebase.bannerIconId,
      bannerColorId: gone(homebase.bannerColorId) ? defaultBanner.bannerColorId : homebase.bannerColorId });
  }
  // A season level reward banner the full locker gave first is the player's again.
  settleChaseRewards(session);
  log("Battle Royale", `${session.accountId}'s full locker was taken back: ${cosmetics} cosmetics and ${removed.length} banners`);
  return { cosmetics, banners: removed.length };
}

// A win in solo, duo or squad (1.8's on, reported by the gameserver), run in the match's build: the victory umbrellas a
// win in its season gives, those the player lacks.
export const awardVictory = (session) => victoryUmbrellasOf(session.accountId, session.settings, seasonNumber())
  .map((templateId) => grantCosmetic(session, templateId)).filter(Boolean);

// The glider 1.7.2's winners answer gives a player (services/fortnite/battleroyale.js, Core-Backend #84): "umbrella" for
// a win in solo, duo or squad, "founder_umbrella" for one by an account that owns Save the World, "founder_glider" for
// such an account without a win, and nothing (the stock glider) for anyone else.
export function umbrellaTypeOf(accountId, hasWon, settings) {
  const founder = ownsSaveTheWorld(accountId, settings);
  if (hasWon) return founder ? "founder_umbrella" : "umbrella";
  return founder ? "founder_glider" : null;
}

// From 1.11 (CL-3807424; 2.1 to 2.5 too) the locker has six emote slots (Emote 1 to Emote 6): EquipBattleRoyaleCustomization's indexWithinSlot
// (UFortMcpProfileAthena::EquipBattleRoyaleCustomization(SlotName, ItemToSlot, indexWithinSlot)) names the one, and the
// loadout's emotes are a list (FFortAthenaLoadout Dances, a TArray<UAthenaDanceItemDefinition*>), so favorite_dance is
// the six emotes' ids, "" for an empty slot, as Epic's athena profiles kept it from Season 2 on. 1.8 to 1.10 keep the one
// emote as a string; their slot is the first. Accounts are shared by every build, so while such a build has the profile
// the other five wait in profile.coreDances (Core's, never sent) and come back with 1.11 (Core-Backend #145: an emote
// equipped in 1.11 didn't stay, the profile giving its client a string where it reads a list). Only a request naming a
// build settles it (the admin panel's and CoreV2's name none).
const firstDanceSlotsBuild = 3807424;
export const danceSlotCount = 6;
const hasDanceSlots = () => Number(currentBuild()) >= firstDanceSlotsBuild;

function danceSlotsNeedSettling(profile) {
  if (!namesAthenaBuild()) return false;
  const dances = profile.stats.attributes.favorite_dance;
  return hasDanceSlots() ? !Array.isArray(dances) || dances.length !== danceSlotCount : Array.isArray(dances);
}

function settleDanceSlots(tracker) {
  const { profile } = tracker;
  const dances = profile.stats.attributes.favorite_dance;
  if (hasDanceSlots()) {
    const kept = Array.isArray(dances) ? dances : [typeof dances === "string" ? dances : "", ...(profile.coreDances ?? []).slice(1)];
    tracker.setStat("favorite_dance", Array.from({ length: danceSlotCount }, (_, index) => (typeof kept[index] === "string" ? kept[index] : "")));
    delete profile.coreDances;
  } else {
    profile.coreDances = dances;
    tracker.setStat("favorite_dance", typeof dances[0] === "string" ? dances[0] : "");
  }
}

// EquipBattleRoyaleCustomization {slotName, itemToSlot, indexWithinSlot}: an item of the slot's type, or "" for its
// default; in 1.11's emote slots, at indexWithinSlot (0 to 5; another index is the first slot).
export function equipCustomization(session, slotName, itemToSlot, indexWithinSlot = 0) {
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
  const held = tracker.profile.stats.attributes[stat];
  if (Array.isArray(held)) {
    const index = Number.isInteger(indexWithinSlot) && indexWithinSlot >= 0 && indexWithinSlot < held.length ? indexWithinSlot : 0;
    if (held[index] !== itemId) tracker.setStat(stat, held.map((id, at) => (at === index ? itemId : id)));
  } else if (held !== itemId) tracker.setStat(stat, itemId);
}

// The season level. The lobby (1.8's sub_707030) shows level, xp against the level's XpToNextLevel (so xp is the XP
// into the level, as in profile0) and accountLevel. A level's chase reward (ChaseRewardTemplateId: the BRSeason01
// banner at 10, the Mako glider at 25) is the player's once they reach it. accountLevel was Epic's count of levels over
// every season: in Season 1 the level (🟡), in 1.11's Season 2 the level and past_seasons' levels (profiles/seasons.js).
// XP past the last level's bar is dropped. In Season 2 each level reached gives its Battle Stars, and they the Battle
// Pass's tiers (settleSeasonRewards).
export function addSeasonXp(session, amount) {
  const levels = seasonLevels();
  if (!levels.length || !(amount > 0)) return;
  const tracker = session.profile("athena");
  const { attributes } = tracker.profile.stats;
  const last = levels[levels.length - 1];
  const top = maxSeasonLevel();
  let level = Math.min(Math.max(1, attributes.level ?? 1), top);
  let xp = (attributes.xp ?? 0) + Math.floor(amount);
  for (let row = levels.find((entry) => entry.level === level); row && level < top && xp >= row.xpToNextLevel;
    row = levels.find((entry) => entry.level === level)) {
    xp -= row.xpToNextLevel;
    level += 1;
  }
  // Season 2's last level (NumSeasonLevels, 100) is one past its XP table's last row, and keeps no XP.
  if (athenaSeason()) {
    if (level >= top) xp = 0;
  } else if (level === last.level) xp = Math.min(xp, last.xpToNextLevel);
  if (attributes.xp !== xp) tracker.setStat("xp", xp);
  if (attributes.level !== level) {
    log("Battle Royale", `${session.accountId} reached season level ${level}`);
    tracker.setStat("level", level);
  }
  const accountLevel = accountLevelOf(tracker.profile, level);
  if (attributes.accountLevel !== accountLevel) tracker.setStat("accountLevel", accountLevel);
  settleChaseRewards(session);
  settleSeasonRewards(session, seasonFunctions);
}

// The season level an admin sets (Core-Backend #106): the start of that level (no XP into it) and its chase rewards up to
// it. Going down takes nothing back, as XP only ever moved the level up. The level a 1.8 lobby can show, 1 to the last
// season level.
export const maxSeasonLevel = () => athenaSeason()?.numSeasonLevels ?? seasonLevels().reduce((max, entry) => Math.max(max, entry.level), 1);
export function setSeasonLevel(session, level) {
  const tracker = session.profile("athena");
  const { attributes } = tracker.profile.stats;
  if (attributes.level !== level) tracker.setStat("level", level);
  if (attributes.xp !== 0) tracker.setStat("xp", 0);
  const accountLevel = accountLevelOf(tracker.profile, level);
  if (attributes.accountLevel !== accountLevel) tracker.setStat("accountLevel", accountLevel);
  log("Battle Royale", `${session.accountId} set to season level ${level} from the admin panel`);
  settleChaseRewards(session);
  settleSeasonRewards(session, seasonFunctions);
}

// What profiles/seasons.js gives season rewards with.
const seasonFunctions = { addSeasonXp, grantCosmetic, grantAthenaQuest, settleBattlePassDaily };
export const seasonRewardFunctions = () => seasonFunctions;

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
export function matchXp(playlistId, result) {
  return matchXpAwards(playlistId, result).reduce((sum, { xp }) => sum + xp, 0);
}

// The same XP by what earned it, as the end-of-match screen lists it (1.11's FAthenaAwardGroup, ERewardSource):
// MinutesPlayed "Survival Time", TeamKills "Kills" and Placement, each with its XP; the ones that earned none are left out.
export const rewardSources = { MinutesPlayed: 1, TeamKills: 3, Placement: 4 };
export function matchXpAwards(playlistId, { place, kills, secondsAlive }) {
  const [first, second] = placements[playlistId] ?? [];
  const placement = place === 1 ? 300 : place <= first ? 100 : place <= second ? 50 : 0;
  return [
    { rewardSource: rewardSources.MinutesPlayed, xp: Math.floor(secondsAlive / 60) * 5 },
    { rewardSource: rewardSources.TeamKills, xp: kills * 50 },
    { rewardSource: rewardSources.Placement, xp: placement }
  ].filter(({ xp }) => xp > 0);
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

// A challenge done waits, Completed, for the lobby's Collect Rewards (Core-Backend #114): its XP is held back until the
// player collects it. Every build with Battle Royale's daily challenges has that button: 1.8, 1.8.1 and 1.8.2 all pack
// Athena/UI/DailyQuests/DailyQuestsPanel, and 1.7.2 has no athena profile (services/mcp/profile.js) and no
// EFortQuestType::AthenaDailyQuest, so no build is paid at once any more.
//
// DailyQuestsPanel_C::OnQuestsUpdated lists the athena quest manager's quests of EFortQuestType 0xB (AthenaDailyQuest)
// that are Active (EFortQuestState 1) or Completed (2), with the objectives' counts (the checkmark), skips Claimed (3)
// ones, and shows ClaimButton while one is Completed. The button calls ClaimNextCompletedQuestReward(0xB) (1.8.2
// sub_871C00: the Completed quest of that type first in its order), which sends ClaimQuestReward {questId: the item id,
// selectedRewardIndex: -1} for the athena profile (sub_871D10 → sub_871E70 → sub_9F7920, command qword_664D410 =
// "ClaimQuestReward"). Once it succeeds (sub_88FDF0: OnQuestRewardClaimed) the panel claims the next one, until none is
// Completed (OnNoQuestRewardsToClaim); a failed claim ends it too. claimAthenaQuest pays it and makes it Claimed, which
// the panel hides; the next day's refresh clears it.
function completeQuest(session, itemId) {
  const tracker = session.profile("athena");
  const item = tracker.profile.items[itemId];
  const quest = athenaQuestOf(item);
  for (const objective of quest.objectives) {
    if (item.attributes[`completion_${objective.name}`] !== objective.count) tracker.setItemAttribute(itemId, `completion_${objective.name}`, objective.count);
  }
  tracker.setItemAttribute(itemId, "quest_state", "Completed");
  tracker.setItemAttribute(itemId, "last_state_change_time", new Date().toISOString());
  log("Battle Royale", `${session.accountId} completed ${questIdOf(item)}, waiting for Collect Rewards`);
  collectEarlierRewards(session, itemId, quest);
}

// 2.1 (CL-3825894): "Daily challenge rewards are automatically collected if another challenge is completed in the same
// category. For instance, if you complete a Battle Pass daily challenge but do not "collect" the reward, the reward will
// automatically be collected upon completing the next Battle Pass daily challenge." 2.1's panel is 1.11's: its
// DailyQuestsPanel lists the challenges by EFortQuestType in three categories (AthenaDailyQuest 0xB in DailyQuestList,
// AthenaEvent 0xC in EventQuestList, AthenaBattlePassQuest 0xD in BattlePassList) and claims only from its button, so the
// collecting was Epic's servers': a challenge completing in 2.1 or later collects the Completed ones of its category
// before it, which then show as Claimed. The one just completed waits for Collect Rewards as before.
const autoCollectBuild = 3825894;
const collectedCategories = ["AthenaDailyQuest", "AthenaEvent", "AthenaBattlePassQuest"];
function collectEarlierRewards(session, itemId, quest) {
  if (!(Number(currentBuild()) >= autoCollectBuild) || !collectedCategories.includes(quest.type)) return;
  const tracker = session.profile("athena");
  for (const [otherId, other] of Object.entries(tracker.profile.items)) {
    if (otherId === itemId || other.attributes.quest_state !== "Completed" || athenaQuestOf(other)?.type !== quest.type) continue;
    log("Battle Royale", `${session.accountId}: ${questIdOf(other)} collected on completing ${questIdOf(tracker.profile.items[itemId])} (2.1)`);
    claimAthenaQuest(session, otherId);
  }
}

// ClaimQuestReward on athena: a Completed challenge's rewards, its XP (AthenaSeasonalXP) to the season level and any
// quest it leads to. The Archive's Battle Bucks were never given. One already Claimed gives nothing more.
export function claimAthenaQuest(session, itemId) {
  const tracker = session.profile("athena");
  const item = tracker.profile.items[itemId];
  const quest = item && athenaQuestOf(item);
  if (!quest) throw new McpError("errors.com.epicgames.fortnite.item_not_found", `No challenge ${itemId}`);
  if (item.attributes.quest_state === "Claimed") return;
  if (item.attributes.quest_state !== "Completed") {
    throw new McpError("errors.com.epicgames.fortnite.quest_not_completed", `Challenge ${itemId} is ${item.attributes.quest_state}`);
  }
  tracker.setItemAttribute(itemId, "quest_state", "Claimed");
  tracker.setItemAttribute(itemId, "last_state_change_time", new Date().toISOString());
  log("Battle Royale", `${session.accountId} collected ${questIdOf(item)}`);
  for (const { templateId, quantity } of quest.rewards ?? []) {
    if (templateId.toLowerCase() === "accountresource:athenaseasonalxp") addSeasonXp(session, quantity);
    // Battle Stars (1.11's challenges give 5 or 10), to the Battle Pass (profiles/seasons.js).
    else if (templateId.toLowerCase() === "accountresource:athenaseasonalbp") addBookXp(session, quantity, seasonFunctions);
    else if (typeOf(templateId) === "quest") grantAthenaQuest(tracker, templateId.split(":")[1]);
  }
}

function addProgress(session, itemId, objective, count) {
  const tracker = session.profile("athena");
  const item = tracker.profile.items[itemId];
  const key = `completion_${objective.name}`;
  const value = Math.min((item.attributes[key] ?? 0) + count, objective.count);
  if (item.attributes[key] !== value) {
    tracker.setItemAttribute(itemId, key, value);
    // Logged so a challenge that never moves (Core-Backend #92's "Search Chests" at 0/5 after a match) shows whether
    // its progress reached the backend at all.
    log("Battle Royale", `${session.accountId}: ${questIdOf(item)} ${objective.name} ${value}/${objective.count}`);
  }
  const quest = athenaQuestOf(item);
  if (quest.objectives.every((other) => (item.attributes[`completion_${other.name}`] ?? 0) >= other.count)) completeQuest(session, itemId);
}

// Objectives Core counts from the match results the gameserver reports (battleroyale/recordresults): the placement
// ones (AthenaRank: "play matches", "top 25 in solo") and eliminations with any weapon. The gameserver's quest manager
// counts the rest (eliminations by weapon, chests and ammo boxes opened, players outlived) and sends them with
// UpdateQuests; those two kinds are left out of what it sends, so a match counts once (🟡).
// The playlists' tags (PvPTags rows Athena.Playlist.Solo, .Duo, .Squad and 1.10's .FiftyFifty, which 50v50's
// complete_athena_50v50 asks for), and from 1.11 the event queues', Athena.Playlist.Event.<N> for the playlist of queue
// AthenaEvent<N> (15 Event.1, 13 .2, 14 .3, 17 .4, 12 .5, 16 .6, 18 .7, 19 .8: events/ltms.js eventQueueOfPlaylist), which
// the LTMs' complete_athena_event_<N> ask for (Core-Backend #195).
// (Looked up when a match is recorded: events/ltms.js imports this module's importers, so it isn't there at load.)
const playlistTags = { 2: "athena.playlist.solo", 10: "athena.playlist.duo", 9: "athena.playlist.squad", 11: "athena.playlist.fiftyfifty" };
const playlistTagOf = (playlistId) => playlistTags[playlistId]
  ?? (eventQueueOfPlaylist[playlistId] ? `athena.playlist.event.${eventQueueOfPlaylist[playlistId]}` : "athena.playlist");
const tagMatches = (tags, tag) => !tags || tags.toLowerCase().split(",").map((one) => one.trim())
  .every((wanted) => tag === wanted || tag.startsWith(`${wanted}.`));

function countedFromResults(stat) {
  const row = stat && athenaObjectiveStat(stat);
  return row?.type === "AthenaRank" || (row?.type === "Kill" && row.sourceTags === "Homebase.Class");
}

// An AthenaRank row's condition: the match's place (Athena.Rank <=25) or, from 2.2's "Play matches with a friend"
// (AthenaDaily_Friend's complete_athena_friend, SquadFriend.Count > 0), how many of the player's friends were in their
// squad (squadFriends, battleroyale/recordresults).
const conditionValues = { "athena.rank": "place", "squadfriend.count": "squadFriends" };
function conditionMet(condition, values) {
  const match = /(Athena\.Rank|SquadFriend\.Count)\s*(<=|==|>=|<|>)\s*(\d+)/i.exec(condition ?? "");
  if (!match) return true;
  const value = values[conditionValues[match[1].toLowerCase()]] ?? 0;
  const target = Number(match[3]);
  return { "<=": value <= target, "==": value === target, ">=": value >= target, "<": value < target, ">": value > target }[match[2]];
}

export function recordMatchProgress(session, playlistId, { place, kills, squadFriends = 0 }) {
  const tag = playlistTagOf(playlistId);
  for (const { itemId, quest } of activeQuests(session.profile("athena"))) {
    for (const objective of quest.objectives) {
      const row = countedFromResults(objective.stat) && athenaObjectiveStat(objective.stat);
      if (!row || !tagMatches(row.contextTags, tag)) continue;
      const count = row.type === "AthenaRank" ? (conditionMet(row.condition, { place, squadFriends }) ? 1 : 0) : kills;
      if (count > 0 && session.profile("athena").profile.items[itemId]?.attributes.quest_state === "Active") addProgress(session, itemId, objective, count);
    }
  }
}

// UpdateQuests (and EndBattleRoyaleGame's Advance) from the gameserver: [{statName, count}], statName an objective's
// BackendName.
export function advanceAthenaObjectives(session, updates) {
  for (const { statName, count } of Array.isArray(updates) ? updates : []) {
    if (typeof statName !== "string" || !Number.isInteger(count) || count <= 0) continue;
    let held = false;
    for (const { itemId, quest } of activeQuests(session.profile("athena"))) {
      const objective = quest.objectives.find((candidate) => candidate.name === statName.toLowerCase());
      if (!objective) continue;
      held = true;
      if (countedFromResults(objective.stat)) continue;
      if (session.profile("athena").profile.items[itemId]?.attributes.quest_state === "Active") addProgress(session, itemId, objective, count);
    }
    // The server's quest manager only sends objectives of quests its copy of the profile has open, so one no open
    // challenge here has is a copy out of step with the backend's.
    if (!held) log("Battle Royale", `${session.accountId}: the gameserver advanced ${statName} by ${count}, which no open challenge has`);
  }
}

// Daily challenges, as Core gives STW's (profiles/dailies.js): 1.8's Athena_DailyQuestTrigger and its quest pack name
// none, Epic chose them on its servers. The pack's limits are the game's: UFortGameData::QuestPackInfos
// (Balance/DefaultGameData) has athenaDailyQuestInfo {DefaultQuestPack Athena_DailyQuestPack, MaxActiveDailyQuests 3,
// MaxRerollsPerDay 1}. On the first quest login of each UTC day, claimed dailies are cleared, one new daily (one the
// player doesn't hold, by the quests' weights) is added for every day since the last quest login while fewer than 3
// are held, so a player away for three days finds three waiting (Core-Backend #92: Seasons 1 and 2 gave one a day and
// kept them up to the cap), and the daily reroll is restored. A done daily stays: Completed, holding its slot, until it
// is collected (Core-Backend #114), then Claimed until that next day. The quest manager doesn't listen for a Completed or
// Claimed quest's objectives (EFortQuestState 2 and 3 skipped in SendStatEventWithTags, 0x890AB7), so it can't be done
// twice.
const maxOpen = 3;
const rerollsPerDay = 1;
const utcDay = (time) => Math.floor(time / 86_400_000);
const heldDailies = (tracker) => Object.entries(tracker.profile.items)
  .filter(([, item]) => athenaQuestOf(item)?.type === "AthenaDailyQuest");

function newDaily(tracker, held = heldDailies(tracker), ids = athenaDailyIds()) {
  const heldIds = new Set(held.map(([, item]) => questIdOf(item)));
  const choices = ids.filter((id) => !heldIds.has(id) && dailyWeight(id) > 0);
  const total = choices.reduce((sum, id) => sum + dailyWeight(id), 0);
  let roll = (crypto.randomInt(1_000_000) / 1_000_000) * total;
  const chosen = choices.find((id) => (roll -= dailyWeight(id)) < 0) ?? choices[choices.length - 1];
  return chosen ? grantAthenaQuest(tracker, chosen) : null;
}

export function refreshAthenaDailies(session, now = new Date()) {
  const tracker = session.profile("athena");
  const manager = tracker.profile.stats.attributes.quest_manager ?? {};
  const last = Date.parse(manager.dailyLoginInterval ?? "");
  const days = Number.isNaN(last) ? 1 : utcDay(now.getTime()) - utcDay(last);
  if (days <= 0) return;
  for (const [itemId, item] of heldDailies(tracker)) {
    if (item.attributes.quest_state === "Claimed") tracker.removeItem(itemId);
  }
  for (let day = 0; day < days && heldDailies(tracker).length < maxOpen; day++) {
    if (!newDaily(tracker)) break;
  }
  tracker.setStat("quest_manager", { ...manager, dailyLoginInterval: now.toISOString(), dailyQuestRerolls: rerollsPerDay });
}

// FortRerollDailyQuest {questId} on athena: an open daily for another, once a day. A Battle Pass daily is rerolled from
// its own pack, once a day too.
export function rerollAthenaDaily(session, itemId, notifications) {
  const tracker = session.profile("athena");
  const item = typeof itemId === "string" && tracker.profile.items[itemId];
  const type = item && athenaQuestOf(item)?.type;
  if (type === "AthenaBattlePassQuest" && item.attributes.quest_state === "Active") return rerollBattlePassDaily(session, itemId, notifications);
  if (!item || type !== "AthenaDailyQuest" || item.attributes.quest_state !== "Active") {
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

// The Battle Pass's daily challenge (Season 2, 1.11 and 2.1; Core-Backend #156): "Extra Battle Pass Daily Challenge", one
// of the pass's tier 1 rewards. Tier 1's Battle Pass rewards give Quest:athena_battlepass_questtrigger
// (profiles/seasons.js), whose reward is the hidden Athena_BattlePass_QuestPack, which is
// UFortGameData::QuestPackInfos' athenaBattlePassQuestInfo {DefaultQuestPack Athena_BattlePass_QuestPack,
// MaxActiveDailyQuests 1, MaxRerollsPerDay 1, DaysToKeepCompletedQuests 2, MaxUnclaimedQuests 1}: one challenge of
// EFortQuestType::AthenaBattlePassQuest (0xD) a day, chosen by the quests' weights from Athena/Items/Quests/BattlePass
// (category BR_BattlePass, "Play Matches" 0/7, 500 XP and 5 Battle Stars each). 1.11's DailyQuestsPanel lists those in
// BattlePassList, apart from the daily challenges, under the yellow "BATTLE PASS" header with the tier, as the issue's
// screenshot shows. As with the other dailies, on the first quest login of each UTC day a collected (Claimed) one goes and
// a new one comes while none is held; a done one keeps its slot until it is collected. The day and the reroll are kept
// in profile.coreBattlePassDaily (Core's, never sent): the athena profile's quest_manager has one reroll count, the daily
// challenges'. A build without the quests (1.8 to 1.10) or a player without the trigger gets none.
const battlePassTrigger = "athena_battlepass_questtrigger";
const heldBattlePassDailies = (tracker) => Object.entries(tracker.profile.items)
  .filter(([, item]) => athenaQuestOf(item)?.type === "AthenaBattlePassQuest");
const ownsBattlePassChallenges = (tracker) => Boolean(getAthenaQuest(battlePassTrigger))
  && Object.values(tracker.profile.items).some((item) => questIdOf(item) === battlePassTrigger);

export function settleBattlePassDaily(session, now = new Date()) {
  const tracker = session.profile("athena");
  if (!ownsBattlePassChallenges(tracker) || !athenaBattlePassDailyIds().length) return;
  const today = utcDay(now.getTime());
  const state = tracker.profile.coreBattlePassDaily ?? {};
  if (state.day === today) return;
  for (const [itemId, item] of heldBattlePassDailies(tracker)) {
    if (item.attributes.quest_state === "Claimed") tracker.removeItem(itemId);
  }
  if (!heldBattlePassDailies(tracker).length) {
    const itemId = newDaily(tracker, heldBattlePassDailies(tracker), athenaBattlePassDailyIds());
    if (itemId) log("Battle Royale", `${session.accountId} got the Battle Pass daily challenge ${questIdOf(tracker.profile.items[itemId])}`);
  }
  tracker.profile.coreBattlePassDaily = { day: today, rerolls: rerollsPerDay };
}

function rerollBattlePassDaily(session, itemId, notifications) {
  const tracker = session.profile("athena");
  const state = tracker.profile.coreBattlePassDaily ?? {};
  if (!(state.rerolls > 0)) throw new McpError("errors.com.epicgames.fortnite.no_rerolls_remaining", "No Battle Pass challenge rerolls left today");
  const newQuestId = newDaily(tracker, heldBattlePassDailies(tracker), athenaBattlePassDailyIds());
  if (!newQuestId) throw new McpError("errors.com.epicgames.fortnite.item_not_found", "No other Battle Pass challenge to give");
  tracker.removeItem(itemId);
  tracker.profile.coreBattlePassDaily = { ...state, rerolls: state.rerolls - 1 };
  notifications.push({ type: "dailyQuestReroll", primary: true, newQuestId });
}

// The Battle Royale event quests (events/fiftyfifty.js) of the events the build runs, which the player gets once, and
// those of the events it doesn't, which leave the quest log unless done (Completed or Claimed), as Save the World's do
// (events/quests.js, Core-Backend #127).
function settleAthenaEventQuests(session) {
  const tracker = session.profile("athena");
  const held = (questId) => Object.entries(tracker.profile.items).filter(([, item]) => questIdOf(item) === questId);
  for (const questId of athenaEventQuestsOf({ running: false })) {
    for (const [itemId, item] of held(questId)) {
      if (item.attributes.quest_state === "Active") tracker.removeItem(itemId);
    }
  }
  for (const questId of athenaEventQuestsOf({ running: true })) {
    if (!held(questId).length && grantAthenaQuest(tracker, questId)) log("Battle Royale", `${session.accountId} got the event challenge ${questId}`);
  }
}

// ClientQuestLogin / ServerQuestLogin on athena.
export function athenaQuestLogin(session) {
  refreshAthenaDailies(session);
  settleBattlePassDaily(session);
  settleAthenaEventQuests(session);
  settleChaseRewards(session);
}

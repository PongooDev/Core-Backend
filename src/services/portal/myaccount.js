import { inBuild } from "../../builds/context.js";
import { buildVersions, versionOf } from "../../builds/detect.js";
import { athenaChallengeBundles, athenaCosmetics, athenaSeason, getAthenaQuest, seasonLevels } from "../../gamedata/athena.js";
import { getQuest, questName } from "../../gamedata/quests.js";
import { maxSeasonLevel } from "../../profiles/athena.js";
import { fullProfile } from "../../profiles/changes.js";
import { usesCommonProfiles, viewProfile } from "../../profiles/common.js";
import { ownsSaveTheWorld } from "../../profiles/founders.js";
import { findItem, isMtxCurrency, mtxPlatform } from "../../profiles/items.js";
import { questIdOf } from "../../profiles/quests.js";
import { inProfileSeason, lastTier, profileSeason } from "../../profiles/seasons.js";
import { openSession } from "../../profiles/session.js";
import { maxLevel, xpForLevel } from "../../profiles/xp.js";
import { hasItemShop, itemShopOffers, nextRotation } from "../../store/itemshop.js";

// What the portal's My account page shows a signed-in player of their own account (Core-Backend #249), read-only and
// from the profiles the game itself reads, as the build the account last played sees them (account.lastBuild, noted at
// login; the newest build Core knows for an account that has not played yet). The id, name and the numbers below are
// all it holds: no token, password or email.

const newestBuild = Object.keys(buildVersions).reduce((newest, build) => (Number(build) > Number(newest) ? build : newest));

// The V-Bucks the client counts of a profile's items. Before 3.5 that is the Currency:Mtx* items whose platform is
// exactly "Epic" (profiles/items.js); 3.5 counts by wallet, and common_core's view tags them all Shared, which it counts
// whatever the account's wallet (profiles/common.js).
function mtxCounts(items, commonProfiles) {
  const counted = Object.values(items).filter((item) => isMtxCurrency(item.templateId)
    && item.attributes?.platform === (commonProfiles ? "Shared" : mtxPlatform));
  const by = (templateId) => counted.filter((item) => item.templateId.toLowerCase() === templateId).reduce((sum, item) => sum + item.quantity, 0);
  return {
    total: counted.reduce((sum, item) => sum + item.quantity, 0),
    purchased: by("currency:mtxpurchased"),
    bonus: by("currency:mtxpurchasebonus"),
    giveaway: by("currency:mtxgiveaway"),
    complimentary: by("currency:mtxcomplimentary")
  };
}

// A readable name for a challenge: Battle Royale's quest assets carry no display text in Core's game data, so it is the
// asset name ("quest_br_damage_pistol" -> "Damage Pistol").
const titleCase = (text) => text.split("_").filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
const athenaQuestTitle = (questId) => titleCase(questId.replace(/^(quest_br_|athenadaily_|quest_)/, ""));

function bundleTitle(bundleId) {
  const week = /week(\d+)/.exec(bundleId);
  if (week) return `Week ${week[1]}`;
  const tier = /tier_(\d+)/.exec(bundleId);
  return tier ? `Tier ${tier[1]}` : titleCase(bundleId.replace(/_?questbundle$/, ""));
}

const isDone = (item) => ["Completed", "Claimed"].includes(item.attributes.quest_state);

// A quest item with the progress of each objective against its target.
function progressOf(item, objectives) {
  const rows = objectives.map(({ name, count }) => ({ progress: Math.min(item.attributes[`completion_${name}`] ?? 0, count), target: count }));
  return {
    state: item.attributes.quest_state,
    done: isDone(item),
    progress: rows.reduce((sum, row) => sum + row.progress, 0),
    target: rows.reduce((sum, row) => sum + row.target, 0)
  };
}

const rewardTotal = (quest, templateId) => (quest?.rewards ?? [])
  .filter((reward) => reward.templateId.toLowerCase() === templateId).reduce((sum, reward) => sum + reward.quantity, 0);
const rewardsOf = (quest) => ({ xp: rewardTotal(quest, "accountresource:athenaseasonalxp"), stars: rewardTotal(quest, "accountresource:athenaseasonalbp") });

// The athena profile's challenges: the daily ones, the pass's weekly bundles with their quests, and any other.
function athenaChallenges(athena) {
  const quests = Object.entries(athena.items).filter(([, item]) => questIdOf(item));
  const entry = ([, item]) => {
    const questId = questIdOf(item);
    const quest = getAthenaQuest(questId);
    return { id: questId, name: athenaQuestTitle(questId), type: quest?.type ?? null, ...progressOf(item, quest?.objectives ?? []), rewards: rewardsOf(quest) };
  };
  const bundled = new Set();
  const weekly = Object.values(athena.items).filter((item) => item.templateId.toLowerCase().startsWith("challengebundle:")).map((item) => {
    const bundleId = item.templateId.split(":")[1].toLowerCase();
    const members = (item.attributes.grantedquestinstanceids ?? []).filter((id) => athena.items[id] && questIdOf(athena.items[id]));
    for (const id of members) bundled.add(id);
    return {
      id: bundleId, name: bundleTitle(bundleId), completed: item.attributes.num_quests_completed ?? 0,
      threshold: athenaChallengeBundles()[bundleId]?.completionThreshold ?? null,
      challenges: members.map((id) => entry([id, athena.items[id]]))
    };
  }).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const loose = quests.filter(([itemId]) => !bundled.has(itemId)).map(entry);
  const order = (a, b) => Number(a.done) - Number(b.done) || a.name.localeCompare(b.name);
  const isDaily = (quest) => quest.type === "AthenaDailyQuest" || quest.type === "AthenaBattlePassQuest";
  return {
    daily: loose.filter(isDaily).sort(order),
    weekly,
    other: loose.filter((quest) => !isDaily(quest)).sort(order),
    completed: quests.filter(([, item]) => isDone(item)).length
  };
}

// Battle Royale's season level and Battle Pass (profiles/seasons.js), in the profile's own season's tables.
function battleRoyaleOf(athena) {
  const attributes = athena.stats.attributes;
  const season = profileSeason(athena);
  return inProfileSeason(athena, () => {
    const level = attributes.level ?? 1;
    const max = maxSeasonLevel();
    return {
      season,
      level,
      maxLevel: max,
      xp: attributes.xp ?? 0,
      xpToNextLevel: level < max ? seasonLevels().find((entry) => entry.level === level)?.xpToNextLevel ?? null : null,
      battlePass: season > 1 ? {
        purchased: attributes.book_purchased === true, tier: attributes.book_level ?? 1, maxTier: lastTier() || null, stars: attributes.book_xp ?? 0
      } : null
    };
  });
}

// The athena cosmetics held, by kind, against all the build has.
const lockerKinds = [["AthenaCharacter", "Outfits"], ["AthenaBackpack", "Back Blings"], ["AthenaPickaxe", "Pickaxes"], ["AthenaGlider", "Gliders"],
  ["AthenaDance", "Emotes"], ["AthenaSkyDiveContrail", "Contrails"], ["AthenaItemWrap", "Wraps"], ["AthenaLoadingScreen", "Loading Screens"],
  ["AthenaMusicPack", "Music"]];
const kindOf = (templateId) => String(templateId).split(":")[0].toLowerCase();
const isReal = (templateId) => !String(templateId).toLowerCase().includes("_random");

function lockerOf(athena, wallet) {
  const all = Object.keys(athenaCosmetics()).filter(isReal);
  const held = athena ? Object.values(athena.items).map((item) => item.templateId).filter(isReal) : [];
  return {
    cosmetics: lockerKinds.map(([kind, label]) => ({
      label,
      owned: new Set(held.filter((templateId) => kindOf(templateId) === kind.toLowerCase()).map((id) => id.toLowerCase())).size,
      total: all.filter((templateId) => kindOf(templateId) === kind.toLowerCase()).length
    })).filter((row) => row.total > 0 || row.owned > 0),
    banners: Object.values(wallet?.items ?? {}).filter((item) => kindOf(item.templateId) === "homebasebannericon").length
  };
}

// The item shop of the day for the build, marking what the account already owns.
function shopOf(athena, now) {
  if (!hasItemShop()) return null;
  const offers = itemShopOffers(now);
  // Regional editions of an outfit ("Alpine Ace (USA)") sell in their own country only: the page lists the outfit once.
  const regional = (offer, entries) => /^(.+) \([A-Z]{3}\)$/.test(offer.title) && entries.some(({ title }) => title === offer.title.replace(/ \([A-Z]{3}\)$/, ""));
  const list = (entries) => entries.filter((offer) => !regional(offer, entries)).map((offer) => ({
    title: offer.title, price: offer.price, owned: Boolean(athena && offer.templateId && findItem(athena, offer.templateId))
  }));
  const featured = list(offers.BRWeeklyStorefront ?? []);
  const daily = list(offers.BRDailyStorefront ?? []);
  return featured.length || daily.length ? { featured, daily, refreshes: nextRotation(now).toISOString() } : null;
}

// Save the World's commander level, its quests in progress and what the account holds (profile0, campaign on 3.5+).
function saveTheWorldOf(campaign) {
  if (!campaign || !ownsSaveTheWorld(campaign)) return null;
  const level = campaign.stats.attributes.level ?? 1;
  const items = Object.values(campaign.items);
  const count = (type) => items.filter((item) => kindOf(item.templateId) === type).length;
  const quests = items.filter((item) => questIdOf(item)).map((item) => {
    const questId = questIdOf(item);
    const quest = getQuest(questId);
    return { id: questId, name: questName(questId) ?? titleCase(questId), type: quest?.type ?? null, hidden: quest?.hidden === true, ...progressOf(item, quest?.objectives ?? []) };
  }).filter((quest) => quest.type !== "Onboarding" && !quest.hidden);
  return {
    level, maxLevel: maxLevel(), xp: campaign.stats.attributes.xp ?? 0, xpForLevel: level < maxLevel() ? xpForLevel(level) : null,
    quests: quests.filter((quest) => quest.state !== "Claimed").sort((a, b) => Number(a.done) - Number(b.done) || a.name.localeCompare(b.name)).slice(0, 40)
      .map(({ id, name, state, done, progress, target }) => ({ id, name, state, done, progress, target })),
    questsClaimed: quests.filter((quest) => quest.state === "Claimed").length,
    items: { heroes: count("hero"), survivors: count("worker"), schematics: count("schematic"), defenders: count("defender") }
  };
}

const playlistNames = { 2: "Solo", 10: "Duos", 9: "Squads" };

function matchesOf(playlists) {
  const rows = Object.entries(playlists).map(([playlistId, counts]) => ({
    name: playlistNames[playlistId] ?? `Playlist ${playlistId}`,
    matches: counts.matchesplayed ?? 0,
    wins: counts.placetop1 ?? 0,
    kills: counts.kills ?? 0,
    minutes: Math.floor((counts.secondsplayed ?? 0) / 60),
    score: counts.score ?? 0
  })).filter((row) => row.matches > 0 || row.wins > 0).sort((a, b) => b.matches - a.matches);
  const total = (stat) => rows.reduce((sum, row) => sum + row[stat], 0);
  return rows.length ? { playlists: rows, totals: { matches: total("matches"), wins: total("wins"), kills: total("kills"), minutes: total("minutes"), score: total("score") } } : null;
}

// context: {profiles, stats}; account: the signed-in player's own.
export function accountSummary({ profiles, stats }, account, now = new Date()) {
  const known = versionOf(account.lastBuild) ? account.lastBuild : null;
  const build = known ?? newestBuild;
  return inBuild(build, () => {
    const session = openSession(profiles, account.id, { setUp: false });
    const profile0 = session.hasProfile("profile0") ? fullProfile(session.profile("profile0").profile) : null;
    // 3.5 on: common_core's V-Bucks and campaign's Save the World (profiles/common.js); profile0 holds both before.
    const common = usesCommonProfiles(account.id);
    const wallet = profile0 && (common ? viewProfile(profile0, "common_core") : profile0);
    const campaign = profile0 && (common ? viewProfile(profile0, "campaign") : profile0);
    const athena = session.hasProfile("athena") && athenaSeason() ? session.profile("athena").profile : null;
    return {
      displayName: account.displayName,
      build: { changelist: build, version: versionOf(build), lastPlayed: known !== null },
      vbucks: mtxCounts(wallet?.items ?? {}, common),
      battleRoyale: athena ? battleRoyaleOf(athena) : null,
      saveTheWorld: saveTheWorldOf(campaign),
      challenges: athena ? athenaChallenges(athena) : null,
      shop: shopOf(athena, now),
      locker: lockerOf(athena, wallet),
      matches: matchesOf(stats?.playlists(account.id) ?? {})
    };
  });
}

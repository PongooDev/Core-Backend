import { currentBuild, inBuild } from "../builds/context.js";
import { certBuild } from "../builds/detect.js";
import { athenaBattlePassDailyIds, athenaChallengeBundles, athenaChallengeSchedules, athenaSeason, getAthenaQuest, seasonLevels } from "../gamedata/athena.js";
import { bannerTemplateId } from "../gamedata/banners.js";
import { buildGameData, dataBuilds } from "../gamedata/read.js";
import { log } from "../log.js";
import { findItem } from "./items.js";
import { battlePassGiftBox, giveGiftBox } from "./giftboxes.js";
import { grant } from "./progress.js";

// Battle Royale's seasons (Core-Backend #145). 1.8 to 1.10 are Season 1; 1.11 (CL-3807424) is Season 2, which starts every
// player again at level 1 with a Battle Pass, as Epic's did when Season 1 ended on 13 December 2017. 2.1 (CL-3825894, 10
// January 2018) is still Season 2: its AthenaSeason2 is 1.11's, so the two share one Season 2 level and Battle Pass, and
// so does 2.2 (CL-3841827, 18 January 2018), whose AthenaSeason2 only adds the Season 3 head start to tier 2, and 2.3
// (CL-3847564, 25 January 2018), 2.4 (CL-3858292, 31 January 2018), 2.4.2 (CL-3870737, 8 February 2018) and 2.5
// (CL-3889387, 13 February 2018), whose AthenaSeason2 is 2.2's (2.5's AthenaSeason3, a copy of it ahead of Season 3,
// isn't its season: tools/extractor). 3.0 (CL-3901517, 21 February 2018) is Season 3, AthenaSeason3 with its own XP
// table (Athena_Season3_XP) and Battle Pass (100 tiers, Athena_Season3_BP), so it puts Season 2 aside as 1.11 put Season
// 1; its pass's challenges are weekly bundles (profiles/challenges.js).
//
// 1.11's athena profile stats (the client's UFortMcpProfileAthena reads them by name: season_num, level, xp,
// accountLevel, book_level, book_xp, book_purchased, season_match_boost, season_friend_match_boost, lifetime_wins):
// - season_num, the season the stats are for. The calendar's client-events state names the season too
//   (FFortClientEventsState SeasonNumber and SeasonTemplateId, services/fortnite/calendar.js);
// - level and xp, the season level and the XP into it, against the season's own XP table (AthenaSeason2's SeasonXpCurve,
//   Athena_Season2_XP) up to its NumSeasonLevels, 100;
// - book_level and book_xp, the Battle Pass tier (from 1) and the Battle Stars into it (BookXpCurve, Athena_Season2_BP:
//   10 a tier) up to NumBookLevels, 70; book_purchased, whether the player bought the Battle Pass
//   (UFortMcpProfileAthena::HasPurchasedSeasonBook, USeasonPassScreenBase::OwnsSeasonPass);
// - season_match_boost and season_friend_match_boost, the percent XP boosts the Battle Pass gives (its
//   AthenaSeasonXpBoost and AthenaSeasonFriendXpBoost tokens, shown as "{Percent}% {BonusName}");
// - past_seasons, Epic's record of the seasons before: [{seasonNumber, numWins, numHighBracket, numLowBracket, seasonXp,
//   seasonLevel, bookXp, bookLevel, purchasedVIP}].
//
// Accounts are shared by every build, so a profile holds the season of the build that last opened it: a build of another
// season puts the season's stats aside (profile.coreSeasons, Core's, never sent) and takes up its own, so Season 1's
// level is still there for 1.8 to 1.10, and Season 2's for 1.11. A match's XP goes to the season of the match's build
// (takeUpSeason), whichever lobby opened the profile last.
//
// Season 1's profile has no season_num, past_seasons or Battle Pass stats, as before Season 2 (Core-Backend #152). 1.10
// already reads season_num, and its season getters (sub_441460: the stat, 0 when missing, against the client-events
// state's SeasonNumber) give level 1 and no XP when the two differ. 1.10's calendar names no season (SeasonNumber 0), so
// a season_num of 1 hid Season 1's level: "Season 1, LEVEL 1, 0 / 100".

const firstSeason = 1;
export const seasonNumber = () => athenaSeason()?.seasonNumber ?? firstSeason;
export const seasonTemplateId = () => `AthenaSeason:athenaseason${seasonNumber()}`;

// The stats each season keeps of its own.
const seasonStats = (season) => (season > firstSeason
  ? ["level", "xp", "book_level", "book_xp", "book_purchased", "season_match_boost", "season_friend_match_boost"]
  : ["level", "xp"]);
const freshStats = (season) => (season > firstSeason
  ? { level: 1, xp: 0, book_level: 1, book_xp: 0, book_purchased: false, season_match_boost: 0, season_friend_match_boost: 0 }
  : { level: 1, xp: 0 });
// What a Season 1 profile doesn't hold: the stats only later seasons have (their values wait in profile.coreSeasons).
const laterSeasonStats = ["season_num", "past_seasons",
  ...seasonStats(firstSeason + 1).filter((name) => !seasonStats(firstSeason).includes(name))];
const strayStats = (profile) => (profileSeason(profile) === firstSeason
  ? laterSeasonStats.filter((name) => Object.hasOwn(profile.stats.attributes, name)) : []);

export const profileSeason = (profile) => profile.stats.attributes.season_num ?? firstSeason;
// Only a Battle Royale client or gameserver's request (one naming a build with an athena profile, 1.8 on) switches the
// season: the admin panel's and CoreV2's match reports name none, and read the profile in its own season
// (inProfileSeason).
const firstAthenaBuild = 3724489;
export const namesAthenaBuild = () => Number(currentBuild()) >= firstAthenaBuild;
export const seasonNeedsSwitch = (profile) => (namesAthenaBuild() && profileSeason(profile) !== seasonNumber())
  || strayStats(profile).length > 0 || seasonItemsOutOfPlace(profile);

// The newest data build of a season, for work on a profile outside a request of its build: Season 1's is Cert's (whose
// athena data is 1.8's, what such work always read).
export function buildOfSeason(season) {
  if (season === firstSeason) return certBuild;
  const builds = dataBuilds.filter((build) => (buildGameData(build, "athena", {}).season?.seasonNumber ?? firstSeason) === season);
  return builds.length ? builds.reduce((newest, build) => (Number(build) > Number(newest) ? build : newest)) : certBuild;
}

// fn run with the game data of the profile's season, when the request names no build of its own.
export const inProfileSeason = (profile, fn) => (namesAthenaBuild() ? fn() : inBuild(buildOfSeason(profileSeason(profile)), fn));

// A season's XP table (Season 1's AthenaGameData SeasonXpLevelsTable, the committed gamedata/athena.json being 1.8's; a
// later season's SeasonXpCurve), for the total XP of the season's record.
function totalXp(season, { level = 1, xp = 0 }) {
  const levels = inBuild(buildOfSeason(season), seasonLevels) ?? [];
  return (levels.find((entry) => entry.level === level)?.xpTotal ?? 0) + xp;
}

// Epic's past_seasons entry for a season set aside. Wins (numWins) are the account's recorded wins in solo, duo and squad
// when Season 1 is first set aside: Core's stats keep no seasons (🟡); the brackets were never counted.
function pastSeason(season, stats, wins) {
  return {
    seasonNumber: season,
    numWins: wins,
    numHighBracket: 0,
    numLowBracket: 0,
    seasonXp: stats.seasonXp ?? 0,
    seasonLevel: stats.level ?? 1,
    bookXp: stats.book_xp ?? 0,
    bookLevel: stats.book_level ?? 1,
    purchasedVIP: stats.book_purchased === true
  };
}

// The levels of the seasons before the profile's: accountLevel is the level over every season, as Epic's was (its
// "accountLevel" counted every season's levels), so in Season 1 it is the level.
export const accountLevelOf = (profile, level) => level
  + (profile.stats.attributes.past_seasons ?? []).reduce((sum, past) => sum + (past.seasonLevel ?? 0), 0);

// Puts the profile's season aside and takes up the requesting build's.
export function switchSeason(session) {
  const tracker = session.profile("athena");
  const { profile } = tracker;
  const { attributes } = profile.stats;
  const from = profileSeason(profile);
  const to = namesAthenaBuild() ? seasonNumber() : from;
  if (from === to) {
    settleStrayStats(session);
    settleSeasonItems(session);
    return;
  }
  const kept = profile.coreSeasons ?? {};
  const previous = kept[from] ?? {};
  const aside = Object.fromEntries(seasonStats(from).map((name) => [name, attributes[name] ?? freshStats(from)[name]]));
  aside.seasonXp = totalXp(from, aside);
  aside.numWins = previous.numWins ?? (session.settings.winCount?.(session.accountId) ?? 0);
  kept[from] = aside;
  profile.coreSeasons = kept;

  const taken = { ...freshStats(to), ...(kept[to] ?? {}) };
  for (const name of seasonStats(to)) {
    if (attributes[name] !== taken[name]) tracker.setStat(name, taken[name]);
  }
  if (to > firstSeason) {
    tracker.setStat("season_num", to);
    // The seasons before this one that were played (a record with any progress).
    const past = Object.entries(kept).map(([season, stats]) => [Number(season), stats])
      .filter(([season, stats]) => season < to && ((stats.level ?? 1) > 1 || (stats.xp ?? 0) > 0 || stats.book_purchased
        || (stats.book_level ?? 1) > 1))
      .sort(([a], [b]) => a - b)
      .map(([season, stats]) => pastSeason(season, stats, stats.numWins ?? 0));
    if (past.length || attributes.past_seasons) tracker.setStat("past_seasons", past);
  } else {
    for (const name of laterSeasonStats) if (Object.hasOwn(attributes, name)) tracker.removeStat(name);
  }
  const accountLevel = accountLevelOf(profile, taken.level);
  if (attributes.accountLevel !== accountLevel) tracker.setStat("accountLevel", accountLevel);
  log("Battle Royale", `${session.accountId} moved from Season ${from} to Season ${to}: season level ${taken.level}`
    + (to > firstSeason ? `, Battle Pass tier ${taken.book_level}${taken.book_purchased ? " (bought)" : ""}` : ""));
  settleSeasonItems(session);
}

// A new season's first login retires the last season's challenges, as Epic's did: once Season 4 began (4.0, CL-4039451)
// the athena profile held Season 4's challenge bundle schedules, bundles and their quests, and no longer Season 3's (the
// weeklies, the tier challenges); once Season 3 began, Season 2's Battle Pass challenges (the pass's
// Quest:athena_battlepass_questtrigger and the Battle Pass dailies it brought) went. What stays is the account's: the
// locker, the level and XP (the season's stats are put aside as before), the daily challenges
// (EFortQuestType::AthenaDailyQuest) and the event challenges, which no season's pass gives, tokens, and what the
// challenges already gave (their XP, Battle Stars and cosmetics).
//
// A season's challenges are what its data gives (buildOfSeason): the ChallengeBundleSchedules its tier rewards name
// (AthenaSeason3's Season3_Challenge_Schedule, _Tier_2_ and _Tier_100_; AthenaSeason4's Season4_Challenge_Schedule,
// _StarterChallenge_ and _ProgressiveB_; AthenaSeason5's Season5_Paid_Schedule, _ProgressiveA_ and _ProgressiveB_, and
// Season5_Free_Schedule, which it gives everyone), the bundles those schedules hold, and the quests that come without a bundle
// from its tier rewards and its bundles' rewards (Season 2's trigger and its pack and dailies, Season 4's hidden
// Quest_BR_S4_Cumulative_Quest<n>). A schedule is its season's by its id, a bundle by its schedule
// (challenge_bundle_schedule_id) or else its id, a bundle's quest by its bundle (challenge_bundle_id): Seasons 3 and 4
// share many bundle quests (Quest_BR_Eliminate...), so a quest's id doesn't tell. A quest without a bundle whose id more
// than one season gives stays where it is.
//
// Accounts are shared by every build, so retired items aren't deleted as Epic's were: they wait in
// profile.coreSeasonItems (Core's, never sent: {<season>: {<item id>: item}}) and come back as they were, progress and
// all, the next time a build of their season takes the profile up. Playing 3.6 after 4.0 shows Season 3's challenges
// again and puts Season 4's aside, and 4.0 swaps them back. A player who stays on one season keeps everything.
const typeOfTemplate = (templateId) => String(templateId).split(":")[0].toLowerCase();
const idOfTemplate = (templateId) => String(templateId).split(":")[1]?.toLowerCase();

// The seasons after Season 1 that some build's data has.
let knownLaterSeasons;
const laterSeasons = () => (knownLaterSeasons ??= [...new Set(dataBuilds.map((build) => buildGameData(build, "athena", {}).season?.seasonNumber)
  .filter((season) => season > firstSeason))].sort((a, b) => a - b));

// A season's challenges by its data: {schedules, bundles, quests (those that come without a bundle)}, lower-cased ids.
const seasonChallengeCache = new Map();
function seasonChallenges(season) {
  if (!seasonChallengeCache.has(season)) {
    seasonChallengeCache.set(season, inBuild(buildOfSeason(season), () => {
      const pass = athenaSeason();
      const found = { schedules: new Set(), bundles: new Set(), quests: new Set() };
      if (pass?.seasonNumber !== season) return found;
      // From 5.0 (Season 5) also what the season gives everyone (SeasonGrantsToEveryone: Season5_Free_Schedule, the free
      // weekly challenges) and what it takes back at its end (TokensToRemoveAtSeasonEnd: its free and paid schedules).
      const rewards = [...(pass.seasonRewards ?? []), ...(pass.bookFreeRewards ?? []), ...(pass.bookPaidRewards ?? []), { rewards: pass.grantsToEveryone }]
        .flatMap((entry) => entry.rewards ?? []).map(({ templateId }) => templateId).concat(pass.removedAtSeasonEnd ?? []);
      const schedules = athenaChallengeSchedules() ?? {};
      const bundles = athenaChallengeBundles() ?? {};
      const follow = (templateIds) => {
        for (const id of templateIds.filter((templateId) => typeOfTemplate(templateId) === "quest").map(idOfTemplate)) {
          if (found.quests.has(id) || !getAthenaQuest(id)) continue;
          found.quests.add(id);
          follow((getAthenaQuest(id).rewards ?? []).map(({ templateId }) => templateId));
        }
      };
      follow(rewards);
      // The Battle Pass dailies Season 2's trigger brings (athenaBattlePassQuestInfo's pack).
      if (found.quests.size) for (const id of athenaBattlePassDailyIds()) found.quests.add(id.toLowerCase());
      for (const id of rewards.filter((templateId) => typeOfTemplate(templateId) === "challengebundleschedule").map(idOfTemplate)) {
        if (!schedules[id]) continue;
        found.schedules.add(id);
        for (const { bundle } of schedules[id].bundles) found.bundles.add(bundle.toLowerCase());
      }
      for (const bundle of found.bundles) {
        for (const { quest } of bundles[bundle]?.quests ?? []) follow((getAthenaQuest(quest)?.rewards ?? []).map(({ templateId }) => templateId));
        follow((bundles[bundle]?.completionRewards ?? []).map(({ templateId }) => templateId));
      }
      return found;
    }));
  }
  return seasonChallengeCache.get(season);
}

// The season an athena item's challenge belongs to, or null for one no season's pass gives (or more than one's).
function itemSeason(profile, item, seen = new Set()) {
  const type = typeOfTemplate(item?.templateId);
  if (!item || !["challengebundleschedule", "challengebundle", "quest"].includes(type)) return null;
  const linked = type === "challengebundle" ? item.attributes?.challenge_bundle_schedule_id
    : type === "quest" ? item.attributes?.challenge_bundle_id : null;
  if (linked && profile.items[linked] && !seen.has(linked)) return itemSeason(profile, profile.items[linked], seen.add(linked));
  const id = idOfTemplate(item.templateId);
  const kind = { challengebundleschedule: "schedules", challengebundle: "bundles", quest: "quests" }[type];
  const seasons = laterSeasons().filter((season) => seasonChallenges(season)[kind].has(id));
  return seasons.length === 1 ? seasons[0] : null;
}

// The profile's items of other seasons' challenges, as [itemId, season].
const otherSeasonItems = (profile) => Object.entries(profile.items)
  .map(([id, item]) => [id, itemSeason(profile, item)])
  .filter(([, season]) => season !== null && season !== profileSeason(profile));
const waitingItems = (profile) => profile.coreSeasonItems?.[profileSeason(profile)] ?? {};
const seasonItemsOutOfPlace = (profile) => Object.keys(waitingItems(profile)).length > 0 || otherSeasonItems(profile).length > 0;

// The other seasons' challenges go aside, and the profile's season's that were aside come back.
function settleSeasonItems(session) {
  const tracker = session.profile("athena");
  const { profile } = tracker;
  const season = profileSeason(profile);
  const retired = {};
  for (const [id, of] of otherSeasonItems(profile)) {
    profile.coreSeasonItems ??= {};
    (profile.coreSeasonItems[of] ??= {})[id] = profile.items[id];
    retired[of] = (retired[of] ?? 0) + 1;
    tracker.removeItem(id);
  }
  for (const [of, count] of Object.entries(retired)) {
    log("Battle Royale", `${session.accountId}: Season ${of}'s ${count} challenge items are put aside in Season ${season}`);
  }
  const waiting = waitingItems(profile);
  const back = Object.entries(waiting).filter(([id]) => !profile.items[id]);
  for (const [id, item] of back) tracker.addItem(id, item);
  if (profile.coreSeasonItems?.[season]) delete profile.coreSeasonItems[season];
  if (back.length) log("Battle Royale", `${session.accountId}: Season ${season}'s ${back.length} challenge items are back`);
}

// A Season 1 profile's stats of later seasons go: those of one switched back before #152 (season_num 1, which hid the
// level from 1.10, an empty past_seasons, the Battle Pass's stats), whose values are already in profile.coreSeasons.
function settleStrayStats(session) {
  const tracker = session.profile("athena");
  const stray = strayStats(tracker.profile);
  for (const name of stray) tracker.removeStat(name);
  if (stray.length) log("Battle Royale", `${session.accountId}: Season 1's profile no longer holds ${stray.join(", ")}`);
}

// A match's season: the profile takes up the season of the match's build, so its XP and challenges count there.
export function takeUpSeason(session) {
  if (seasonNeedsSwitch(session.profile("athena").profile)) switchSeason(session);
}

// What the season's rewards have given so far (profile.coreSeasonRewards, Core's): {<season>: {seasonLevel, free, paid}},
// the highest season level whose Battle Stars and the highest tiers whose free and Battle Pass rewards were given, so
// each is given once.
function givenSoFar(profile) {
  const season = String(seasonNumber());
  profile.coreSeasonRewards ??= {};
  return (profile.coreSeasonRewards[season] ??= { seasonLevel: 1, free: 0, paid: 0 });
}

const rewardsUpTo = (schedule, after, upTo) => (schedule ?? []).filter(({ level }) => level > after && level <= upTo)
  .flatMap(({ rewards }) => rewards);

// A season reward: Battle Stars to the Battle Pass, season XP to the level, the boosts to their stats, banners to profile0
// (where the banner editor finds them), V-Bucks to profile0, the Battle Pass challenges' trigger quest to athena and
// cosmetics to the locker. Returns what went to the locker or profile0, as loot.
function giveReward(session, { templateId, quantity }, athena) {
  const id = templateId.toLowerCase();
  const tracker = session.profile("athena");
  const { attributes } = tracker.profile.stats;
  if (id === "accountresource:athenaseasonalbp") return addBookXp(session, quantity, athena), [];
  if (id === "accountresource:athenaseasonalxp") return athena.addSeasonXp(session, quantity), [];
  if (id === "token:athenaseasonxpboost") return tracker.setStat("season_match_boost", (attributes.season_match_boost ?? 0) + quantity), [];
  if (id === "token:athenaseasonfriendxpboost") {
    return tracker.setStat("season_friend_match_boost", (attributes.season_friend_match_boost ?? 0) + quantity), [];
  }
  // The weekly challenge tokens a challenge bundle gives (5.0's completion steps, profiles/challenges.js): held in athena
  // and counted by the challenges that wait for them (athena.js acquireAthenaToken), as 4.0's quest-given one.
  if (/^token:athenabattlepass_.*weekly.*_token$/.test(id) && athena.acquireAthenaToken) return athena.acquireAthenaToken(session, templateId, quantity), [];
  const banner = bannerTemplateId(templateId);
  if (banner) return findItem(session.profile("profile0").profile, banner) ? [] : grant(session, banner, 1);
  if (id.startsWith("quest:")) {
    const questId = id.split(":")[1];
    const held = Object.values(tracker.profile.items).some((item) => item.templateId.toLowerCase() === id);
    if (!held) athena.grantAthenaQuest(tracker, questId);
    // The Battle Pass's trigger brings its first daily challenge at once, without waiting for the next quest login.
    athena.settleBattlePassDaily?.(session);
    return [];
  }
  // Season 3's challenges (profiles/challenges.js): the schedule, which gives its bundles as they unlock.
  if (id.startsWith("challengebundleschedule:")) return athena.grantChallengeSchedule?.(session, templateId), [];
  if (id.startsWith("athena")) {
    const item = athena.grantCosmetic(session, templateId);
    return item ? [item] : [];
  }
  return grant(session, templateId, quantity);
}
export const giveSeasonReward = giveReward;

// What the outermost settleSeasonRewards running has given so far, the nested ones' too (a reward's Battle Stars or
// season XP settle again inside it), or null when none runs.
let settling = null;

// Gives what the season level, the tier and (once bought) the Battle Pass have reached and not yet given. athena: the
// locker and season XP functions (profiles/athena.js), passed in so the two modules don't import each other. The
// outermost call returns every item it and the calls inside it gave and, on 3.0, puts them in a GiftBox:GB_BattlePass
// (profiles/giftboxes.js), the client's "{Number} items have been unlocked!" screen of the tiers reached (Core-Backend
// #205), unless giftBox is false (a purchase makes its own, PurchaseCatalogEntry.js; the admin panel's reset makes none).
export function settleSeasonRewards(session, athena, { giftBox = true } = {}) {
  const season = athenaSeason();
  if (!season || profileSeason(session.profile("athena").profile) !== season.seasonNumber) return [];
  const { profile } = session.profile("athena");
  const given = givenSoFar(profile);
  const outer = settling === null;
  if (outer) settling = [];
  const loot = settling;
  try {
    // A reward can move the level or tier on (season XP, Battle Stars), so it goes round until nothing is left to give.
    for (let round = 0; round < 1000; round++) {
      const { attributes } = profile.stats;
      const level = attributes.level ?? 1;
      const tier = attributes.book_level ?? 1;
      const rewards = [];
      if (level > given.seasonLevel) {
        rewards.push(...rewardsUpTo(season.seasonRewards, given.seasonLevel, level));
        given.seasonLevel = level;
      }
      if (tier > given.free) {
        rewards.push(...rewardsUpTo(season.bookFreeRewards, given.free, tier));
        given.free = tier;
      }
      if (attributes.book_purchased === true && tier > given.paid) {
        rewards.push(...rewardsUpTo(season.bookPaidRewards, given.paid, tier));
        given.paid = tier;
      }
      if (!rewards.length) break;
      for (const reward of rewards) loot.push(...giveReward(session, reward, athena));
    }
  } finally {
    if (outer) settling = null;
  }
  if (!outer) return [];
  if (giftBox) giveGiftBox(session, battlePassGiftBox, loot);
  return loot;
}

// Battle Stars into the tier; each tier's stars (BookXpCurve) move it on, up to the last tier, where none are kept.
export function addBookXp(session, stars, athena) {
  const season = athenaSeason();
  if (!season || !(stars > 0)) return;
  const tracker = session.profile("athena");
  const { attributes } = tracker.profile.stats;
  let tier = Math.min(Math.max(1, attributes.book_level ?? 1), season.numBookLevels);
  let xp = (attributes.book_xp ?? 0) + Math.floor(stars);
  for (let row = season.bookLevels.find((entry) => entry.level === tier); row && tier < season.numBookLevels && xp >= row.xpToNextLevel;
    row = season.bookLevels.find((entry) => entry.level === tier)) {
    xp -= row.xpToNextLevel;
    tier += 1;
  }
  if (tier >= season.numBookLevels) xp = 0;
  if (attributes.book_xp !== xp) tracker.setStat("book_xp", xp);
  if (attributes.book_level !== tier) {
    log("Battle Royale", `${session.accountId} reached Battle Pass tier ${tier}`);
    tracker.setStat("book_level", tier);
  }
  settleSeasonRewards(session, athena);
}

// The Battle Pass Promise (Core-Backend #206): "As a special thanks for buying the Season 2 Battle Pass, you'll start
// Season 3 off with 5 free tiers". From 2.2 (CL-3841827) AthenaSeason2's tier 2 Battle Pass reward is
// Token:AthenaNextSeasonTierBoost x5 ("Free Tiers", a profile0 token), and 3.0 (CL-3901517) has GiftBox:GB_BattlePassPromise,
// whose header (ItemReceivedBattlePassPromiseHeader) is that screen. In a season after the token's, the tokens the
// account holds become that many tiers' Battle Stars (BookXpCurve from tier 1: 5 tiers, 50 stars), shown in the promise
// box, once a season. A pass bought on 1.11 or 2.1, whose data had no token yet, counts as the token the newest data of
// its season gives at tier 2 (🟡 Core's: Epic gave every Season 2 pass owner the tiers).
const nextSeasonTierBoost = "Token:athenanextseasontierboost";
const promiseGiftBox = "GiftBox:gb_battlepasspromise";
const sameTemplate = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
export function settleSeasonPromise(session, athena) {
  const season = athenaSeason();
  const { profile } = session.profile("athena");
  if (!season || profileSeason(profile) !== season.seasonNumber) return;
  const key = String(season.seasonNumber);
  if ((profile.coreSeasonPromises ?? []).includes(key)) return;
  // A season older than one the profile has played (3.6 after 4.0) takes no tokens: they are a later pass's promise.
  if (Object.keys(profile.coreSeasons ?? {}).some((played) => Number(played) > season.seasonNumber)) return;
  const account = session.profile("profile0");
  const tokens = Object.entries(account.profile.items).filter(([, item]) => sameTemplate(item.templateId, nextSeasonTierBoost));
  let tiers = tokens.reduce((sum, [, item]) => sum + item.quantity, 0);
  const previous = season.seasonNumber - 1;
  if (!tiers && profile.coreSeasons?.[previous]?.book_purchased === true) {
    tiers = inBuild(buildOfSeason(previous), () => (athenaSeason()?.bookPaidRewards ?? []).flatMap(({ rewards }) => rewards)
      .filter(({ templateId }) => sameTemplate(templateId, nextSeasonTierBoost)).reduce((sum, { quantity }) => sum + quantity, 0));
  }
  if (!tiers) return;
  for (const [itemId] of tokens) account.removeItem(itemId);
  profile.coreSeasonPromises = [...(profile.coreSeasonPromises ?? []), key];
  const stars = season.bookLevels.filter(({ level }) => level >= 1 && level < 1 + tiers).reduce((sum, { xpToNextLevel }) => sum + xpToNextLevel, 0);
  log("Battle Royale", `${session.accountId} starts Season ${key} with ${tiers} free tiers (${stars} Battle Stars) for the Season ${previous} Battle Pass`);
  giveGiftBox(session, promiseGiftBox, [{ profileId: "athena", itemId: "AccountResource:athenaseasonalbp", templateId: "AccountResource:athenaseasonalbp", quantity: stars }]);
  addBookXp(session, stars, athena);
}

// The season's last tier, and how many tiers a player at a tier can still buy.
export const lastTier = () => athenaSeason()?.numBookLevels ?? 0;
export const tiersLeft = (profile) => Math.max(0, lastTier() - (profile.stats.attributes.book_level ?? 1));

// The Battle Pass bought (store/battlepass.js): book_purchased, and the Battle Pass rewards of every tier reached.
export function buyBattlePass(session, athena) {
  const tracker = session.profile("athena");
  tracker.setStat("book_purchased", true);
  log("Battle Royale", `${session.accountId} bought the Season ${seasonNumber()} Battle Pass`);
  return settleSeasonRewards(session, athena, { giftBox: false });
}

// The V-Bucks the account paid Core for the season's Battle Pass offers (the pass, the bundle and tiers), kept as
// profile.coreBattlePassSpend (Core's, never sent): {<season>: {<currency templateId>: amount}}, what the admin panel's
// Battle Pass reset refunds (Core-Backend #201). spent: what the purchase took of each kind.
export function recordBattlePassSpend(session, spent) {
  const { profile } = session.profile("athena");
  profile.coreBattlePassSpend ??= {};
  const record = (profile.coreBattlePassSpend[String(seasonNumber())] ??= {});
  for (const [templateId, amount] of Object.entries(spent ?? {})) record[templateId] = (record[templateId] ?? 0) + amount;
}

// Tiers bought: the tier moves on and keeps its Battle Stars ("Your current progress will be applied to the next tier"),
// and gives what the tiers reached give.
export function buyTiers(session, count, athena) {
  const tracker = session.profile("athena");
  const tier = Math.min(lastTier(), (tracker.profile.stats.attributes.book_level ?? 1) + count);
  tracker.setStat("book_level", tier);
  if (tier >= lastTier() && tracker.profile.stats.attributes.book_xp) tracker.setStat("book_xp", 0);
  log("Battle Royale", `${session.accountId} bought ${count} Battle Pass tier${count === 1 ? "" : "s"}, to tier ${tier}`);
  return settleSeasonRewards(session, athena, { giftBox: false });
}

// A match's season XP with the Battle Pass's match XP boost (season_match_boost percent) in a season that has one.
export function boostedMatchXp(session, xp) {
  if (!athenaSeason()) return xp;
  const boost = session.profile("athena").profile.stats.attributes.season_match_boost ?? 0;
  return Math.floor(xp * (1 + Math.max(0, boost) / 100));
}

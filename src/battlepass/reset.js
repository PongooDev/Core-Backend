import { inBuild } from "../builds/context.js";
import { athenaSeason, getAthenaQuest, seasonLevels } from "../gamedata/athena.js";
import { bannerTemplateId } from "../gamedata/banners.js";
import { buildGameData, dataBuilds } from "../gamedata/read.js";
import { log } from "../log.js";
import { lockerCosmeticId, removeLockerCosmetic, seasonRewardFunctions } from "../profiles/athena.js";
import { defaultBanner } from "../profiles/defaults.js";
import { battlePassGiftBox, heldGiftBoxes } from "../profiles/giftboxes.js";
import { findItem } from "../profiles/items.js";
import { grant } from "../profiles/progress.js";
import { accountLevelOf, buildOfSeason, profileSeason, settleSeasonRewards } from "../profiles/seasons.js";

// The admin panel's Battle Pass reset (Core-Backend #201): a season's pass back to before the player bought it. The pass
// isn't bought (book_purchased), its tiers and Battle Stars start over (book_level 1, book_xp 0) and its boosts go
// (season_match_boost and season_friend_match_boost, which only its tiers' tokens give). What the tiers reached gave is
// taken back as the season's data names it (AthenaSeason<n>'s BookXpScheduleFree and BookXpSchedulePaid, as far as the
// rewards bookkeeping, profile.coreSeasonRewards, says they were given):
// - cosmetics leave the locker, the slots showing them back to their default, unless something else gives them (a starter,
//   a season level reward, a victory umbrella: athena.js removeLockerCosmetic keeps those);
// - banners leave profile0, unless the full locker gave them (coreGrantedBanners), and a banner showing one goes back to
//   the default;
// - the V-Bucks they gave, as far as the account still has them (never below 0);
// - the season XP they gave (AccountResource:AthenaSeasonalXP), against the season's XP table;
// - Season 2's Battle Pass daily challenges (the pass's Quest:athena_battlepass_questtrigger, and the dailies it brought);
// - Season 3's challenge schedules the tiers gave, with their bundles and quests, apart from the season's own weekly
//   challenges, which every player has (AthenaSeason3's ChallengeSchedulesAlwaysShown);
// - 3.0's Battle Pass gift boxes not yet opened (profiles/giftboxes.js), whose items are gone.
// Then the season's level gives its Battle Stars again, so the free tiers the player's own level reaches (and their free
// rewards) come back, as they would have without the pass; Battle Stars from challenges aren't kept apart, so those don't.
// The V-Bucks the account paid Core for the season's pass, bundle and tiers (profile.coreBattlePassSpend, recorded since
// #201) are refunded in the kinds they were paid with; a pass bought before then, or given another way, refunds nothing.
// A season the profile has set aside (profile.coreSeasons) is reset in its record, and its past_seasons entry with it.

const typeOf = (templateId) => String(templateId).split(":")[0].toLowerCase();
const idOf = (templateId) => String(templateId).split(":")[1]?.toLowerCase();
const sameId = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// The seasons with a Battle Pass in any build's data, in order.
export const battlePassSeasons = () => [...new Set(dataBuilds.map((build) => buildGameData(build, "athena", {}).season?.seasonNumber)
  .filter((season) => season > 1))].sort((a, b) => a - b);

const freshPass = { book_level: 1, book_xp: 0, book_purchased: false, season_match_boost: 0, season_friend_match_boost: 0 };

// A season's total XP and back (SeasonXpCurve: {level, xpToNextLevel, xpTotal}); the season's last level keeps no XP.
const totalXpOf = (levels, level, xp) => (levels.find((row) => row.level === level)?.xpTotal ?? 0) + xp;
function levelOfXp(levels, total, top) {
  let row = levels[0];
  for (const entry of levels) if (entry.xpTotal <= total) row = entry;
  if (!row) return { level: 1, xp: 0 };
  const level = Math.min(row.level, top);
  return { level, xp: level >= top ? 0 : total - row.xpTotal };
}

// Takes up to amount V-Bucks from profile0, the reward's own kind first. Returns how many it took.
const mtxKinds = ["currency:mtxgiveaway", "currency:mtxcomplimentary", "currency:mtxpurchasebonus", "currency:mtxpurchased"];
function takeMtx(tracker, templateId, amount) {
  const order = [templateId.toLowerCase(), ...mtxKinds.filter((kind) => kind !== templateId.toLowerCase())];
  let left = amount;
  for (const kind of order) {
    for (const [itemId, item] of Object.entries(tracker.profile.items)) {
      if (!left || item.templateId.toLowerCase() !== kind) continue;
      const used = Math.min(left, item.quantity);
      left -= used;
      if (item.quantity > used) tracker.setQuantity(itemId, item.quantity - used);
      else tracker.removeItem(itemId);
    }
  }
  return amount - left;
}

// The rewards of a schedule's tiers after 0 up to upTo.
const rewardsUpTo = (schedule, upTo) => (schedule ?? []).filter(({ level }) => level <= upTo).flatMap(({ rewards }) => rewards);

// Resets the season's pass; run without a build of its own (the panel's requests name none). Returns what it did, or
// throws an Error with a message for the panel.
export function resetBattlePass(session, season) {
  if (!battlePassSeasons().includes(season)) throw new Error(`Season ${season} has no Battle Pass: pick one of ${battlePassSeasons().join(", ")}`);
  return inBuild(buildOfSeason(season), () => {
    const pass = athenaSeason();
    const tracker = session.profile("athena");
    const { profile } = tracker;
    const current = profileSeason(profile) === season;
    const record = current ? profile.stats.attributes : profile.coreSeasons?.[season] ?? {};
    const tier = record.book_level ?? 1;
    const purchased = record.book_purchased === true;
    const given = profile.coreSeasonRewards?.[String(season)];
    const rewards = [...rewardsUpTo(pass.bookFreeRewards, given?.free ?? tier), ...rewardsUpTo(pass.bookPaidRewards, given?.paid ?? (purchased ? tier : 0))];
    const result = { season, wasPurchased: purchased, tier, cosmetics: [], keptCosmetics: [], banners: [], vbucksTaken: 0, seasonXpTaken: 0,
      challenges: 0, refunded: 0 };

    // Cosmetics and banners.
    const account = session.profile("profile0");
    const removedBanners = [];
    for (const { templateId } of rewards) {
      const banner = bannerTemplateId(templateId);
      if (banner) {
        const itemId = findItem(account.profile, banner);
        if (!itemId || (account.profile.coreGrantedBanners ?? []).some((id) => sameId(id, banner))) continue;
        account.removeItem(itemId);
        removedBanners.push(idOf(banner));
        result.banners.push(banner);
      } else if (typeOf(templateId).startsWith("athena")) {
        const cosmetic = lockerCosmeticId(templateId);
        if (!cosmetic) continue;
        const removal = removeLockerCosmetic(session, cosmetic);
        if (removal.removed) result.cosmetics.push(cosmetic);
        else if (removal.kept) result.keptCosmetics.push({ templateId: cosmetic, reason: removal.kept });
      }
    }
    const gone = (row) => removedBanners.includes(String(row ?? "").toLowerCase());
    const { attributes } = profile.stats;
    if (gone(attributes.banner_icon)) tracker.setStat("banner_icon", defaultBanner.bannerIconId);
    const homebase = account.profile.stats.attributes.homebase;
    if (homebase && gone(homebase.bannerIconId)) account.setStat("homebase", { ...homebase, bannerIconId: defaultBanner.bannerIconId });

    // V-Bucks the tiers gave.
    for (const { templateId, quantity } of rewards) {
      if (mtxKinds.includes(templateId.toLowerCase())) result.vbucksTaken += takeMtx(account, templateId, quantity);
    }

    // Season 2's Battle Pass dailies and Season 3's challenge schedules the tiers gave.
    const quests = new Set(rewards.filter(({ templateId }) => typeOf(templateId) === "quest").map(({ templateId }) => idOf(templateId)));
    if (quests.size) {
      for (const [itemId, item] of Object.entries(profile.items)) {
        const questId = typeOf(item.templateId) === "quest" ? idOf(item.templateId) : null;
        const daily = questId && getAthenaQuest(questId)?.type === "AthenaBattlePassQuest";
        if (questId && (quests.has(questId) || daily)) {
          tracker.removeItem(itemId);
          result.challenges += 1;
        }
      }
      delete profile.coreBattlePassDaily;
    }
    const alwaysShown = (pass.challengeSchedulesAlwaysShown ?? []).map((id) => id.toLowerCase());
    const schedules = new Set(rewards.filter(({ templateId }) => typeOf(templateId) === "challengebundleschedule")
      .map(({ templateId }) => idOf(templateId)).filter((id) => !alwaysShown.includes(id)));
    for (const [scheduleItemId, schedule] of Object.entries(profile.items)) {
      if (typeOf(schedule.templateId) !== "challengebundleschedule" || !schedules.has(idOf(schedule.templateId))) continue;
      for (const [bundleItemId, bundle] of Object.entries(profile.items)) {
        if (typeOf(bundle.templateId) !== "challengebundle" || bundle.attributes.challenge_bundle_schedule_id !== scheduleItemId) continue;
        for (const [questItemId, quest] of Object.entries(profile.items)) {
          if (quest.attributes?.challenge_bundle_id === bundleItemId) tracker.removeItem(questItemId);
        }
        tracker.removeItem(bundleItemId);
      }
      tracker.removeItem(scheduleItemId);
      result.challenges += 1;
    }

    // Its unopened gift boxes, profile0's (profiles/giftboxes.js).
    for (const [itemId, item] of heldGiftBoxes(account.profile)) if (sameId(item.templateId, battlePassGiftBox)) account.removeItem(itemId);

    // The pass's stats, and the season XP its tiers gave.
    result.seasonXpTaken = rewards.filter(({ templateId }) => sameId(templateId, "AccountResource:athenaseasonalxp"))
      .reduce((sum, { quantity }) => sum + quantity, 0);
    const levels = seasonLevels();
    const top = pass.numSeasonLevels ?? levels.at(-1)?.level ?? 1;
    const before = totalXpOf(levels, record.level ?? 1, record.xp ?? 0);
    const { level, xp } = result.seasonXpTaken ? levelOfXp(levels, Math.max(0, before - result.seasonXpTaken), top)
      : { level: record.level ?? 1, xp: record.xp ?? 0 };
    const stats = { ...freshPass, level, xp };
    if (current) {
      for (const [name, value] of Object.entries(stats)) if (attributes[name] !== value) tracker.setStat(name, value);
      const accountLevel = accountLevelOf(profile, level);
      if (attributes.accountLevel !== accountLevel) tracker.setStat("accountLevel", accountLevel);
    } else {
      profile.coreSeasons ??= {};
      profile.coreSeasons[season] = { ...record, ...stats, seasonXp: totalXpOf(levels, level, xp) };
      const past = attributes.past_seasons;
      if (Array.isArray(past) && past.some((entry) => entry.seasonNumber === season)) {
        tracker.setStat("past_seasons", past.map((entry) => (entry.seasonNumber === season ? { ...entry, seasonXp: totalXpOf(levels, level, xp),
          seasonLevel: level, bookXp: 0, bookLevel: 1, purchasedVIP: false } : entry)));
        const accountLevel = accountLevelOf(profile, attributes.level ?? 1);
        if (attributes.accountLevel !== accountLevel) tracker.setStat("accountLevel", accountLevel);
      }
    }

    // The refund of what the account paid Core for this season's pass.
    const spent = profile.coreBattlePassSpend?.[String(season)] ?? {};
    for (const [templateId, amount] of Object.entries(spent)) {
      if (amount > 0) grant(session, templateId, amount);
      result.refunded += amount;
    }
    if (profile.coreBattlePassSpend) delete profile.coreBattlePassSpend[String(season)];

    // The season's level gives its Battle Stars again (now, in the profile's season; else when it next takes the season up
    // and earns XP), and they the free tiers they reach.
    profile.coreSeasonRewards ??= {};
    profile.coreSeasonRewards[String(season)] = { seasonLevel: 1, free: 0, paid: 0 };
    if (current) settleSeasonRewards(session, seasonRewardFunctions(), { giftBox: false });

    log("Battle Royale", `${session.accountId}'s Season ${season} Battle Pass was reset from the admin panel: ${result.cosmetics.length} cosmetics, `
      + `${result.banners.length} banners, ${result.vbucksTaken} V-Bucks and ${result.seasonXpTaken} season XP taken back, ${result.refunded} V-Bucks refunded`);
    return { ...result, tierNow: current ? profile.stats.attributes.book_level ?? 1 : 1 };
  });
}

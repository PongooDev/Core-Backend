import crypto from "node:crypto";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaSeason, getAthenaQuest } from "../gamedata/athena.js";
import { log } from "../log.js";
import { seasonHistoryStart, seasonMoment } from "../store/itemshop.js";
import { giveGiftBox } from "./giftboxes.js";
import { findItem } from "./items.js";
import { isOriginalOwner } from "./origins.js";
import { grantVariantToken, missingVariantTokens } from "./variants.js";

// Season 3's challenges (3.0, CL-3901517): the Battle Pass's weekly challenges and the tier challenges, in challenge
// bundles (tools/extractor: athena.json challengeSchedules, challengeBundles). AthenaSeason3's tier rewards grant the
// schedules: ChallengeBundleSchedule:Season3_Challenge_Schedule with the Battle Pass (tier 1), Season3_Tier_2_Schedule
// at free tier 2 and Season3_Tier_100_Schedule at tier 100. A schedule (UFortChallengeBundleScheduleDefinition) unlocks
// its bundles by its entries' UnlockType: OnScheduleGranted at once, DaysSinceEventStart (Week 2 to 9, 7 to 56 days)
// once that many days of the season have passed. 3.1 (CL-3915963) adds Week 10 (S3_Week10_QuestBundle, 63 days: 26
// April on the replay) and a sixth quest to Week 9 (topUpBundle); its other weeks are 3.0's. A bundle (UFortChallengeBundleItemDefinition) brings its quests
// (AthenaChallengeBundleQuest, bGrantWithBundle) and, once CompletionThreshold of them are done, its CompletionRewards
// (4,000 season XP a week; Tier 100's the Carbide glider, Glider_ID_017_Assassin).
//
// As Epic's athena profile kept them (the 3.0 client reads the schedule's granted_bundles and unlock_epoch):
// - ChallengeBundleSchedule:<id> {unlock_epoch, max_level_bonus, level, item_seen, xp, favorite, granted_bundles: [the
//   bundles' item ids]};
// - ChallengeBundle:<id> {has_unlock_by_completion, num_quests_completed, level, grantedquestinstanceids: [the quests'
//   item ids], item_seen, max_allowed_bundle_level, num_granted_bundle_quests, max_level_bonus,
//   challenge_bundle_schedule_id, num_progress_quests_completed, xp, favorite};
// - each quest's challenge_bundle_id, its bundle's item id.
// Days count on Season 3's replay (store/itemshop.js seasonMoment: day 1 is 22 February 2018), and unlock_epoch is the
// replay's day 1, so the challenges tab's "unlocks in" countdowns read as the replay's, unless the admin picks other
// unlock dates (#219, weekPlan). A bundle once given stays when the
// replay starts over. The quests are done as Epic's were, their Battle Stars paid at once (athena.js completeQuest).
const dayMs = 24 * 60 * 60 * 1000;
const typeOf = (templateId) => String(templateId).split(":")[0].toLowerCase();
const idOf = (templateId) => String(templateId).split(":")[1]?.toLowerCase();

const heldOf = (profile, type) => Object.entries(profile.items).filter(([, item]) => typeOf(item.templateId) === type);
const heldSchedule = (profile, scheduleId) => heldOf(profile, "challengebundleschedule").find(([, item]) => idOf(item.templateId) === scheduleId);
const heldBundle = (profile, bundleId) => heldOf(profile, "challengebundle").find(([, item]) => idOf(item.templateId) === bundleId);

// How many days into the season its replay is now, and the replay's day 1 (the client's unlock_epoch).
function replayDays(now) {
  const season = athenaSeason()?.seasonNumber ?? 1;
  const into = seasonMoment(now, null, season).getTime() - seasonHistoryStart(season);
  return { days: Math.max(0, Math.floor(into / dayMs)), epoch: new Date(now.getTime() - into).toISOString() };
}

// The season's start for the client's countdowns to the locked weeks (Core-Backend #207): the calendar's client-events
// state's seasonBegin (FFortClientEventsState::SeasonBegin, +0x158). 3.0's challenges tab shows a week that isn't in the
// profile yet as UFortChallengeBundleInfo::IsUnlocked's (0x26E0410) "Unlocks in {0}" (FortChallengeBundleInfo_
// TimeLeftBeforeUnlock): its DaysSinceEventStart UnlockValue in days less the time since SeasonBegin (0x9AE190: the
// calendar's now less SeasonBegin), so without one every week read "Unlocks in" nothing. By the original dates it is the
// replay's day 1: Season 3 began on 22 February 2018 and its weeks unlocked on the Thursdays after (Week 2 on 1 March to
// Week 9 on 19 April, 3.0's Season3_Challenge_Schedule's 7 to 56 days), so on the replay each week shows the day it came
// out. The admin's other unlock modes move it (weekPlan). The schedules' unlock_epoch is the same. Null for a build
// without challenge schedules.
export const challengeSeasonBegin = (now = new Date()) => (Object.keys(athenaChallengeSchedules()).length ? weekPlan(now).begin : null);

// The admin panel's weekly challenge settings (Core-Backend #207, #219), settings challengeUnlock.season<N>:
// - mode "original": each week on its day of the season's replay (the schedule's DaysSinceEventStart);
// - mode "interval": Week 1 on startDate ("YYYY-MM-DD", 00:00 UTC), each next week intervalDays later;
// - mode "manual": the first manualWeeks weeks, now;
// - weeksAvailable: the weeks past it stay locked whatever the mode.
// "Unlock all weeks now" is manual with every week. Before #219 it was settings challengesAllUnlocked, still read for a
// season without settings of its own. A player gets the weeks at their next login (settleChallengeSchedules).
let settingsProvider = () => undefined;
export function configureChallenges(provider) {
  settingsProvider = typeof provider === "function" ? provider : () => provider;
}
export const challengeModes = ["original", "interval", "manual"];

// Challenges that cannot be completed on the builds that give them, which the admin panel can complete for players
// (Core-Backend #269, settings completeBrokenChallenges, off by default). ONLY challenges that were reported and checked
// to be impossible to complete belong here, each with its issue and the builds it is broken on:
// - Quest_BR_Watch_Replay, "Watch a Match Replay" (Season 4 week 3): its objective battlepass_athena_watch_replay counts
//   the stat revive_athena_player, a placeholder row (a RevivePlayer stat), and no client code reports a watched replay,
//   so watching one never moves it (reviving a teammate does). In 4.0 and 4.1 (week 3 gives it); 4.2 keeps the
//   definition but no bundle gives it.
// - Quest_BR_Visit_ScavengerHunt_StormCircles, "Visit the center of different Storm Circles in a single match" (Season 4
//   week 4): in 4.0 and 4.1 its objective counts visit_location_animal_building_crab, the crab building visit borrowed as
//   a placeholder, and the storm circle item it asks for does not exist in those builds. 4.2 counts its own stat,
//   touch_scavengerhunt_stormcircles, so it is not listed.
// - Quest_BR_Score_Goals, "Score a goal on different pitches" (Season 4 week 7, Core-Backend #287): in 4.0, 4.1 and 4.2
//   it has one objective, battlepass_athena_score_goals_01 (count 1), on the placeholder stat revive_athena_player (a
//   RevivePlayer row, context Athena.Playlist), while its ObjectiveCompletionCount is 5, so it can never get past 1/5,
//   and that one only by reviving a teammate. No goal is reported: the builds' SDKs have no soccer class and the pitches'
//   quest stats came with a later build.
// 4.4 (CL-4132537; 4.4.0 and 4.4.1 play on its data) fixes the ones its bundles still give, so none is listed for it:
// - Score a goal on different pitches (week 7) has seven objectives, one per pitch (battlepass_athena_score_goals_01 to
//   07, on the Custom stats scoregoal_location_pitch_01 to 07), five of them to complete: the pitches' own stats, which
//   the gameserver reports, as 4.4's notes' soccer stadium and balls came with them.
// - Minigun or Light Machine Gun Eliminations (week 5): its stat row now wants Weapon.Ranged.Minigun or
//   Weapon.Ranged.LMG, which 4.4's WID_Assault_LMG_Athena_* (Weapon.Ranged.Minigun) and WID_Assault_LMGSAW_Athena_*
//   (Weapon.Ranged.LMG) carry. Minigun Eliminations' row wants Weapon.Ranged.Minigun too; Damage with a Minigun's still
//   wants Weapon.Ranged.Heavy.Minigun, which no 4.4 item carries, but no 4.4 bundle gives either of those two.
// - Watch a Match Replay is in no 4.4 bundle, and the Storm Circles visit counts its own stat, as on 4.2.
// 4.5 (CL-4166199; CL-4159770 plays on its data) lists none either. Its weeks 9 and 10 are revised and count their own
// stats: Ride a Shopping Cart now counts use_vehicle_shoppingcart (4.4's counted the vending machines' interact row), Visit
// different craters in a single match the nine visit_location_meteor_crater rows (4.4's the taco shops'), and the new
// mountain summits visit (quest_br_visit_namedlocations_singlematch) its own visit rows; Pass through rings
// (quest_br_skydive_rings) now needs all 20 of its rings (no ObjectiveCompletionCount). None is tied to a placeholder.
// 5.0 (CL-4214610; CL-4204761 plays on its data), checked: of Season 5's 70 weekly challenges one is unfinished in its paks,
// Quest_BR_Destroy_SpecificTargets (week 3's, a Battle Pass one): its name and objective read "TBD" and its objective counts
// visit_location_animal_building_crab, the crab building visit borrowed as a placeholder (as 4.0's Storm Circles one,
// CoreV2 #299), so nothing about it says what to destroy and no target of its own exists in 5.0. Its week came on 26 July,
// with 5.10. The rest count their own stats: the Custom ones (open_supply_llama, scorebasket_location_basket_01 to 10,
// touch_flamingrings_vehicle, use_item_riftportal, scorehole_location_green_01 to 07, complete_timed_trial_01 to 07,
// use_scavengerhunt_danceoff) are the gameserver's to report, and Minigun or Light Machine Gun Eliminations (week 6)
// wants Weapon.Ranged.Minigun or Weapon.Ranged.LMG, which 5.0's LMGs carry, as on 4.4.
export const brokenChallenges = [
  { quest: "quest_br_watch_replay", title: "Watch a Match Replay", issue: "Core-Backend #269", url: "https://github.com/PongooDev/Core-Backend/issues/269",
    builds: ["4039451", "4053532"], reason: "Its objective is tied to the placeholder stat revive_athena_player and no client code reports a watched replay." },
  { quest: "quest_br_visit_scavengerhunt_stormcircles", title: "Visit the center of different Storm Circles in a single match", issue: "CoreV2 #299",
    url: "https://github.com/PongooDev/CoreV2/issues/299", builds: ["4039451", "4053532"],
    reason: "Its objective uses the borrowed stat visit_location_animal_building_crab and the item it asks for does not exist in the build." },
  // 4.2 (CL-4072250), CoreV2 #318: the stat rows of AthenaObjectiveStatTable want Weapon.Ranged.Heavy.Minigun (the LMG one
  // also accepts Weapon.Ranged.Heavy.LMG) among the killing weapon's tags, and the build's Minigun and LMG items
  // (WID_Assault_LMG_Athena_*, WID_Assault_LMGSAW_Athena_*) carry only Gameplay.DamageSource.Weapon, Weapon.Ranged.Assault and
  // a Bacchus.Shoot.* tag, so the stats never count.
  { quest: "quest_br_eliminate_weapon_minigunlmg", title: "Minigun or Light Machine Gun Eliminations", issue: "CoreV2 #318",
    url: "https://github.com/PongooDev/CoreV2/issues/318", builds: ["4072250"],
    reason: "Its stat row killingblow_athena_player_minigunLMG needs the tag Weapon.Ranged.Heavy.Minigun or Weapon.Ranged.Heavy.LMG and no item in the build carries either." },
  { quest: "quest_br_eliminate_weapon_minigun", title: "Minigun Eliminations", issue: "CoreV2 #318",
    url: "https://github.com/PongooDev/CoreV2/issues/318", builds: ["4072250"],
    reason: "Its stat row killingblow_athena_player_minigun needs the tag Weapon.Ranged.Heavy.Minigun and no item in the build carries it." },
  { quest: "quest_br_damage_minigun", title: "Damage with a Minigun", issue: "CoreV2 #318",
    url: "https://github.com/PongooDev/CoreV2/issues/318", builds: ["4072250"],
    reason: "Its stat row damage_athena_player_with_minigun needs the tag Weapon.Ranged.Heavy.Minigun and no item in the build carries it." },
  { quest: "quest_br_score_goals", title: "Score a goal on different pitches", issue: "Core-Backend #287",
    url: "https://github.com/PongooDev/Core-Backend/issues/287", builds: ["4039451", "4053532", "4072250"],
    reason: "It needs 5 objectives done but has one, on the placeholder stat revive_athena_player, and nothing reports a goal." },
  { quest: "quest_br_destroy_specifictargets", title: "Destroy specific targets (TBD)", issue: "CoreV2 #299", url: "https://github.com/PongooDev/CoreV2/issues/299",
    builds: ["4204761", "4214610"], reason: "It is unfinished in 5.0's paks: its name and objective read TBD and the objective uses the borrowed stat visit_location_animal_building_crab." },
  // 6.20 (CL-4497486), Fortnitemares Part 4: damage_athena_deimos_monsterspawner wants a DamageDone.Deimos.Spawner damage
  // record, and nothing in 6.20's code or data makes one (the pawn's RecordDamage only fills its five built-in groups, and
  // building damage is recorded only for pieces a player placed). 6.21 (CL-4526925) fixed it in its code and game data
  // (CoreV2 40dcb906 has the details), so only 6.20 is listed.
  { quest: "quest_fnm_damage_monsterspawners", title: "Deal damage to Cube Fragments", issue: "CoreV2 40dcb906",
    url: "https://github.com/PongooDev/CoreV2/commit/40dcb906", builds: ["4497486"],
    reason: "Its stat damage_athena_deimos_monsterspawner needs a DamageDone.Deimos.Spawner damage record, which nothing in 6.20 creates; 6.21 fixed it." }
];
export const completeBrokenChallenges = (settingsValue = settingsProvider()) => settingsValue?.completeBrokenChallenges === true;
// The list entry for a challenge on a build, when it is one of the broken ones there.
export const brokenChallengeOf = (questId, build) => brokenChallenges.find((entry) => entry.quest === String(questId).toLowerCase() && entry.builds.includes(String(build)));

const bySeasonDays = (entry) => entry.unlockType === "DaysSinceEventStart";
// The season's weekly schedule unlocks by days and names no event. 6.20's (CL-4497486) Schedule_Fortnitemares unlocks its
// Parts 2 to 4 by days too (DaysSinceEventStart 32, 34 and 36) but is an event's (EventName EventFlag.LTM_Fortnitemares),
// and sorts before the season's: it isn't the weeks the admin panel's challenge settings move (eventBundleOpen).
const isWeekly = (schedule) => schedule.bundles.some(bySeasonDays) && !schedule.eventName;
// An event schedule's bundle that unlocks by days: open once that many days of the season's replay have passed, the same
// count the client's "Unlocks in" countdown takes from the calendar's seasonBegin by the original dates (Schedule_
// Fortnitemares: 29 October, 31 October and 2 November on Season 6's replay, whose day 1 is 27 September). 🟡 The Fortnite
// Wiki's Fortnitemares 2018 Challenges dates Parts 2 to 4 on 27, 29 and 31 October; the days are the files'.
const eventBundleOpen = (entry, now) => !bySeasonDays(entry) || replayDays(now).days >= entry.unlockValue;
// The season's weekly schedule's weeks (Season3_Challenge_Schedule: the one unlocking by days), Week 1 first: each
// DaysSinceEventStart entry is a week, and the entries given with the schedule (OnScheduleGranted) are Week 1 together.
// Season 3's has one such entry, S3_Week1_QuestBundle. Season 4's (4.0, CL-4039451) has three: QuestBundle_S4_Cumulative
// and QuestBundle_S4_ProgressiveA before QuestBundle_S4_Week_001, so counting entries made 12 weeks of its 10 and put
// Week 1 third (Core-Backend #266). A week is {bundle: its own bundle (the last of Week 1's), bundles, unlockType,
// unlockValue}.
function weeklyEntries() {
  const schedule = Object.values(athenaChallengeSchedules()).find(isWeekly);
  if (!schedule) return [];
  const given = schedule.bundles.filter((entry) => !bySeasonDays(entry));
  const byDays = schedule.bundles.filter(bySeasonDays).sort((a, b) => a.unlockValue - b.unlockValue);
  const first = given.length ? [{ ...given[given.length - 1], unlockValue: 0, bundles: given.map((entry) => entry.bundle) }] : [];
  return [...first, ...byDays.map((entry) => ({ ...entry, bundles: [entry.bundle] }))];
}
export const challengeWeekCount = () => weeklyEntries().length;

const dateOnly = (value) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : null);
const whole = (value, low, high, fallback) => (Number.isInteger(value) ? Math.min(high, Math.max(low, value)) : fallback);

// The running season's settings, filled in and held to its weeks.
export function challengeUnlock(settingsValue = settingsProvider(), now = new Date()) {
  const total = challengeWeekCount();
  const saved = settingsValue?.challengeUnlock?.[`season${athenaSeason()?.seasonNumber ?? 1}`];
  const base = saved ?? (settingsValue?.challengesAllUnlocked === true ? { mode: "manual", manualWeeks: total } : {});
  return {
    mode: challengeModes.includes(base.mode) ? base.mode : "original",
    startDate: dateOnly(base.startDate) ?? replayDays(now).epoch.slice(0, 10),
    intervalDays: whole(base.intervalDays, 1, 60, 7),
    manualWeeks: whole(base.manualWeeks, 0, total, total),
    weeksAvailable: whole(base.weeksAvailable, 1, Math.max(1, total), total),
    totalWeeks: total
  };
}
export const challengesAllUnlocked = (settingsValue = settingsProvider()) => {
  const settings = challengeUnlock(settingsValue);
  return settings.mode === "manual" && settings.manualWeeks >= settings.totalWeeks && settings.weeksAvailable >= settings.totalWeeks;
};

// Which weeks are unlocked now, when each unlocks (null: no date), and the seasonBegin the client counts down from.
// The client puts a week at seasonBegin plus its UnlockValue (7 days a week), so seasonBegin is set for the next locked
// week to read right: by the original dates and every 7 days that is every week; any other interval gets the next week
// right and the weeks after it read 7 days apart; manual has no dates, its next locked week reads a week from today.
// changes: when seasonBegin next moves, for the calendar's cacheExpire.
export function weekPlan(now = new Date(), settingsValue = settingsProvider()) {
  const settings = challengeUnlock(settingsValue, now);
  const entries = weeklyEntries();
  const { days, epoch } = replayDays(now);
  const valueOf = (i) => (entries[i] && bySeasonDays(entries[i]) ? entries[i].unlockValue : 0);
  const start = Date.parse(`${settings.startDate}T00:00:00Z`);
  const today = Math.floor(now.getTime() / dayMs) * dayMs;
  const weeks = entries.map((entry, i) => {
    const at = i >= settings.weeksAvailable ? null
      : settings.mode === "original" ? Date.parse(epoch) + valueOf(i) * dayMs
        : settings.mode === "interval" ? start + i * settings.intervalDays * dayMs : null;
    const open = i < settings.weeksAvailable && (settings.mode === "manual" ? i < settings.manualWeeks
      : settings.mode === "interval" ? now.getTime() >= at : !bySeasonDays(entry) || days >= entry.unlockValue);
    return { week: i + 1, bundle: entry.bundle, bundles: entry.bundles, unlocked: open, unlocksAt: at === null ? null : new Date(at).toISOString() };
  });
  const next = weeks.findIndex((week) => !week.unlocked && week.week <= settings.weeksAvailable);
  let begin = epoch;
  if (settings.mode === "interval") {
    const anchor = next >= 0 ? next : Math.max(0, Math.min(settings.weeksAvailable, entries.length) - 1);
    begin = new Date(start + anchor * settings.intervalDays * dayMs - valueOf(anchor) * dayMs).toISOString();
  } else if (settings.mode === "manual") {
    begin = new Date(next >= 0 ? today + 7 * dayMs - valueOf(next) * dayMs : today - valueOf(entries.length - 1) * dayMs).toISOString();
  }
  const changes = next < 0 || settings.mode === "original" ? null
    : settings.mode === "interval" ? new Date(weeks[next].unlocksAt) : new Date(today + dayMs);
  return { ...settings, weeks, begin, changes };
}

// 5.0's (CL-4214610, Season 5) weekly challenges are "split into two sections, free and Battle Pass. The first 3
// challenges will be available for free while the last 4 are only available if you own the Battle Pass": each week's
// bundle (QuestBundle_S5_Week_<n>, in Season5_Free_Schedule, which every player gets) marks its last four
// RequiresBattlePass (athena.json requiresBattlePass). A player without the pass gets the first three; buying it gives
// the rest of every week held (topUpBundle, at the purchase's settle and every login).
const givesQuest = (tracker, { grantWithBundle, requiresBattlePass, quest }) => grantWithBundle && Boolean(getAthenaQuest(quest))
  && (!requiresBattlePass || tracker.profile.stats.attributes.book_purchased === true);

function grantBundle(session, scheduleItemId, bundleId, athena) {
  const tracker = session.profile("athena");
  const bundle = athenaChallengeBundles()[bundleId];
  if (!bundle) return null;
  const bundleItemId = crypto.randomUUID();
  const questIds = [];
  for (const entry of bundle.quests) {
    const { quest } = entry;
    if (!givesQuest(tracker, entry)) continue;
    const questItemId = athena.grantAthenaQuest(tracker, quest);
    if (!questItemId) continue;
    tracker.setItemAttribute(questItemId, "challenge_bundle_id", bundleItemId);
    tracker.setItemAttribute(questItemId, "challenge_linked_quest_given", "");
    tracker.setItemAttribute(questItemId, "challenge_linked_quest_parent", "");
    questIds.push(questItemId);
  }
  tracker.addItem(bundleItemId, {
    templateId: `ChallengeBundle:${bundleId}`,
    attributes: {
      has_unlock_by_completion: false, num_quests_completed: 0, level: 0, grantedquestinstanceids: questIds, item_seen: false,
      max_allowed_bundle_level: 0, num_granted_bundle_quests: questIds.length, max_level_bonus: 0,
      challenge_bundle_schedule_id: scheduleItemId, num_progress_quests_completed: 0, xp: 0, favorite: false
    },
    quantity: 1
  });
  log("Battle Royale", `${session.accountId} got the challenges ${bundleId} (${questIds.length} quests)`);
  return bundleItemId;
}

// A bundle given on an earlier build whose data had fewer of its quests gets the ones the requesting build's data adds
// (🟡 Core's: 3.1, CL-3915963, adds Quest_BR_Damage_Enemy_Buildings to S3_Week9_QuestBundle, which 3.0 gave with five
// quests; a 3.1 player who had week 9 on 3.0 gets the sixth at their next login). Quests the bundle held stay.
function topUpBundle(session, bundleItemId, bundleId, athena) {
  const tracker = session.profile("athena");
  const bundle = athenaChallengeBundles()[bundleId];
  const bundleItem = tracker.profile.items[bundleItemId];
  if (!bundle || !bundleItem) return;
  const questIds = [...(bundleItem.attributes.grantedquestinstanceids ?? [])];
  const heldQuests = new Set(questIds.map((id) => idOf(tracker.profile.items[id]?.templateId)).filter(Boolean));
  const added = [];
  for (const entry of bundle.quests) {
    const { quest } = entry;
    if (heldQuests.has(quest) || !givesQuest(tracker, entry)) continue;
    const questItemId = athena.grantAthenaQuest(tracker, quest);
    if (!questItemId) continue;
    tracker.setItemAttribute(questItemId, "challenge_bundle_id", bundleItemId);
    tracker.setItemAttribute(questItemId, "challenge_linked_quest_given", "");
    tracker.setItemAttribute(questItemId, "challenge_linked_quest_parent", "");
    added.push(questItemId);
  }
  if (!added.length) return;
  tracker.setItemAttribute(bundleItemId, "grantedquestinstanceids", [...questIds, ...added]);
  tracker.setItemAttribute(bundleItemId, "num_granted_bundle_quests", questIds.length + added.length);
  log("Battle Royale", `${session.accountId} got ${added.length} more of ${bundleId}'s challenges`);
}

// Gives the schedules' bundles that have unlocked (the weekly schedule's by the admin's settings, weekPlan), and keeps
// their unlock_epoch on the calendar's seasonBegin.
export function settleChallengeSchedules(session, athena, now = new Date()) {
  const schedules = athenaChallengeSchedules();
  const tracker = session.profile("athena");
  const plan = weekPlan(now);
  const weekOpen = new Map(plan.weeks.flatMap((week) => week.bundles.map((bundle) => [bundle, week.unlocked])));
  for (const [scheduleItemId, item] of heldOf(tracker.profile, "challengebundleschedule")) {
    const schedule = schedules[idOf(item.templateId)];
    if (!schedule) continue;
    if (item.attributes.unlock_epoch !== plan.begin) tracker.setItemAttribute(scheduleItemId, "unlock_epoch", plan.begin);
    const granted = [...(item.attributes.granted_bundles ?? [])];
    for (const entry of schedule.bundles) {
      const open = isWeekly(schedule) ? weekOpen.get(entry.bundle) === true : schedule.eventName ? eventBundleOpen(entry, now) : !bySeasonDays(entry);
      const held = heldBundle(tracker.profile, entry.bundle);
      if (held) topUpBundle(session, held[0], entry.bundle, athena);
      if (!open || held) continue;
      const bundleItemId = grantBundle(session, scheduleItemId, entry.bundle, athena);
      if (bundleItemId) granted.push(bundleItemId);
    }
    if (granted.length !== (item.attributes.granted_bundles ?? []).length) tracker.setItemAttribute(scheduleItemId, "granted_bundles", granted);
  }
}

// A season reward ChallengeBundleSchedule:<id> (profiles/seasons.js): the schedule, once, and the bundles it unlocks now.
export function grantChallengeSchedule(session, templateId, athena, now = new Date()) {
  const scheduleId = idOf(templateId);
  const tracker = session.profile("athena");
  if (!athenaChallengeSchedules()[scheduleId] || heldSchedule(tracker.profile, scheduleId)) return;
  tracker.addItem(crypto.randomUUID(), {
    templateId: `ChallengeBundleSchedule:${scheduleId}`,
    attributes: { unlock_epoch: now.toISOString(), max_level_bonus: 0, level: 1, item_seen: false, xp: 0, favorite: false, granted_bundles: [] },
    quantity: 1
  });
  log("Battle Royale", `${session.accountId} got the challenge schedule ${scheduleId}`);
  settleChallengeSchedules(session, athena, now);
}

// An outfit's own challenges (athena.json's challengeSchedules of category "Styles", tools/extractor): a schedule no
// season's pass gives, whose one bundle comes with it (OnScheduleGranted) and earns the outfit something more.
// - BundleSchedule_Styles_SkullTrooper, 6.02's (CL-4461277): "Skull Trooper Challenges", "Earn additional styles for
//   Skull Trooper". The Fortnite Wiki: "available from October 10th 2018 for anyone who has purchased the Skull Trooper
//   Outfit ... rewarded players with the Ghost Portal Back Bling", and Epic's post of that day: "Patch v6.02 is available
//   now with a return from beyond the grave! The Skull Squad Gear is available now. Complete challenges to earn the
//   Ghost Portal Back Bling." Its bundle, QuestBundle_Styles_SkullTrooper, has five challenges (complete 7 daily
//   challenges, play 50 matches, 14 matches with an elimination, search 10 chests and deal 1,000 damage in a single
//   match) and gives BID_105_GhostPortal when all five are done.
// - BundleSchedule_Styles_Tomatohead (5.30's, in 6.02's data too): "Tomatohead Challenges", the wiki's "available since
//   August 23rd 2018 for anyone who has purchased the Tomatohead Outfit", three challenges for the Crown style
//   (VTID_032_Tomatohead_Crown). Only a build whose data has the schedule gives it: 5.30's to 6.00's overlays were made
//   before the extractor kept these, so there it starts with 6.01, extracted again for #334 (🟡 until those builds are
//   extracted again).
// Nothing in the game's files ties a schedule to its outfit (Epic's servers gave it with the purchase, and to those who
// already owned the outfit), so the outfits are named here. A player whose locker holds the outfit gets its schedule at
// the quest login, once; the challenges tab then lists it. It is no season's (profiles/seasons.js retires only what a
// pass gives), so it stays.
// The styles for "original owners who bought Skull Trooper in 2017", the outfit's Purple Glow and the Ghost Portal's
// purple, are originalOwnerStyles' below; the Green Glow and the blue and green portals are unlocked for everyone, as the
// data has them.
// 🟡 Not sent: GiftBox:GB_SkullTrooperStyleChallenge and GB_TomatoHeadStyleChallenge, the boxes that announced the
// challenges (the first's header, ItemReceivedSkullTrooperStyleChallenge: "HE'S BACK!", "SKULL TROOPER CHALLENGES
// AVAILABLE!", "Complete the Skull Trooper challenges to unlock the Ghost Portal Back Bling!"). Only the asset registry
// names them: no schedule, bundle or reward does, and what Epic's servers listed in one isn't in the client. The reward's
// own box is the one its bundle names, GB_ChallengeComplete (giveBundleRewards), and the schedules go once done
// (settleCompletedSchedules).
// 6.20 (CL-4497486) gives each its own CategoryID, "Styles_SkullTrooper" and "Styles_Tomatohead" (the schedules, bundles
// and quests are 6.10's otherwise).
export const isStylesCategory = (category) => category === "Styles" || String(category ?? "").startsWith("Styles_");
export const styleSchedules = {
  bundleschedule_styles_tomatohead: "AthenaCharacter:cid_109_athena_commando_m_pizza",
  bundleschedule_styles_skulltrooper: "AthenaCharacter:cid_030_athena_commando_m_halloween"
};
export function settleStyleSchedules(session, athena, now = new Date()) {
  const schedules = athenaChallengeSchedules() ?? {};
  const tracker = session.profile("athena");
  for (const [scheduleId, outfit] of Object.entries(styleSchedules)) {
    if (!isStylesCategory(schedules[scheduleId]?.category) || heldSchedule(tracker.profile, scheduleId)) continue;
    // Done and cleaned up (settleCompletedSchedules): they don't start over.
    if (scheduleCleanedUp(tracker.profile, scheduleId)) continue;
    if (findItem(tracker.profile, outfit)) grantChallengeSchedule(session, `ChallengeBundleSchedule:${scheduleId}`, athena, now);
  }
}

// The styles of an outfit's original owners (Core-Backend #335): the Skull Trooper's Purple Glow and the Ghost Portal's
// purple, "for original owners who bought Skull Trooper in 2017".
// What 6.02's (CL-4461277) files say:
// - CosmeticVariantToken:VTID_052_Skull_Trooper_RedFlames, "Purple Glow Skull Trooper", is CID_030_Athena_Commando_M_
//   Halloween's channel ClothingColor, option Mat1 ("PURPLE GLOW", its picture T-Variant-M-Grave-OG-Variant), and
//   VTID_053_Ghost_Portal__RedFlames, "Purple Glow Ghost Portal", is BID_105_GhostPortal's channel Particle, option
//   Particle1 ("PURPLE"). Both options are bStartUnlocked false and bHideIfNotOwned true, with no UnlockRequirements text:
//   by the flag's name, a locker that doesn't own one doesn't list it. (Mat2, "GREEN GLOW", and Particle2, "GREEN", start
//   unlocked.)
// - Nothing read gives either token: none of the 429 Battle Royale quests' rewards (shown, hidden or their rewards table's
//   rows), none of the completion rewards of the bundles the extractor keeps (Season 6's, the outfits', High Stakes' and
//   Season 5's two that outlast it) and no tier of AthenaSeason6 names them. The paks' other 39 bundles are Season 3's to
//   5's weeks, the Birthday's and SocialPlay's by their names, and weren't opened.
// - The Skull Trooper Challenges are one schedule with one bundle of five quests, each given with the bundle, and one
//   completion step (every quest, CompletionCount -1) with one reward, the back bling. There is no second bundle, quest
//   or stage for the purple portal, and none that only some players get: of the 57 bundles, 18 schedules and the quests
//   of Athena/Items/Quests/Styles in the paks, the only ones of the Skull Trooper are these.
// So who got the tokens was Epic's service's, from when the outfit was bought, and the rule here is 🟡 Core's reading of
// what players saw (the reporter's words on #335, and the Fortnite Wiki's "original owners"):
// - the Purple Glow is the outfit's original owners': an account whose Skull Trooper was bought from the item shop of a
//   Season 1 build (1.8 to 1.10: the shop's replay of 30 October to 13 December 2017, the outfit's first release), as
//   profiles/origins.js notes purchases, or one an admin marked;
// - the purple portal is theirs once they have done the Skull Trooper Challenges (the schedule: its bundle's five, which
//   give the back bling); nobody else gets it, and no challenge is added or shown for it, as the files have none.
// Everyone else's stay locked (hidden, as the options say): a Skull Trooper bought in a later season's shop, given by the
// panel or held from before purchases were noted is a later owner's. The admin panel's full locker and styles window
// give them as they give any style.
// 🟡 No gift box announces them: the tokens ask for one (bCreateGiftbox) and name none, and what box Epic's service made
// isn't in the client. The styles are owned on their items, which is what the locker reads.
const skullTrooper = "AthenaCharacter:cid_030_athena_commando_m_halloween";
export const originalOwnerStyles = [
  { token: "CosmeticVariantToken:vtid_052_skull_trooper_redflames", outfit: skullTrooper, season: 1 },
  { token: "CosmeticVariantToken:vtid_053_ghost_portal__redflames", outfit: skullTrooper, season: 1, schedule: "bundleschedule_styles_skulltrooper" }
];
// Whether an outfit has styles for its original owners (the admin panel's mark).
export const hasOriginalOwnerStyles = (templateId) => originalOwnerStyles.some(({ outfit }) => outfit.toLowerCase() === String(templateId).toLowerCase());

// Every challenge of a schedule done: cleaned up since (settleCompletedSchedules), or each of its bundles held with all
// its quests done.
function scheduleDone(profile, scheduleId) {
  if (scheduleCleanedUp(profile, scheduleId)) return true;
  const schedule = (athenaChallengeSchedules() ?? {})[scheduleId];
  if (!schedule?.bundles.length) return false;
  return schedule.bundles.every((entry) => {
    const held = heldBundle(profile, entry.bundle);
    return Boolean(held) && bundleDone({ profile }, held[1]);
  });
}

// The tokens the rule gives this profile, whether or not the requesting build's data has them.
export const originalOwnerTokens = (profile) => originalOwnerStyles
  .filter(({ outfit, season, schedule }) => isOriginalOwner(profile, outfit, season) && (!schedule || scheduleDone(profile, schedule)))
  .map(({ token }) => token);

// Those the locker lacks, given: at the athena profile's setup (a login) and when a bundle's last challenge is done, so
// the back bling comes with its purple.
export function settleOriginalOwnerStyles(session) {
  const { profile } = session.profile("athena");
  for (const tokenId of missingVariantTokens(profile, originalOwnerTokens(profile))) {
    log("Battle Royale", `${session.accountId}: ${tokenId}, an original owner's style`);
    grantVariantToken(session, tokenId);
  }
}

// CleanUpOnBundleCompletion (athena.json's schedules' cleanUpOnBundleCompletion, tools/extractor): a schedule that goes
// once its bundle is completed. The client only writes the flag into the schedule's MCP template (6.02, CL-4461277,
// 0xD8D730: static_cleanup_on_bundle_completion, beside static_bundle_list and static_event_name) and reads it nowhere
// else, so the cleaning up was Epic's service's. In 6.02's files seven schedules have it, each with one bundle given
// with the schedule: the outfits' own (BundleSchedule_Styles_SkullTrooper and _Tomatohead), Season 5's and 6's
// ProgressiveA and B (Drift's and Ragnarok's, Calamity's and Dire's) and High Stakes' Schedule_LTM_Heist; the weekly
// schedules, which the season's end takes, don't.
// 🟡 What the service removed isn't in the client. Core takes the schedule out with its bundles and their quests once
// every quest of every bundle of it is done (a bundle's rewards may come before that: Calamity's harvesting tool at five
// of eight), at the quest login, so the lobby the player comes back to no longer lists challenges that are all done.
// What the challenges gave stays (the locker's items and styles are no quest's). The schedule is noted
// (profile.coreCleanedUpSchedules, Core's, never sent) so the ones given at the quest login, the outfits' and the
// events', aren't given again; a Battle Pass tier gives its schedule once anyway (profiles/seasons.js). Only a build
// whose data has the flag cleans up: overlays made before the extractor kept it (6.00's and earlier) leave theirs.
// The flag is what lets a schedule outlast its season: Season 5's ProgressiveA and B aren't among what AthenaSeason5's
// end takes (profiles/seasons.js keptPast, Core-Backend #334), so in Season 6 a pass owner still has Drift's and
// Ragnarok's until their five stages are done, and then they go this way, on 6.01 and 6.02.
export const scheduleCleanedUp = (profile, scheduleId) => (profile.coreCleanedUpSchedules ?? []).includes(String(scheduleId).toLowerCase());

function bundleDone(tracker, bundleItem) {
  const bundle = athenaChallengeBundles()[idOf(bundleItem.templateId)];
  if (!bundle) return false;
  const questIds = bundleItem.attributes.grantedquestinstanceids ?? [];
  const held = questIds.map((id) => tracker.profile.items[id]).filter(Boolean);
  // Every quest the bundle gives this player is held (none still to come from newer data, topUpBundle) and done.
  const given = new Set(held.map((quest) => idOf(quest.templateId)));
  return bundle.quests.filter((entry) => givesQuest(tracker, entry)).every(({ quest }) => given.has(quest))
    && held.length > 0 && held.every((quest) => ["Completed", "Claimed"].includes(quest.attributes.quest_state));
}

export function settleCompletedSchedules(session) {
  const schedules = athenaChallengeSchedules() ?? {};
  const tracker = session.profile("athena");
  const { profile } = tracker;
  for (const [scheduleItemId, item] of heldOf(profile, "challengebundleschedule")) {
    const scheduleId = idOf(item.templateId);
    const schedule = schedules[scheduleId];
    if (!schedule?.cleanUpOnBundleCompletion) continue;
    const bundles = schedule.bundles.map((entry) => heldBundle(profile, entry.bundle));
    if (!bundles.length || !bundles.every((held) => held && bundleDone(tracker, held[1]))) continue;
    let quests = 0;
    for (const [bundleItemId, bundleItem] of bundles) {
      for (const questItemId of bundleItem.attributes.grantedquestinstanceids ?? []) {
        if (!profile.items[questItemId]) continue;
        tracker.removeItem(questItemId);
        quests += 1;
      }
      tracker.removeItem(bundleItemId);
    }
    tracker.removeItem(scheduleItemId);
    profile.coreCleanedUpSchedules = [...new Set([...(profile.coreCleanedUpSchedules ?? []), scheduleId])];
    log("Battle Royale", `${session.accountId} completed ${scheduleId}: the schedule, its ${bundles.length === 1 ? "bundle" : `${bundles.length} bundles`} and ${quests} challenges are cleaned up`);
  }
}

// A bundle's quest done (athena.js completeQuest): the bundle counts it, and gives its CompletionRewards the time the
// count reaches its CompletionThreshold. giveReward pays a reward (profiles/seasons.js). From 5.0 (CL-4214610) a bundle's
// rewards come in steps (BundleCompletionRewards, athena.json completionSteps): each step pays the time the count
// reaches its count, and a count of -1 when every quest of the bundle is done. A Season 5 week gives a weekly challenge
// token (Token:AthenaBattlePass_WeeklyChallenge_Token) for each challenge, 5,000 season XP at four, and at all seven the
// weekly bundle token (Token:AthenaBattlePass_WeeklyBundle_Token) the Road Trip challenges count
// (Quest_BR_S5_Cumulative_CollectTokens_01 to _07, one to seven weeks done).
export function countBundleQuest(session, questItemId, giveReward) {
  const tracker = session.profile("athena");
  const bundleItemId = tracker.profile.items[questItemId]?.attributes.challenge_bundle_id;
  const bundleItem = bundleItemId && tracker.profile.items[bundleItemId];
  if (!bundleItem) return [];
  const bundle = athenaChallengeBundles()[idOf(bundleItem.templateId)];
  const done = (bundleItem.attributes.grantedquestinstanceids ?? [])
    .filter((id) => ["Completed", "Claimed"].includes(tracker.profile.items[id]?.attributes.quest_state)).length;
  const before = bundleItem.attributes.num_quests_completed ?? 0;
  if (done === before) return [];
  tracker.setItemAttribute(bundleItemId, "num_quests_completed", done);
  tracker.setItemAttribute(bundleItemId, "num_progress_quests_completed", done);
  const bundleId = idOf(bundleItem.templateId);
  if (bundle?.completionSteps) {
    const total = bundle.quests.length;
    const reached = bundle.completionSteps.filter(({ count }) => (count < 0 ? before < total && done >= total : before < count && done >= count));
    if (reached.length) log("Battle Royale", `${session.accountId} completed ${done} of ${bundleId}'s challenges`);
    return giveBundleRewards(session, bundleId, reached.flatMap(({ rewards }) => rewards), giveReward);
  }
  if (!bundle || before >= bundle.completionThreshold || done < bundle.completionThreshold) return [];
  log("Battle Royale", `${session.accountId} completed ${bundle.completionThreshold} of ${bundleId}'s challenges`);
  return giveBundleRewards(session, bundleId, bundle.completionRewards, giveReward);
}

// A bundle's rewards given, the ones that name a gift box (FAthenaRewardItemReference's GiftBoxToUse, athena.json's
// giftBox) shown in it. 6.02's (CL-4461277) files name GB_ChallengeComplete for the Ghost Portal of the Skull Trooper
// Challenges and Tomatohead's Crown, for Calamity's and Dire's rewards and for each Season 6 week's season XP at four
// challenges (the weeks' tokens, hidden rewards, name none); its header, ItemReceivedChallengeCompleteHeader, reads "You
// have received a reward for completing the {Bundle Name} {Number}Challenge" from the bundle the box's param
// HeaderTemplateId names (the bundle definition's ShortName and ShortNameNumber: "Skull Trooper", "Week" and "1"), so
// the box carries its bundle's template id there. Season XP and Battle Stars are no item: the box lists the resource, as
// the promise box does its Battle Stars. A reward that gave nothing new (a cosmetic already owned) isn't listed, and a
// box with nothing to list isn't sent. Only a build whose data names the box sends one: overlays made before the
// extractor kept it (6.00's and earlier) give their bundles' rewards without one, as before.
function giveBundleRewards(session, bundleId, rewards, giveReward) {
  const given = [];
  const boxes = new Map();
  for (const reward of rewards) {
    const loot = giveReward(session, reward);
    given.push(...loot);
    if (!reward.giftBox) continue;
    const shown = loot.length || typeOf(reward.templateId) !== "accountresource" ? loot
      : [{ profileId: "athena", itemId: reward.templateId, templateId: reward.templateId, quantity: reward.quantity }];
    boxes.set(reward.giftBox, [...(boxes.get(reward.giftBox) ?? []), ...shown]);
  }
  for (const [templateId, loot] of boxes) giveGiftBox(session, templateId, loot, { HeaderTemplateId: `ChallengeBundle:${bundleId}` });
  // A reward an original owner's style waits for (the Ghost Portal's purple, Core-Backend #335) comes with that style.
  settleOriginalOwnerStyles(session);
  return given;
}


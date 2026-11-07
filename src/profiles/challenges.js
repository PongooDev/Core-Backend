import crypto from "node:crypto";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaSeason, getAthenaQuest } from "../gamedata/athena.js";
import { log } from "../log.js";
import { seasonHistoryStart, seasonMoment } from "../store/itemshop.js";

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
export const brokenChallenges = [
  { quest: "quest_br_watch_replay", title: "Watch a Match Replay", issue: "Core-Backend #269", url: "https://github.com/PongooDev/Core-Backend/issues/269",
    builds: ["4039451", "4053532"], reason: "Its objective is tied to the placeholder stat revive_athena_player and no client code reports a watched replay." },
  { quest: "quest_br_visit_scavengerhunt_stormcircles", title: "Visit the center of different Storm Circles in a single match", issue: "CoreV2 #299",
    url: "https://github.com/PongooDev/CoreV2/issues/299", builds: ["4039451", "4053532"],
    reason: "Its objective uses the borrowed stat visit_location_animal_building_crab and the item it asks for does not exist in the build." }
];
export const completeBrokenChallenges = (settingsValue = settingsProvider()) => settingsValue?.completeBrokenChallenges === true;
// The list entry for a challenge on a build, when it is one of the broken ones there.
export const brokenChallengeOf = (questId, build) => brokenChallenges.find((entry) => entry.quest === String(questId).toLowerCase() && entry.builds.includes(String(build)));

const bySeasonDays = (entry) => entry.unlockType === "DaysSinceEventStart";
const isWeekly = (schedule) => schedule.bundles.some(bySeasonDays);
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

function grantBundle(session, scheduleItemId, bundleId, athena) {
  const tracker = session.profile("athena");
  const bundle = athenaChallengeBundles()[bundleId];
  if (!bundle) return null;
  const bundleItemId = crypto.randomUUID();
  const questIds = [];
  for (const { quest, grantWithBundle } of bundle.quests) {
    if (!grantWithBundle || !getAthenaQuest(quest)) continue;
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
  for (const { quest, grantWithBundle } of bundle.quests) {
    if (!grantWithBundle || heldQuests.has(quest) || !getAthenaQuest(quest)) continue;
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
      const open = isWeekly(schedule) ? weekOpen.get(entry.bundle) === true : !bySeasonDays(entry);
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

// A bundle's quest done (athena.js completeQuest): the bundle counts it, and gives its CompletionRewards the time the
// count reaches its CompletionThreshold. giveReward pays a reward (profiles/seasons.js).
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
  if (!bundle || before >= bundle.completionThreshold || done < bundle.completionThreshold) return [];
  log("Battle Royale", `${session.accountId} completed ${bundle.completionThreshold} of ${idOf(bundleItem.templateId)}'s challenges`);
  return bundle.completionRewards.flatMap((reward) => giveReward(session, reward));
}


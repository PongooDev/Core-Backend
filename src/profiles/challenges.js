import crypto from "node:crypto";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaSeason, getAthenaQuest } from "../gamedata/athena.js";
import { log } from "../log.js";
import { seasonHistoryStart, seasonMoment } from "../store/itemshop.js";

// Season 3's challenges (3.0, CL-3901517): the Battle Pass's weekly challenges and the tier challenges, in challenge
// bundles (tools/extractor: athena.json challengeSchedules, challengeBundles). AthenaSeason3's tier rewards grant the
// schedules: ChallengeBundleSchedule:Season3_Challenge_Schedule with the Battle Pass (tier 1), Season3_Tier_2_Schedule
// at free tier 2 and Season3_Tier_100_Schedule at tier 100. A schedule (UFortChallengeBundleScheduleDefinition) unlocks
// its bundles by its entries' UnlockType: OnScheduleGranted at once, DaysSinceEventStart (Week 2 to 9, 7 to 56 days)
// once that many days of the season have passed. A bundle (UFortChallengeBundleItemDefinition) brings its quests
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
// replay's day 1, so the challenges tab's "unlocks in" countdowns read as the replay's. A bundle once given stays when the
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
// calendar's now less SeasonBegin), so without one every week read "Unlocks in" nothing. It is the replay's day 1, as
// unlock_epoch is: Season 3 began on 22 February 2018 and its weeks unlocked on the Thursdays after (Week 2 on 1 March
// to Week 9 on 19 April, 3.0's Season3_Challenge_Schedule's 7 to 56 days), so on the replay each week shows the day it
// came out. Null for a build without challenge schedules.
export const challengeSeasonBegin = (now = new Date()) => (Object.keys(athenaChallengeSchedules()).length ? replayDays(now).epoch : null);

// The admin panel's "Unlock all weekly challenges now" (settings challengesAllUnlocked, Core-Backend #207): every week of
// the schedules a player holds is given at once, whatever the replay's day.
let settingsProvider = () => undefined;
export function configureChallenges(provider) {
  settingsProvider = typeof provider === "function" ? provider : () => provider;
}
export const challengesAllUnlocked = (settingsValue = settingsProvider()) => settingsValue?.challengesAllUnlocked === true;

const unlocked = (entry, days) => entry.unlockType !== "DaysSinceEventStart" || days >= entry.unlockValue || challengesAllUnlocked();

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

// Gives the schedules' bundles that have unlocked, and keeps their unlock_epoch on the replay's day 1.
export function settleChallengeSchedules(session, athena, now = new Date()) {
  const schedules = athenaChallengeSchedules();
  const tracker = session.profile("athena");
  for (const [scheduleItemId, item] of heldOf(tracker.profile, "challengebundleschedule")) {
    const schedule = schedules[idOf(item.templateId)];
    if (!schedule) continue;
    const { days, epoch } = replayDays(now);
    if (item.attributes.unlock_epoch !== epoch) tracker.setItemAttribute(scheduleItemId, "unlock_epoch", epoch);
    const granted = [...(item.attributes.granted_bundles ?? [])];
    for (const entry of schedule.bundles) {
      if (!unlocked(entry, days) || heldBundle(tracker.profile, entry.bundle)) continue;
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


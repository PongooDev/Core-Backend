import { currentBuild } from "../builds/context.js";
import { getQuest } from "../gamedata/quests.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows, fourteenDaysSummerCalendarEvent } from "./datedflags.js";
import { currentEventsConfig, ltm14DaysOfSummer, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// The 14 Days of Summer (9.30, CL-7095426), Content Update v9.30's event: "Celebrate a fortnight of summer fun with
// Fortnite" (Battle Royale), "Complete a new quest every day to help Homebase host a hot summer party! ... The fun begins on
// June 25, 9 AM Eastern Time" (Save the World). Update v9.30's build already holds all of it; Epic turned it on from the
// calendar on 25 June.
// - Battle Royale's challenges: Athena/Items/ChallengeBundleSchedules/LTM/Schedule_14DaysOfSummer ("14 Days Of Summer
//   Challenges", ChallengeCategory.Event, CalendarEventTag EventFlag.LTM_14DaysOfSummer, CalendarEventName
//   CalendarEvent_Season9_14DaysOfSummer, CleanUpOnBundleCompletion), whose one bundle, QuestBundle_14DaysOfSummer ("Come
//   back each day for new challenges!"), gives Quest_BR_FDS_Dance_BeachParties with it and the other thirteen
//   DaysFromEventStart 1 to 13, and the Banana Smoothie back bling (BID_303_BananaSmoothie) for all fourteen. The schedule
//   is given at the quest login while the flag is served (profiles/athena.js settleEventSchedules), each later challenge at
//   the first quest login on or after its day (profiles/challenges.js, events/fourteendays.js eventDaysOf).
// - Each day's unvaulted weapon (the Fortnite Wiki: "A weapon was unvaulted for 24 hours only"): Balance/
//   ItemsForEventMapping names, for EventFlag.Unvaulting.Day1 to Day14, the weapons the loot takes while the flag is active
//   (Day 1 the Light Machine Gun, 2 the Quad Launcher, 3 the Burst Assault Rifle ... 14 the Suppressed Assault Rifle, the
//   wiki's order), so the calendar serves each flag on its day.
// - Its modes, a large and a small team mode a day: events/ltms.js (summerDay).
// - Save the World's: the Quests/Events/Summer quests SummerQuest_2019_*: fourteen dailies paying Summer Tickets (Fetch
//   Water, Search Ice, Kill Melee, ... Light Fireworks, the notes' "Light'em Up" for Stars and Stripes Jonesy), and
//   SummerQuest_2019_Complete_All, done by all fourteen, for the Boom Bow (SID_Sniper_ExplosiveBow_SR_Ore_T01: "Complete
//   all 14 days to unlock a new weapon"). Nothing in 9.30's data grants them (Epic's servers did): Complete_All is given at
//   the start, and the dailies one a day in Complete_All's order of its objectives (🟡 the order Epic used isn't recorded
//   anywhere else; it puts Light Fireworks on day 10, 4 July).
// The calendar serves the flags on their dates (events/datedflags.js fourteenDaysSummer), the admin's times, or off, and
// the switch serves them always or never (events/season4flags.js).
export const fourteenDaysSummerEvent = datedEvent("fourteenDaysSummer");
export const fourteenDaysSummerBuild = 7095426;
const dayMs = 24 * 60 * 60 * 1000;

export function fourteenDaysSummerStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(fourteenDaysSummerEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(fourteenDaysSummerEvent, datedSettings(config).fourteenDaysSummer, nowMs,
    seasonMoment(now, null, fourteenDaysSummerEvent.season).getTime());
  return datedParts(windows, nowMs, fourteenDaysSummerEvent.parts, new Set([...off, ...on]));
}

// The flags served now by the event's dates (none outside them), for the quest login's event schedules.
export const fourteenDaysSummerFlagsNow = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  (fourteenDaysSummerStates(now, changelist, config)[0]?.events ?? []).map(({ eventType }) => eventType);

// How many whole days the event has run: from its first step's start (25 June 2019, 13:00 UTC, on Season 9's replay; the
// admin's own start in the custom mode), null before it or when nothing serves the flag. While the admin's switch serves
// the flag it is on for good, so every day has come.
export function fourteenDaysSummerDay(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(fourteenDaysSummerEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn()) return null;
  const { off, on } = season4Overrides(changelist, config);
  if (off.includes(ltm14DaysOfSummer)) return null;
  if (on.includes(ltm14DaysOfSummer)) return Infinity;
  if (!fourteenDaysSummerFlagsNow(now, changelist, config).includes(ltm14DaysOfSummer)) return null;
  const setting = datedSettings(config).fourteenDaysSummer;
  const [first] = fourteenDaysSummerEvent.steps;
  const start = setting.mode === "custom"
    ? Date.parse(setting.schedule.find(({ step }) => step === first.id)?.startAt ?? "")
    : null;
  const days = start === null
    ? Math.floor((seasonMoment(now, null, fourteenDaysSummerEvent.season).getTime() - first.start) / dayMs)
    : Math.floor((now.getTime() - start) / dayMs);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export const summerCompleteAllQuest = "summerquest_2019_complete_all";

// Save the World's quests for the event's day: Complete_All and the dailies of the days so far, in its objectives' order.
export function fourteenDaysSummerQuests(now = new Date(), changelist = currentBuild()) {
  const day = fourteenDaysSummerDay(now, changelist);
  const all = getQuest(summerCompleteAllQuest);
  if (day === null || !all) return [];
  const dailies = (all.objectives ?? []).map(({ item }) => String(item ?? "").replace(/^quest:/i, "").toLowerCase())
    .filter((questId) => questId && getQuest(questId));
  return [summerCompleteAllQuest, ...dailies.slice(0, Math.min(dailies.length, day + 1))];
}

export { fourteenDaysSummerCalendarEvent };

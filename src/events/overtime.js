import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows, overtimeCalendarEvent } from "./datedflags.js";
import { currentEventsConfig, lteS7Overtime, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// The Overtime Challenges, Share the Love's (7.40, CL-5046157). Update v7.40: "Everyone who completes 13 free Overtime
// Challenges by February 27 will receive the upcoming Season 8 Battle Pass for FREE!"; the Fortnite Wiki's Overtime
// Challenges: "available from February 14th 2019 to February 28th 2019", rewarding "extra styles for Season 7 Battle Pass
// Outfits, the Valentine Wrap, the True Form Loading Screen, the Vines Contrail and the Season 7 Loading Screen".
// 7.40's paks have them as Athena/Items/ChallengeBundleSchedules/Season7/Season7_OT_Schedule (CategoryID S7_Overtime,
// EventName EventFlag.LTE_S7_OverTime, CalendarEventName CalendarEvent_Season7_OverTime, GiftBoxToUseOnBundleUnlock
// GB_MakeGoodAthena, "Overtime Challenges"), whose one bundle, QuestBundle_S7_Overtime (VisualStyle FreePassWeekly, its
// OverrideRewardItem Athena_FreeBattlePassToken, "Season 8 Battle Pass"), gives with it Quest_BR_OT_CompleteChallenges (13
// of the free ones: the token) and the first free four, then three or four more DaysFromEventStart 3, 6 and 9 (Visit
// different Named Locations, Search a Supply Drop ... Play matches of Driftin' with a friend, Outlast 75 opponents), the
// Battle Pass's three two-stage ones (tiers 47, 71 and 87, then 5, 10 and 15 free ones: Powder's, Trog's and Onesie's
// styles; RequiresBattlePass), and HomebaseBannerIcon:BRS7Overtime for 13 (BundleCompletionRewards). The schedule is given
// at the quest login while its flag is served (profiles/athena.js settleEventSchedules), its later challenges at the first
// quest login on or after their day (profiles/challenges.js, events/fourteendays.js eventDaysOf), and the calendar serves
// the flag and the bundle's calendar event on their dates (events/datedflags.js overtime), or the admin's times, or off;
// the switch serves the flag always or never (events/season4flags.js).
// 🟡 What Epic's service did with Athena_FreeBattlePassToken (the Season 8 pass, given at Season 8's start) isn't in the
// client; Core keeps the token on the account, as the quest gives it, for a Season 8 build to read.
export const overtimeEvent = datedEvent("overtime");
export const overtimeBuild = 5046157;
const dayMs = 24 * 60 * 60 * 1000;

// The challenges' calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on: on 7.40 with the seasonal events on, in the Automatic mode. A flag the admin switched on is served
// always (season4Overrides) and one switched off never, so neither is scheduled here.
export function overtimeStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(overtimeEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(overtimeEvent, datedSettings(config).overtime, nowMs, seasonMoment(now, null, overtimeEvent.season).getTime());
  return datedParts(windows, nowMs, overtimeEvent.parts, new Set([...off, ...on]));
}

// The flags served now by the challenges' dates (none outside them), for the quest login's event schedules.
export const overtimeFlagsNow = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  (overtimeStates(now, changelist, config)[0]?.events ?? []).map(({ eventType }) => eventType);

// How many whole days the challenges have run, for those that unlock DaysFromEventStart: from their step's start (14
// February 2019, 00:00 UTC, on Season 7's replay; the admin's own start in the custom mode), null before it or when nothing
// serves the flag. While the admin's switch serves the flag it is on for good, so every day has come.
export function overtimeDay(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(overtimeEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn()) return null;
  const { off, on } = season4Overrides(changelist, config);
  if (off.includes(lteS7Overtime)) return null;
  if (on.includes(lteS7Overtime)) return Infinity;
  if (!overtimeFlagsNow(now, changelist, config).includes(lteS7Overtime)) return null;
  const setting = datedSettings(config).overtime;
  const [first] = overtimeEvent.steps;
  const start = setting.mode === "custom"
    ? Date.parse(setting.schedule.find(({ step }) => step === first.id)?.startAt ?? "")
    : null;
  const days = start === null
    ? Math.floor((seasonMoment(now, null, 7).getTime() - first.start) / dayMs)
    : Math.floor((now.getTime() - start) / dayMs);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export { overtimeCalendarEvent };

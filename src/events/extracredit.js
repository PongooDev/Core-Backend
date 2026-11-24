import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows, extraCreditCalendarEvent } from "./datedflags.js";
import { currentEventsConfig, lteS8ExtraCredit, seasonalEventsOn } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

// Season 8's Overtime Challenges (8.51, CL-6165369; code-named ExtraCredit). The Fortnite Wiki's Overtime Challenges:
// "available from May 3rd 2019 to May 8th 2019 ... rewarded players with extra styles for Season 8 Battle Pass Outfits and
// the Season 8 Loading Screen". 8.50's and 8.51's paks have them as
// Athena/Items/ChallengeBundleSchedules/Season8/Season8_ExtraCredit_Schedule ("Overtime Challenges", CategoryTag
// ChallengeCategory.Event, CalendarEventName CalendarEvent_Season8_ExtraCredit, GiftBox GB_MakeGoodAthena), which names no
// flag of its own: its one bundle, QuestBundle_S8_ExtraCredit, does (CalendarEventTag EventFlag.LTE_S8_ExtraCredit), so the
// extractor gives the schedule its bundle's flag (tools/extractor). The bundle gives with it "Collect Coins in Featured
// Creative Islands" and "Place Top 10 in Squads with a friend", two more on DaysFromEventStart 2 (damage, top 15 in duos
// with a friend) and 4 (outlast, top 25 in solo), the Battle Pass's three two-stage ones (tiers 23, 71 and 87, then 2, 4
// and 6 free ones: Sidewinder's, Ember's and Master Key's styles; RequiresBattlePass), and LSID_119_VolcanoKey for 6
// (BundleCompletionRewards). Served on 8.51 only: Season 8's replay reaches the challenges after 8.51's day (1 May), so
// 8.50 never had them. The schedule is given at the quest login while its flag is served (profiles/athena.js
// settleEventSchedules), its later challenges at the first quest login on or after their day (profiles/challenges.js,
// events/fourteendays.js eventDaysOf), and the calendar serves the flag and the schedule's calendar event on their dates
// (events/datedflags.js extraCredit), or the admin's times, or off; the switch serves the flag always or never
// (events/season4flags.js).
export const extraCreditEvent = datedEvent("extraCredit");
export const extraCreditBuild = 6165369;
const dayMs = 24 * 60 * 60 * 1000;

// The challenges' calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on: on 8.51 with the seasonal events on, in the Automatic mode. A flag the admin switched on is served
// always (season4Overrides) and one switched off never, so neither is scheduled here.
export function extraCreditStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(extraCreditEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(extraCreditEvent, datedSettings(config).extraCredit, nowMs,
    seasonMoment(now, null, extraCreditEvent.season).getTime());
  return datedParts(windows, nowMs, extraCreditEvent.parts, new Set([...off, ...on]));
}

// The flags served now by the challenges' dates (none outside them), for the quest login's event schedules.
export const extraCreditFlagsNow = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  (extraCreditStates(now, changelist, config)[0]?.events ?? []).map(({ eventType }) => eventType);

// How many whole days the challenges have run, for those that unlock DaysFromEventStart: from their step's start (3 May
// 2019, 00:00 UTC, on Season 8's replay; the admin's own start in the custom mode), null before it or when nothing serves
// the flag. While the admin's switch serves the flag it is on for good, so every day has come.
export function extraCreditDay(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(extraCreditEvent.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn()) return null;
  const { off, on } = season4Overrides(changelist, config);
  if (off.includes(lteS8ExtraCredit)) return null;
  if (on.includes(lteS8ExtraCredit)) return Infinity;
  if (!extraCreditFlagsNow(now, changelist, config).includes(lteS8ExtraCredit)) return null;
  const setting = datedSettings(config).extraCredit;
  const [first] = extraCreditEvent.steps;
  const start = setting.mode === "custom"
    ? Date.parse(setting.schedule.find(({ step }) => step === first.id)?.startAt ?? "")
    : null;
  const days = start === null
    ? Math.floor((seasonMoment(now, null, 8).getTime() - first.start) / dayMs)
    : Math.floor((now.getTime() - start) / dayMs);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export { extraCreditCalendarEvent };

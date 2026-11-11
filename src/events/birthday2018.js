import { currentBuild } from "../builds/context.js";
import { getQuest } from "../gamedata/quests.js";
import { nextReplayOf, seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows } from "./datedflags.js";
import { anniversary2018BR, birthday2018, birthdayBattleBus, currentEventsConfig, eventsActiveUntil, isEventActive, seasonalEventsOn,
  supplyDropBDay } from "./events.js";
import { onBuild, season4Flag, season4Overrides } from "./season4flags.js";

export { birthday2018 };

// The Fortnite Birthday (5.10, CL-4225813 and CL-4240749; events.js birthday2018), Save the World's side (Update v5.10):
// "Celebrate #Fortnite1st with cake, loot, and a special in-game questline. Complete the questline to unlock Birthday
// Brigade Ramirez. While you're partying, find and eat birthday cakes to earn event tickets which can be spent on the
// limited time Birthday Llama", "New Fortnite Birthday quests! Find and eat Birthday Cakes to earn event tickets. Eliminate
// Cake Sploders to earn a Birthday Hero." The Fortnite Wiki's Fortnite 1st Birthday: 24 July to 7 August 2018.
//
// Its quests (Quests/Events/Anniversary2018), which nothing in 5.10's data grants (Epic's servers handed them out), granted
// at quest login while it runs:
// - AnniversaryQuest_2018_Kill_Cake_Sploders ("Sploding Husks": 50 sploders in successful missions): Birthday Brigade
//   Ramirez (HID_Commando_010_Bday_SR_T01, "Birthday Brigade Ramirez", a Legendary Sergeant);
// - AnniversaryQuest_2018_Complete_Cake_Repeatable (5 cakes in successful missions, a TransientQuest): 100 Road Trip
//   Tickets, granting itself again (its hidden reward).
export const birthdayQuests = ["anniversaryquest_2018_kill_cake_sploders", "anniversaryquest_2018_complete_cake_repeatable"];

// The Birthday Llama (CardPack_Event_2018_Anniversary, "Birthday Llama"): "Awards past event items from Llamas and Event
// Store, but not from Quest Rewards ... Cost: 1,000 Road Trip tickets" (store/catalog.js).
export const birthdayLlama = "CardPack:cardpack_event_2018_anniversary";
export const birthdayLlamaPrice = 1000;

// The requesting build's Birthday quests, when the event runs there.
export const birthdayEventQuests = () => (isEventActive(birthday2018) ? birthdayQuests.filter((questId) => getQuest(questId)) : []);

// The Birthday's calendar flags, and when the client is told they end (Core-Backend #312: the Birthday Challenges' time
// remaining counted down to the never-ending activeUntil, a huge number of days). The Fortnite Wiki's Fortnite 1st Birthday
// ran to 7 August 2018 (Update v5.20's day), so on Season 5's replay (store/itemshop.js seasonMoment) the event ends when
// the replay next stands at 7 August, as the other dated events' dates do; 🟡 the wiki gives days, not hours, so at midnight UTC.
export const birthdayFlags = [anniversary2018BR, birthdayBattleBus, supplyDropBDay];
export const birthdayEndedAt = Date.parse("2018-08-07T00:00:00.000Z");
export function birthdayActiveUntil(flag, now = new Date()) {
  if (!birthdayFlags.includes(flag) || !isEventActive(birthday2018)) return eventsActiveUntil;
  return nextReplayOf(birthdayEndedAt, now, null, 5).toISOString();
}

// The Birthday Challenges' timing from the admin panel (Event challenges, Core-Backend #316; events/datedflags.js): by
// default ("build") 5.10 serves Anniversary2018_BR itself, as above. On Epic's dates (24 July to 7 August on Season 5's
// replay, lap by lap) or the admin's own times the flag is served through the calendar in those windows only, with their
// end as activeUntil (the challenges tab's countdown), on 5.10 and 5.21 (both have Schedule_Birthday2018_BR); off, never.
// The schedule is given at the quest login while the flag is served (profiles/athena.js settleEventSchedules). The flag's
// switch (events/season4flags.js) still wins: on, always served; off, never. The Birthday's other two flags keep Save the
// World's Birthday running on 5.10 as before.
const birthdayChallenges = datedEvent("birthday");

// The flag's calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], as
// events/highstakes.js's: on 5.10 and 5.21 with the seasonal events on, in the Automatic mode.
export function birthdayChallengeStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(birthdayChallenges.flag);
  if (!entry || !onBuild(entry, changelist) || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const setting = datedSettings(config).birthday;
  if (setting.mode === "build") return [];
  const { off, on } = season4Overrides(changelist, config);
  const nowMs = now.getTime();
  const windows = datedWindows(birthdayChallenges, setting, nowMs, seasonMoment(now, null, 5).getTime());
  return datedParts(windows, nowMs, birthdayChallenges.parts, new Set([...off, ...on]));
}

// The Birthday Challenges' flag served now by those times (none outside them), for the quest login's event schedules.
export const birthdayChallengeFlagsNow = (now = new Date(), changelist = currentBuild()) =>
  (birthdayChallengeStates(now, changelist)[0]?.events ?? []).map(({ eventType }) => eventType);

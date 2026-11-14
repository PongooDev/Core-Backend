import { getItem } from "../gamedata/items.js";
import { foundersEditionOf } from "../profiles/founders.js";
import { nextReplayOf } from "../store/itemshop.js";
import { eventsActiveUntil, fortnitemares2018, isEventActive, ltmFortnitemares, ltmLilKevin } from "./events.js";

// 6.20's Fortnitemares (CL-4497486, events/events.js fortnitemares2018), Update v6.20: "All Founders will receive a pair of
// new Heroes when they log in during the first few weeks of Fortnitemares: Skull Ranger Ramirez, Brainiac Jonesy", and the
// Fortnite Wiki's Fortnitemares 2018: "Brainiac Jonesy and Skull Ranger Ramirez (Free to Founders)". Both are new in 6.20's
// data: Hero:HID_Commando_GunHeadshotHW_RS01_SR_T01 ("Skull Ranger Ramirez") and Hero:HID_Commando_007HW_RS01_SR_T01
// ("Brainiac Jonesy"), Legendary, tier I. Nothing in the files grants them (Epic's service did), so a founder (an account
// whose campaign profile holds a Founder's Pack token, profiles/founders.js) gets both at the quest login while the
// requesting build runs Fortnitemares, once: the profile notes it (coreFortnitemares2018FounderHeroes, Core's, never sent
// to a client), so a hero recycled later doesn't come back. 🟡 "The first few weeks" aren't dated: while 6.20 and 6.21 run
// the event.
export const founderHeroes2018 = ["Hero:hid_commando_gunheadshothw_rs01_sr_t01", "Hero:hid_commando_007hw_rs01_sr_t01"];

// The heroes the account is owed now (none once given, for a non-founder or off the event).
export function owedFounderHeroes(profile) {
  if (!isEventActive(fortnitemares2018) || profile.coreFortnitemares2018FounderHeroes || foundersEditionOf(profile) < 1) return [];
  return founderHeroes2018.filter((templateId) => getItem(templateId));
}

// Gives them through grant (profiles/progress.js grant, passed in: the quests' Acquire objectives see them) and notes it.
export function settleFounderHeroes2018(session, grant) {
  const { profile } = session.profile("profile0");
  const owed = owedFounderHeroes(profile);
  if (!owed.length) return [];
  for (const templateId of owed) grant(session, templateId, 1);
  session.profile("profile0").profile.coreFortnitemares2018FounderHeroes = true;
  return owed;
}

// When the Fortnitemares Challenges end (Core-Backend #345: the challenges tab's FORTNITEMARES CHALLENGES header read
// "2,912,126 Days", the count to the calendar's never-ending activeUntil). The header is the category's expiration date:
// UFortChallengeBundleCategoryInfo::GetExpirationDate (CL-4497486 0x2E24E10) takes the EventName of its schedule
// (Schedule_FortNitemares: EventFlag.LTM_Fortnitemares) and asks the seasonal event manager how long that event has left
// (0x119A6C0), which is the calendar's activeUntil for it. Epic's end: "Fortnitemares in Battle Royale ends on Sunday,
// November 4 at 1 PM Eastern Time" (Update v6.21's notes; Epic's tweet of 31 October: "Finish your Fortnitemares Challenges
// by then to unlock the Dark Engine Glider"), 4 November 2018 18:00 UTC. On Season 6's replay (store/itemshop.js
// seasonMoment, its day 1 27 September) the flag ends when the replay next stands at that moment, as the Birthday
// Challenges' end (events/birthday2018.js). Only while the build runs the event (6.20 and 6.21, events/events.js); a flag
// the admin panel switches on outside it keeps the never-ending end.
export const fortnitemares2018EndedAt = Date.parse("2018-11-04T18:00:00.000Z");
export function fortnitemaresActiveUntil(flag, now = new Date()) {
  if (flag !== ltmFortnitemares || !isEventActive(fortnitemares2018)) return eventsActiveUntil;
  return nextReplayOf(fortnitemares2018EndedAt, now, null, 6).toISOString();
}

// When the Lil' Kev Challenges end (Core-Backend #358: on 6.30 the challenges tab's LIL' KEV CHALLENGES header read
// "2,912,125 Days", the count to the calendar's never-ending activeUntil, as Fortnitemares' did on #345). The header is the
// same GetExpirationDate of the category's schedule (Schedule_LTM_LilKevin: EventFlag.LTM_LilKevin), so the calendar's
// activeUntil for that flag. Epic's end, its tweets of 4 and 5 November 2018 (the Fortnite Wiki's Lil' Kev Challenges):
// "Complete the challenges before 1 PM ET, November 11 (6PM UTC) to earn the Lil' Kev Back Bling", 11 November 2018
// 18:00 UTC. On Season 6's replay the flag ends when the replay next stands at that moment, as the Fortnitemares
// Challenges' end. Only while the build runs the event (6.21 to 6.30, events/events.js); a flag the admin panel switches
// on outside it keeps the never-ending end.
export const lilKevinEndedAt = Date.parse("2018-11-11T18:00:00.000Z");
export function lilKevinActiveUntil(flag, now = new Date()) {
  if (flag !== ltmLilKevin || !isEventActive(fortnitemares2018)) return eventsActiveUntil;
  return nextReplayOf(lilKevinEndedAt, now, null, 6).toISOString();
}

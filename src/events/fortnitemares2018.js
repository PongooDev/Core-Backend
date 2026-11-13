import { getItem } from "../gamedata/items.js";
import { foundersEditionOf } from "../profiles/founders.js";
import { fortnitemares2018, isEventActive } from "./events.js";

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

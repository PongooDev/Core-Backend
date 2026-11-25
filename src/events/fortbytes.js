import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { season9FirstDay } from "./datedflags.js";
import { activeEventFlags, lobbySeason9 } from "./events.js";

// Season 9's Fortbytes (9.00, CL-6337466). Update v9.00 (9 May 2019): "Fortbytes are a series of 100 collectible computer
// chips available to Battle Pass owners ... On the first day of Season 9, there are 18 Fortbytes available to find. At least
// 1 new Fortbyte will be unlocked each day." 9.00's paks have them as
// Athena/Items/ChallengeBundleSchedules/Season9/Season9_Fortbyte_Schedule (ChallengeCategory.Event, EventName
// EventFlag.LobbySeason9), which AthenaSeason9's tier 1 Battle Pass rewards give, and its one bundle, QuestBundle_S9_Fortbyte:
// its 100 quests (Quest_BR_S9_Fortbyte_00 to _99, each a Token:athenafortbyte) come DaysFromEventStart, 18 on day 0, the
// rest on their day (42 on day 100, past the season's end: Epic's later hotfixes moved them, 9.00's paks don't), and the Neo
// Tubes contrail for all of them (BundleCompletionSteps). The event is the Season 9 lobby's flag, which Epic's calendar ran
// from the season's first day, so the days are those of Season 9's replay (events/datedflags.js season9FirstDay) while the
// build serves the flag (events/events.js lobbySeason9; never in the admin's Off mode). Each quest is given at the first
// quest login on or after its day (profiles/challenges.js, events/fourteendays.js eventDaysOf).
const dayMs = 24 * 60 * 60 * 1000;

export function fortbytesDay(now = new Date(), changelist = currentBuild()) {
  if (!activeEventFlags(changelist).includes(lobbySeason9)) return null;
  const days = Math.floor((seasonMoment(now, null, 9).getTime() - season9FirstDay) / dayMs);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

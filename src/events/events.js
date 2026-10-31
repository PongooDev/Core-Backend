import { AsyncLocalStorage } from "node:async_hooks";
import { currentBuild } from "../builds/context.js";

// The seasonal events Core runs. A build runs the event its own update shipped, for as long as it is played: Epic
// switched events on and off from its servers (its event flags and calendar), so which builds run one is Core's choice.
//
// Fortnitemares (Halloween 2017) shipped with 1.8 (CL-3724489) and ran through its patches 1.8.1 (CL-3729133) and
// 1.8.2 (CL-3741772), and 1.9 (CL-3757339), whose notes extend it to 29 November. 1.9.1 (CL-3775276) ended it. Its content waits for EventFlag.Fortnitemares, the only event flag 1.8's paks add (1.7.2's are
// EventFlag.FirstStorm and EventFlag.Horde): the front end's "View Event" button and the event's quest pages
// (HomeScreenNextQuest UpdateButtonBasedOnEventStatus: BorderQuestMapToggle shows when the quest manager's
// IsEventFlagActive("EventFlag.Fortnitemares") or the player holds ProtoEnableQuest).
export const fortnitemares = "EventFlag.Fortnitemares";

// The Mutant Storms (events/mutantstorms.js) came back with 1.9.1 (CL-3775276), whose notes end Fortnitemares and
// return them; their content waits for EventFlag.Vindertech, the flag 1.9.1's StormCategory mission alerts require.
// 1.10 (CL-3790078) keeps them (its notes change how their alerts appear, world/theaters.js) under another flag: its
// StormCategory rows require EventFlag.ActiveStorms, and no 1.10 data names EventFlag.Vindertech. So the event is
// named apart from its flags (mutantStorms), each build running it under the flag its own data asks for.
export const mutantStorms = "MutantStorms";

// Battle Royale's 50v50 (events/fiftyfifty.js), the limited-time playlist 1.10 (CL-3790078) shipped: its
// BR_Playlist_50v50 (AthenaCustomPlaylistEvent, PlaylistId 11) requires EventFlag.BR.Allow50v50, and its quest
// (Athena/Items/Quests/Events/Winter2017_50v50) is the event's. 1.9 and 1.9.1 have the playlist's code but no asset or
// quest, and their DefaultGame.ini turns the queue off (UFortGameInstance bBattleRoyaleFiftyFiftyQueueEnabled=false);
// 1.10's turns it on and leaves the rest to the calendar (UFortGlobals b50v50CalenderEventEnabled=true).
export const fiftyFifty = "EventFlag.BR.Allow50v50";

const events = [
  { name: fortnitemares, flag: fortnitemares, firstBuild: 3724489, lastBuild: 3757339 },
  { name: mutantStorms, flag: "EventFlag.Vindertech", firstBuild: 3775276, lastBuild: 3775276 },
  { name: mutantStorms, flag: "EventFlag.ActiveStorms", firstBuild: 3790078, lastBuild: 3790078 },
  { name: fiftyFifty, flag: fiftyFifty, firstBuild: 3790078, lastBuild: 3790078 }
];

const runsOn = (event, number) => number >= event.firstBuild && number <= event.lastBuild;

let eventsConfigProvider = null;

export function configureEvents(provider) {
  eventsConfigProvider = typeof provider === "function" ? provider : () => provider;
}

export function currentEventsConfig() {
  return (eventsConfigProvider ? eventsConfigProvider() : null) ?? { mode: "auto" };
}

// Whether the host runs the seasonal events (settings.seasonalEvents, the admin panel's Seasonal Events switch,
// Core-Backend #66), for everything a request does. Switched off, no build runs one: no event flags, quests, theater or
// event offers. Work that no request started runs them.
const eventsSetting = new AsyncLocalStorage();
export const seasonalEvents = (enabled) => (req, res, next) => eventsSetting.run(enabled(), next);

// The event flags the requesting build runs (none outside a request).
export function activeEventFlags(changelist = currentBuild()) {
  if (eventsSetting.getStore() === false) return [];
  const config = currentEventsConfig();
  if (config?.mode === "off") return [];
  if (config?.mode === "force_fortnitemares") return [fortnitemares];
  if (config?.mode === "force_mutantstorms") {
    const num = Number(changelist);
    if (num >= 3790078) return ["EventFlag.ActiveStorms"];
    if (Number.isInteger(num)) return ["EventFlag.Vindertech"];
    return ["EventFlag.Vindertech", "EventFlag.ActiveStorms"];
  }
  if (config?.mode === "custom") {
    return Array.isArray(config.customFlags) ? config.customFlags : [];
  }
  const number = Number(changelist);
  if (!Number.isInteger(number)) return [];
  return events.filter((event) => runsOn(event, number)).map((event) => event.flag);
}

// Whether the requesting build runs an event, by its name (fortnitemares, mutantStorms) or by an event flag (a mission
// alert row's RequiredEventFlag).
export function isEventActive(nameOrFlag, changelist = currentBuild()) {
  if (eventsSetting.getStore() === false) return false;
  const config = currentEventsConfig();
  if (config?.mode === "off") return false;
  if (config?.mode === "force_fortnitemares") {
    return nameOrFlag === fortnitemares || nameOrFlag === "EventFlag.Fortnitemares";
  }
  if (config?.mode === "force_mutantstorms") {
    return nameOrFlag === mutantStorms || nameOrFlag === "EventFlag.Vindertech" || nameOrFlag === "EventFlag.ActiveStorms";
  }
  if (config?.mode === "custom") {
    const flags = Array.isArray(config.customFlags) ? config.customFlags : [];
    if (flags.includes(nameOrFlag)) return true;
    if (nameOrFlag === fortnitemares && flags.includes(fortnitemares)) return true;
    if (nameOrFlag === mutantStorms && (flags.includes("EventFlag.Vindertech") || flags.includes("EventFlag.ActiveStorms"))) return true;
    return false;
  }
  const flags = activeEventFlags(changelist);
  return events.some((event) => flags.includes(event.flag) && runsOn(event, Number(changelist))
    && (event.name === nameOrFlag || event.flag === nameOrFlag));
}

// Whether the requesting build comes after an event's last build: the event is over there for good (1.9.1's notes:
// "The Fortnitemares event has ended"), whatever the Seasonal Events switch says.
export function hasEventEnded(name, changelist = currentBuild()) {
  const config = currentEventsConfig();
  if (config?.mode === "force_fortnitemares" && (name === fortnitemares || name === "EventFlag.Fortnitemares")) return false;
  const number = Number(changelist);
  const runs = events.filter((candidate) => candidate.name === name || candidate.flag === name);
  return runs.length > 0 && Number.isInteger(number) && number > Math.max(...runs.map((event) => event.lastBuild));
}

// When the client is told an event ends: never, as far as Core goes (FDateTime's largest day).
export const eventsActiveUntil = "9999-12-31T23:59:59.999Z";

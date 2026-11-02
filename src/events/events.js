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
// 1.10's turns it on and leaves the rest to the calendar (UFortGlobals b50v50CalenderEventEnabled=true). 1.11
// (CL-3807424) keeps its quest, and its notes fix 50v50's screen ("Improved visibility of the number of players remaining
// on each team in 50v50 mode"), so it runs there too.
export const fiftyFifty = "EventFlag.BR.Allow50v50";

// Survive the Holidays (events/winter2017.js), Save the World's winter event 1.11 (CL-3807424) shipped: "The Fortnite
// Guide to Holiday Survival is here!" Its content waits for EventFlag.Winter2017, the flag 1.11's MiniBossCategory and
// Survival3Day/7DayCategory mission alerts require. Its notes end the Mutant Storms ("With the end of the Mutant Storms
// event, every 1,000 unspent Storm Tickets will be converted to a storm llama", events/stormllamas.js) and keep storms on
// the map without tickets ("Note that while Mutant Storms are also present on the map to provide evolution materials,
// these do not reward event tickets", "You can now complete up to four Mutant Storms per day"): 1.11's StormLowCategory
// rows (quota 4) require EventFlag.PassiveStorms, its StormCategory rows still EventFlag.ActiveStorms, which it doesn't
// run.
export const winter2017 = "EventFlag.Winter2017";
export const passiveStorms = "EventFlag.PassiveStorms";

// Battle Royale's winter lobby (1.11, CL-3807424; Core-Backend #145: "Battle royal does not have the winter background").
// 1.11's LobbyBG_Winter (Items/Events/Shared, LobbyBackgroundTakeoverEvent) puts the lobby in Frontend_Lobby_Winter while
// its RequiredEventTag, EventFlag.LobbyWinterDecor, is on, as LobbyBG_Halloween did with EventFlag.LobbyHalloweenDecor;
// the seasonal event manager takes its flags from the calendar's client-events state (services/fortnite/calendar.js).
// The holiday Battle Bus (BR_Decor_WinterBus's EventFlag.WinterBattleBus) flew all through Season 2's Winterfest, as
// players' 1.11 matches show (CoreV2 #176); the gameserver takes its flags from the same calendar. Its supply drops came
// down gift-wrapped too (BR_Decor_SupplyDropGift's EventFlag.SupplyDropGift, CoreV2 #176). The last winter event,
// BR_Winter_CandyCaneGuns' EventFlag.BR.CandyCaneGuns, changes the match's weapons and is left off (🟡: nothing found
// says when Epic ran it).
export const lobbyWinterDecor = "EventFlag.LobbyWinterDecor";
export const winterBattleBus = "EventFlag.WinterBattleBus";
export const supplyDropGift = "EventFlag.SupplyDropGift";

// 2.1 (CL-3825894, 10 January 2018) keeps all of 1.11's events: its data has the same mission alerts, quests, event
// items and playlists, and its notes end none of them. The next update ended them: 2.2.0's notes end the Battle Royale
// Winter event on 18 January (and remove "the winter theme from the pre-game lobby"), and "The Save the World winter
// event has been extended until January 24".
//
// 2.2 (CL-3841827, 18 January 2018) so runs Save the World's half: Survive the Holidays (its MiniBoss and Survival
// alerts still require EventFlag.Winter2017, its Event Store and Holiday Survival Llamas are 1.11's) and the ticketless
// storms (its StormLowCategory rows still require EventFlag.PassiveStorms), but not Battle Royale's: no winter lobby,
// holiday Battle Bus or gift-wrapped supply drops ("Thank you all for being a part of our 2017 Battle Royale Winter
// event!"). 50v50 stays: 2.2's BR_Playlist_50v50 still waits for EventFlag.BR.Allow50v50, its quest
// (AthenaEvent_FiftyFifty_PlayMatches) is still there, and its notes end only the winter event.
// The Save the World home screen's winter "View Event" tile is this event's: 2.2's HomeScreenNextQuest
// (UpdateButtonBasedOnEventStatus) shows BorderQuestMapToggle while IsEventFlagActive("EventFlag.Winter2017") or the
// player holds ProtoEnableQuest, and the button opens Winter2017_QuestMapWidget (the event's quest map, with
// WinterEvent2017QuestMapTile's WinterQuest_2017 side quests). Survive the Holidays outlived 2.2: Epic's 2.3.0 notes
// (24 January 2018) say "The Save the World Winter event ends on January 25", so 2.2 showed the tile all its life.
//
// 2.3 (CL-3847564, 25 January 2018) ends Survive the Holidays: "The Save the World Winter event ends on January 25" and
// "As the snow from Survive the Holidays melts, the Mutant Storms return!" Its data is 2.2's (the same mission alert
// rows, quests, llamas and playlists: what changed was Epic's servers'), so the return is the storms its StormCategory
// rows wait for, EventFlag.ActiveStorms (1.10's flag), under an event of its own, mutantStorms2018
// (events/mutantstorms.js): "Hydraulic Weapons and Storm Zone Heroes have returned, and are available in the Storm
// Llamas", the first storms' Hydraulic quests and Storm Llama rather than 1.9.1's Vindertech ones. Survive the Holidays
// and its ticketless storms (EventFlag.PassiveStorms, "storms on the map without tickets" while no Mutant Storms ran)
// stop at 2.2 (🟡: 2.3's notes name no ticketless storms), so 2.3's Snowflake Tickets become Holiday Survival Llamas
// (events/winter2017.js). 50v50 stays: 2.3's BR_Playlist_50v50 and its quest are 2.2's, and its notes end no playlist.
export const mutantStorms2018 = "MutantStorms2018";

const events = [
  { name: fortnitemares, flag: fortnitemares, firstBuild: 3724489, lastBuild: 3757339 },
  { name: mutantStorms, flag: "EventFlag.Vindertech", firstBuild: 3775276, lastBuild: 3775276 },
  { name: mutantStorms, flag: "EventFlag.ActiveStorms", firstBuild: 3790078, lastBuild: 3790078 },
  { name: mutantStorms2018, flag: "EventFlag.ActiveStorms", firstBuild: 3847564, lastBuild: 3847564 },
  { name: fiftyFifty, flag: fiftyFifty, firstBuild: 3790078, lastBuild: 3847564 },
  { name: winter2017, flag: winter2017, firstBuild: 3807424, lastBuild: 3841827 },
  { name: passiveStorms, flag: passiveStorms, firstBuild: 3807424, lastBuild: 3841827 },
  { name: lobbyWinterDecor, flag: lobbyWinterDecor, firstBuild: 3807424, lastBuild: 3825894 },
  { name: winterBattleBus, flag: winterBattleBus, firstBuild: 3807424, lastBuild: 3825894 },
  { name: supplyDropGift, flag: supplyDropGift, firstBuild: 3807424, lastBuild: 3825894 }
];

const runsOn = (event, number) => number >= event.firstBuild && number <= event.lastBuild;

// The storms a build runs when the admin panel forces the Mutant Storms (or a custom EventFlag.ActiveStorms): 2.3's
// return (mutantStorms2018: the Hydraulic quests, the Storm Llama, the Mini-Bosses and the Event Store) from 2.3
// (CL-3847564), whose data has no Vindertech quests or llama, else 1.9.1's Vindertech storms (mutantStorms).
const storms2018Build = 3847564;
const forcedStorms = (changelist) => (Number(changelist) >= storms2018Build ? mutantStorms2018 : mutantStorms);

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
  // Forcing a Save the World event leaves the build's Battle Royale 50v50 running (1.10 to 2.3).
  const fiftyFiftyFlags = Number.isInteger(Number(changelist)) && runsOn(events.find((event) => event.name === fiftyFifty), Number(changelist))
    ? [fiftyFifty] : [];
  if (config?.mode === "force_fortnitemares") return [fortnitemares, ...fiftyFiftyFlags];
  if (config?.mode === "force_mutantstorms") {
    const num = Number(changelist);
    if (num >= 3790078) return ["EventFlag.ActiveStorms", ...fiftyFiftyFlags];
    if (Number.isInteger(num)) return ["EventFlag.Vindertech"];
    return ["EventFlag.Vindertech", "EventFlag.ActiveStorms"];
  }
  if (config?.mode === "force_winter2017") {
    return [winter2017, passiveStorms, lobbyWinterDecor, winterBattleBus, supplyDropGift, ...fiftyFiftyFlags];
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
  if (nameOrFlag === fiftyFifty && (config?.mode === "force_fortnitemares" || config?.mode === "force_mutantstorms" || config?.mode === "force_winter2017")) {
    return activeEventFlags(changelist).includes(fiftyFifty);
  }
  if (config?.mode === "force_fortnitemares") {
    return nameOrFlag === fortnitemares || nameOrFlag === "EventFlag.Fortnitemares";
  }
  if (config?.mode === "force_mutantstorms") {
    return nameOrFlag === forcedStorms(changelist) || nameOrFlag === "EventFlag.Vindertech" || nameOrFlag === "EventFlag.ActiveStorms";
  }
  if (config?.mode === "force_winter2017") {
    return nameOrFlag === winter2017 || nameOrFlag === "EventFlag.Winter2017"
      || nameOrFlag === passiveStorms || nameOrFlag === "EventFlag.PassiveStorms"
      || nameOrFlag === lobbyWinterDecor || nameOrFlag === "EventFlag.LobbyWinterDecor"
      || nameOrFlag === winterBattleBus || nameOrFlag === "EventFlag.WinterBattleBus"
      || nameOrFlag === supplyDropGift || nameOrFlag === "EventFlag.SupplyDropGift";
  }
  if (config?.mode === "custom") {
    const flags = Array.isArray(config.customFlags) ? config.customFlags : [];
    if (flags.includes(nameOrFlag)) return true;
    if (nameOrFlag === fortnitemares && flags.includes(fortnitemares)) return true;
    if (nameOrFlag === forcedStorms(changelist) && (flags.includes("EventFlag.Vindertech") || flags.includes("EventFlag.ActiveStorms"))) return true;
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
  if (config?.mode === "force_winter2017" && (name === winter2017 || name === "EventFlag.Winter2017")) return false;
  const number = Number(changelist);
  const runs = events.filter((candidate) => candidate.name === name || candidate.flag === name);
  return runs.length > 0 && Number.isInteger(number) && number > Math.max(...runs.map((event) => event.lastBuild));
}

// When the client is told an event ends: never, as far as Core goes (FDateTime's largest day).
export const eventsActiveUntil = "9999-12-31T23:59:59.999Z";

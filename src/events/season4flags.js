import { currentBuild } from "../builds/context.js";
import { currentEventsConfig } from "./events.js";
import { geodeBegin, geodeCountdown, geodeOver, riftGrowth } from "./rocketlaunch.js";

// Every event flag Season 4's paks hold (Core-Backend #296): the byte scans of every uasset, umap, uexp and ini of 4.0
// (CL-4039451), 4.1, 4.2, 4.4.2 and 4.5 (CL-4166199) that events/events.js lists build by build, grouped for the admin
// panel's Season 4 event flags. A flag's builds are the ones whose paks (or, for the mission alert flags, whose
// MissionAlerts rows: 4.0's, which 4.1 to 5.0 still play on) have it, so switching one on serves it to those builds only.
// 5.0's paks keep most of them (events/events.js), so the range runs to 5.0 where they do, and 5.10's (CL-4240749) keep
// every one 5.0's do, so those run to 5.10; 5.10 adds the Birthday's three and two of Battle Royale's map (below).
//
// The admin panel switches each one "on" or "off" over what the build serves by itself (events config
// season4Flags.overrides; absent: the build's own, events/events.js), in the Automatic mode. On, a flag is served with
// the build's other flags (the calendar's activeEvents, RequestEventFlags, ClientQuestLogin), active until never.
// The rocket's four (BP_GeodeScripting's and BP_Athena_Event_Components') aren't switched here: their watchers count to
// each event's activeUntil, so they are served by the launch time (events/rocketlaunch.js, the panel's Rocket Launch).
const b40 = 4039451;
const b42 = 4072250;
const b440 = 4117433;
const b450 = 4159770;
const b45 = 4166199;
const b500 = 4204761;
const b5100 = 4225813;
const b510 = 4240749;

const flag = (name, builds, description) => ({ flag: `EventFlag.${name}`, builds, description });

// Athena_OdditiesActors (streamed in by 4.5's Athena_Terrain): eight BP_Athena_CalendarEvent_PropHandler actors, each
// watching its PrecursorEventFlag (_Tell) and ExecutionEventFlag (_Event) with FortAsyncAction_CalendarEventWatcher once
// the match starts (AFortGameModeZone::OnHandleMatchHasStarted). _Tell: the prop shimmers (IsShimmerEnabled 1,
// P_Geode_Oddity_Shimmer_Loop and its sound), and when the event's TimeUntilEnd less the 5 s TelegraphDuration is
// between 5 s and an hour, it waits that long and plays the telegraph (RiftEventTelegraph). _Event: by EventType, the
// prop is rifted away (NewEnumerator1: DestroyOverlappingBuildingProps, then DestroyProp, P_Geode_Oddity_Leftovers) or
// rifted in (NewEnumerator0, the default: SpawnProp(Server) spawns the PropReferences it noted). So a _Tell runs until
// its _Event begins, and an _Event stays on: the prop stays gone, or stays.
// Epic's July 2018 (the Fortnite Wiki's Season 4 page; Prima Games for the Durrr Burger, "6:00pm ET on July 5th";
// NoobFeed on 9 July for the stagecoach): each rift formed the day before its prop went. 🟡 Only the Durrr Burger's hour is
// known, so every one is put at 22:00 UTC (6 PM Eastern) on its day, and the motel sign's and Noms sign's days (and
// the stagecoach's) are the days between the rifts the wiki dates; the Lonely Lodge sign went the evening of the launch.
const oddityProps = [
  ["Lonely Lodge's camp gate sign (Prop_Sign_CampGate)", "away", "2018-06-30T18:04:00Z", "2018-06-30T22:00:00Z"],
  ["the motel sign (Sign_Motel_SimpleB_Busted)", "away", "2018-07-01T22:00:00Z", "2018-07-02T22:00:00Z"],
  ["Tomato Town's rotating Tomato Head (FORT_Pizza_Clown)", "away", "2018-07-02T22:00:00Z", "2018-07-03T22:00:00Z"],
  ["Retail Row's Noms sign (Sign_NomsGrocery)", "away", "2018-07-03T22:00:00Z", "2018-07-04T22:00:00Z"],
  ["Greasy Grove's Durrr Burger head (Sign_Durrr_Big_Top)", "away", "2018-07-04T22:00:00Z", "2018-07-05T22:00:00Z"],
  ["a ship anchor between Greasy Grove and Snobby Shores (Prop_Viking_Anchor_01)", "in", "2018-07-05T22:00:00Z", "2018-07-06T22:00:00Z"],
  ["a stagecoach near Moisty Mire (Prop_WildWest_Stagecoach_02)", "in", "2018-07-07T22:00:00Z", "2018-07-08T22:00:00Z"],
  ["a skeleton's bones at I9 (Prop_Desert_Skeleton_03)", "in", "2018-07-09T22:00:00Z", "2018-07-10T22:00:00Z"]
];
// Season 5 began on 12 July 2018 (5.0 has no Athena_OdditiesActors): Season 4's replay ends there.
export const oddityScheduleEnd = "2018-07-12T00:00:00Z";
const pad = (n) => String(n).padStart(2, "0");
export const oddities = oddityProps.map(([prop, rift, tell, event], index) => ({
  number: index + 1, prop, rift,
  tell: `EventFlag.BR_S4_Oddity_${pad(index + 1)}_Tell`, event: `EventFlag.BR_S4_Oddity_${pad(index + 1)}_Event`,
  tellAt: tell, eventAt: event
}));

export const season4FlagGroups = [
  { id: "blockbuster", name: "Save the World: Blockbuster", flags: [
    flag("Blockbuster2018Phase1", [b40, b510], "Part 1, Origin Story: the front end's View Event and the quest map's Part 1 page"),
    flag("Blockbuster2018Phase2", [b40, b510], "Part 2, A Hero Is Born: the quest map's Part 2 page"),
    flag("Blockbuster2018Phase3", [b40, b510], "Part 3, The Cloaked Star: the quest map's side bar"),
    flag("Blockbuster2018Phase4", [b440, b510], "Part 4, The Finale: the quest map's side bar (4.5's pages)")
  ] },
  // 5.0's Road Trip (events/roadtrip2018.js, Core-Backend #298): its quests, tickets, llama and Event Store go with
  // RoadTrip2018, Challenge the Horde's theater and alerts with Horde (below), each served by 5.0 itself.
  { id: "roadTrip", name: "Save the World: Road Trip (5.0 – 5.10)", flags: [
    flag("RoadTrip2018", [b500, b510], "Road Trip: the quest map's pages, the Horde progression quests, Road Trip Tickets, the Road Trip Llama and the Event Store")
  ] },
  // 5.10's Birthday (events/events.js birthday2018, events/birthday2018.js): served by 5.10 itself, its Save the World
  // quests, Birthday Llama and Event Store hero with Anniversary2018_BR.
  { id: "birthday", name: "Fortnite Birthday (5.10)", flags: [
    flag("Anniversary2018_BR", [b5100, b510], "The Birthday Challenges (Schedule_Birthday2018_BR) and Save the World's Birthday quests, Birthday Llama and Urban Assault Sledgehammer"),
    flag("BirthdayBattleBus", [b5100, b510], "The birthday Battle Bus (BR_Decor_BirthdayBus)"),
    flag("SupplyDropBDay", [b5100, b510], "Birthday supply drops (BR_Decor_SupplyDropBDay)")
  ] },
  { id: "alerts", name: "Save the World: mission alerts", flags: [
    flag("ActiveMiniBosses", [b40, b510], "Mini-Boss alerts with Blockbuster Tickets (MiniBossCategory, quota 10)"),
    flag("PassiveMiniBosses", [b40, b510], "Mini-Boss alerts without tickets"),
    flag("ActiveStorms", [b40, b510], "Mutant Storm alerts with tickets"),
    flag("PassiveStorms", [b40, b510], "Mutant Storm alerts without tickets (StormLowCategory)"),
    flag("GroupMission", [b42, b510], "Group mission alerts (GroupMissionCategory, quota 10)"),
    flag("SurviveTheStorm", [b40, b510], "Survive the Storm's alerts"),
    flag("Fortnitemares", [b40, b510], "Fortnitemares' alert rows"),
    flag("Horde", [b40, b510], "Challenge the Horde: the Horde Skill Tree page (CCNodePages) and, on 5.0 and 5.10, the horde theater and its alerts (HordeCategory, quota 10)")
  ] },
  { id: "lobby", name: "Lobby", flags: [
    flag("LobbySeason4", [b40, b510], "The Season 4 lobby (Frontend_Lobby_Season4)"),
    flag("LobbyHalloweenDecor", [b40, b510], "The Halloween lobby"),
    flag("LobbyWinterDecor", [b40, b510], "The winter lobby")
  ] },
  { id: "battleRoyale", name: "Battle Royale: items and modes", flags: [
    flag("BR.CandyCaneGuns", [b40, b510], "Candy cane guns (BR_Winter_CandyCaneGuns)"),
    flag("SupplyDropGift", [b40, b510], "Supply drops as presents"),
    flag("BR.Allow50v50", [b40, b42], "Allows the 50v50 playlist"),
    flag("BR.DisallowSolo", [b40, b42], "Takes Solo off the lobby"),
    flag("BR.DisallowDuo", [b40, b42], "Takes Duos off the lobby"),
    flag("BR.DisallowSquad", [b40, b42], "Takes Squads off the lobby")
  ] },
  // 5.10's two map flags: nothing dates them (🟡), so no build serves them by itself.
  { id: "season5Map", name: "Battle Royale map: Season 5 (5.10)", flags: [
    flag("BR_S5_Rift_Shrink", [b5100, b510], "The sky's rift shrinks (BP_Athena_Event_Components)"),
    flag("BR_S5_RiskyReels_Event", [b5100, b510], "Risky Reels' drive-in projector event (DriveIn_Projector)")
  ] },
  { id: "rocket", name: "Battle Royale map: Blast Off (the rocket launch)", managedBy: "rocketLaunch", flags: [
    { flag: geodeCountdown, builds: [b450, b45], description: "The hologram counts down to the launch" },
    { flag: geodeBegin, builds: [b450, b45], description: "The 4-minute launch sequence" },
    { flag: geodeOver, builds: [b450, b45], description: "After the launch: the lair is gone" },
    { flag: riftGrowth, builds: [b450, b45], description: "The sky's crack grows for 13.6 days" }
  ] },
  { id: "oddities", name: "Battle Royale map: rifts (oddities)", flags: oddities.flatMap(({ number, prop, rift, tell, event }) => [
    { flag: tell, builds: [b450, b45], description: `Rift ${number}: ${prop} shimmers (the rift forms)` },
    { flag: event, builds: [b450, b45], description: `Rift ${number}: ${prop} is rifted ${rift}` }
  ]) }
];

const catalog = new Map(season4FlagGroups.flatMap((group) => group.flags.map((entry) => [entry.flag.toLowerCase(), { ...entry, group }])));
export const season4Flag = (name) => catalog.get(String(name ?? "").toLowerCase());
export const switchable = (entry) => entry && !entry.group.managedBy;
export const onBuild = (entry, changelist) => {
  const number = Number(changelist);
  return Number.isInteger(number) && number >= entry.builds[0] && number <= entry.builds[1];
};

export const odditiesModes = ["off", "launch", "dates", "custom"];
export const defaultSeason4Flags = { overrides: {}, oddities: "off", schedule: [] };

// The admin's own rift times (the "custom" oddities mode, Core-Backend #304): [{number, tellAt, eventAt}] with ISO times,
// one per rift that has them, by number. tellAt (the rift forms, _Tell) is no later than eventAt (the prop is rifted,
// _Event); a rift without times isn't scheduled. They stay, as the "launch" mode's do.
const validTime = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));
const riftEntry = (number, tellAt, eventAt) => ({ number, tellAt: new Date(tellAt).toISOString(), eventAt: new Date(eventAt).toISOString() });
const maxHours = 24 * 30;

// Every rift's times from a start and a spacing: rift n forms at startAt + (n - 1) * spacingHours, and its prop is
// rifted warningHours after that. Epic's: a day apart, each prop gone a day after its rift formed (24 and 24).
export function spacedOdditySchedule({ startAt, spacingHours = 24, warningHours = 24 } = {}) {
  const spacing = Number(spacingHours);
  const warning = Number(warningHours);
  const inRange = (hours) => Number.isFinite(hours) && hours >= 0 && hours <= maxHours;
  if (!validTime(startAt) || !inRange(spacing) || !inRange(warning)) return null;
  const start = Date.parse(startAt);
  const hour = 3600000;
  return oddities.map(({ number }, index) => riftEntry(number, start + index * spacing * hour, start + (index * spacing + warning) * hour));
}

// The schedule input: {startAt, spacingHours, warningHours} replaces every rift's times; a list
// [{number, tellAt, eventAt}] sets those rifts' over the current ones (both times null removes a rift's); null clears
// it. Returns the new schedule, or null when the input isn't a valid schedule.
export function odditySchedulePatch(value, current = []) {
  if (value === null) return [];
  if (Array.isArray(value)) {
    const byNumber = new Map((Array.isArray(current) ? current : []).map((entry) => [entry.number, entry]));
    for (const item of value) {
      const number = Number(item?.number);
      if (!oddities.some((oddity) => oddity.number === number)) return null;
      if (item.tellAt === null && item.eventAt === null) { byNumber.delete(number); continue; }
      if (!validTime(item.tellAt) || !validTime(item.eventAt) || Date.parse(item.tellAt) > Date.parse(item.eventAt)) return null;
      byNumber.set(number, riftEntry(number, item.tellAt, item.eventAt));
    }
    return [...byNumber.values()].sort((a, b) => a.number - b.number);
  }
  if (value && typeof value === "object") return spacedOdditySchedule(value);
  return null;
}

// The events config's season4Flags: {overrides: {flag: "on" | "off"} (a switchable flag of the catalog, "auto" or null
// removes it), oddities: "off" | "launch" | "dates" | "custom", schedule: the custom mode's rift times}. Overrides merge
// into the current ones, and a schedule list into the current schedule by rift (odditySchedulePatch).
export function sanitizeSeason4Flags(value, current = defaultSeason4Flags) {
  const result = { overrides: { ...(current?.overrides ?? {}) }, oddities: odditiesModes.includes(current?.oddities) ? current.oddities : "off",
    schedule: (Array.isArray(current?.schedule) && odditySchedulePatch(current.schedule)) || [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  if (value.overrides && typeof value.overrides === "object" && !Array.isArray(value.overrides)) {
    for (const [name, state] of Object.entries(value.overrides)) {
      const entry = season4Flag(name);
      if (!switchable(entry)) continue;
      if (state === "on" || state === "off") result.overrides[entry.flag] = state;
      else if (state === "auto" || state === null) delete result.overrides[entry.flag];
    }
  }
  if (odditiesModes.includes(value.oddities)) result.oddities = value.oddities;
  if (value.schedule !== undefined) result.schedule = odditySchedulePatch(value.schedule, result.schedule) ?? result.schedule;
  return result;
}

export const season4Settings = (config = currentEventsConfig()) => sanitizeSeason4Flags(config?.season4Flags);

// The flags the admin switched on and off for a build (the Automatic mode only; the forced and Custom modes are whole
// lists of their own).
export function season4Overrides(changelist = currentBuild(), config = currentEventsConfig()) {
  const on = [];
  const off = [];
  if (!config || (config.mode ?? "auto") === "auto") {
    for (const [name, state] of Object.entries(season4Settings(config).overrides)) {
      const entry = season4Flag(name);
      if (!switchable(entry) || !onBuild(entry, changelist)) continue;
      (state === "on" ? on : off).push(entry.flag);
    }
  }
  return { on, off };
}


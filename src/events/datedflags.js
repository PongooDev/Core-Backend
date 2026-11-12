import { anniversary2018BR, cubeDestination, cubeLake, cubeLightning, cubeMoveTo, cubeMoveToLake, cubeRune, cubeStartMove, cubeTurnOn,
  eventsActiveUntil, islandMoveTo, islandRune, ltmHeist, riftCorrupt, tomatoRiftEvent, tomatoRiftTell } from "./events.js";

// Season 5's small dated event-flag events, step by step, and the admin's own times for them (Core-Backend #311): 5.21's
// Tomato Town rift (events/tomatorift.js), 5.30's Cube (events/cube.js; 5.40's and 5.41's too) and 5.40's High Stakes
// (events/highstakes.js; 5.41's paks keep it); and Season 6's floating island (6.00 to 6.10, events/island.js), on
// Season 6's replay (an event's `season`, 5 without one). Each step is one or more calendar events served
// from its start to its end (null: on to the replay's end, or, on the admin's own times, for good). The events config's
// datedFlags.<event> picks the times:
// - "dates": Epic's dates on its season's replay (store/itemshop.js seasonMoment), lap by lap (the default);
// - "custom": the admin's own times [{step, startAt, endAt}] (ISO; endAt null: stays on), which stay, as the custom rift
//   times of events/season4flags.js do; a step without times isn't served;
// - "off": none of its steps (the flags still switch by hand, events/season4flags.js);
// - "build" (the Birthday Challenges only, its default): as the build serves the flag by itself (events/events.js: 5.10
//   always, counting down to 7 August on the replay, events/birthday2018.js; 5.21 never).
// The Battle Royale event challenges (Core-Backend #316) are two of them: 5.10's Birthday Challenges and 5.40's High
// Stakes Challenges (an event's `challenges`, its ChallengeBundleSchedule), given at the quest login while their flag is
// served (profiles/athena.js settleEventSchedules) and counting down to its activeUntil; the admin panel shows them apart.
// 4.5's rifts have their own times already (events/season4flags.js's oddities schedule) and the rocket its launch time
// (events/rocketlaunch.js).
export const season5FirstDay = Date.parse("2018-07-12T00:00:00.000Z");
export const season5EndDay = Date.parse("2018-09-27T00:00:00.000Z");
// Season 6's replay: its 70 days, 27 September to 5 December 2018 (store/itemshop-season6.json).
export const season6FirstDay = Date.parse("2018-09-27T00:00:00.000Z");
export const season6EndDay = Date.parse("2018-12-06T00:00:00.000Z");
const seasonDays = { 5: [season5FirstDay, season5EndDay], 6: [season6FirstDay, season6EndDay] };
export const datedSeasonOf = (event) => event.season ?? 5;
const daysOf = (event) => seasonDays[datedSeasonOf(event)];
// The replay's moment now for an event's season: momentNowMs is that moment (ms), or a function of the season that gives it.
const momentOf = (momentNowMs, event) => (typeof momentNowMs === "function" ? momentNowMs(datedSeasonOf(event)) : momentNowMs);

// The Cube's steps in Epic's time (events/cube.js has the sources): every change at 21:00 UTC, the purple crack from Update
// v5.30's morning; each leg to a rune runs BR_S5_Cube_StartMove alongside its MoveTo. 5.40's CUBE names the leg to the
// lake BR_S5_Cube_MoveTo8 and the lake BR_S5_Cube_Destination (5.41's too), served with 5.30's names (each build watches
// its own).
const at = (day, time = "21:00") => Date.parse(`2018-${day}T${time}:00.000Z`);
const runeStops = [["08-28", "08-29", "Fatal Fields"], ["09-02", "09-03", "Greasy Grove"], ["09-05", "09-06", "Salty Springs"],
  ["09-07", "09-08", "Retail Row"], ["09-10", "09-11", "Wailing Woods"], ["09-13", "09-14", "Lazy Links"], ["09-16", "09-17", "Pleasant Park"]];
const closure = at("08-24");
const lakeAt = at("09-19");
const step = (id, label, flags, start, end) => ({ id, label, flags, start, end });

// The Cube's locations, in order (its hill, the seven runes, Loot Lake), and the leg that rolls it to each: the admin
// panel rolls it to the next one (Core-Backend #322, datedRollSchedule) or straight to any of them (Core-Backend #295,
// datedMoveSchedule), each with its short name.
const cubeLocations = ["spawn", ...runeStops.map((_, index) => `rune${index + 1}`), "lake"];
const cubeLegs = { ...Object.fromEntries(runeStops.map((_, index) => [`moveTo${index + 1}`, `rune${index + 1}`])), moveToLake: "lake" };
const cubeStops = { spawn: "Its hill (Paradise Palms)", ...Object.fromEntries(runeStops.map(([, , place], index) => [`rune${index + 1}`, `Rune ${index + 1}: ${place}`])),
  lake: "Loot Lake" };

// The floating island's steps in Epic's time (6.00, events/island.js has the sources and how 6.00 plays them): the Fortnite
// Wiki's days, each change 🟡 at 00:00 UTC (no source gives the hours), its rune 0 (Loot Lake) from the replay's first day.
// Each stop: the day it leaves for the rune, the day it reaches it, the rune's place (short, and as the wiki puts it).
// The 6.00 island's spline runs Loot Lake, the seven runes and Loot Lake again (its point 8); its leg 8 is the way back.
const at6 = (day) => Date.parse(`2018-${day}T00:00:00.000Z`);
const islandRuneStops = [["09-28", "09-29", "Pleasant Park", "southwest of Pleasant Park"], ["10-01", "10-03", "Shifty Shafts", "by Shifty Shafts"],
  ["10-05", "10-06", "Fatal Fields", "northwest of Fatal Fields"], ["10-08", "10-09", "Retail Row", "south of Retail Row"],
  ["10-10", "10-13", "Wailing Woods", "in Wailing Woods"], ["10-14", "10-16", "Lazy Links", "by Lazy Links"],
  ["10-17", "10-18", "the map's middle", "in the map's middle"]];
const islandBackAt = at6("10-20");
const islandHomeAt = at6("10-21");
const islandLocations = ["lake", ...islandRuneStops.map((_, index) => `rune${index + 1}`), "home"];
const islandLegs = { ...Object.fromEntries(islandRuneStops.map((_, index) => [`moveTo${index + 1}`, `rune${index + 1}`])), moveTo8: "home" };
const islandStops = { lake: "Loot Lake (rune 0)", ...Object.fromEntries(islandRuneStops.map(([, , place], index) => [`rune${index + 1}`, `Rune ${index + 1}: ${place}`])),
  home: "Back over Loot Lake" };
const islandSteps = [
  step("lake", "Hangs over Loot Lake (rune 0)", [islandRune(0)], season6FirstDay, at6(islandRuneStops[0][0])),
  ...islandRuneStops.flatMap(([leave, reach, , place], index) => [
    step(`moveTo${index + 1}`, `Floats to rune ${index + 1} (${place})`, [islandMoveTo(index + 1)], at6(leave), at6(reach)),
    step(`rune${index + 1}`, `Over rune ${index + 1} (${place}): the Cube lifts it`, [islandRune(index + 1)], at6(reach),
      index + 1 < islandRuneStops.length ? at6(islandRuneStops[index + 1][0]) : islandBackAt)
  ]),
  step("moveTo8", "Floats back to Loot Lake", [islandMoveTo(8)], islandBackAt, islandHomeAt),
  step("home", "Back over Loot Lake (rune 0)", [islandRune(0)], islandHomeAt, null)
];
// 6.10 (CL-4464155 on, events/island.js): back over Loot Lake the island is at its rune 8, the spline's last point, not
// rune 0 again, so its "home" step is that flag there (a step's flags from a build on: datedEventOn).
const islandRune8Build = 4464155;

export const datedEvents = [
  { id: "cube", name: "the Cube (5.30 – 5.41)", flag: cubeTurnOn, anchor: "crack", parts: 4, locations: cubeLocations, legs: cubeLegs, stops: cubeStops,
    spawn: "spawn", sink: "lake", sinkLeg: "moveToLake", steps: [
    step("crack", "The sky's crack turns purple", [riftCorrupt], at("08-23", "08:00"), closure),
    step("lightning", "Lightning strikes the hill", [cubeLightning], at("08-23"), closure),
    step("spawn", "The Cube appears (the crack closes)", [cubeTurnOn], closure, null),
    ...runeStops.flatMap(([stop, leave, place], index) => {
      const start = index === 0 ? closure : at(runeStops[index - 1][1]);
      return [step(`moveTo${index + 1}`, `Rolls to rune ${index + 1} (${place})`, [cubeMoveTo(index + 1), cubeStartMove], start, at(stop)),
        step(`rune${index + 1}`, `Prints rune ${index + 1} (${place})`, [cubeRune(index + 1)], at(stop), at(leave))];
    }),
    step("moveToLake", "Rolls to Loot Lake", [cubeMoveToLake, cubeMoveTo(8), cubeStartMove], at(runeStops[6][1]), lakeAt),
    step("lake", "Sinks into Loot Lake", [cubeLake, cubeDestination], lakeAt, null)
  ] },
  // The floating island (6.00 to 6.10, events/island.js): one of its flags at a time, as 6.00's scripting takes the last
  // one that turns on (6.01's, 6.02's and 6.10's the first, once a match). The admin panel puts it straight at any of its
  // stops (datedMoveSchedule).
  { id: "island", name: "the floating island (6.00 – 6.10)", season: 6, flag: islandRune(0), anchor: "lake", parts: 4, locations: islandLocations,
    legs: islandLegs, stops: islandStops, steps: islandSteps, laterFlags: [{ step: "home", firstBuild: islandRune8Build, flags: [islandRune(8)] }] },
  // On the replay the rift is formed from the lap's start (5.21 shipped with it formed) until the head comes out.
  // High Stakes (5.40, events/highstakes.js; 5.41's paks keep it): from Update v5.40's morning to Update v5.41's.
  { id: "highStakes", name: "High Stakes (5.40 – 5.41)", flag: ltmHeist, anchor: "challenges", parts: 1, challenges: "Schedule_LTM_Heist", steps: [
    step("challenges", "The High Stakes Challenges", [ltmHeist], Date.parse("2018-09-06T08:00:00.000Z"), Date.parse("2018-09-18T08:00:00.000Z"))
  ] },
  // The Birthday Challenges (5.10, Schedule_Birthday2018_BR, events/birthday2018.js; 5.21's paks keep them): the Fortnite
  // Wiki's Fortnite 1st Birthday, 24 July to 7 August 2018 (🟡 days, not hours: midnight UTC, as birthdayEndedAt).
  { id: "birthday", name: "the Birthday Challenges (5.10 – 5.21)", flag: anniversary2018BR, anchor: "challenges", parts: 1,
    challenges: "Schedule_Birthday2018_BR", modes: ["build", "dates", "custom", "off"], defaultMode: "build", steps: [
      step("challenges", "The Birthday Challenges", [anniversary2018BR], Date.parse("2018-07-24T00:00:00.000Z"), Date.parse("2018-08-07T00:00:00.000Z"))
    ] },
  { id: "tomatoRift", name: "Tomato Town's rift (5.21)", flag: tomatoRiftTell, anchor: "event", parts: 2, steps: [
    step("tell", "A rift forms over Uncle Pete's Pizza Pit", [tomatoRiftTell], season5FirstDay, Date.parse("2018-08-19T00:00:00.000Z")),
    step("event", "The rift spits out the stone tomato head", [tomatoRiftEvent], Date.parse("2018-08-19T00:00:00.000Z"), null)
  ] }
];
export const datedEvent = (id) => datedEvents.find((event) => event.id === id);
export const datedModes = ["dates", "custom", "off"];
export const datedModesOf = (event) => event.modes ?? datedModes;
export const defaultDatedMode = (event) => event.defaultMode ?? "dates";
export const defaultDatedFlags = Object.fromEntries(datedEvents.map((event) => [event.id, { mode: defaultDatedMode(event), schedule: [] }]));

const validTime = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));
const iso = (ms) => new Date(ms).toISOString();
const minScale = 0.001;
const maxScale = 10;

// A schedule list [{step, startAt, endAt}] checked: each step of the event once, startAt a time, endAt null or a time after
// it. Returns it normalized (ISO, in the event's step order), or null.
export function validDatedSchedule(event, list) {
  if (!Array.isArray(list)) return null;
  const byStep = new Map();
  for (const item of list) {
    const own = event.steps.find(({ id }) => id === item?.step);
    if (!own || byStep.has(own.id) || !validTime(item.startAt)) return null;
    if (item.endAt !== null && item.endAt !== undefined && (!validTime(item.endAt) || Date.parse(item.endAt) <= Date.parse(item.startAt))) return null;
    byStep.set(own.id, { step: own.id, startAt: iso(Date.parse(item.startAt)), endAt: item.endAt == null ? null : iso(Date.parse(item.endAt)) });
  }
  return event.steps.filter(({ id }) => byStep.has(id)).map(({ id }) => byStep.get(id));
}

// Every step at Epic's spacing from one step's start: {startAt, step (default the event's anchor), scale (1: Epic's
// spacing, 0.5: twice as fast)}. A step that ran on to the season's end stays on.
export function shiftedDatedSchedule(event, { startAt, step: anchorId = event.anchor, scale = 1 } = {}) {
  const anchor = event.steps.find(({ id }) => id === anchorId);
  const factor = Number(scale);
  if (!anchor || !validTime(startAt) || !Number.isFinite(factor) || factor < minScale || factor > maxScale) return null;
  const start = Date.parse(startAt);
  const shift = (ms) => iso(start + Math.round((ms - anchor.start) * factor));
  return event.steps.map(({ id, start: own, end }) => ({ step: id, startAt: shift(own), endAt: end === null ? null : shift(end) }));
}

// The schedule input for an event: {startAt, step, scale} replaces every step's times; a list [{step, startAt, endAt}] sets
// those steps' over the current ones (or over seed, the steps' times now, when there are none yet; both times null removes
// a step's); null clears them. Returns the new schedule, or null when the input isn't one.
export function datedSchedulePatch(event, value, current = [], seed = []) {
  if (value === null) return [];
  if (Array.isArray(value)) {
    const base = new Map((current.length ? current : seed).map((entry) => [entry.step, entry]));
    for (const item of value) {
      if (!event.steps.some(({ id }) => id === item?.step)) return null;
      if (item.startAt === null && item.endAt === null) base.delete(item.step);
      else base.set(item.step, item);
    }
    return validDatedSchedule(event, [...base.values()]);
  }
  if (value && typeof value === "object") return shiftedDatedSchedule(event, value);
  return null;
}

// The events config's datedFlags: {<event>: {mode, schedule}}, each merged over the current one; a bad mode or schedule
// keeps the current.
export function sanitizeDatedFlags(value, current = defaultDatedFlags) {
  const result = {};
  for (const event of datedEvents) {
    const own = current?.[event.id];
    const modes = datedModesOf(event);
    const next = { mode: modes.includes(own?.mode) ? own.mode : defaultDatedMode(event), schedule: validDatedSchedule(event, own?.schedule ?? []) ?? [] };
    const input = value?.[event.id];
    if (input && typeof input === "object" && !Array.isArray(input)) {
      if (modes.includes(input.mode)) next.mode = input.mode;
      if (input.schedule === null) next.schedule = [];
      else if (input.schedule !== undefined) next.schedule = validDatedSchedule(event, input.schedule) ?? next.schedule;
    }
    result[event.id] = next;
  }
  return result;
}

export const datedSettings = (config) => sanitizeDatedFlags(config?.datedFlags);

// Epic's steps on the replay's lap that holds now, as real times: lapStart is the real time that lap began. The replay is
// the event's season's (momentNowMs: that season's moment now, store/itemshop.js seasonMoment).
const lapOf = (event, nowMs, momentNowMs) => {
  const [first, end] = daysOf(event);
  const cycle = end - first;
  return { cycle, first, end, lapStart: nowMs - ((((momentNowMs - first) % cycle) + cycle) % cycle) };
};
export function datedStepsThisLap(event, nowMs, momentNowMs) {
  const { lapStart, first, end: seasonEnd } = lapOf(event, nowMs, momentNowMs);
  const real = (ms) => lapStart + (ms - first);
  return event.steps.map(({ id, start, end }) => ({ step: id, startAt: iso(real(start)), endAt: iso(real(end ?? seasonEnd)) }));
}

// An event as a build has it: its steps with the flags that build's files give them (an event's laterFlags: a step's
// flags from a build on, the newest that holds). An event without any is itself on every build.
export function datedEventOn(event, changelist) {
  const build = Number(changelist);
  const later = (event.laterFlags ?? []).filter(({ firstBuild }) => Number.isInteger(build) && build >= firstBuild);
  if (!later.length) return event;
  const flagsOf = (id) => later.filter(({ step: own }) => own === id).sort((a, b) => b.firstBuild - a.firstBuild)[0]?.flags;
  return { ...event, steps: event.steps.map((own) => (flagsOf(own.id) ? { ...own, flags: flagsOf(own.id) } : own)) };
}

// The event's windows [{eventType, since, until (ms, Infinity: for good)}] by its mode: Epic's dates on the laps around
// now, or the admin's times (none in the "build" mode: the build serves the flag itself).
export function datedWindows(event, setting, nowMs, momentNowMs) {
  if (setting.mode === "off" || setting.mode === "build") return [];
  if (setting.mode === "custom") {
    return setting.schedule.flatMap(({ step: id, startAt, endAt }) => event.steps.find((own) => own.id === id).flags
      .map((eventType) => ({ eventType, since: Date.parse(startAt), until: endAt === null ? Infinity : Date.parse(endAt) })));
  }
  const { cycle, lapStart, first, end: seasonEnd } = lapOf(event, nowMs, momentNowMs);
  return [lapStart - cycle, lapStart, lapStart + cycle].flatMap((lap) => event.steps.flatMap(({ flags, start, end }) => flags.map((eventType) =>
    ({ eventType, since: lap + (start - first), until: lap + ((end ?? seasonEnd) - first) }))));
}

// Windows as calendar parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part that holds
// now on (the next `count` changes), each event once, without the skipped flags.
export function datedParts(windows, nowMs, count, skip = new Set()) {
  const kept = windows.filter(({ eventType }) => !skip.has(eventType));
  const eventsAt = (t) => {
    const seen = new Set();
    return kept.filter(({ eventType, since, until }) => t >= since && t < until && !seen.has(eventType) && seen.add(eventType))
      .map(({ eventType, since, until }) => ({ eventType, activeSince: iso(since), activeUntil: until === Infinity ? eventsActiveUntil : iso(until) }));
  };
  const boundaries = [...new Set(kept.flatMap(({ since, until }) => [since, until]))].filter((t) => Number.isFinite(t) && t > nowMs)
    .sort((a, b) => a - b).slice(0, count);
  return [{ validFrom: -Infinity, events: eventsAt(nowMs) }, ...boundaries.map((t) => ({ validFrom: t, events: eventsAt(t) }))];
}

// Rolling the Cube to its next location (Core-Backend #322). The game moves it by its calendar events alone:
// Athena/Prototype/Blueprints/Cube/CUBE (5.30 and 5.40) watches each of its EventsToBindTo with a
// FortAsyncAction_CalendarEventWatcher, which at every calendar download (5.30 dump 0x1060F30) calls OnEventActive for an
// event active now that wasn't before, OnEventUpdated for one still active and OnEventEnded for one gone. On OnEventActive
// a _RuneN puts the cube's PathIndex on Runes[N - 1] and OnRep_PathIndex runs PerformStep: the first time in a match
// (InitialSetup) it is put there, afterwards it rolls there (RollTimeline at PlayRate 0.08, 12.5 s, from the path's step
// before it), lands (LandedAtRune) and prints the rune (StartRuneSequence). So a rune that turns on in a running match
// rolls the cube onto it, its last roll and not the path's 42 to 106 steps between stops (Runes 42, 114, 186, 244, 318,
// 382, 461 of 567 Steps); a new match starts it there. A _MoveToN
// that turns on puts it as far along the path as the leg's progress, the next roll timed from BR_S5_Cube_StartMove's end
// and set only under an hour away (CalculateNextMove): it rolls in Epic's days, not at once, so the panel's roll goes to
// the next rune, not the leg. On OnEventUpdated 5.30 puts it where the event says (InitialSetup) and 5.40 does nothing.
// BR_S5_Cube_TurnOn turning on puts it on step 0, its hill. The lake: 5.40's CUBE watches BR_S5_Cube_Destination, which
// puts PathIndex on the path's last step (rolling into Loot Lake in a running match) and turns Cube_Dest_Scripting's lake
// on (LakeTurnOn); 5.30's BR_S5_Cube_Lake calls ImpactLake, which is empty, so there the cube stays where it was and starts
// a new match on its hill (its _TurnOn). A running Core gameserver fetches the calendar within 5 seconds of a change
// (CoreV2's AFortGameModeAthena::AskEventCalendarRevision and Client_RefreshEventCalendar), its players with it.
//
// A step's times now (the status's `current`) hold nowMs.
const onAt = (current, nowMs) => Boolean(current) && Date.parse(current.startAt) <= nowMs && (current.endAt === null || nowMs < Date.parse(current.endAt));

// Where an event with locations (the Cube) is on its schedule at nowMs, from its steps' times now: `now` the step that says
// so (a leg it is rolling on, else the last location it is at, else another step on, the crack or its lightning; null:
// none), and `next` the location a roll takes it to (null after the last).
export function datedPlace(event, steps, nowMs) {
  const on = steps.filter(({ current }) => onAt(current, nowMs)).map(({ step: id }) => id);
  const at = event.locations.filter((id) => on.includes(id)).at(-1) ?? null;
  const leg = on.find((id) => event.legs[id]) ?? null;
  const reached = at === null ? -1 : event.locations.indexOf(at);
  const rolling = leg ? event.legs[leg] : null;
  const next = rolling !== null && event.locations.indexOf(rolling) > reached ? rolling : event.locations[reached + 1] ?? null;
  return { now: leg ?? at ?? on.at(-1) ?? null, next };
}

// The Cube's stage at nowMs for the admin panel's track of its stops: `toward` the location a leg on now rolls it to (null:
// none) and `at` the location it is at, or rolls from on a leg (null: not out).
export function datedStage(event, steps, nowMs) {
  const on = steps.filter(({ current }) => onAt(current, nowMs)).map(({ step: id }) => id);
  const leg = on.find((id) => event.legs[id]) ?? null;
  const toward = leg ? event.legs[leg] : null;
  const at = toward ? event.locations[event.locations.indexOf(toward) - 1] ?? null : event.locations.filter((id) => on.includes(id)).at(-1) ?? null;
  return { at, toward };
}

// The admin's times that put it at one of its locations now and hold it there (Core-Backend #295's movement stages): that
// location from now on, with the Cube's appearing (_TurnOn) kept from its start, or from now when it isn't out yet. Loot
// Lake is the sink: datedSinkSchedule, it rolls in sinkLeadSeconds from now. Null for a location it doesn't have.
// What a running match plays (a Core gameserver fetches the calendar within 5 seconds of the change): a rune newly on
// rolls the Cube onto it from the path's step before it, whichever stop it was at, and prints it (the roll above); its hill
// changes nothing there (_TurnOn stays on and the game has no roll back), so new matches start it there; and the sink.
// The floating island (no appearing, no sink) is that stop's flag alone from now on: one island flag at a time
// (events/island.js has what a running match plays).
export function datedMoveSchedule(event, steps, to, nowMs) {
  if (!event.locations?.includes(to)) return null;
  if (to === event.sink) return datedSinkSchedule(event, nowMs + sinkLeadSeconds * 1000);
  if (!event.spawn) return validDatedSchedule(event, [{ step: to, startAt: iso(nowMs), endAt: null }]);
  const appearing = steps.find(({ step: id }) => id === event.spawn);
  const out = { step: event.spawn, startAt: onAt(appearing.current, nowMs) ? appearing.current.startAt : iso(nowMs), endAt: null };
  return validDatedSchedule(event, to === event.spawn ? [out] : [out, { step: to, startAt: iso(nowMs), endAt: null }]);
}

// The admin's times that roll it to its next location now and hold it there: datedMoveSchedule to the next location. Null
// after the last, and while it rolls into Loot Lake (the sink's last stretch, which matches already play: datedSinkStatus).
export function datedRollSchedule(event, steps, nowMs) {
  const { next } = datedPlace(event, steps, nowMs);
  if (next === null || (next === event.sink && datedSinkStatus(event, steps, nowMs).phase === "rollingIn")) return null;
  return datedMoveSchedule(event, steps, next, nowMs);
}

// The Cube sinking into Loot Lake (Core-Backend #295), 19 September 2018 (the Fortnite Wiki's Kevin the Cube: it rolled
// into the lake and dissolved, and the lake turned bouncy), played on 5.41. How 5.40's and 5.41's paks play it (their CUBE
// and Cube_Dest_Scripting are the same but for 5.41's tilted-impact sound and replay fixes; events/cube.js): its leg to the
// lake (BR_S5_Cube_MoveTo8, with BR_S5_Cube_StartMove) and then BR_S5_Cube_Destination.
// - CUBE, on _MoveTo8's OnEventActive, puts PathIndex at Runes[6] (460) plus the leg's progress times its 104 steps (the
//   path's last but one, 564, is the lake's surface): CalculateNextMove, rolling there from the step before it, and sets
//   IncrementIndex for the next step's time less its 12.5-second roll and 5 seconds, if under an hour away; IncrementIndex
//   waits 5 seconds and rolls one step on. In the leg's last hour it also sets the time of day to reach
//   DestinationTimeOfDay (21:30) at its end. So a match where the leg turns on in its last 104th (27.7 minutes at Epic's two
//   days) rolls the Cube to the lake's edge (563) and, 12.5 seconds before the leg's end, onto the water (564), landing
//   as it ends: CubeRollFeedback splashes (Cube_Dest_Scripting's CubeSplash, the water boils) and shakes the camera, and
//   5 seconds on ImpactLake plays LakeTimeline (80 s): the Cube sinks over 60 seconds (Steps 564 to 565) while the lake's
//   corruption spreads (MPC_Landscape's LakeCorruption, CubeStartSinking), at 60 s DoneSinking (CubeStopSinking, the
//   Cube off) and at 67 s TurnOn: Cube_Dest_Scripting's LakeTurnOn turns the lake on (LakeState 2, its purple material,
//   P_C_L_TurnOn and the lake made Bouncy) and DestTurnedOn. After the roll onto the water, IncrementIndex's next timer
//   (from BR_S5_Cube_StartMove's end, the leg's) works out below zero, so no roll follows it.
// - _Destination's OnEventActive, with the Cube not at the lake's surface or under it, puts it under it (565, rolling
//   down in a running match) and turns the lake on at once; a new match after the sink starts so: the Cube gone, the
//   lake purple and bouncy.
// A match where the leg was already on gets OnEventUpdated, which 5.40's and 5.41's CUBE ignore, so it gets that quick
// version once it sees _Destination. 5.30's paks have no lake sequence (its _Lake calls an empty ImpactLake, and it has
// no Cube_Dest_Scripting), and 6.00's place neither the Cube nor the lake's scripting (its Loot Lake is Season 6's,
// with the floating island; events/cube.js). Each schedule here sets every step at Epic's spacing from the Cube rolling
// onto the water at sinkAtMs, as the admin's own times: the leg to the lake from two days before, rune 7 the day before
// that. "Now" is a minute on, so a running match sees the leg newly on within its last 104th with time for both rolls.
export const sinkLeadSeconds = 60;
export const minSinkLeadSeconds = 30;
export const sinkPlaysSeconds = 85;
export const cubeLakeLegSteps = 104;
export function datedSinkSchedule(event, sinkAtMs) {
  if (!event.sink || !Number.isFinite(sinkAtMs)) return null;
  return shiftedDatedSchedule(event, { startAt: iso(sinkAtMs), step: event.sink, scale: 1 });
}

// When it sinks on its times now and Epic's: {at (null: not served), original, playsFrom, phase}. playsFrom is when its leg
// to the lake reaches its last 104th: a match whose leg turns on from then (one that starts then, or any running one
// when the admin's change is that late) plays the sink. The phase: "unscheduled", "scheduled", "rolling" (on its leg to
// the lake), "rollingIn" (the last 104th), "sinking" (sinkPlaysSeconds from it: the roll lands, it sinks and the lake
// turns) or "sunk" (the lake bouncy).
export function datedSinkStatus(event, steps, nowMs) {
  const own = steps.find(({ step }) => step === event.sink);
  const leg = steps.find(({ step }) => step === event.sinkLeg);
  const at = own.current?.startAt ?? null;
  const ms = at === null ? null : Date.parse(at);
  const legStart = leg.current && leg.current.endAt !== null && Date.parse(leg.current.endAt) === ms ? Date.parse(leg.current.startAt) : null;
  const playsFrom = ms === null ? null : legStart === null ? ms : ms - Math.floor((ms - legStart) / cubeLakeLegSteps);
  const phase = ms === null ? "unscheduled" : nowMs >= ms + sinkPlaysSeconds * 1000 ? "sunk" : nowMs >= ms ? "sinking"
    : nowMs >= playsFrom ? "rollingIn" : onAt(leg.current, nowMs) ? "rolling" : "scheduled";
  return { at, original: own.original.startAt, playsFrom: playsFrom === null ? null : iso(playsFrom), phase };
}

// The Cube's appearing, the Crack Closure (Core-Backend #295; events/cube.js has how 5.30 plays it): every step at Epic's
// spacing from its appearing at spawnAtMs, as the admin's own times. The game's sequence counts to the lightning's end,
// which is the appearing: the crack is purple and the lightning on from a day and a half and a day before, so a match
// within the last hour sees the strikes, the final bolt from 20 seconds before and the Cube at the end; rune 1 four days
// after. Null for an event without one.
export const spawnLeadSeconds = 30;
export const minSpawnLeadSeconds = 25;
const spawnStrikesMs = 3600000;
export function datedSpawnSchedule(event, spawnAtMs) {
  if (!event.spawn || !Number.isFinite(spawnAtMs)) return null;
  return shiftedDatedSchedule(event, { startAt: iso(spawnAtMs), step: event.spawn, scale: 1 });
}

// When it appears on its times now and Epic's: {at (null: not served), original, phase}, the phase "unscheduled",
// "scheduled", "lightning" (its last hour: the strikes and the final bolt) or "spawned".
export function datedSpawnStatus(event, steps, nowMs) {
  const own = steps.find(({ step }) => step === event.spawn);
  const at = own.current?.startAt ?? null;
  const ms = at === null ? null : Date.parse(at);
  const phase = ms === null ? "unscheduled" : nowMs < ms - spawnStrikesMs ? "scheduled" : nowMs < ms ? "lightning" : "spawned";
  return { at, original: own.original.startAt, phase };
}

// The admin panel's view of each event: its mode and each step's Epic date, its times on the replay's lap now, the
// admin's own times and the times it runs at now (by the mode); the Cube's place and its appearing too. momentNowMs is
// Season 5's replay moment now, or a function of the season that gives its replay's (the floating island's is Season 6's).
export function datedFlagsStatus(nowMs, momentNowMs, config) {
  const settings = datedSettings(config);
  return {
    modes: datedModes,
    events: datedEvents.map((event) => {
      const setting = settings[event.id];
      const lap = datedStepsThisLap(event, nowMs, momentOf(momentNowMs, event));
      const custom = new Map(setting.schedule.map((entry) => [entry.step, entry]));
      const steps = event.steps.map(({ id, label, flags, start, end }, index) => ({
        step: id, label, flags,
        original: { startAt: iso(start), endAt: end === null ? null : iso(end) },
        dates: { startAt: lap[index].startAt, endAt: end === null ? null : lap[index].endAt },
        custom: custom.get(id) ?? null,
        current: setting.mode === "off" || setting.mode === "build" ? null : setting.mode === "custom" ? custom.get(id) ?? null : lap[index]
      }));
      return {
        id: event.id, name: event.name, season: datedSeasonOf(event), mode: setting.mode, modes: datedModesOf(event), challenges: event.challenges ?? null,
        anchor: event.anchor, schedule: setting.schedule, steps,
        place: event.locations ? datedPlace(event, steps, nowMs) : null,
        stops: event.locations ? event.locations.map((id) => ({ id, label: event.stops[id] })) : null,
        stage: event.locations ? datedStage(event, steps, nowMs) : null,
        spawn: event.spawn ? datedSpawnStatus(event, steps, nowMs) : null,
        sink: event.sink ? datedSinkStatus(event, steps, nowMs) : null
      };
    })
  };
}

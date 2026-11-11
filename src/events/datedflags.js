import { anniversary2018BR, cubeDestination, cubeLake, cubeLightning, cubeMoveTo, cubeMoveToLake, cubeRune, cubeStartMove, cubeTurnOn,
  eventsActiveUntil, ltmHeist, riftCorrupt, tomatoRiftEvent, tomatoRiftTell } from "./events.js";

// Season 5's small dated event-flag events, step by step, and the admin's own times for them (Core-Backend #311): 5.21's
// Tomato Town rift (events/tomatorift.js), 5.30's Cube (events/cube.js; 5.40's too) and 5.40's High Stakes
// (events/highstakes.js). Each step is one or more calendar events served
// from its start to its end (null: on to the replay's end, or, on the admin's own times, for good). The events config's
// datedFlags.<event> picks the times:
// - "dates": Epic's dates on Season 5's replay (store/itemshop.js seasonMoment), lap by lap (the default);
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

// The Cube's steps in Epic's time (events/cube.js has the sources): every change at 21:00 UTC, the purple crack from Update
// v5.30's morning; each leg to a rune runs BR_S5_Cube_StartMove alongside its MoveTo. 5.40's CUBE names the leg to the
// lake BR_S5_Cube_MoveTo8 and the lake BR_S5_Cube_Destination, served with 5.30's names (each build watches its own).
const at = (day, time = "21:00") => Date.parse(`2018-${day}T${time}:00.000Z`);
const runeStops = [["08-28", "08-29", "Fatal Fields"], ["09-02", "09-03", "Greasy Grove"], ["09-05", "09-06", "Salty Springs"],
  ["09-07", "09-08", "Retail Row"], ["09-10", "09-11", "Wailing Woods"], ["09-13", "09-14", "Lazy Links"], ["09-16", "09-17", "Pleasant Park"]];
const closure = at("08-24");
const lakeAt = at("09-19");
const step = (id, label, flags, start, end) => ({ id, label, flags, start, end });

export const datedEvents = [
  { id: "cube", name: "the Cube (5.30 – 5.40)", flag: cubeTurnOn, anchor: "crack", parts: 4, steps: [
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
  // On the replay the rift is formed from the lap's start (5.21 shipped with it formed) until the head comes out.
  // High Stakes (5.40, events/highstakes.js): from Update v5.40's morning to Update v5.41's.
  { id: "highStakes", name: "High Stakes (5.40)", flag: ltmHeist, anchor: "challenges", parts: 1, challenges: "Schedule_LTM_Heist", steps: [
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

// Epic's steps on the replay's lap that holds now, as real times: lapStart is the real time that lap began.
const lapOf = (nowMs, momentNowMs) => {
  const cycle = season5EndDay - season5FirstDay;
  return { cycle, lapStart: nowMs - ((((momentNowMs - season5FirstDay) % cycle) + cycle) % cycle) };
};
export function datedStepsThisLap(event, nowMs, momentNowMs) {
  const { lapStart } = lapOf(nowMs, momentNowMs);
  const real = (ms) => lapStart + (ms - season5FirstDay);
  return event.steps.map(({ id, start, end }) => ({ step: id, startAt: iso(real(start)), endAt: iso(real(end ?? season5EndDay)) }));
}

// The event's windows [{eventType, since, until (ms, Infinity: for good)}] by its mode: Epic's dates on the laps around
// now, or the admin's times (none in the "build" mode: the build serves the flag itself).
export function datedWindows(event, setting, nowMs, momentNowMs) {
  if (setting.mode === "off" || setting.mode === "build") return [];
  if (setting.mode === "custom") {
    return setting.schedule.flatMap(({ step: id, startAt, endAt }) => event.steps.find((own) => own.id === id).flags
      .map((eventType) => ({ eventType, since: Date.parse(startAt), until: endAt === null ? Infinity : Date.parse(endAt) })));
  }
  const { cycle, lapStart } = lapOf(nowMs, momentNowMs);
  return [lapStart - cycle, lapStart, lapStart + cycle].flatMap((lap) => event.steps.flatMap(({ flags, start, end }) => flags.map((eventType) =>
    ({ eventType, since: lap + (start - season5FirstDay), until: lap + ((end ?? season5EndDay) - season5FirstDay) }))));
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

// The admin panel's view of each event: its mode and each step's Epic date, its times on the replay's lap now, the
// admin's own times and the times it runs at now (by the mode).
export function datedFlagsStatus(nowMs, momentNowMs, config) {
  const settings = datedSettings(config);
  return {
    modes: datedModes,
    events: datedEvents.map((event) => {
      const setting = settings[event.id];
      const lap = datedStepsThisLap(event, nowMs, momentNowMs);
      const custom = new Map(setting.schedule.map((entry) => [entry.step, entry]));
      return {
        id: event.id, name: event.name, mode: setting.mode, modes: datedModesOf(event), challenges: event.challenges ?? null,
        anchor: event.anchor, schedule: setting.schedule,
        steps: event.steps.map(({ id, label, flags, start, end }, index) => ({
          step: id, label, flags,
          original: { startAt: iso(start), endAt: end === null ? null : iso(end) },
          dates: { startAt: lap[index].startAt, endAt: end === null ? null : lap[index].endAt },
          custom: custom.get(id) ?? null,
          current: setting.mode === "off" || setting.mode === "build" ? null : setting.mode === "custom" ? custom.get(id) ?? null : lap[index]
        }))
      };
    })
  };
}

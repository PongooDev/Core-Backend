import { currentBuild } from "../builds/context.js";
import { nextReplayOf, seasonMoment } from "../store/itemshop.js";
import { currentEventsConfig, eventsActiveUntil, seasonalEventsOn } from "./events.js";
import { originalRocketLaunch, rocketLaunchTimes } from "./rocketlaunch.js";
import { oddities, oddityScheduleEnd, odditiesModes, onBuild, season4Flag, season4FlagGroups, season4Overrides, season4Settings } from "./season4flags.js";

// The rifts of July 2018 (events/season4flags.js's oddities) on the calendar, and the admin panel's view of Season 4's
// flags. 4.5's builds: CL-4159770 and CL-4166199.
const b45 = 4166199;

const time = (iso) => Date.parse(iso);
const iso = (ms) => new Date(ms).toISOString();

// The rifts' moments ({tellMs, eventMs}, end in ms or null for never) by the oddities mode:
// - "launch": Epic's offsets from its launch (30 June 2018, 18:00 UTC) after the admin's launch time
//   (events/rocketlaunch.js), the rifts following the rocket as they did; none without a launch time. They stay.
// - "dates": Epic's own dates on Season 4's replay (store/itemshop.js seasonMoment, as the LTMs' original dates), until
//   the replay's 12 July (Season 5); its next lap starts them again.
// - "off": none (the flags still switch by hand).
function riftTimes(now, changelist, config) {
  const mode = season4Settings(config).oddities;
  if (mode === "launch") {
    const t = rocketLaunchTimes(changelist, config);
    if (!t) return null;
    const shift = t.launch - time(originalRocketLaunch);
    return { end: null, list: oddities.map((oddity) => ({ ...oddity, tellMs: time(oddity.tellAt) + shift, eventMs: time(oddity.eventAt) + shift })) };
  }
  if (mode === "dates") {
    // The replay's moment now and each of Epic's moments in this lap of it, as real times.
    const moment = seasonMoment(now, null, 4).getTime();
    const real = (original) => (original <= moment ? now.getTime() - (moment - original) : now.getTime() + (original - moment));
    const end = time(oddityScheduleEnd);
    // Past the replay's 12 July (its last days are Season 5's update day, 11 July): this lap's rifts are over.
    if (moment >= end) return { end: real(end), list: [] };
    return { end: real(end), list: oddities.map((oddity) => ({ ...oddity, tellMs: real(time(oddity.tellAt)), eventMs: real(time(oddity.eventAt)) })) };
  }
  return null;
}

// The rifts' calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the part
// that holds now on (an empty list when nothing is scheduled), on 4.5 with the seasonal events on. A flag the admin
// switched on is served always (season4Overrides) and one switched off never, so neither is scheduled here.
export function odditiesStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const entry = season4Flag(oddities[0].tell);
  if (!onBuild(entry, changelist) || !seasonalEventsOn() || config?.mode === "off" || (config?.mode ?? "auto") !== "auto") return [];
  const times = riftTimes(now, changelist, config);
  if (!times) return [];
  const { off, on } = season4Overrides(changelist, config);
  const skip = new Set([...off, ...on]);
  const until = (ms) => (ms === null ? eventsActiveUntil : iso(ms));
  const eventsAt = (t) => times.list.flatMap((oddity) => [
    ...(t >= oddity.tellMs && t < oddity.eventMs ? [{ eventType: oddity.tell, activeSince: iso(oddity.tellMs), activeUntil: iso(oddity.eventMs) }] : []),
    ...(t >= oddity.eventMs && (times.end === null || t < times.end) ? [{ eventType: oddity.event, activeSince: iso(oddity.eventMs), activeUntil: until(times.end) }] : [])
  ]).filter(({ eventType }) => !skip.has(eventType));
  const boundaries = [...new Set([...times.list.flatMap((oddity) => [oddity.tellMs, oddity.eventMs]), ...(times.end === null ? [] : [times.end])])]
    .filter((t) => t > now.getTime()).sort((a, b) => a - b);
  return [{ validFrom: -Infinity, events: eventsAt(now.getTime()) }, ...boundaries.map((t) => ({ validFrom: t, events: eventsAt(t) }))];
}

// Two schedules' parts as one: at each part's start, the events of each schedule's part then.
export function mergeTimedStates(...schedules) {
  const lists = schedules.filter((list) => list.length);
  if (!lists.length) return [];
  if (lists.length === 1) return lists[0];
  const at = (list, t) => list.findLast((part) => part.validFrom <= t)?.events ?? [];
  const starts = [...new Set(lists.flatMap((list) => list.slice(1).map((part) => part.validFrom)))].sort((a, b) => a - b);
  return [{ validFrom: -Infinity, events: lists.flatMap((list) => list[0].events) },
    ...starts.map((t) => ({ validFrom: t, events: lists.flatMap((list) => at(list, t)) }))];
}

// The admin panel's view: each group with each flag's state on the newest Season 4 build (4.5) and whether the admin
// switched it, the oddities mode and the rifts' times now.
export function season4FlagsStatus(now = new Date(), config = currentEventsConfig(), servedOn45 = [], servedOn50 = []) {
  const { overrides, oddities: mode } = season4Settings(config);
  const times = riftTimes(now, String(b45), config);
  const replayNext = (original) => nextReplayOf(time(original), now, null, 4).toISOString();
  return {
    oddities: mode,
    odditiesModes,
    rifts: oddities.map((oddity, index) => ({
      number: oddity.number, prop: oddity.prop, rift: oddity.rift, tell: oddity.tell, event: oddity.event,
      original: { tell: oddity.tellAt, event: oddity.eventAt },
      ...(times?.list[index] ? { tellAt: iso(times.list[index].tellMs), eventAt: iso(times.list[index].eventMs) } : {}),
      nextOnReplay: { tell: replayNext(oddity.tellAt), event: replayNext(oddity.eventAt) }
    })),
    groups: season4FlagGroups.map((group) => ({
      id: group.id, name: group.name, managedBy: group.managedBy ?? null,
      flags: group.flags.map((entry) => ({
        flag: entry.flag, description: entry.description, builds: entry.builds,
        override: group.managedBy ? null : overrides[entry.flag] ?? "auto",
        servedOn45: servedOn45.includes(entry.flag),
        servedOn50: servedOn50.includes(entry.flag)
      }))
    }))
  };
}

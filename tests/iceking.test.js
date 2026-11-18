import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { eventSchedules, scheduleEventPatch } from "../src/admin/eventschedules.js";
import { datedFlagsStatus } from "../src/events/datedflags.js";
import { configureEvents } from "../src/events/events.js";
import { iceKingState, iceKingStates } from "../src/events/icestorm.js";
import { defaultReplacements, ltmOn } from "../src/events/ltms.js";
import { createSettingsStore } from "../src/settings/store.js";
import { seasonMoment } from "../src/store/itemshop.js";

// 7.20's Ice King and his Ice Storm (Core-Backend #354, PongooDev/CoreV2 #490): the calendar names 7.20's blueprints
// watch, the event held before the storm by default and started from the admin panel, Solo, Duos and Squads switching to
// the Ice Storm's at the storm, and the snow switch (events/icestorm.js).
const v720 = "4727874";
const v710 = "4667333";
const season7 = { mode: "auto", seasonStarts: { 7: "2018-12-06" } };
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const typesAt = (states, ms) => (states.filter(({ validFrom }) => validFrom === -Infinity || validFrom <= ms).at(-1)?.events ?? [])
  .map(({ eventType }) => eventType).sort();
const at = (iso) => new Date(iso);
// The real time now at which Season 7's replay is at the given moment.
const onReplay = (iso) => new Date(Date.now() + (Date.parse(iso) - seasonMoment(new Date(), null, 7).getTime()));

test("before the event (the default): the sphere alone, the default modes, on 7.20 only", () => {
  const defaults = createSettingsStore(null).get();
  withConfig(season7, () => {
    const now = new Date();
    const states = inBuild(v720, () => iceKingStates(now));
    assert.deepEqual(typesAt(states, now.getTime()), ["LoadLevel"]);
    assert.equal(states.length, 1, "nothing scheduled");
    assert.equal(inBuild(v720, () => iceKingState(now)), "before");
    assert.deepEqual(inBuild(v710, () => iceKingStates(now)), [], "7.10 has no Ice King");
    assert.equal(inBuild(v710, () => iceKingState(now)), null);
    for (const id of ["iceStormSolo", "iceStormDuos", "iceStormSquads"]) assert.equal(ltmOn(id, v720, defaults, now), false, id);
    assert.deepEqual(defaultReplacements(v720, defaults, now), {});
  });
});

test("Start now: the last 12 minutes on at once, the storm 30 seconds on, then the island under snow and the Ice Storm modes", () => {
  const defaults = createSettingsStore(null).get();
  const now = new Date();
  const { patch } = scheduleEventPatch({ event: "iceKing", mode: "now" }, season7, now);
  assert.equal(patch.datedFlags.iceKing.mode, "custom");
  const config = { ...season7, ...patch };
  withConfig(config, () => {
    const states = inBuild(v720, () => iceKingStates(now));
    const ms = now.getTime();
    assert.deepEqual(typesAt(states, ms), ["Countdown", "LoadLevel", "LoadSequence", "R0", "WD1", "warning"]);
    const storm = states.find(({ events }) => events.some(({ eventType }) => eventType === "WD2"));
    assert.equal(storm.validFrom, ms + 30000, "the storm 30 seconds on");
    assert.deepEqual(typesAt(states, ms + 30000), ["LoadLevel", "LoadSequence", "SP", "WD2"]);
    assert.deepEqual(typesAt(states, ms + 30000 + 10 * 60000), ["LoadLevel", "SP"], "the storm's 10 minutes over, the snow stays");
    const wd1 = states[0].events.find(({ eventType }) => eventType === "WD1");
    assert.equal(Date.parse(wd1.activeUntil), ms + 30000, "WD1 ends at the storm");
    assert.equal(Date.parse(wd1.activeSince), ms + 30000 - 12 * 60000);
    const countdown = states[0].events.find(({ eventType }) => eventType === "Countdown");
    assert.equal(Date.parse(countdown.activeUntil), ms + 30000, "the TVs count to the storm");
    assert.equal(inBuild(v720, () => iceKingState(now)), "before");
    const after = new Date(ms + 31000);
    assert.equal(inBuild(v720, () => iceKingState(after)), "after");
    for (const id of ["iceStormSolo", "iceStormDuos", "iceStormSquads"]) {
      assert.equal(ltmOn(id, v720, defaults, now), false, `${id} before the storm`);
      assert.equal(ltmOn(id, v720, defaults, after), true, `${id} after it`);
      assert.equal(ltmOn(id, v720, { ...defaults, matchmakingModes: { ...defaults.matchmakingModes, [id]: false } }, after), false, `${id}'s switch`);
      assert.equal(ltmOn(id, v720, { ...defaults, ltmOriginalDates: true }, after), true, `${id}: the admin's storm, not the dates`);
    }
    assert.deepEqual(Object.keys(defaultReplacements(v720, defaults, after)).sort(), ["Playlist_DefaultDuo", "Playlist_DefaultSolo", "Playlist_DefaultSquad"]);
  });
  // Before the event brings the sphere and the default modes back.
  const before = scheduleEventPatch({ event: "iceKing", mode: "before" }, config, now);
  assert.deepEqual(before.patch, { datedFlags: { iceKing: { mode: "before" } } });
  withConfig({ ...config, datedFlags: { iceKing: { mode: "before", schedule: config.datedFlags.iceKing.schedule } } }, () => {
    const later = new Date(now.getTime() + 3600000);
    assert.equal(inBuild(v720, () => iceKingState(later)), "before");
    assert.deepEqual(typesAt(inBuild(v720, () => iceKingStates(later)), later.getTime()), ["LoadLevel"]);
    assert.equal(ltmOn("iceStormSolo", v720, defaults, later), false);
  });
});

test("Epic's dates on Season 7's replay: the sphere, the Ice King, the TVs, the clock, the last 12 minutes, the storm at 19 January 19:00 UTC", () => {
  const config = { ...season7, datedFlags: { iceKing: { mode: "dates" } } };
  withConfig(config, () => {
    const typesOnReplay = (iso) => {
      const now = onReplay(iso);
      return typesAt(inBuild(v720, () => iceKingStates(now)), now.getTime());
    };
    assert.deepEqual(typesOnReplay("2019-01-10T12:00:00Z"), ["LoadLevel"], "7.20 shipped with the sphere");
    assert.deepEqual(typesOnReplay("2019-01-16T12:00:00Z"), ["LoadLevel", "WDK"]);
    assert.deepEqual(typesOnReplay("2019-01-17T12:00:00Z"), ["Countdown", "LoadLevel", "R0", "WDK", "warning"]);
    assert.deepEqual(typesOnReplay("2019-01-19T12:00:00Z"), ["Countdown", "LoadLevel", "LoadSequence", "R0", "WD0", "warning"]);
    assert.deepEqual(typesOnReplay("2019-01-19T18:50:00Z"), ["Countdown", "LoadLevel", "LoadSequence", "R0", "WD1", "warning"]);
    assert.deepEqual(typesOnReplay("2019-01-19T19:05:00Z"), ["LoadLevel", "LoadSequence", "SP", "WD2"]);
    assert.deepEqual(typesOnReplay("2019-01-25T12:00:00Z"), ["LoadLevel", "SP"]);
    assert.equal(inBuild(v720, () => iceKingState(onReplay("2019-01-19T18:59:00Z"))), "before");
    assert.equal(inBuild(v720, () => iceKingState(onReplay("2019-01-19T19:01:00Z"))), "after");
    const defaults = createSettingsStore(null).get();
    const dated = { ...defaults, ltmOriginalDates: true };
    assert.equal(ltmOn("iceStormSolo", v720, dated, onReplay("2019-01-22T12:00:00Z")), true, "after the storm, in its dates");
    assert.equal(ltmOn("iceStormSolo", v720, dated, onReplay("2019-02-10T12:00:00Z")), false, "after its dates (Update v7.30)");
    assert.equal(ltmOn("iceStormSolo", v720, defaults, onReplay("2019-02-10T12:00:00Z")), true, "on by its switch without Original dates");
  });
});

test("the snow switch: SP by the storm, never, or always; the modes follow the storm whatever it says", () => {
  const now = new Date();
  const { patch } = scheduleEventPatch({ event: "iceKing", mode: "now" }, season7, now);
  const after = now.getTime() + 60000;
  const typesWith = (snow, ms) => withConfig({ ...season7, ...patch, iceKingSnow: snow }, () => typesAt(inBuild(v720, () => iceKingStates(now)), ms));
  assert.ok(typesWith("event", after).includes("SP"));
  assert.ok(!typesWith("event", now.getTime()).includes("SP"));
  assert.ok(!typesWith("none", after).includes("SP"), "Season 7's own snow after the storm");
  assert.ok(typesWith("full", now.getTime()).includes("SP"), "the island under snow before it");
  withConfig({ ...season7, iceKingSnow: "full" }, () => {
    assert.deepEqual(typesAt(inBuild(v720, () => iceKingStates(now)), now.getTime()), ["LoadLevel", "SP"], "before the event, under snow");
    assert.equal(inBuild(v720, () => iceKingState(now)), "before", "the snow doesn't start the storm");
  });
  const store = createSettingsStore(null);
  assert.equal(store.get().events.iceKingSnow, "event");
  assert.equal(store.update({ events: { iceKingSnow: "full" } }).events.iceKingSnow, "full");
  assert.equal(store.update({ events: { iceKingSnow: "stages" } }).events.iceKingSnow, "full", "an unknown value keeps the current");
  assert.deepEqual(scheduleEventPatch({ event: "iceKingSnow", mode: "none" }, {}, now), { patch: { iceKingSnow: "none" } });
  assert.ok(scheduleEventPatch({ event: "iceKingSnow", mode: "half" }, {}, now).error);
});

test("the Events page's cards: the Ice King held before the event with Start now, and its snow", () => {
  const now = new Date();
  const dated = datedFlagsStatus(now.getTime(), (season) => seasonMoment(now, null, season).getTime(), season7);
  const cards = eventSchedules({ now, config: season7, dated });
  const king = cards.find(({ id }) => id === "iceKing");
  assert.deepEqual([king.mode, king.modes, king.now], ["before", ["before", "dates", "custom"], true]);
  assert.equal(king.state.nowLabel, "before the event");
  assert.ok(king.flags.includes("WD2") && king.flags.includes("SP") && king.flags.includes("LoadLevel"));
  const snow = cards.find(({ id }) => id === "iceKingSnow");
  assert.deepEqual([snow.mode, snow.modes], ["event", ["event", "none", "full"]]);
  assert.equal(snow.modeLabels.full, "Island under snow");
  const meteor = cards.find(({ id }) => id === "meteorStrike");
  assert.deepEqual([meteor.mode, meteor.modes], ["meteors", ["none", "broadcast", "meteors", "impact"]], "the meteor shower's choice as it was");
  assert.deepEqual(scheduleEventPatch({ event: "meteorStrike", mode: "impact" }, {}, now), { patch: { meteorStrike: "impact" } });
});

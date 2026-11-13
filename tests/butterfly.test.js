import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { butterflyBuilds, butterflyEvent, butterflyStates } from "../src/events/butterfly.js";
import { datedFlagsStatus, shiftedDatedSchedule } from "../src/events/datedflags.js";
import { activeEventFlags, configureEvents, eventsActiveUntil, islandCrack, islandDrain, islandPoi } from "../src/events/events.js";
import { season4Flag } from "../src/events/season4flags.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// 6.21's Butterfly (events/butterfly.js): opt-in, as 4.5's rocket launch is, on Epic's dates on Season 6's replay or the
// admin's times; off, 6.21 serves POI0 by itself and the rest by the switches (tests/build621.test.js).
const v621 = "4526925";
const v620 = "4497486";
const replay = { mode: "auto", seasonStarts: { 6: "2018-09-27" } };
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const at = (iso) => new Date(iso);
const isoOf = (ms) => new Date(ms).toISOString();
const types = (part) => part.events.map(({ eventType }) => eventType).sort();
const states = (build, iso, config) => withConfig(config, () => inBuild(build, () => butterflyStates(at(iso))));
const flagsOf = (build, config) => withConfig(config, () => inBuild(build, () => activeEventFlags(build)));

test("the Butterfly's steps are 6.21's island scripting's four calendar names, back to back, the Butterfly on 4 November at 18:00 UTC", () => {
  assert.deepEqual(butterflyBuilds, [Number(v621)]);
  assert.equal(islandDrain, "EventFlag.BR_S6_Island_Drain", "BP_IslandServerOnly's EventBinding3 in CL-4526925's server-assets pak");
  assert.deepEqual(butterflyEvent.steps.map(({ id, flags }) => [id, flags]),
    [["deimos", [islandPoi(0)]], ["crack", [islandCrack]], ["drain", [islandDrain]], ["butterfly", [islandPoi(1)]]]);
  const step = (id) => butterflyEvent.steps.find((own) => own.id === id);
  assert.equal(isoOf(step("butterfly").start), "2018-11-04T18:00:00.000Z");
  assert.equal(step("butterfly").end, null, "POI1 from then on");
  assert.equal(step("deimos").end, step("butterfly").start, "POI0 ends as the Butterfly comes");
  assert.equal(step("drain").end - step("drain").start, 24 * 3600000, "a drip each hour, the 24th the Butterfly's");
  assert.equal(step("crack").end, step("drain").start, "the drain follows the crack's last crack");
  assert.equal(butterflyEvent.defaultMode, "off");
  assert.deepEqual(season4Flag(islandDrain).builds, [Number(v621), Number(v621)], "the drain's switch is 6.21's alone");
});

test("off by default: 6.21 serves POI0 by itself, nothing is scheduled; 6.20 never schedules it", () => {
  assert.deepEqual(states(v621, "2018-11-04T17:00:00Z", replay), []);
  assert.ok(flagsOf(v621, replay).includes(islandPoi(0)));
  const dates = { ...replay, datedFlags: { butterfly: { mode: "dates" } } };
  assert.deepEqual(states(v620, "2018-11-04T17:00:00Z", dates), [], "6.20's scripting has no Butterfly");
  assert.ok(flagsOf(v620, dates).includes(islandPoi(0)), "and keeps its POI0");
});

test("on Epic's dates: POI0 counts down to the Butterfly, the crack then the drain before it, POI1 after; POI0 isn't the build's then", () => {
  const dates = { ...replay, datedFlags: { butterfly: { mode: "dates" } } };
  assert.equal(flagsOf(v621, dates).includes(islandPoi(0)), false, "the schedule serves it");
  const before = states(v621, "2018-11-04T17:40:00Z", dates);
  assert.deepEqual(types(before[0]), [islandDrain, islandPoi(0)].sort(), "the Butterfly's last 20 minutes: POI0 and the drain");
  const poi0 = before[0].events.find(({ eventType }) => eventType === islandPoi(0));
  assert.equal(poi0.activeUntil, "2018-11-04T18:00:00.000Z", "a match starting now has its storm close on the Butterfly (POI0's last 30 minutes)");
  assert.equal(isoOf(before[1].validFrom), "2018-11-04T18:00:00.000Z", "the next part is the Butterfly, which the server's calendar moves to itself");
  assert.deepEqual(types(before[1]), [islandPoi(1)]);
  assert.equal(before[1].events[0].activeUntil, "2018-12-06T00:00:00.000Z", "to the replay's end (on the admin's times, for good)");
  assert.deepEqual(types(states(v621, "2018-11-02T12:00:00Z", dates)[0]), [islandCrack, islandPoi(0)].sort());
  assert.deepEqual(types(states(v621, "2018-11-10T12:00:00Z", dates)[0]), [islandPoi(1)], "after it");
  assert.deepEqual(types(states(v621, "2018-10-01T12:00:00Z", dates)[0]), [islandPoi(0)], "the Cube Monsters' days");
});

test("the admin's switches stay over the schedule: a flag switched on or off isn't scheduled", () => {
  const config = { ...replay, datedFlags: { butterfly: { mode: "dates" } }, season4Flags: { overrides: { [islandDrain]: "off" } } };
  assert.deepEqual(types(states(v621, "2018-11-04T17:40:00Z", config)[0]), [islandPoi(0)]);
  assert.equal(flagsOf(v621, config).includes(islandDrain), false);
});

test("Start now on the Butterfly's step: the admin's times, every step at Epic's spacing, POI1 from then", () => {
  const nowMs = Date.parse("2026-11-13T15:00:00.000Z");
  const schedule = shiftedDatedSchedule(butterflyEvent, { startAt: isoOf(nowMs + 60000), step: "butterfly", scale: 1 });
  const config = { mode: "auto", datedFlags: { butterfly: { mode: "custom", schedule } } };
  const parts = states(v621, isoOf(nowMs), config);
  assert.deepEqual(types(parts[0]), [islandDrain, islandPoi(0)].sort());
  assert.equal(parts[1].validFrom, nowMs + 60000);
  assert.deepEqual(types(parts[1]), [islandPoi(1)]);
  assert.equal(parts[1].events[0].activeUntil, eventsActiveUntil, "for good");
  const status = withConfig(config, () => datedFlagsStatus(nowMs, () => nowMs, config).events.find(({ id }) => id === "butterfly"));
  assert.deepEqual([status.mode, status.anchor, status.season], ["custom", "butterfly", 6]);
});

test("a 6.21 gameserver's calendar with the Butterfly a minute away: POI0 and the drain now, POI1 in the next part", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Butterfly621");
    const timeline = async () => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": `Fortnite/++Fortnite+Release-6.21-CL-${v621} Windows/10.0.19045.1.256.64bit`, Authorization: `bearer ${token}` } })).body;
    const before = (await timeline()).channels["client-events"].states;
    assert.equal(before.length, 1, "off: no schedule");
    const revision = (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/game/v2/calendar/revision",
      headers: { Authorization: `bearer ${token}` } })).body.revision;
    const butterflyAt = new Date(Date.now() + 60000).toISOString();
    const dated = await post(backend.port, "/admin/api/events/dated-flags", null, { event: "butterfly", schedule: { startAt: butterflyAt, step: "butterfly", scale: 1 } });
    assert.equal(dated.status, 200, JSON.stringify(dated.body));
    const status = dated.body.datedFlags.events.find(({ id }) => id === "butterfly");
    assert.equal(status.mode, "custom");
    const after = (await timeline()).channels["client-events"];
    const [now, next] = after.states;
    const nowTypes = now.activeEvents.map(({ eventType }) => eventType);
    assert.ok(nowTypes.includes(islandPoi(0)) && nowTypes.includes(islandDrain), JSON.stringify(nowTypes));
    assert.equal(nowTypes.filter((type) => type === islandPoi(0)).length, 1, "POI0 once: the schedule's, not the build's too");
    assert.equal(now.activeEvents.find(({ eventType }) => eventType === islandPoi(0)).activeUntil, new Date(Date.parse(butterflyAt)).toISOString());
    assert.equal(next.validFrom, new Date(Date.parse(butterflyAt)).toISOString());
    assert.ok(next.activeEvents.some(({ eventType }) => eventType === islandPoi(1)));
    assert.equal(next.activeEvents.some(({ eventType }) => eventType === islandPoi(0)), false);
    assert.ok(next.state.activeEventFlags.includes(islandPoi(1)));
    assert.ok(Date.parse(after.cacheExpire) <= Date.parse(butterflyAt), "good no later than the Butterfly");
    const changed = (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/game/v2/calendar/revision",
      headers: { Authorization: `bearer ${token}` } })).body.revision;
    assert.notEqual(changed, revision, "running gameservers fetch it again");
    // Off again: the build's own POI0.
    assert.equal((await post(backend.port, "/admin/api/events/dated-flags", null, { event: "butterfly", mode: "off" })).status, 200);
    const off = (await timeline()).channels["client-events"].states;
    assert.equal(off.length, 1);
    assert.ok(off[0].activeEvents.some(({ eventType }) => eventType === islandPoi(0)));
  } finally {
    await backend.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { cubeStates } from "../src/events/cube.js";
import { datedEvent, datedFlagsStatus, datedMoveSchedule, datedRollSchedule, shiftedDatedSchedule } from "../src/events/datedflags.js";
import { configureEvents, eventsActiveUntil, islandMoveTo, islandRune } from "../src/events/events.js";
import { islandEvent, islandStates } from "../src/events/island.js";
import { season4Flag } from "../src/events/season4flags.js";
import { tomatoRiftStates } from "../src/events/tomatorift.js";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

// 6.00's floating island (PongooDev/CoreV2#401): BP_IslandServerOnly's calendar events, served by Season 6's dates. 6.01
// (CL-4417689, CL-4424678) and 6.02 (CL-4442095, CL-4461277) keep it: its flags run to 6.10 (tests/build601.test.js,
// tests/build602.test.js).
const v600 = "4402180";
const v6000 = "4395664";
const v601 = "4424678";
const v541 = "4363240";
const builds600 = [v6000, v600];
// Season 6's replay from its real first day, so the replay's dates are Epic's.
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
const islandFlags = (part) => part.events.map(({ eventType }) => eventType).filter((type) => type.startsWith("EventFlag.BR_S6_Island_"));
const served = (build, iso) => inBuild(build, () => islandStates(at(iso)))[0]?.events ?? [];
// The island's status, on Season 6's replay at its real dates (the replay's moment is now).
const islandStatus = (datedFlags, nowMs) => datedFlagsStatus(nowMs, () => nowMs, { datedFlags }).events.find(({ id }) => id === "island");

test("the island's steps are BP_IslandServerOnly's sixteen calendar events, one at a time, rune 0 Loot Lake", () => {
  // CL-4395664's server-assets pak: BP_IslandServerOnly_C's EventBindings, in its order.
  const bindings = [...[1, 2, 3, 4, 5, 6, 7].map(islandMoveTo), ...[0, 1, 2, 3, 4, 5, 6, 7].map(islandRune), islandMoveTo(8)];
  assert.deepEqual(bindings.slice(0, 2), ["EventFlag.BR_S6_Island_MoveTo1", "EventFlag.BR_S6_Island_MoveTo2"]);
  assert.deepEqual([...new Set(islandEvent.steps.flatMap(({ flags }) => flags))].sort(), [...bindings].sort());
  assert.ok(islandEvent.steps.every(({ flags }) => flags.length === 1), "one flag a step");
  assert.deepEqual(islandEvent.steps.map(({ id }) => id), ["lake", "moveTo1", "rune1", "moveTo2", "rune2", "moveTo3", "rune3", "moveTo4", "rune4",
    "moveTo5", "rune5", "moveTo6", "rune6", "moveTo7", "rune7", "moveTo8", "home"]);
  // Back to back: each step starts as the one before it ends, so no two island flags are on at once.
  islandEvent.steps.slice(1).forEach((step, index) => assert.equal(step.start, islandEvent.steps[index].end, step.id));
  assert.equal(isoOf(islandEvent.steps[0].start), "2018-09-27T00:00:00.000Z", "over Loot Lake from Season 6's first day");
  assert.equal(islandEvent.steps.at(-1).end, null, "and back there to the season's end");
  assert.deepEqual(islandEvent.steps.filter(({ flags }) => flags[0] === islandRune(0)).map(({ id }) => id), ["lake", "home"]);
  // They run to 6.10 now, which has one more, its own (tests/build610.test.js).
  for (const flag of bindings) assert.deepEqual(season4Flag(flag).builds, [Number(v6000), 4480234], flag);
  assert.deepEqual(season4Flag(islandRune(8)).builds, [4464155, 4480234]);
});

test("6.00 serves the island by Epic's Season 6 dates on its replay, on both changelists; 5.41 doesn't", () => {
  withConfig(replay, () => {
    for (const build of builds600) {
      const flags = (iso) => served(build, iso).map(({ eventType }) => eventType);
      assert.deepEqual(flags("2018-09-27T12:00:00Z"), [islandRune(0)], `${build}: over Loot Lake at the release`);
      assert.deepEqual(flags("2018-09-28T12:00:00Z"), [islandMoveTo(1)], "on its way to Pleasant Park's rune");
      assert.deepEqual(flags("2018-09-30T00:00:00Z"), [islandRune(1)]);
      assert.deepEqual(flags("2018-10-02T00:00:00Z"), [islandMoveTo(2)]);
      assert.deepEqual(flags("2018-10-09T12:00:00Z"), [islandRune(4)], "Retail Row's rune on 9 October");
      assert.deepEqual(flags("2018-10-11T00:00:00Z"), [islandMoveTo(5)]);
      assert.deepEqual(flags("2018-10-19T00:00:00Z"), [islandRune(7)], "the map's middle");
      assert.deepEqual(flags("2018-10-20T12:00:00Z"), [islandMoveTo(8)], "back to Loot Lake");
      assert.deepEqual(flags("2018-11-15T00:00:00Z"), [islandRune(0)], "over Loot Lake again");
    }
    // A leg's activeSince and activeUntil are the leg's: the island's scripting puts it along the leg by its progress.
    assert.deepEqual(served(v600, "2018-10-02T00:00:00Z"), [{ eventType: islandMoveTo(2), activeSince: "2018-10-01T00:00:00.000Z",
      activeUntil: "2018-10-03T00:00:00.000Z" }]);
    // The next changes: the parts to come, one island flag each.
    const parts = inBuild(v600, () => islandStates(at("2018-09-27T12:00:00Z")));
    assert.deepEqual(parts.map((part) => islandFlags(part)), [[islandRune(0)], [islandMoveTo(1)], [islandRune(1)], [islandMoveTo(2)], [islandRune(2)]]);
    assert.equal(isoOf(parts[1].validFrom), "2018-09-28T00:00:00.000Z");
    // Lap by lap: the replay's 70 days, Loot Lake from the next lap's start.
    assert.deepEqual(served(v600, "2018-12-06T12:00:00Z").map(({ eventType }) => eventType), [islandRune(0)]);
    assert.deepEqual(served(v600, "2018-12-07T12:00:00Z").map(({ eventType }) => eventType), [islandMoveTo(1)], "the next lap's leg 1");
    assert.deepEqual(inBuild(v541, () => islandStates(at("2018-10-01T00:00:00Z"))), [], "5.41 has no floating island");
    assert.deepEqual(inBuild(v600, () => cubeStates(at("2018-10-01T00:00:00Z"))), [], "and 6.00 no Cube");
  });
});

test("the island's flags: off, their switch, and the other modes", () => {
  withConfig({ ...replay, datedFlags: { island: { mode: "off" } } }, () => assert.deepEqual(served(v600, "2018-10-02T00:00:00Z"), []));
  // Switched off, the dates skip it; switched on, it is the build's own flag (served always, not scheduled here).
  withConfig({ ...replay, season4Flags: { overrides: { [islandMoveTo(2)]: "off" } } }, () => assert.deepEqual(served(v600, "2018-10-02T00:00:00Z"), []));
  withConfig({ ...replay, season4Flags: { overrides: { [islandRune(3)]: "on" } } }, () => {
    assert.deepEqual(served(v600, "2018-10-07T00:00:00Z"), []);
    assert.deepEqual(served(v600, "2018-10-02T00:00:00Z").map(({ eventType }) => eventType), [islandMoveTo(2)]);
  });
  withConfig({ mode: "custom", customFlags: [] }, () => assert.deepEqual(inBuild(v600, () => islandStates(at("2018-10-02T00:00:00Z"))), []));
  // Season 5's dated events keep Season 5's replay.
  withConfig({ mode: "auto", seasonStarts: { 5: "2018-07-12" } }, () => {
    assert.ok(inBuild("4288479", () => tomatoRiftStates(at("2018-08-01T00:00:00Z")))[0].events.length, "5.21's rift still on Season 5's dates");
  });
});

test("the island's stops: where it is on Season 6's dates, and straight to any stop now, that flag alone", () => {
  const status = islandStatus({}, Date.parse("2018-10-09T12:00:00Z"));
  assert.equal(status.season, 6);
  assert.deepEqual(status.stops.map(({ id }) => id), ["lake", "rune1", "rune2", "rune3", "rune4", "rune5", "rune6", "rune7", "home"]);
  assert.deepEqual([status.stops[0].label, status.stops[4].label, status.stops[8].label], ["Loot Lake (rune 0)", "Rune 4: Retail Row", "Back over Loot Lake"]);
  assert.deepEqual(status.stage, { at: "rune4", toward: null });
  assert.deepEqual(status.steps.find(({ step }) => step === "rune4").current, { step: "rune4", startAt: "2018-10-09T00:00:00.000Z", endAt: "2018-10-10T00:00:00.000Z" });
  assert.deepEqual(islandStatus({}, Date.parse("2018-10-11T00:00:00Z")).stage, { at: "rune4", toward: "rune5" }, "on its way from rune 4 to 5");
  assert.deepEqual(islandStatus({}, Date.parse("2018-10-20T12:00:00Z")).stage, { at: "rune7", toward: "home" });
  assert.deepEqual(islandStatus({}, Date.parse("2018-09-27T12:00:00Z")).stage, { at: "lake", toward: null });
  assert.deepEqual(islandStatus({ island: { mode: "off" } }, Date.parse("2018-10-09T12:00:00Z")).stage, { at: null, toward: null });
  assert.equal(islandStatus({}, Date.parse("2018-10-09T12:00:00Z")).spawn, null, "no appearing, no sink");

  const now = Date.parse("2026-11-12T12:00:00Z");
  const island = datedEvent("island");
  const three = datedMoveSchedule(island, status.steps, "rune3", now);
  assert.deepEqual(three, [{ step: "rune3", startAt: isoOf(now), endAt: null }], "rune 3 alone, from now, for good");
  withConfig({ mode: "auto", datedFlags: { island: { mode: "custom", schedule: three } } }, () => {
    const parts = inBuild(v600, () => islandStates(new Date(now + 1000)));
    assert.deepEqual(parts, [{ validFrom: -Infinity, events: [{ eventType: islandRune(3), activeSince: isoOf(now), activeUntil: eventsActiveUntil }] }]);
  });
  assert.deepEqual(islandStatus({ island: { mode: "custom", schedule: three } }, now + 1000).stage, { at: "rune3", toward: null });
  assert.deepEqual(datedMoveSchedule(island, status.steps, "lake", now), [{ step: "lake", startAt: isoOf(now), endAt: null }]);
  assert.deepEqual(datedMoveSchedule(island, status.steps, "home", now), [{ step: "home", startAt: isoOf(now), endAt: null }]);
  assert.equal(datedMoveSchedule(island, status.steps, "moveTo3", now), null, "only its stops");
  // The roll goes to its next stop the same way.
  assert.deepEqual(datedRollSchedule(island, islandStatus({ island: { mode: "custom", schedule: three } }, now + 1000).steps, now + 2000),
    [{ step: "rune4", startAt: isoOf(now + 2000), endAt: null }]);
  // Its steps at Epic's spacing from a start: rune 1 a day and a day after leaving Loot Lake.
  const shifted = shiftedDatedSchedule(island, { startAt: isoOf(now), step: "lake" });
  assert.deepEqual(shifted.find(({ step }) => step === "rune1"), { step: "rune1", startAt: isoOf(now + 2 * 86400000), endAt: isoOf(now + 4 * 86400000) });
});

test("the admin panel moves the floating island to any stop, and 6.00's timelines serve that stop's flag alone", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "IslandStops");
    const islandServed = async (cl) => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": `Fortnite/++Fortnite+Release-6.00-CL-${cl} Windows/10.0.19045.1.256.64bit`, Authorization: `bearer ${token}` } }))
      .body.channels["client-events"].states[0].activeEvents.map(({ eventType }) => eventType).filter((type) => type.startsWith("EventFlag.BR_S6_Island_"));
    const revision = async () => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/game/v2/calendar/revision",
      headers: { Authorization: `bearer ${token}` } })).body.revision;
    const move = (body) => post(backend.port, "/admin/api/events/dated-flags/move", null, body);

    for (const bad of [{ event: "island" }, { event: "island", to: "moveTo3" }, { event: "island", to: "nowhere" }]) {
      assert.equal((await move(bad)).status, 400, JSON.stringify(bad));
    }
    // Season 6's replay starts the day 6.00 is first served: over Loot Lake on its first day.
    for (const cl of [v600, v6000]) assert.deepEqual(await islandServed(cl), [islandRune(0)], cl);

    const before = await revision();
    const four = await move({ event: "island", to: "rune4" });
    assert.equal(four.status, 200);
    assert.deepEqual([four.body.movedTo, four.body.label, four.body.sinkAt], ["rune4", "Rune 4: Retail Row", null]);
    const status = four.body.datedFlags.events.find(({ id }) => id === "island");
    assert.deepEqual([status.mode, status.season, status.stage], ["custom", 6, { at: "rune4", toward: null }]);
    assert.notEqual(await revision(), before, "running gameservers see it");
    for (const cl of [v600, v6000]) assert.deepEqual(await islandServed(cl), [islandRune(4)], cl);
    assert.deepEqual(await islandServed(v600), [islandRune(4)]);

    assert.equal((await move({ event: "island", to: "lake" })).status, 200);
    assert.deepEqual(await islandServed(v600), [islandRune(0)]);

    // The Season 6 flags' switches show what 6.00 serves now.
    const flags = (await get(backend.port, "/admin/api/events/overview")).body.season4Flags;
    const group = flags.groups.find(({ id }) => id === "island");
    assert.equal(group.flags.find(({ flag }) => flag === islandRune(0)).servedOn600, true);
    assert.equal(group.flags.find(({ flag }) => flag === islandRune(4)).servedOn600, false);

    const back = await post(backend.port, "/admin/api/events/dated-flags", null, { event: "island", schedule: null, mode: "dates" });
    assert.equal(back.body.datedFlags.events.find(({ id }) => id === "island").mode, "dates");
    assert.deepEqual(await islandServed(v600), [islandRune(0)], "Epic's dates: its first day, over Loot Lake");
  } finally {
    await backend.close();
  }
});

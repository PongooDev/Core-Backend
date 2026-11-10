import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { cubeStates } from "../src/events/cube.js";
import { datedEvent, datedSchedulePatch, defaultDatedFlags, sanitizeDatedFlags, shiftedDatedSchedule, validDatedSchedule } from "../src/events/datedflags.js";
import { configureEvents, cubeLake, cubeMoveTo, cubeRune, cubeStartMove, cubeTurnOn, eventsActiveUntil, riftCorrupt, tomatoRiftEvent,
  tomatoRiftTell } from "../src/events/events.js";
import { tomatoRiftStates } from "../src/events/tomatorift.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Season 5's dated event-flag events on the admin's own times (Core-Backend #311): 5.30's Cube and 5.21's Tomato Town rift.
const v530 = "4305896";
const v521 = "4288479";
const cube = datedEvent("cube");
const tomato = datedEvent("tomatoRift");
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const hour = 3600000;
const types = (part) => part.events.map(({ eventType }) => eventType).sort();

test("the Cube's steps at Epic's spacing from any step, scaled", () => {
  const schedule = shiftedDatedSchedule(cube, { startAt: "2026-11-10T12:00:00Z", step: "spawn" });
  assert.equal(schedule.length, cube.steps.length);
  const of = (id) => schedule.find(({ step }) => step === id);
  assert.deepEqual(of("spawn"), { step: "spawn", startAt: "2026-11-10T12:00:00.000Z", endAt: null }, "the cube stays");
  assert.equal(of("lightning").startAt, "2026-11-10T12:00:00.000Z".replace("10T12", "09T12"), "the lightning a day before it");
  assert.deepEqual(of("rune1"), { step: "rune1", startAt: "2026-11-14T12:00:00.000Z", endAt: "2026-11-15T12:00:00.000Z" });
  assert.equal(of("lake").endAt, null);
  const fast = shiftedDatedSchedule(cube, { startAt: "2026-11-10T12:00:00Z", step: "spawn", scale: 0.5 });
  assert.equal(fast.find(({ step }) => step === "rune1").startAt, "2026-11-12T12:00:00.000Z", "twice as fast");
  // The default step: the purple crack.
  assert.equal(shiftedDatedSchedule(cube, { startAt: "2026-11-10T12:00:00Z" })[0].startAt, "2026-11-10T12:00:00.000Z");
  for (const bad of [{ startAt: "soon" }, { startAt: "2026-11-10T12:00:00Z", step: "nope" }, { startAt: "2026-11-10T12:00:00Z", scale: 0 },
    { startAt: "2026-11-10T12:00:00Z", scale: 11 }, { startAt: "2026-11-10T12:00:00Z", scale: "fast" }]) {
    assert.equal(shiftedDatedSchedule(cube, bad), null, JSON.stringify(bad));
  }
});

test("the dated schedules' input is checked, step by step over the current or seeded times", () => {
  assert.equal(validDatedSchedule(cube, [{ step: "spawn", startAt: "2026-11-10T12:00:00Z", endAt: "2026-11-10T11:00:00Z" }]), null, "an end before its start");
  assert.equal(validDatedSchedule(cube, [{ step: "spawn", startAt: "2026-11-10T12:00:00Z" }, { step: "spawn", startAt: "2026-11-11T12:00:00Z" }]), null, "a step twice");
  assert.equal(validDatedSchedule(cube, [{ step: "tell", startAt: "2026-11-10T12:00:00Z" }]), null, "another event's step");
  const seed = shiftedDatedSchedule(cube, { startAt: "2026-11-10T12:00:00Z" });
  const edited = datedSchedulePatch(cube, [{ step: "spawn", startAt: "2026-12-01T00:00:00Z", endAt: null }, { step: "lake", startAt: null, endAt: null }], [], seed);
  assert.equal(edited.length, cube.steps.length - 1, "seeded, the lake taken off");
  assert.equal(edited.find(({ step }) => step === "spawn").startAt, "2026-12-01T00:00:00.000Z");
  assert.equal(datedSchedulePatch(cube, [{ step: "nope", startAt: "2026-12-01T00:00:00Z" }], edited), null);
  assert.equal(datedSchedulePatch(cube, "soon", edited), null);
  assert.deepEqual(datedSchedulePatch(cube, null, edited), []);

  assert.deepEqual(sanitizeDatedFlags(undefined), defaultDatedFlags);
  const current = sanitizeDatedFlags({ cube: { mode: "custom", schedule: seed } });
  assert.equal(current.cube.schedule.length, cube.steps.length);
  assert.deepEqual(current.tomatoRift, { mode: "dates", schedule: [] });
  const kept = sanitizeDatedFlags({ cube: { mode: "sometimes", schedule: "soon" }, tomatoRift: { mode: "off" } }, current);
  assert.deepEqual(kept.cube, current.cube, "bad input keeps the current");
  assert.equal(kept.tomatoRift.mode, "off");
  assert.deepEqual(sanitizeDatedFlags({ cube: { schedule: null } }, current).cube.schedule, []);
});

test("5.30 serves the Cube by the admin's times, and none when it's off", () => {
  const start = Date.parse("2026-11-10T12:00:00Z");
  const schedule = shiftedDatedSchedule(cube, { startAt: new Date(start).toISOString(), step: "spawn", scale: 0.1 });
  const config = { mode: "auto", datedFlags: { cube: { mode: "custom", schedule } } };
  withConfig(config, () => {
    const before = inBuild(v530, () => cubeStates(new Date(start - hour)));
    assert.deepEqual(types(before[0]), [riftCorrupt, "EventFlag.BR_S5_Cube_Lightning"].sort(), "an hour before the cube: the crack and its lightning");
    const parts = inBuild(v530, () => cubeStates(new Date(start + hour)));
    assert.deepEqual(types(parts[0]), [cubeMoveTo(1), cubeStartMove, cubeTurnOn].sort(), "the cube is out and rolling");
    assert.equal(parts[0].events.find(({ eventType }) => eventType === cubeTurnOn).activeUntil, eventsActiveUntil, "it stays");
    // Rune 1 four days on at Epic's spacing, 9.6 hours at a tenth of it.
    assert.equal(parts[1].validFrom, start + 9.6 * hour);
    assert.deepEqual(types(parts[1]), [cubeRune(1), cubeTurnOn].sort());
    const late = inBuild(v530, () => cubeStates(new Date(start + 40 * 24 * hour)));
    assert.deepEqual(types(late[0]), [cubeLake, cubeTurnOn].sort(), "the lake for good");
    assert.equal(late.length, 1, "nothing changes after it");
    assert.deepEqual(inBuild(v521, () => cubeStates(new Date(start + hour))), [], "5.21 has no cube");
  });
  withConfig({ ...config, season4Flags: { overrides: { [cubeTurnOn]: "off" } } }, () => {
    assert.ok(!types(inBuild(v530, () => cubeStates(new Date(start + hour)))[0]).includes(cubeTurnOn), "its switch still wins");
  });
  withConfig({ mode: "auto", datedFlags: { cube: { mode: "off", schedule } } }, () => {
    assert.deepEqual(inBuild(v530, () => cubeStates(new Date(start + hour)))[0].events, []);
  });
});

test("5.21 serves Tomato Town's rift by the admin's times", () => {
  const start = Date.parse("2026-11-10T12:00:00Z");
  const schedule = shiftedDatedSchedule(tomato, { startAt: new Date(start).toISOString() });
  assert.deepEqual(schedule.find(({ step }) => step === "event"), { step: "event", startAt: "2026-11-10T12:00:00.000Z", endAt: null }, "the head comes out then");
  withConfig({ mode: "auto", datedFlags: { tomatoRift: { mode: "custom", schedule } } }, () => {
    const parts = inBuild(v521, () => tomatoRiftStates(new Date(start - hour)));
    assert.deepEqual(types(parts[0]), [tomatoRiftTell]);
    assert.equal(parts[1].validFrom, start);
    assert.deepEqual(parts[1].events, [{ eventType: tomatoRiftEvent, activeSince: "2026-11-10T12:00:00.000Z", activeUntil: eventsActiveUntil }]);
  });
});

test("the admin panel sets the Cube's times, checks them, and 5.30's timeline serves them", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Cube530");
    const timeline = async () => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": `game=FortniteGame, engine=UE4, build=++Fortnite+Release-5.30-CL-${v530}`, Authorization: `bearer ${token}` } })).body.channels["client-events"];
    const served = async () => (await timeline()).states[0].activeEvents.map(({ eventType }) => eventType);
    const dated = (body) => post(backend.port, "/admin/api/events/dated-flags", null, body);

    for (const bad of [{}, { event: "nope", mode: "off" }, { event: "cube" }, { event: "cube", mode: "sometimes" },
      { event: "cube", schedule: "soon" }, { event: "cube", schedule: { startAt: "soon" } },
      { event: "cube", schedule: [{ step: "spawn", startAt: "2026-11-10T12:00:00Z", endAt: "2026-11-10T11:00:00Z" }] }]) {
      assert.equal((await dated(bad)).status, 400, JSON.stringify(bad));
    }

    // Start the cube now: it appears and rolls toward rune 1.
    const now = await dated({ event: "cube", schedule: { startAt: new Date(Date.now() - 60000).toISOString(), step: "spawn" } });
    assert.equal(now.status, 200);
    const status = now.body.datedFlags.events.find(({ id }) => id === "cube");
    assert.equal(status.mode, "custom");
    assert.equal(status.schedule.length, cube.steps.length);
    assert.ok(status.steps.find(({ step }) => step === "spawn").current.startAt);
    const types530 = await served();
    assert.ok(types530.includes(cubeTurnOn) && types530.includes(cubeMoveTo(1)), types530.join(", "));

    // One step's times over the current ones: the spawn moved to tomorrow.
    const tomorrow = new Date(Date.now() + 24 * hour).toISOString();
    assert.equal((await dated({ event: "cube", schedule: [{ step: "spawn", startAt: tomorrow, endAt: null }] })).status, 200);
    assert.ok(!(await served()).includes(cubeTurnOn));

    // Off, then back to Epic's dates.
    assert.equal((await dated({ event: "cube", mode: "off" })).status, 200);
    assert.ok(!(await served()).some((type) => type.startsWith("EventFlag.BR_S5_Cube")));
    const back = await dated({ event: "cube", schedule: null, mode: "dates" });
    assert.deepEqual([back.body.datedFlags.events[0].mode, back.body.datedFlags.events[0].schedule], ["dates", []]);
    const overview = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/admin/api/events/overview" });
    assert.equal(overview.body.datedFlags.events.length, 2);

    // The custom mode alone starts from the replay's dates now.
    const custom = await dated({ event: "tomatoRift", mode: "custom" });
    assert.equal(custom.status, 200);
    assert.equal(custom.body.datedFlags.events.find(({ id }) => id === "tomatoRift").schedule.length, 2);
  } finally {
    await backend.close();
  }
});

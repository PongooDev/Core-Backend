import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { cubeStates } from "../src/events/cube.js";
import { cubeLakeLegSteps, datedEvent, datedFlagsStatus, datedMoveSchedule, datedRollSchedule, datedSchedulePatch, datedSinkSchedule, datedSpawnSchedule,
  defaultDatedFlags, sanitizeDatedFlags, shiftedDatedSchedule, sinkLeadSeconds, sinkPlaysSeconds, validDatedSchedule } from "../src/events/datedflags.js";
import { configureEvents, cubeDestination, cubeLake, cubeLightning, cubeMoveTo, cubeMoveToLake, cubeRune, cubeStartMove, cubeTurnOn, eventsActiveUntil,
  riftCorrupt, tomatoRiftEvent, tomatoRiftTell } from "../src/events/events.js";
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
    assert.equal(overview.body.datedFlags.events.length, 5, "the Cube, the floating island, High Stakes, the Birthday Challenges and Tomato Town's rift");

    // The custom mode alone starts from the replay's dates now.
    const custom = await dated({ event: "tomatoRift", mode: "custom" });
    assert.equal(custom.status, 200);
    assert.equal(custom.body.datedFlags.events.find(({ id }) => id === "tomatoRift").schedule.length, 2);
  } finally {
    await backend.close();
  }
});

// The Cube rolled to its next location from the admin panel (Core-Backend #322): its hill, each rune, then Loot Lake, each
// held from the roll on.
const v540 = "4352937";
const cubeStatus = (datedFlags, nowMs, momentMs = nowMs) => datedFlagsStatus(nowMs, momentMs, { datedFlags }).events.find(({ id }) => id === "cube");

test("the Cube's place on its schedule, and a roll to its next location that holds it there", () => {
  const start = Date.parse("2026-11-10T12:00:00Z");
  const schedule = shiftedDatedSchedule(cube, { startAt: new Date(start).toISOString(), step: "spawn", scale: 0.1 });
  const custom = { cube: { mode: "custom", schedule } };
  assert.deepEqual(cubeStatus(custom, start - hour).place, { now: "lightning", next: "spawn" }, "before it appears: its lightning");
  assert.deepEqual(cubeStatus(custom, start + hour).place, { now: "moveTo1", next: "rune1" }, "rolling to rune 1");
  assert.deepEqual(cubeStatus({ cube: { mode: "off" } }, start).place, { now: null, next: "spawn" }, "off: not on the island");
  assert.equal(datedFlagsStatus(start, start, {}).events.find(({ id }) => id === "tomatoRift").place, null, "only the Cube has places");

  // Rolled while it rolls to rune 1: rune 1 from now on, its appearing kept from its start, nothing else.
  const now = start + hour;
  const rolled = datedRollSchedule(cube, cubeStatus(custom, now).steps, now);
  assert.deepEqual(rolled, [{ step: "spawn", startAt: "2026-11-10T12:00:00.000Z", endAt: null },
    { step: "rune1", startAt: new Date(now).toISOString(), endAt: null }]);
  withConfig({ mode: "auto", datedFlags: { cube: { mode: "custom", schedule: rolled } } }, () => {
    const parts = inBuild(v530, () => cubeStates(new Date(now + 1000)));
    assert.deepEqual(types(parts[0]), [cubeRune(1), cubeTurnOn].sort(), "it prints rune 1");
    assert.equal(parts.length, 1, "and stays there");
  });

  // Roll on, one location at a time, to the lake, and no further.
  let current = rolled;
  let at = now;
  const visited = [];
  for (;;) {
    at += 60000;
    const status = cubeStatus({ cube: { mode: "custom", schedule: current } }, at);
    const next = datedRollSchedule(cube, status.steps, at);
    if (!next) {
      assert.deepEqual(status.place, { now: "lake", next: null });
      break;
    }
    assert.equal(next.at(-1).step, status.place.next);
    // Loot Lake is the sink, a minute on (Core-Backend #295); a rune is held from now.
    if (status.place.next === "lake") {
      assert.deepEqual(next, datedSinkSchedule(cube, at + sinkLeadSeconds * 1000));
      const rolling = cubeStatus({ cube: { mode: "custom", schedule: next } }, at + 1000);
      assert.deepEqual([rolling.place, rolling.sink.phase], [{ now: "moveToLake", next: "lake" }, "rollingIn"]);
      assert.equal(datedRollSchedule(cube, rolling.steps, at + 1000), null, "not again while it rolls in");
    } else {
      assert.deepEqual(next.map(({ step }) => step), ["spawn", status.place.next]);
    }
    visited.push(status.place.next);
    current = next;
  }
  assert.deepEqual(visited, ["rune2", "rune3", "rune4", "rune5", "rune6", "rune7", "lake"]);
  withConfig({ mode: "auto", datedFlags: { cube: { mode: "custom", schedule: current } } }, () => {
    assert.deepEqual(types(inBuild(v530, () => cubeStates(new Date(at)))[0]), [cubeLake, cubeTurnOn].sort(), "5.30's lake");
    assert.deepEqual(types(inBuild(v540, () => cubeStates(new Date(at)))[0]), [cubeDestination, cubeTurnOn].sort(), "5.40's");
  });

  // Not out yet: the first roll has it appear on its hill.
  assert.deepEqual(datedRollSchedule(cube, cubeStatus({ cube: { mode: "off" } }, start).steps, start),
    [{ step: "spawn", startAt: "2026-11-10T12:00:00.000Z", endAt: null }]);
});

test("rolled from Epic's dates on the replay: the next rune now, its appearing kept from the lap's", () => {
  // Season 5's replay at 2 September 2018 22:00 UTC: rune 2 (Greasy Grove) prints until 3 September 21:00.
  const nowMs = Date.parse("2026-11-10T12:00:00Z");
  const moment = Date.parse("2018-09-02T22:00:00Z");
  const status = cubeStatus({ cube: { mode: "dates" } }, nowMs, moment);
  assert.deepEqual(status.place, { now: "rune2", next: "rune3" });
  const appeared = nowMs - (moment - Date.parse("2018-08-24T21:00:00Z"));
  assert.deepEqual(datedRollSchedule(cube, status.steps, nowMs), [{ step: "spawn", startAt: new Date(appeared).toISOString(), endAt: null },
    { step: "rune3", startAt: new Date(nowMs).toISOString(), endAt: null }]);
  // On a leg (rolling to rune 3 on 4 September), the roll goes to the rune it rolls to.
  assert.deepEqual(cubeStatus({ cube: { mode: "dates" } }, nowMs, Date.parse("2018-09-04T12:00:00Z")).place, { now: "moveTo3", next: "rune3" });
});

test("the admin panel rolls the Cube to its next location, and 5.30's and 5.40's timelines serve it", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "CubeRoll");
    const served = async (cl, version) => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": `game=FortniteGame, engine=UE4, build=++Fortnite+Release-${version}-CL-${cl}`, Authorization: `bearer ${token}` } }))
      .body.channels["client-events"].states[0].activeEvents.map(({ eventType }) => eventType);
    const revision = async () => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/game/v2/calendar/revision",
      headers: { Authorization: `bearer ${token}` } })).body.revision;
    const roll = (body) => post(backend.port, "/admin/api/events/dated-flags/roll", null, body);

    for (const bad of [{}, { event: "nope" }, { event: "tomatoRift" }]) assert.equal((await roll(bad)).status, 400, JSON.stringify(bad));

    // Off first: the first roll has it appear on its hill, the next prints rune 1.
    assert.equal((await post(backend.port, "/admin/api/events/dated-flags", null, { event: "cube", mode: "off" })).status, 200);
    const before = await revision();
    const appear = await roll({ event: "cube" });
    assert.equal(appear.status, 200);
    assert.deepEqual([appear.body.rolledTo, appear.body.label], ["spawn", "The Cube appears (the crack closes)"]);
    assert.notEqual(await revision(), before, "running gameservers see the change");
    const first = await roll({ event: "cube" });
    assert.equal(first.body.rolledTo, "rune1");
    const status = first.body.datedFlags.events.find(({ id }) => id === "cube");
    assert.equal(status.mode, "custom");
    assert.deepEqual(status.place, { now: "rune1", next: "rune2" });
    for (const [cl, version] of [[v530, "5.30"], [v540, "5.40"]]) {
      const eventTypes = await served(cl, version);
      assert.ok(eventTypes.includes(cubeRune(1)) && eventTypes.includes(cubeTurnOn) && !eventTypes.includes(cubeMoveTo(1)), `${version}: ${eventTypes.join(", ")}`);
    }

    for (let rune = 2; rune <= 7; rune += 1) assert.equal((await roll({ event: "cube" })).body.rolledTo, `rune${rune}`);
    // The lake: its leg on now and the sink a minute on (Core-Backend #295).
    assert.equal((await roll({ event: "cube" })).body.rolledTo, "lake");
    const rollingIn = await served(v540, "5.40");
    assert.ok(rollingIn.includes(cubeMoveTo(8)) && !rollingIn.includes(cubeDestination), rollingIn.join(", "));
    assert.equal((await roll({ event: "cube" })).status, 400, "nothing more while it rolls into the lake");

    // Back to Epic's dates.
    const back = await post(backend.port, "/admin/api/events/dated-flags", null, { event: "cube", schedule: null, mode: "dates" });
    const cubeBack = back.body.datedFlags.events.find(({ id }) => id === "cube");
    assert.deepEqual([cubeBack.mode, cubeBack.schedule], ["dates", []]);
  } finally {
    await backend.close();
  }
});

// The Cube's appearing, the Crack Closure (Core-Backend #295): every step at Epic's spacing from it, the lightning ending as
// it appears, so 5.30's CUBE and BP_Athena_Event_Components play the final bolt and the spawn at the lightning's end.
test("the Cube's appearing: the crack and the lightning end as it appears, at Epic's spacing", () => {
  const spawnAt = Date.parse("2026-11-10T12:00:00Z");
  const schedule = datedSpawnSchedule(cube, spawnAt);
  const of = (id) => schedule.find(({ step }) => step === id);
  assert.equal(schedule.length, cube.steps.length);
  assert.deepEqual(of("spawn"), { step: "spawn", startAt: "2026-11-10T12:00:00.000Z", endAt: null }, "it stays out");
  assert.deepEqual(of("lightning"), { step: "lightning", startAt: "2026-11-09T12:00:00.000Z", endAt: "2026-11-10T12:00:00.000Z" }, "a day of lightning to it");
  assert.deepEqual(of("crack"), { step: "crack", startAt: "2026-11-08T23:00:00.000Z", endAt: "2026-11-10T12:00:00.000Z" }, "the purple crack from 37 hours before");
  assert.equal(of("moveTo1").startAt, "2026-11-10T12:00:00.000Z", "it starts rolling then");
  assert.equal(of("rune1").startAt, "2026-11-14T12:00:00.000Z", "rune 1 four days on");
  assert.equal(datedSpawnSchedule(tomato, spawnAt), null, "only the Cube appears");
  assert.equal(datedSpawnSchedule(cube, Number.NaN), null);

  // Its status: when it appears now and Epic's, and the phase.
  const custom = { cube: { mode: "custom", schedule } };
  const at = (nowMs) => cubeStatus(custom, nowMs).spawn;
  assert.deepEqual(at(spawnAt - 2 * hour), { at: "2026-11-10T12:00:00.000Z", original: "2018-08-24T21:00:00.000Z", phase: "scheduled" });
  assert.equal(at(spawnAt - 10 * 60000).phase, "lightning", "the strikes in its last hour");
  assert.equal(at(spawnAt).phase, "spawned");
  assert.deepEqual(cubeStatus({ cube: { mode: "off" } }, spawnAt).spawn, { at: null, original: "2018-08-24T21:00:00.000Z", phase: "unscheduled" });
  assert.equal(datedFlagsStatus(spawnAt, spawnAt, {}).events.find(({ id }) => id === "tomatoRift").spawn, null);

  // 5.30's timeline 30 seconds before: the lightning newly on, ending as the Cube's part starts; 5.40 has no lightning.
  withConfig({ mode: "auto", datedFlags: custom }, () => {
    const parts = inBuild(v530, () => cubeStates(new Date(spawnAt - 30000)));
    assert.deepEqual(types(parts[0]), [riftCorrupt, cubeLightning].sort());
    assert.deepEqual(parts[0].events.find(({ eventType }) => eventType === cubeLightning),
      { eventType: cubeLightning, activeSince: "2026-11-09T12:00:00.000Z", activeUntil: "2026-11-10T12:00:00.000Z" });
    assert.equal(parts[1].validFrom, spawnAt);
    assert.deepEqual(types(parts[1]), [cubeMoveTo(1), cubeStartMove, cubeTurnOn].sort(), "the Cube out and rolling as the lightning ends");
    const parts540 = inBuild(v540, () => cubeStates(new Date(spawnAt - 30000)));
    assert.deepEqual(parts540[0].events, [], "5.40: nothing before");
    assert.deepEqual(types(parts540[1]), [cubeMoveTo(1), cubeStartMove, cubeTurnOn].sort(), "it just appears");
    const parts541 = inBuild("4363240", () => cubeStates(new Date(spawnAt - 30000)));
    assert.deepEqual([parts541[0].events, types(parts541[1])], [[], types(parts540[1])], "5.41 as 5.40");
  });
});

test("the admin panel spawns the Cube now or at a time, and 5.30's timeline counts the lightning to it", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "CubeSpawn");
    const timeline = async (cl = v530, version = "5.30") => (await send({ host: "127.0.0.1", port: backend.port, method: "GET",
      path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": `game=FortniteGame, engine=UE4, build=++Fortnite+Release-${version}-CL-${cl}`, Authorization: `bearer ${token}` } }))
      .body.channels["client-events"];
    const revision = async () => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/game/v2/calendar/revision",
      headers: { Authorization: `bearer ${token}` } })).body.revision;
    const spawn = (body) => post(backend.port, "/admin/api/events/dated-flags/spawn", null, body);

    for (const bad of [{}, { event: "nope" }, { event: "tomatoRift" }, { event: "cube", inSeconds: 5 }, { event: "cube", inSeconds: "soon" },
      { event: "cube", inSeconds: 8 * 86400 }, { event: "cube", at: "soon" }, { event: "cube", at: 5 }]) {
      assert.equal((await spawn(bad)).status, 400, JSON.stringify(bad));
    }

    // Now: in 30 seconds, the lightning on until then.
    const before = await revision();
    const sent = Date.now();
    const now = await spawn({ event: "cube" });
    assert.equal(now.status, 200);
    const spawnAt = Date.parse(now.body.spawnAt);
    assert.ok(spawnAt >= sent + 30000 && spawnAt <= Date.now() + 30000, now.body.spawnAt);
    assert.notEqual(await revision(), before, "running gameservers see it");
    const status = now.body.datedFlags.events.find(({ id }) => id === "cube");
    assert.equal(status.mode, "custom");
    assert.deepEqual(status.spawn, { at: now.body.spawnAt, original: "2018-08-24T21:00:00.000Z", phase: "lightning" });
    const channel = await timeline();
    const lightning = channel.states[0].activeEvents.find(({ eventType }) => eventType === cubeLightning);
    assert.equal(lightning?.activeUntil, now.body.spawnAt, "the lightning ends as it appears");
    assert.ok(!channel.states[0].activeEvents.some(({ eventType }) => eventType === cubeTurnOn), "not out yet");
    assert.equal(channel.states[1].validFrom, now.body.spawnAt);
    assert.ok(channel.states[1].activeEvents.some(({ eventType }) => eventType === cubeTurnOn));
    assert.ok(Date.parse(channel.cacheExpire) <= spawnAt, "asked again by then");
    assert.ok(!(await timeline(v540, "5.40")).states[0].activeEvents.some(({ eventType }) => eventType === cubeLightning), "5.40 has no lightning");

    // The countdown, and a time of the admin's.
    const countdown = await spawn({ event: "cube", inSeconds: 600 });
    assert.equal(countdown.body.datedFlags.events.find(({ id }) => id === "cube").spawn.phase, "lightning");
    const later = await spawn({ event: "cube", at: "2030-01-01T18:00:00Z" });
    assert.equal(later.body.spawnAt, "2030-01-01T18:00:00.000Z");
    const scheduled = later.body.datedFlags.events.find(({ id }) => id === "cube");
    assert.equal(scheduled.spawn.phase, "scheduled");
    assert.equal(scheduled.steps.find(({ step }) => step === "lightning").current.endAt, "2030-01-01T18:00:00.000Z");
  } finally {
    await backend.close();
  }
});

// The Cube sinking into Loot Lake (Core-Backend #295): 5.40's and 5.41's CUBE roll it onto the water as its leg to the lake
// ends, in a match where that leg turned on in its last 104th, then sink it and turn the lake bouncy (events/datedflags.js).
const v541 = "4363240";
const isoOf = (ms) => new Date(ms).toISOString();

test("the Cube's sinking: its leg to the lake ends as it rolls onto the water, at Epic's spacing", () => {
  const sinkAt = Date.parse("2026-11-10T12:00:00Z");
  const schedule = datedSinkSchedule(cube, sinkAt);
  const of = (id) => schedule.find(({ step }) => step === id);
  assert.equal(schedule.length, cube.steps.length);
  assert.deepEqual(of("lake"), { step: "lake", startAt: "2026-11-10T12:00:00.000Z", endAt: null }, "the lake stays bouncy");
  assert.deepEqual(of("moveToLake"), { step: "moveToLake", startAt: "2026-11-08T12:00:00.000Z", endAt: "2026-11-10T12:00:00.000Z" }, "two days' roll to it");
  assert.deepEqual(of("rune7"), { step: "rune7", startAt: "2026-11-07T12:00:00.000Z", endAt: "2026-11-08T12:00:00.000Z" });
  assert.equal(of("spawn").endAt, null, "out all along");
  assert.equal(datedSinkSchedule(tomato, sinkAt), null, "only the Cube sinks");
  assert.equal(datedSinkSchedule(cube, Number.NaN), null);

  // Its status: matches that start in the leg's last 104th play it.
  const custom = { cube: { mode: "custom", schedule } };
  const sink = (nowMs) => cubeStatus(custom, nowMs).sink;
  const playsFrom = isoOf(sinkAt - Math.floor(2 * 24 * hour / cubeLakeLegSteps));
  assert.deepEqual(sink(sinkAt - 3 * 24 * hour), { at: "2026-11-10T12:00:00.000Z", original: "2018-09-19T21:00:00.000Z", playsFrom, phase: "scheduled" });
  assert.equal(sink(sinkAt - hour).phase, "rolling");
  assert.equal(sink(sinkAt - 60000).phase, "rollingIn");
  assert.equal(sink(sinkAt).phase, "sinking");
  assert.equal(sink(sinkAt + sinkPlaysSeconds * 1000).phase, "sunk");
  assert.deepEqual(cubeStatus({ cube: { mode: "off" } }, sinkAt).sink, { at: null, original: "2018-09-19T21:00:00.000Z", playsFrom: null, phase: "unscheduled" });
  assert.equal(datedFlagsStatus(sinkAt, sinkAt, {}).events.find(({ id }) => id === "tomatoRift").sink, null);
  assert.deepEqual(cubeStatus(custom, sinkAt - 60000).stage, { at: "rune7", toward: "lake" }, "rolling from rune 7");
  assert.deepEqual(cubeStatus(custom, sinkAt).stage, { at: "lake", toward: null });

  // A minute before, 5.40's and 5.41's timelines have the leg newly on in its last 104th: CUBE's CalculateNextMove puts the
  // Cube at Runes[6] (460) plus the leg's progress times its 104 steps, the lake's edge (563), and IncrementIndex rolls it
  // onto the water (564) 12.5 seconds before the leg's end, from a timer that has to be above zero. The lake from then.
  withConfig({ mode: "auto", datedFlags: custom }, () => {
    const nowMs = sinkAt - 60000;
    for (const cl of [v540, v541]) {
      const parts = inBuild(cl, () => cubeStates(new Date(nowMs)));
      assert.deepEqual(types(parts[0]), [cubeMoveTo(8), cubeStartMove, cubeTurnOn].sort(), cl);
      const leg = parts[0].events.find(({ eventType }) => eventType === cubeMoveTo(8));
      const untilEnd = Date.parse(leg.activeUntil) - nowMs;
      const total = Date.parse(leg.activeUntil) - Date.parse(leg.activeSince);
      assert.equal(460 + Math.floor((1 - untilEnd / total) * cubeLakeLegSteps), 563, "the lake's edge");
      assert.ok(untilEnd / 1000 - 12.5 - 5 > 0, "time for the roll onto the water");
      assert.equal(parts[0].events.find(({ eventType }) => eventType === cubeStartMove).activeUntil, leg.activeUntil, "its roll timer reads the leg's end");
      assert.equal(parts[1].validFrom, sinkAt);
      assert.deepEqual(types(parts[1]), [cubeDestination, cubeTurnOn].sort(), "the lake for good");
    }
    const parts530 = inBuild(v530, () => cubeStates(new Date(nowMs)));
    assert.deepEqual([types(parts530[0]), types(parts530[1])], [[cubeMoveToLake, cubeStartMove, cubeTurnOn].sort(), [cubeLake, cubeTurnOn].sort()], "5.30's names");
    assert.deepEqual(inBuild("4402180", () => cubeStates(new Date(nowMs))), [], "6.00 places no Cube");
  });
});

test("the Cube's stages: straight to any stop now and held there, Loot Lake the sink a minute on", () => {
  const start = Date.parse("2026-11-10T12:00:00Z");
  const custom = { cube: { mode: "custom", schedule: shiftedDatedSchedule(cube, { startAt: isoOf(start), step: "spawn", scale: 0.1 }) } };
  const now = start + hour;
  const status = cubeStatus(custom, now);
  assert.deepEqual(status.stage, { at: "spawn", toward: "rune1" }, "rolling from its hill to rune 1");
  assert.deepEqual(status.stops.map(({ id }) => id), ["spawn", "rune1", "rune2", "rune3", "rune4", "rune5", "rune6", "rune7", "lake"]);
  assert.deepEqual([status.stops[0].label, status.stops[3].label, status.stops[8].label], ["Its hill (Paradise Palms)", "Rune 3: Salty Springs", "Loot Lake"]);
  assert.equal(datedFlagsStatus(now, now, {}).events.find(({ id }) => id === "tomatoRift").stops, null);

  // Straight to rune 5: its appearing kept, rune 5 from now; 5.40 serves it, and it stays.
  const five = datedMoveSchedule(cube, status.steps, "rune5", now);
  assert.deepEqual(five, [{ step: "spawn", startAt: isoOf(start), endAt: null }, { step: "rune5", startAt: isoOf(now), endAt: null }]);
  withConfig({ mode: "auto", datedFlags: { cube: { mode: "custom", schedule: five } } }, () => {
    const parts = inBuild(v540, () => cubeStates(new Date(now + 1000)));
    assert.deepEqual([types(parts[0]), parts.length], [[cubeRune(5), cubeTurnOn].sort(), 1]);
  });
  const atFive = cubeStatus({ cube: { mode: "custom", schedule: five } }, now + 1000);
  assert.deepEqual(atFive.stage, { at: "rune5", toward: null });
  // And back to rune 2.
  assert.deepEqual(datedMoveSchedule(cube, atFive.steps, "rune2", now + 2000),
    [{ step: "spawn", startAt: isoOf(start), endAt: null }, { step: "rune2", startAt: isoOf(now + 2000), endAt: null }]);
  // Its hill: its appearing alone, kept.
  assert.deepEqual(datedMoveSchedule(cube, atFive.steps, "spawn", now + 2000), [{ step: "spawn", startAt: isoOf(start), endAt: null }]);
  // Not out yet: it appears now, with the rune.
  assert.deepEqual(datedMoveSchedule(cube, cubeStatus({ cube: { mode: "off" } }, now).steps, "rune3", now),
    [{ step: "spawn", startAt: isoOf(now), endAt: null }, { step: "rune3", startAt: isoOf(now), endAt: null }]);
  // Loot Lake: the sink, a minute on.
  const lake = datedMoveSchedule(cube, status.steps, "lake", now);
  assert.deepEqual(lake, datedSinkSchedule(cube, now + sinkLeadSeconds * 1000));
  assert.deepEqual(cubeStatus({ cube: { mode: "custom", schedule: lake } }, now + 1000).stage, { at: "rune7", toward: "lake" });
  // Only its stops.
  assert.equal(datedMoveSchedule(cube, status.steps, "moveTo3", now), null);
  assert.equal(datedMoveSchedule(tomato, datedFlagsStatus(now, now, {}).events.find(({ id }) => id === "tomatoRift").steps, "event", now), null);
});

test("the admin panel moves the Cube to any stop and sinks it now or at a time, and 5.40's and 5.41's timelines serve it", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "CubeSink");
    const timeline = async (cl, version) => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": `game=FortniteGame, engine=UE4, build=++Fortnite+Release-${version}-CL-${cl}`, Authorization: `bearer ${token}` } }))
      .body.channels["client-events"];
    const served = async (cl, version) => (await timeline(cl, version)).states[0].activeEvents.map(({ eventType }) => eventType);
    const revision = async () => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/game/v2/calendar/revision",
      headers: { Authorization: `bearer ${token}` } })).body.revision;
    const move = (body) => post(backend.port, "/admin/api/events/dated-flags/move", null, body);
    const sink = (body) => post(backend.port, "/admin/api/events/dated-flags/sink", null, body);

    for (const bad of [{}, { event: "tomatoRift", to: "event" }, { event: "cube" }, { event: "cube", to: "moveTo3" }, { event: "cube", to: "nowhere" }]) {
      assert.equal((await move(bad)).status, 400, JSON.stringify(bad));
    }
    for (const bad of [{}, { event: "nope" }, { event: "tomatoRift" }, { event: "cube", inSeconds: 10 }, { event: "cube", inSeconds: "soon" },
      { event: "cube", inSeconds: 8 * 86400 }, { event: "cube", at: "soon" }, { event: "cube", at: 5 }]) {
      assert.equal((await sink(bad)).status, 400, JSON.stringify(bad));
    }

    // Straight to rune 4, then back to rune 1: each newly on, so a running match rolls onto it and prints it.
    let before = await revision();
    const four = await move({ event: "cube", to: "rune4" });
    assert.equal(four.status, 200);
    assert.deepEqual([four.body.movedTo, four.body.label, four.body.sinkAt], ["rune4", "Rune 4: Retail Row", null]);
    const fourStatus = four.body.datedFlags.events.find(({ id }) => id === "cube");
    assert.deepEqual([fourStatus.mode, fourStatus.stage], ["custom", { at: "rune4", toward: null }]);
    assert.notEqual(await revision(), before, "running gameservers see it");
    for (const [cl, version] of [[v540, "5.40"], [v541, "5.41"], [v530, "5.30"]]) {
      const eventTypes = await served(cl, version);
      assert.ok(eventTypes.includes(cubeRune(4)) && eventTypes.includes(cubeTurnOn), `${version}: ${eventTypes.join(", ")}`);
    }
    assert.equal((await move({ event: "cube", to: "rune1" })).body.datedFlags.events.find(({ id }) => id === "cube").stage.at, "rune1");
    assert.ok((await served(v540, "5.40")).includes(cubeRune(1)));

    // Loot Lake from the stops: the sink a minute on.
    const lake = await move({ event: "cube", to: "lake" });
    assert.ok(Date.parse(lake.body.sinkAt) > Date.now() + 50000, lake.body.sinkAt);
    assert.equal(lake.body.datedFlags.events.find(({ id }) => id === "cube").sink.phase, "rollingIn");

    // Sink now: the leg to the lake on until it rolls onto the water a minute on, the lake from then.
    before = await revision();
    const sent = Date.now();
    const now = await sink({ event: "cube" });
    assert.equal(now.status, 200);
    const sinkAt = Date.parse(now.body.sinkAt);
    assert.ok(sinkAt >= sent + 60000 && sinkAt <= Date.now() + 60000, now.body.sinkAt);
    assert.notEqual(await revision(), before, "running gameservers see it");
    const status = now.body.datedFlags.events.find(({ id }) => id === "cube");
    assert.deepEqual([status.sink.at, status.sink.phase, status.stage], [now.body.sinkAt, "rollingIn", { at: "rune7", toward: "lake" }]);
    for (const [cl, version] of [[v540, "5.40"], [v541, "5.41"]]) {
      const channel = await timeline(cl, version);
      const leg = channel.states[0].activeEvents.find(({ eventType }) => eventType === cubeMoveTo(8));
      assert.equal(leg?.activeUntil, now.body.sinkAt, `${version}: its leg ends as it rolls onto the water`);
      assert.ok(!channel.states[0].activeEvents.some(({ eventType }) => eventType === cubeDestination), "not sunk yet");
      assert.equal(channel.states[1].validFrom, now.body.sinkAt);
      assert.ok(channel.states[1].activeEvents.some(({ eventType }) => eventType === cubeDestination), "the lake from then");
    }

    // A time of the admin's, and back to Epic's dates.
    const later = await sink({ event: "cube", at: "2030-01-01T18:00:00Z" });
    assert.equal(later.body.sinkAt, "2030-01-01T18:00:00.000Z");
    const scheduled = later.body.datedFlags.events.find(({ id }) => id === "cube");
    assert.equal(scheduled.sink.phase, "scheduled");
    assert.equal(scheduled.steps.find(({ step }) => step === "moveToLake").current.endAt, "2030-01-01T18:00:00.000Z");
    const back = await post(backend.port, "/admin/api/events/dated-flags", null, { event: "cube", schedule: null, mode: "dates" });
    assert.equal(back.body.datedFlags.events.find(({ id }) => id === "cube").mode, "dates");
  } finally {
    await backend.close();
  }
});

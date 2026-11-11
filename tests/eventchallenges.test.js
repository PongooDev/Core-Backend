import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { birthdayChallengeFlagsNow, birthdayChallengeStates } from "../src/events/birthday2018.js";
import { datedEvent, defaultDatedFlags, sanitizeDatedFlags, shiftedDatedSchedule } from "../src/events/datedflags.js";
import { activeEventFlags, anniversary2018BR, birthday2018, birthdayBattleBus, configureEvents, isEventActive } from "../src/events/events.js";
import { athenaQuestLogin } from "../src/profiles/athena.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// The admin panel's event challenges (Core-Backend #316): 5.10's Birthday Challenges on or off and when, by default as
// the build serves them.
const v510 = "4240749";
const v521 = "4288479";
const v530 = "4305896";
const birthday = datedEvent("birthday");
const replay = { mode: "auto", seasonStarts: { 5: "2018-07-12" } };
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const hour = 3600000;
const at = (iso) => new Date(iso);
const scheduleId = "challengebundleschedule:schedule_birthday2018_br";
const withStore = (run) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-eventchallenges-"));
  try {
    return run(dataDir);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

test("the Birthday Challenges default to the build's own, and only they take that mode", () => {
  assert.deepEqual(defaultDatedFlags.birthday, { mode: "build", schedule: [] });
  assert.equal(defaultDatedFlags.highStakes.mode, "dates");
  assert.equal(sanitizeDatedFlags({ cube: { mode: "build" } }).cube.mode, "dates", "the Cube has no build mode");
  assert.equal(sanitizeDatedFlags({ birthday: { mode: "off" } }).birthday.mode, "off");
  withConfig(replay, () => {
    assert.ok(activeEventFlags(v510).includes(anniversary2018BR), "5.10 serves it itself, as before");
    assert.deepEqual(inBuild(v510, () => birthdayChallengeStates(at("2018-07-30T12:00:00Z"))), []);
    assert.ok(!activeEventFlags(v521).includes(anniversary2018BR), "5.21 doesn't by itself");
  });
});

test("on Epic's dates, the admin's times or off, the Birthday Challenges' flag follows them on 5.10 and 5.21", () => {
  withConfig({ ...replay, datedFlags: { birthday: { mode: "dates" } } }, () => {
    assert.ok(!activeEventFlags(v510).includes(anniversary2018BR), "not the build's own any more");
    assert.ok(activeEventFlags(v510).includes(birthdayBattleBus) && isEventActive(birthday2018, v510), "the Birthday's other flags run on");
    const types = (build, iso) => inBuild(build, () => birthdayChallengeStates(at(iso)))[0]?.events.map(({ eventType }) => eventType) ?? [];
    assert.deepEqual(types(v510, "2018-07-20T12:00:00Z"), []);
    assert.deepEqual(types(v510, "2018-07-30T12:00:00Z"), [anniversary2018BR]);
    assert.equal(inBuild(v510, () => birthdayChallengeStates(at("2018-07-30T12:00:00Z")))[0].events[0].activeUntil, "2018-08-07T00:00:00.000Z");
    assert.deepEqual(types(v521, "2018-07-30T12:00:00Z"), [anniversary2018BR], "5.21 has the schedule too");
    assert.deepEqual(types(v510, "2018-08-08T12:00:00Z"), []);
    assert.deepEqual(inBuild(v530, () => birthdayChallengeStates(at("2018-07-30T12:00:00Z"))), [], "5.30 has no Birthday");
  });
  const start = Date.parse("2026-11-10T12:00:00Z");
  const schedule = [{ step: "challenges", startAt: new Date(start).toISOString(), endAt: new Date(start + 72 * hour).toISOString() }];
  withConfig({ ...replay, datedFlags: { birthday: { mode: "custom", schedule } } }, () => {
    const parts = inBuild(v510, () => birthdayChallengeStates(new Date(start - hour)));
    assert.deepEqual(parts[0].events, []);
    assert.equal(parts[1].validFrom, start);
    assert.deepEqual(parts[1].events, [{ eventType: anniversary2018BR, activeSince: "2026-11-10T12:00:00.000Z", activeUntil: "2026-11-13T12:00:00.000Z" }]);
    assert.deepEqual(inBuild(v510, () => birthdayChallengeFlagsNow(new Date(start + hour))), [anniversary2018BR]);
    assert.deepEqual(inBuild(v510, () => birthdayChallengeFlagsNow(new Date(start + 73 * hour))), []);
  });
  // A whole schedule from one start, as the other dated events.
  assert.equal(shiftedDatedSchedule(birthday, { startAt: "2026-11-10T12:00:00Z" })[0].endAt, "2026-11-24T12:00:00.000Z", "Epic's two weeks");
  withConfig({ ...replay, datedFlags: { birthday: { mode: "off" } } }, () => {
    assert.ok(!activeEventFlags(v510).includes(anniversary2018BR));
    assert.deepEqual(inBuild(v510, () => birthdayChallengeFlagsNow(at("2018-07-30T12:00:00Z"))), []);
  });
  withConfig({ ...replay, datedFlags: { birthday: { mode: "off" } }, season4Flags: { overrides: { [anniversary2018BR]: "on" } } }, () => {
    assert.ok(activeEventFlags(v510).includes(anniversary2018BR), "its switch still wins");
  });
});

test("the quest login gives the Birthday Challenges only while they're on", () => withStore((dataDir) => {
  const store = createProfileStore(dataDir);
  const has = (session) => Object.values(session.profile("athena").profile.items).some((item) => item.templateId.toLowerCase() === scheduleId);
  withConfig({ ...replay, datedFlags: { birthday: { mode: "off" } } }, () => inBuild(v510, () => {
    const session = openSession(store, "birthdayOff");
    athenaQuestLogin(session);
    assert.ok(!has(session), "off: not given");
  }));
  const schedule = [{ step: "challenges", startAt: new Date(Date.now() + 24 * hour).toISOString(), endAt: null }];
  withConfig({ ...replay, datedFlags: { birthday: { mode: "custom", schedule } } }, () => inBuild(v510, () => {
    const session = openSession(store, "birthdayLater");
    athenaQuestLogin(session);
    assert.ok(!has(session), "before its start: not given");
  }));
  const now = [{ step: "challenges", startAt: new Date(Date.now() - hour).toISOString(), endAt: null }];
  withConfig({ ...replay, datedFlags: { birthday: { mode: "custom", schedule: now } } }, () => inBuild(v521, () => {
    const session = openSession(store, "birthday521");
    athenaQuestLogin(session);
    assert.ok(has(session), "on 5.21 at the admin's times");
  }));
}));

test("the admin panel turns the Birthday Challenges off, times them, and 5.10's timeline follows", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Birthday510");
    const timeline = async () => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": `game=FortniteGame, engine=UE4, build=++Fortnite+Release-5.10-CL-${v510}`, Authorization: `bearer ${token}` } })).body.channels["client-events"];
    const birthdayEvent = async () => (await timeline()).states[0].activeEvents.find(({ eventType }) => eventType === anniversary2018BR);
    const dated = (body) => post(backend.port, "/admin/api/events/dated-flags", null, body);

    assert.ok(await birthdayEvent(), "served by default");
    assert.equal((await dated({ event: "cube", mode: "build" })).status, 400, "only the Birthday has the build mode");
    const off = await dated({ event: "birthday", mode: "off" });
    assert.equal(off.status, 200);
    const status = off.body.datedFlags.events.find(({ id }) => id === "birthday");
    assert.deepEqual([status.mode, status.challenges, status.modes], ["off", "Schedule_Birthday2018_BR", ["build", "dates", "custom", "off"]]);
    assert.equal(await birthdayEvent(), undefined, "off: not served");

    const endAt = new Date(Date.now() + 48 * hour).toISOString();
    const timed = await dated({ event: "birthday", schedule: [{ step: "challenges", startAt: new Date(Date.now() - hour).toISOString(), endAt }] });
    assert.equal(timed.body.datedFlags.events.find(({ id }) => id === "birthday").mode, "custom");
    assert.equal((await birthdayEvent()).activeUntil, endAt, "the challenges count down to the admin's end");

    // Cleared, back to the build's own.
    const back = await dated({ event: "birthday", schedule: null });
    assert.equal(back.body.datedFlags.events.find(({ id }) => id === "birthday").mode, "build");
    assert.ok(await birthdayEvent());
  } finally {
    await backend.close();
  }
});

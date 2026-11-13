import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { configureEvents, eventsActiveUntil, ltmFortnitemares } from "../src/events/events.js";
import { fortnitemaresActiveUntil } from "../src/events/fortnitemares2018.js";
import { defaultReplacements, ltmFrontEndPlaylists } from "../src/events/ltms.js";
import { athenaQuestLogin, seasonRewardFunctions, setUpAthena } from "../src/profiles/athena.js";
import { configureChallenges, eventChallengeUnlock, eventDaySchedules, eventPlan, settleChallengeSchedules } from "../src/profiles/challenges.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { createSettingsStore } from "../src/settings/store.js";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #345 (the Fortnitemares Challenges' end and parts) and #348 (Fortnitemares in the default modes' place, and
// its tiles: tests/playlist-images.test.js) on 6.20 (CL-4497486) and 6.21 (CL-4526925).
const v620 = "4497486";
const v621 = "4526925";
const v610 = "4480234";
const v541 = "4363240";
const replay = { mode: "auto", seasonStarts: { 6: "2018-09-27" } };
const at = (iso) => new Date(iso);
const agentOf = (build, version) => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const withSession = (build, name, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-fnm-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
const withChallengeSettings = (value, run) => {
  configureChallenges(value);
  try {
    return run();
  } finally {
    configureChallenges(undefined);
  }
};

test("#345: LTM_Fortnitemares ends on 4 November 2018 18:00 UTC on Season 6's replay, not never; other flags and builds as they were", () => {
  withConfig(replay, () => {
    // The replay's 26 October: the end is 9 days 6 hours on.
    assert.equal(inBuild(v620, () => fortnitemaresActiveUntil(ltmFortnitemares, at("2018-10-26T12:00:00Z"))), "2018-11-04T18:00:00.000Z");
    assert.equal(inBuild(v621, () => fortnitemaresActiveUntil(ltmFortnitemares, at("2018-11-02T00:00:00Z"))), "2018-11-04T18:00:00.000Z");
    // Past it, the replay's next lap (70 days).
    assert.equal(inBuild(v620, () => fortnitemaresActiveUntil(ltmFortnitemares, at("2018-11-05T00:00:00Z"))), "2019-01-13T18:00:00.000Z");
    assert.equal(inBuild(v620, () => fortnitemaresActiveUntil("EventFlag.LobbySeason6Halloween", at("2018-10-26T12:00:00Z"))), eventsActiveUntil);
    assert.equal(inBuild(v610, () => fortnitemaresActiveUntil(ltmFortnitemares, at("2018-10-26T12:00:00Z"))), eventsActiveUntil, "6.10 runs no Fortnitemares");
  });
});

test("#345: the calendar serves LTM_Fortnitemares' end to 6.20 and 6.21 (the challenges header's days), the other flags never ending", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Calendar345");
    const timeline = async (build, version) => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": agentOf(build, version), Authorization: `bearer ${token}` } })).body;
    for (const [build, version] of [[v620, "6.20"], [v621, "6.21"]]) {
      const before = Date.now();
      const events = (await timeline(build, version)).channels["client-events"].states[0].activeEvents;
      const own = events.find((event) => event.eventType === ltmFortnitemares);
      assert.ok(own, version);
      assert.match(own.activeUntil, /T18:00:00\.000Z$/, version);
      const until = Date.parse(own.activeUntil);
      assert.ok(until > before && until <= before + 70 * 86400000, `${version}: ${own.activeUntil}`);
      assert.ok(events.filter((event) => event.eventType !== ltmFortnitemares && event.eventType.startsWith("EventFlag.") && !event.activeSince)
        .every((event) => event.activeUntil === eventsActiveUntil), version);
    }
  } finally {
    backend.close();
  }
});

test("#345: the Fortnitemares parts unlock on the files' days of the replay by default, as the client counts them", () => {
  for (const build of [v620, v621]) {
    withConfig(replay, () => inBuild(build, () => {
      assert.deepEqual(eventDaySchedules(), ["schedule_fortnitemares"], build);
      const plan = eventPlan("schedule_fortnitemares", at("2018-10-26T12:00:00Z"), {});
      assert.equal(plan.mode, "original");
      assert.equal(plan.eventName, ltmFortnitemares);
      assert.deepEqual(plan.parts.map(({ part, bundle, unlocked, unlocksAt }) => [part, bundle, unlocked, unlocksAt]), [
        [1, "questbundle_fortnitemares_part1", true, null],
        [2, "questbundle_fortnitemares_part2", false, "2018-10-29T00:00:00.000Z"],
        [3, "questbundle_fortnitemares_part3", false, "2018-10-31T00:00:00.000Z"],
        [4, "questbundle_fortnitemares_part4", false, "2018-11-02T00:00:00.000Z"]], build);
      assert.deepEqual(eventPlan("schedule_fortnitemares", at("2018-10-31T00:00:00Z"), {}).parts.map(({ unlocked }) => unlocked), [true, true, true, false], build);
    }));
  }
  // A build without the schedule has no event challenges.
  assert.deepEqual(inBuild(v610, eventDaySchedules), []);
  assert.deepEqual(inBuild(v541, eventDaySchedules), []);
});

test("#345: the admin's manual parts and Unlock all parts now give the parts at the next login", () => {
  withConfig(replay, () => withSession(v620, "fnm345", (session) => {
    const now = at("2018-10-25T12:00:00Z");
    const held = () => Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId)
      .filter((id) => id.startsWith("ChallengeBundle:questbundle_fortnitemares")).sort();
    withChallengeSettings({}, () => {
      setUpAthena(session);
      athenaQuestLogin(session);
      settleChallengeSchedules(session, seasonRewardFunctions(), now);
    });
    assert.deepEqual(held(), ["ChallengeBundle:questbundle_fortnitemares_part1"]);
    // Manual, two parts: Part 2 now, days early.
    withChallengeSettings({ eventChallengeUnlock: { schedule_fortnitemares: { mode: "manual", manualParts: 2 } } }, () => {
      assert.deepEqual(eventChallengeUnlock("schedule_fortnitemares"), { mode: "manual", manualParts: 2, totalParts: 4, givenParts: 1 });
      settleChallengeSchedules(session, seasonRewardFunctions(), now);
    });
    assert.deepEqual(held(), ["ChallengeBundle:questbundle_fortnitemares_part1", "ChallengeBundle:questbundle_fortnitemares_part2"]);
    // Every part.
    withChallengeSettings({ eventChallengeUnlock: { schedule_fortnitemares: { mode: "manual", manualParts: 4 } } }, () => {
      settleChallengeSchedules(session, seasonRewardFunctions(), now);
    });
    assert.equal(held().length, 4);
    // Manual 0 still keeps the part given with the schedule.
    assert.equal(withChallengeSettings({ eventChallengeUnlock: { schedule_fortnitemares: { mode: "manual", manualParts: 0 } } },
      () => eventChallengeUnlock("schedule_fortnitemares").manualParts), 1);
    // The weekly settings don't move them: all weeks unlocked leaves Part 2 to its day.
    const weeksAll = { challengeUnlock: { season6: { mode: "manual", manualWeeks: 10, weeksAvailable: 10 } } };
    assert.deepEqual(eventPlan("schedule_fortnitemares", now, weeksAll).parts.map(({ unlocked }) => unlocked), [true, false, false, false]);
  }));
});

test("#345: the admin panel lists Season 6's Fortnitemares Challenges and sets their unlock; the settings keep it", async () => {
  const backend = await startBackend();
  try {
    const overview = await get(backend.port, "/admin/api/battlepass/overview?season=6");
    assert.equal(overview.status, 200);
    const [plan] = overview.body.eventChallenges;
    assert.equal(plan.schedule, "schedule_fortnitemares");
    assert.equal(plan.category, "Fortnitemares");
    assert.equal(plan.mode, "original");
    assert.equal(plan.parts.length, 4);
    const all = await post(backend.port, "/admin/api/battlepass/event-challenges", undefined, { season: 6, schedule: "Schedule_FortNitemares", allUnlocked: true });
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.eventChallenges[0].parts.map(({ unlocked }) => unlocked), [true, true, true, true]);
    assert.equal(all.body.eventChallenges[0].mode, "manual");
    const manual = await post(backend.port, "/admin/api/battlepass/event-challenges", undefined, { season: 6, schedule: "schedule_fortnitemares", mode: "manual", manualParts: 3 });
    assert.deepEqual(manual.body.eventChallenges[0].parts.map(({ unlocked }) => unlocked), [true, true, true, false]);
    const back = await post(backend.port, "/admin/api/battlepass/event-challenges", undefined, { season: 6, schedule: "schedule_fortnitemares", allUnlocked: false });
    assert.equal(back.body.eventChallenges[0].mode, "original");
    assert.equal((await post(backend.port, "/admin/api/battlepass/event-challenges", undefined, { season: 6, schedule: "schedule_fortnitemares", mode: "manual", manualParts: 9 })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/battlepass/event-challenges", undefined, { season: 6, schedule: "season6_free_schedule", mode: "manual" })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/battlepass/event-challenges", undefined, { season: 5, schedule: "schedule_fortnitemares", allUnlocked: true })).status, 400);
    // Season 5 has none to list.
    assert.equal((await get(backend.port, "/admin/api/battlepass/overview?season=5")).body.eventChallenges, undefined);
  } finally {
    backend.close();
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-fnm-settings-"));
  try {
    const store = createSettingsStore(dir);
    assert.equal(store.get().fortnitemaresReplacesDefaults, true);
    store.update({ eventChallengeUnlock: { schedule_fortnitemares: { mode: "manual", manualParts: 2 }, "bad key!": { mode: "manual" } }, fortnitemaresReplacesDefaults: false });
    store.update({ eventChallengeUnlock: { schedule_fortnitemares: { mode: "sideways" } }, fortnitemaresReplacesDefaults: "no" });
    const again = createSettingsStore(dir).get();
    assert.deepEqual(again.eventChallengeUnlock, { schedule_fortnitemares: { mode: "manual", manualParts: 2 } });
    assert.equal(again.fortnitemaresReplacesDefaults, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("#348: while on, Fortnitemares Solo, Duos and Squads replace the default modes on 6.20 and 6.21, each by its own switch; the admin can turn it off", () => {
  const now = at("2026-11-13T12:00:00Z");
  for (const build of [v620, v621]) {
    const all = defaultReplacements(build, {}, now);
    assert.deepEqual(Object.fromEntries(Object.entries(all).map(([name, ltm]) => [name, ltm.playlistName])),
      { Playlist_DefaultSolo: "Playlist_Deimos_Solo", Playlist_DefaultDuo: "Playlist_Deimos_Duo", Playlist_DefaultSquad: "Playlist_Deimos_Squad" }, build);
    assert.deepEqual(defaultReplacements(build, { fortnitemaresReplacesDefaults: false }, now), {}, build);
    // Fortnitemares Solo off: Solo is back, Duos and Squads stay replaced.
    assert.deepEqual(Object.keys(defaultReplacements(build, { matchmakingModes: { fortnitemares2018Solo: false } }, now)).sort(),
      ["Playlist_DefaultDuo", "Playlist_DefaultSquad"], build);
  }
  // Original dates: outside its window on the replay (Season 6's replay from 27 September: 1 December), no Fortnitemares and no replacement.
  withConfig(replay, () => assert.deepEqual(defaultReplacements(v620, { ltmOriginalDates: true }, at("2018-12-01T12:00:00Z")), {}));
  withConfig(replay, () => assert.equal(Object.keys(defaultReplacements(v620, { ltmOriginalDates: true }, at("2018-10-30T12:00:00Z"))).length, 3));
  // No other build replaces anything.
  for (const build of [v610, v541, "4039451", "3724489"]) assert.deepEqual(defaultReplacements(build, {}, now), {}, build);
  assert.equal(ltmFrontEndPlaylists(v610).some(({ name }) => name.includes("Deimos")), false);
});

test("#348: with the replacement off, 6.20's hotfix keeps the defaults and lists Fortnitemares as a New limited time mode", async () => {
  const backend = await startBackend({ fortnitemaresReplacesDefaults: false });
  try {
    const { token } = await userLogin(backend.port, "Lobby348");
    const lines = (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/cloudstorage/system/DefaultGame.ini",
      headers: { "User-Agent": agentOf(v620, "6.20"), Authorization: `bearer ${token}` } })).body.toString().split("\r\n").filter((line) => line.includes("FrontEndPlaylistData"));
    const of = (name) => lines.find((line) => line.includes(`PlaylistName=${name},`));
    assert.ok(of("Playlist_DefaultSolo").includes("bEnabled=true, bIsDefaultPlaylist=true, bVisibleWhenDisabled=true"));
    assert.ok(of("Playlist_Deimos_Solo").includes("bEnabled=true, bIsDefaultPlaylist=false, bVisibleWhenDisabled=false, AdvertiseType=New, bDisplayAsLimitedTime=true"));
    // The admin panel's switch turns it back on.
    const saved = await post(backend.port, "/admin/api/matchmaking/config", undefined, { fortnitemaresReplacesDefaults: true });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.ltms.fortnitemaresReplacesDefaults, true);
    const after = (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/cloudstorage/system/DefaultGame.ini",
      headers: { "User-Agent": agentOf(v621, "6.21"), Authorization: `bearer ${token}` } })).body.toString().split("\r\n")
      .filter((line) => line.includes("FrontEndPlaylistData"));
    assert.ok(after.find((line) => line.includes("PlaylistName=Playlist_DefaultSquad,")).includes("bEnabled=false"), "6.21 too");
    assert.ok(after.find((line) => line.includes("PlaylistName=Playlist_Deimos_Squad,")).includes("bIsDefaultPlaylist=true"));
  } finally {
    backend.close();
  }
});

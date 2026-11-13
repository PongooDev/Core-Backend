import { test } from "node:test";
import assert from "node:assert/strict";
import { get, post, startBackend } from "./helpers.js";
import { eventCards, eventSchedules, scheduleEventPatch } from "../src/admin/eventschedules.js";
import { datedEvent } from "../src/events/datedflags.js";
import { originalRocketLaunch, replayRocketLaunch, rocketLaunchStatus, rocketLaunchTimes, sanitizeRocketLaunch } from "../src/events/rocketlaunch.js";
import { seasonMoment, withoutSeasonStartRecording } from "../src/store/itemshop.js";

// The admin panel's Events page in plain words (Core-Backend #351): each event's state and one control, over the stores the
// events already had.
const admin = (backend, urlPath, body) => (body === undefined ? get(backend.port, `/admin/api${urlPath}`) : post(backend.port, `/admin/api${urlPath}`, null, body));
const card = (body, id) => body.schedules.find((entry) => entry.id === id);
const sees = (body, version) => body.buildsNow.find((build) => build.version === version).sees;
const hour = 3600000;

test("the rocket launch: a saved launch without a mode is the admin's own time, and Epic's dates follow Season 4's replay", () => {
  // Settings saved before the mode existed keep working: a time is the admin's own, none is off.
  assert.deepEqual(sanitizeRocketLaunch({ at: "2026-11-10T18:00:00Z", countdownHours: 12 }), { mode: "custom", at: "2026-11-10T18:00:00.000Z", countdownHours: 12 });
  assert.deepEqual(sanitizeRocketLaunch(undefined, { at: null, countdownHours: 48 }), { mode: "off", at: null, countdownHours: 48 });
  assert.equal(sanitizeRocketLaunch({}, { at: "2026-11-10T18:00:00.000Z", countdownHours: 48 }).mode, "custom");
  // Clearing the time turns it off; "dates" keeps the time for a later Custom.
  assert.equal(sanitizeRocketLaunch({ at: null }, { mode: "custom", at: "2026-11-10T18:00:00.000Z" }).mode, "off");
  assert.deepEqual(sanitizeRocketLaunch({ mode: "dates" }, { mode: "custom", at: "2026-11-10T18:00:00.000Z", countdownHours: 48 }),
    { mode: "dates", at: "2026-11-10T18:00:00.000Z", countdownHours: 48 });
  assert.equal(sanitizeRocketLaunch({ mode: "custom" }, { mode: "off", at: null }).mode, "off", "Custom needs a time");

  const now = new Date();
  const config = { mode: "auto", rocketLaunch: { mode: "dates", countdownHours: 48 } };
  withoutSeasonStartRecording(() => {
    const launch = now.getTime() + (Date.parse(originalRocketLaunch) - seasonMoment(now, null, 4).getTime());
    assert.equal(replayRocketLaunch(now), launch);
    assert.equal(rocketLaunchTimes(4166199, config, now).launch, launch);
    assert.equal(rocketLaunchStatus(now, config).launch, new Date(launch).toISOString());
    assert.equal(rocketLaunchStatus(now, config).mode, "dates");
    assert.equal(rocketLaunchTimes(4166199, { mode: "auto", rocketLaunch: { mode: "off", at: now.toISOString() } }, now), null, "off: no launch");
  });
});

test("one control per event: Off, Epic's dates, Custom start and end, Start now", () => {
  const now = new Date("2026-11-13T12:00:00.000Z");
  const unknown = scheduleEventPatch({ event: "nope", mode: "off" });
  assert.ok(unknown.error);
  assert.ok(scheduleEventPatch({ event: "blockbuster2018", mode: "off" }).error, "an event its builds run by themselves has no schedule");
  assert.ok(scheduleEventPatch({ event: "cube", mode: "sometimes" }).error);
  assert.ok(scheduleEventPatch({ event: "cube", mode: "custom", startAt: "2026-11-20T00:00:00Z", endAt: "2026-11-19T00:00:00Z" }).error, "the end before the start");
  assert.ok(scheduleEventPatch({ event: "butterfly", mode: "custom", startAt: "2026-11-20T00:00:00Z", endAt: "2026-11-21T00:00:00Z" }).error, "the Butterfly takes a start only");
  assert.ok(scheduleEventPatch({ event: "cube", mode: "custom" }).error, "Custom without times and none saved");
  assert.deepEqual(scheduleEventPatch({ event: "cube", mode: "custom" }, { datedFlags: { cube: { mode: "dates", schedule: [{ step: "spawn", startAt: "2026-11-20T00:00:00.000Z", endAt: null }] } } }),
    { patch: { datedFlags: { cube: { mode: "custom" } } } }, "Custom without times uses the saved ones");

  // Modes alone: each store's own.
  assert.deepEqual(scheduleEventPatch({ event: "cube", mode: "dates" }).patch, { datedFlags: { cube: { mode: "dates" } } });
  assert.deepEqual(scheduleEventPatch({ event: "birthday", mode: "build" }).patch, { datedFlags: { birthday: { mode: "build" } } });
  assert.deepEqual(scheduleEventPatch({ event: "rocket", mode: "dates" }).patch, { rocketLaunch: { mode: "dates" } });
  assert.deepEqual(scheduleEventPatch({ event: "oddities", mode: "launch" }).patch, { season4Flags: { oddities: "launch" } });
  assert.deepEqual(scheduleEventPatch({ event: "stormDestruction", mode: "always", percent: 25 }).patch, { stormDestruction: { mode: "always", percent: 25 } });
  assert.ok(scheduleEventPatch({ event: "stormDestruction", mode: "always", percent: 250 }).error);
  assert.deepEqual(scheduleEventPatch({ event: "contentUpdates", mode: "all" }).patch, { contentUpdates: { mode: "all" } });
  assert.deepEqual(scheduleEventPatch({ event: "meteorStrike", mode: "impact" }).patch, { meteorStrike: "impact" });

  // The Cube from its appearing to its sinking: Epic's 26 days squeezed into a week, the crack before it at the same scale.
  const cube = datedEvent("cube");
  const spawnAt = Date.parse("2026-11-14T20:00:00.000Z");
  const lakeAt = Date.parse("2026-11-21T20:00:00.000Z");
  const { patch } = scheduleEventPatch({ event: "cube", mode: "custom", startAt: new Date(spawnAt).toISOString(), endAt: new Date(lakeAt).toISOString() }, {}, now);
  const steps = Object.fromEntries(patch.datedFlags.cube.schedule.map((entry) => [entry.step, entry]));
  assert.equal(patch.datedFlags.cube.mode, "custom");
  assert.equal(Date.parse(steps.spawn.startAt), spawnAt);
  assert.equal(Date.parse(steps.lake.startAt), lakeAt);
  const scale = (lakeAt - spawnAt) / (cube.steps.find(({ id }) => id === "lake").start - cube.steps.find(({ id }) => id === "spawn").start);
  assert.equal(Date.parse(steps.crack.startAt), spawnAt - Math.round((cube.steps.find(({ id }) => id === "spawn").start - cube.steps.find(({ id }) => id === "crack").start) * scale));
  // Start now: the Cube appears 30 seconds on, for the final bolt.
  const started = scheduleEventPatch({ event: "cube", mode: "now" }, {}, now).patch.datedFlags.cube.schedule.find(({ step }) => step === "spawn");
  assert.equal(Date.parse(started.startAt), now.getTime() + 30000);
  // A one-step event's start and end are its own.
  const stakes = scheduleEventPatch({ event: "highStakes", mode: "custom", startAt: "2026-11-15T10:00:00Z", endAt: "2026-11-16T10:00:00Z" }, {}, now).patch.datedFlags.highStakes.schedule;
  assert.deepEqual(stakes, [{ step: "challenges", startAt: "2026-11-15T10:00:00.000Z", endAt: "2026-11-16T10:00:00.000Z" }]);
  // The rifts: the first forming at the start, the last object going at the end, eight spacings on.
  const rifts = scheduleEventPatch({ event: "oddities", mode: "custom", startAt: "2026-11-14T00:00:00Z", endAt: "2026-11-15T00:00:00Z" }, {}, now).patch.season4Flags;
  assert.equal(rifts.oddities, "custom");
  assert.equal(rifts.schedule[0].tellAt, "2026-11-14T00:00:00.000Z");
  assert.equal(rifts.schedule[7].eventAt, "2026-11-15T00:00:00.000Z");
  // The rocket: a custom time, and now.
  assert.deepEqual(scheduleEventPatch({ event: "rocket", mode: "custom", startAt: "2026-11-20T19:30:00Z", countdownHours: 12 }).patch,
    { rocketLaunch: { mode: "custom", at: "2026-11-20T19:30:00.000Z", countdownHours: 12 } });
  assert.equal(scheduleEventPatch({ event: "rocket", mode: "now" }, {}, now).patch.rocketLaunch.at, now.toISOString());
});

test("plain-words states: the event mode and the Seasonal Events switch come first", () => {
  const now = new Date();
  const base = { now, config: { mode: "auto" }, seasonalEvents: true, rocket: { mode: "off", phase: "unscheduled" }, dated: { events: [] }, season4: { oddities: "off", rifts: [] },
    storm: { mode: "dates", percent: 10, inDates: false, builds: {} } };
  const of = (options, id) => eventSchedules({ ...base, ...options }).find((entry) => entry.id === id).state;
  assert.equal(of({}, "fortnitemares2017").tone, "dates");
  assert.equal(of({}, "rocket").text, "Off: the rocket waits in its lair");
  assert.equal(of({ config: { mode: "force_fortnitemares" } }, "fortnitemares2017").tone, "on");
  assert.match(of({ config: { mode: "force_fortnitemares" } }, "winter2017").text, /^Not running/);
  assert.match(of({ config: { mode: "off" } }, "blockbuster2018").text, /All off/);
  assert.match(of({ seasonalEvents: false }, "blockbuster2018").text, /Seasonal Events switch/);
  const rocket = of({ rocket: { mode: "custom", phase: "scheduled", launch: new Date(now.getTime() + hour).toISOString() } }, "rocket");
  assert.deepEqual([rocket.tone, rocket.text], ["scheduled", "Scheduled: launches {at}"]);
  assert.equal(of({ rocket: { mode: "dates", phase: "countdown", launch: new Date(now.getTime() + hour).toISOString() } }, "rocket").text, "Follows Epic's dates. On now: counting down to the launch, {at}");
  // Every event with a schedule has a control; the ones their builds run by themselves don't.
  for (const entry of eventSchedules(base)) assert.equal(entry.kind === "build", !entry.modes.length, entry.id);
  assert.ok(eventCards.every((entry) => entry.seasons.length && entry.ranges.length && entry.builds));
});

test("the Events page's API: the overview's plain words, the one control and what each build's players see now", async () => {
  const backend = await startBackend();
  try {
    let overview = (await admin(backend, "/events/overview")).body;
    assert.ok(Array.isArray(overview.schedules) && Array.isArray(overview.buildsNow));
    assert.equal(card(overview, "rocket").mode, "off");
    assert.deepEqual(card(overview, "rocket").modes, ["off", "dates", "custom"]);
    assert.equal(card(overview, "blockbuster2018").state.tone, "dates");
    assert.match(sees(overview, "4.5"), /^Blockbuster/);
    assert.equal(sees(overview, "1.7.2"), "No event: the base game");
    // The Birthday Challenges as 5.10 ran them: 5.10's players get them, 5.21's don't.
    assert.match(sees(overview, "5.10"), /Birthday Challenges/);
    assert.doesNotMatch(sees(overview, "5.21"), /Birthday Challenges/);
    assert.ok(card(overview, "fortnitemares2018").links.some(({ href }) => href === "#/matchmaking"));

    // Start the rocket's launch now: 4.5's players see it.
    let res = await admin(backend, "/events/schedule", { event: "rocket", mode: "now" });
    assert.equal(res.status, 200);
    assert.equal(card(res.body, "rocket").state.tone, "on");
    assert.match(sees(res.body, "4.5"), /Rocket launch \(Blast Off\): launching/);
    assert.doesNotMatch(sees(res.body, "4.4.2"), /Rocket/);
    // Epic's dates through the rocket's own route too, and Off.
    res = await admin(backend, "/events/rocket", { action: "dates" });
    assert.equal(res.body.rocketLaunch.mode, "dates");
    res = await admin(backend, "/events/rocket", { action: "clear" });
    assert.deepEqual([res.body.rocketLaunch.mode, res.body.rocketLaunch.phase], ["off", "unscheduled"]);

    // The Cube at a custom time, stored as the dated event's own schedule.
    const startAt = new Date(Date.now() + 2 * hour).toISOString();
    res = await admin(backend, "/events/schedule", { event: "cube", mode: "custom", startAt });
    assert.equal(res.status, 200);
    assert.equal(card(res.body, "cube").mode, "custom");
    assert.equal(card(res.body, "cube").startAt, startAt);
    overview = (await admin(backend, "/events/overview")).body;
    assert.equal(overview.eventsConfig.datedFlags.cube.mode, "custom");
    assert.equal(overview.datedFlags.events.find(({ id }) => id === "cube").steps.find(({ step }) => step === "spawn").current.startAt, startAt);
    assert.equal(card(overview, "cube").state.tone, "on", "the crack and its lightning come before the Cube appears");
    res = await admin(backend, "/events/schedule", { event: "cube", mode: "off" });
    assert.equal(card(res.body, "cube").state.text, "Off");

    // Bad input is refused.
    assert.equal((await admin(backend, "/events/schedule", { event: "cube", mode: "custom", startAt: "soon" })).status, 400);
    assert.equal((await admin(backend, "/events/schedule", { event: "fortnitemares2018", mode: "off" })).status, 400);

    // The page.
    const panel = await get(backend.port, "/admin");
    assert.ok(panel.body.includes("/admin/api/events/schedule"));
    assert.ok(panel.body.includes("What players see now"));
  } finally {
    backend.close();
  }
});

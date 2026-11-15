import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { eventCard, scheduleEventPatch } from "../src/admin/eventschedules.js";
import { configureEvents, distantFogApproach, distantFogApproach630, distantFogOverlap, distantFogOverlap630 } from "../src/events/events.js";
import { distantFog630Event, distantFogEvent, distantFogEventOf, distantFogStates } from "../src/events/distantfog.js";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

// The Ice King's iceberg at the end of Season 6 (Core-Backend #362): BP_Distant_Fog's own two calendar events on each
// build, served by Season 6's dates on its replay: 6.30's snowstorm (BR_S6_Approach_01 and _02) and 6.31's iceberg
// (BR_S6_Approach_03 and _Overlap), each build its own pair alone.
const v631 = "4573279";
const v630 = "4573096";
const v622 = "4543176";
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
const served = (build, iso) => inBuild(build, () => distantFogStates(at(iso)))[0]?.events ?? [];
const flags = (build, iso) => served(build, iso).map(({ eventType }) => eventType);
const day = 24 * 3600000;

test("the iceberg's steps are BP_Distant_Fog's two calendar events, back to back, to Season 6's end", () => {
  assert.deepEqual(distantFogEvent.steps.flatMap(({ flags: own }) => own), [distantFogApproach, distantFogOverlap]);
  assert.deepEqual([distantFogApproach, distantFogOverlap], ["BR_S6_Approach_03", "BR_S6_Approach_Overlap"]);
  assert.ok(distantFogEvent.steps.every(({ flags: own }) => own.length === 1), "one event a step");
  assert.deepEqual(distantFogEvent.steps.map(({ id }) => id), ["approach", "overlap"]);
  assert.equal(distantFogEvent.steps[1].start, distantFogEvent.steps[0].end, "the overlap starts as the approach ends");
  assert.equal(isoOf(distantFogEvent.steps[0].start), "2018-11-27T00:00:00.000Z", "Update v6.31's day");
  assert.equal(isoOf(distantFogEvent.steps[0].end), "2018-12-05T00:00:00.000Z");
  assert.equal(isoOf(distantFogEvent.steps[1].end), "2018-12-06T00:00:00.000Z", "Season 6's end");
});

test("6.30's snowstorm is its own BP_Distant_Fog pair: the approach over 6.30's days, then its end point to Season 6's end", () => {
  assert.deepEqual([distantFogApproach630, distantFogOverlap630], ["BR_S6_Approach_01", "BR_S6_Approach_02"], "6.30's FogApproachEvent and FogApproachOverlapEvent");
  assert.deepEqual(distantFog630Event.steps.flatMap(({ flags: own }) => own), [distantFogApproach630, distantFogOverlap630]);
  assert.deepEqual(distantFog630Event.steps.map(({ id }) => id), ["approach", "overlap"], "the blueprint's two, as 6.31's");
  assert.equal(distantFog630Event.season, 6);
  assert.equal(distantFog630Event.steps[1].start, distantFog630Event.steps[0].end, "it holds at the end point from the approach's end");
  assert.equal(isoOf(distantFog630Event.steps[0].start), "2018-11-14T00:00:00.000Z", "Update v6.30's day");
  assert.equal(isoOf(distantFog630Event.steps[0].end), "2018-11-27T00:00:00.000Z", "Update v6.31's day, where 6.31's iceberg carries on");
  assert.equal(isoOf(distantFog630Event.steps[1].end), "2018-12-06T00:00:00.000Z", "Season 6's end");
  // Each build its own event, and none before 6.30.
  assert.equal(distantFogEventOf(v630), distantFog630Event);
  assert.equal(distantFogEventOf(v631), distantFogEvent);
  assert.equal(distantFogEventOf(v622), null);
});

test("6.31 serves the iceberg and 6.30 the snowstorm by Epic's Season 6 dates, each its own pair; 6.22 none of it", () => {
  withConfig(replay, () => {
    assert.deepEqual(flags(v631, "2018-11-20T12:00:00Z"), [], "before Update v6.31");
    assert.deepEqual(flags(v631, "2018-11-28T12:00:00Z"), [distantFogApproach], "the iceberg drifts in");
    assert.deepEqual(served(v631, "2018-11-28T12:00:00Z"), [{ eventType: distantFogApproach, activeSince: "2018-11-27T00:00:00.000Z",
      activeUntil: "2018-12-05T00:00:00.000Z" }], "the event's own window is the blueprint's progress");
    assert.deepEqual(flags(v631, "2018-12-05T12:00:00Z"), [distantFogOverlap], "at the island on the last day");
    assert.deepEqual(flags(v631, "2018-12-06T12:00:00Z"), [], "Season 7's map has it crashed in");
    // The next changes: the overlap, then none.
    const parts = inBuild(v631, () => distantFogStates(at("2018-11-28T12:00:00Z")));
    assert.deepEqual(parts[0].events.map(({ eventType }) => eventType), [distantFogApproach]);
    assert.equal(isoOf(parts[1].validFrom), "2018-12-05T00:00:00.000Z");
    assert.deepEqual(parts[1].events.map(({ eventType }) => eventType), [distantFogOverlap]);

    // 6.30: nothing (the snowstorm hidden) before Update v6.30, then its approach over 6.30's days and its end point after.
    assert.deepEqual(flags(v630, "2018-11-10T12:00:00Z"), [], "after the Butterfly, before Update v6.30");
    assert.deepEqual(served(v630, "2018-11-20T12:00:00Z"), [{ eventType: distantFogApproach630, activeSince: "2018-11-14T00:00:00.000Z",
      activeUntil: "2018-11-27T00:00:00.000Z" }], "the snowstorm drifts in, its progress the event's own");
    assert.deepEqual(flags(v630, "2018-11-28T12:00:00Z"), [distantFogOverlap630], "held at 6.30's end point");
    assert.deepEqual(flags(v630, "2018-12-05T12:00:00Z"), [distantFogOverlap630], "to the season's last day");
    assert.deepEqual(flags(v630, "2018-12-06T12:00:00Z"), [], "the replay's next lap starts without it");
    const parts630 = inBuild(v630, () => distantFogStates(at("2018-11-20T12:00:00Z")));
    assert.equal(isoOf(parts630[1].validFrom), "2018-11-27T00:00:00.000Z");
    assert.deepEqual(parts630[1].events.map(({ eventType }) => eventType), [distantFogOverlap630]);

    // Neither build is served the other's names, and 6.22 (no BP_Distant_Fog) none.
    for (const iso of ["2018-11-20T12:00:00Z", "2018-11-28T12:00:00Z", "2018-12-01T12:00:00Z", "2018-12-05T12:00:00Z"]) {
      assert.ok(flags(v630, iso).every((eventType) => [distantFogApproach630, distantFogOverlap630].includes(eventType)), `6.30 ${iso}`);
      assert.ok(flags(v631, iso).every((eventType) => [distantFogApproach, distantFogOverlap].includes(eventType)), `6.31 ${iso}`);
      assert.deepEqual(inBuild(v622, () => distantFogStates(at(iso))), [], `6.22 ${iso}`);
    }
    // Switched off, each build's own card switches its own.
    withConfig({ ...replay, datedFlags: { distantFog: { mode: "off" } } }, () => {
      assert.deepEqual(served(v631, "2018-12-01T12:00:00Z"), []);
      assert.deepEqual(flags(v630, "2018-12-01T12:00:00Z"), [distantFogOverlap630], "6.31's switch leaves 6.30's");
    });
    withConfig({ ...replay, datedFlags: { distantFog630: { mode: "off" } } }, () => {
      assert.deepEqual(served(v630, "2018-11-20T12:00:00Z"), []);
      assert.deepEqual(flags(v631, "2018-11-28T12:00:00Z"), [distantFogApproach], "6.30's switch leaves 6.31's");
    });
    // Outside the Automatic mode, none.
    withConfig({ ...replay, mode: "off" }, () => assert.deepEqual(served(v630, "2018-11-20T12:00:00Z"), []));
  });
});

test("on Season 6's replay from 12 November 2026, 6.30's snowstorm comes in from 30 December and 6.31's iceberg from 12 January", () => {
  withConfig({ mode: "auto", seasonStarts: { 6: "2026-11-12" } }, () => {
    for (const build of [v630, v631]) assert.deepEqual(flags(build, "2026-11-15T12:00:00Z"), [], `${build}: nothing on the replay's day 4`);
    assert.deepEqual(served(v630, "2026-12-31T12:00:00Z"), [{ eventType: distantFogApproach630, activeSince: "2026-12-30T00:00:00.000Z",
      activeUntil: "2027-01-12T00:00:00.000Z" }]);
    assert.deepEqual(served(v630, "2027-01-15T12:00:00Z"), [{ eventType: distantFogOverlap630, activeSince: "2027-01-12T00:00:00.000Z",
      activeUntil: "2027-01-21T00:00:00.000Z" }]);
    assert.deepEqual(served(v631, "2027-01-15T12:00:00Z"), [{ eventType: distantFogApproach, activeSince: "2027-01-12T00:00:00.000Z",
      activeUntil: "2027-01-20T00:00:00.000Z" }]);
    // The next part a 6.30 server waits for from now is the approach's start.
    const parts = inBuild(v630, () => distantFogStates(at("2026-11-15T12:00:00Z")));
    assert.equal(isoOf(parts[1].validFrom), "2026-12-30T00:00:00.000Z");
  });
});

test("the Events page has a card for each build, and each card's custom schedule runs its own build alone", () => {
  for (const [id, ranges, name] of [["distantFog630", [[4573096, 4573096]], "The Ice King's snowstorm"], ["distantFog", [[4573279, 4573279]], "The Ice King's iceberg"]]) {
    const card = eventCard(id);
    assert.ok(card, id);
    assert.deepEqual([card.kind, card.dated, card.name, card.key, card.endStep], ["dated", id, name, "approach", "overlap"]);
    assert.deepEqual(card.ranges, ranges);
  }

  const now = at("2026-11-15T12:00:00.000Z");
  const config = { mode: "auto", seasonStarts: { 6: "2026-11-12" } };
  // Start now on 6.30's card: the snowstorm from now at Epic's spacing (13 days in, 9 at the end point).
  const started = scheduleEventPatch({ event: "distantFog630", mode: "now" }, config, now).patch.datedFlags;
  assert.deepEqual(Object.keys(started), ["distantFog630"]);
  assert.deepEqual(started.distantFog630.schedule, [
    { step: "approach", startAt: "2026-11-15T12:00:00.000Z", endAt: "2026-11-28T12:00:00.000Z" },
    { step: "overlap", startAt: "2026-11-28T12:00:00.000Z", endAt: "2026-12-07T12:00:00.000Z" }]);
  withConfig({ ...config, datedFlags: started }, () => {
    assert.deepEqual(served(v630, now.toISOString()), [{ eventType: distantFogApproach630, activeSince: "2026-11-15T12:00:00.000Z",
      activeUntil: "2026-11-28T12:00:00.000Z" }]);
    assert.deepEqual(flags(v631, now.toISOString()), [], "6.31 keeps Epic's dates");
  });
  // A custom start and end on 6.30's card: the approach squeezed into a day, the end point at the same scale.
  const squeezed = scheduleEventPatch({ event: "distantFog630", mode: "custom", startAt: "2026-11-16T00:00:00Z", endAt: "2026-11-17T00:00:00Z" }, config, now)
    .patch.datedFlags.distantFog630.schedule;
  assert.equal(squeezed[0].endAt, "2026-11-17T00:00:00.000Z");
  assert.equal(Date.parse(squeezed[1].endAt) - Date.parse(squeezed[1].startAt), Math.round(9 * day / 13));
  // 6.31's card as the live panel has it (the iceberg's approach from 15 November): 6.31 alone runs it, 6.30 keeps its dates.
  const iceberg = { distantFog: { mode: "custom", schedule: [{ step: "approach", startAt: "2026-11-15T09:29:10.743Z", endAt: "2026-11-23T09:29:10.743Z" },
    { step: "overlap", startAt: "2026-11-23T09:29:10.743Z", endAt: "2026-11-24T09:29:10.743Z" }] } };
  withConfig({ ...config, datedFlags: iceberg }, () => {
    assert.deepEqual(flags(v631, now.toISOString()), [distantFogApproach]);
    assert.deepEqual(flags(v630, now.toISOString()), [], "6.30 waits for its own dates (30 December on this replay)");
  });
  // Both cards custom at once: each build its own.
  withConfig({ ...config, datedFlags: { ...iceberg, ...started } }, () => {
    assert.deepEqual(flags(v631, now.toISOString()), [distantFogApproach]);
    assert.deepEqual(flags(v630, now.toISOString()), [distantFogApproach630]);
  });
});

test("the admin panel's Start now on each card reaches that build's calendar timeline and leaves the other's", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "DistantFog");
    const timeline = async (cl, version) => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": `game=FortniteGame, engine=UE4, build=++Fortnite+Release-${version}-CL-${cl}`, Authorization: `bearer ${token}` } }))
      .body.channels["client-events"].states[0].activeEvents.map(({ eventType }) => eventType);
    const fog = (eventTypes) => eventTypes.filter((eventType) => eventType.startsWith("BR_S6_Approach_"));
    // Epic's dates on a replay that starts today: none yet on either.
    assert.deepEqual(fog(await timeline(v630, "6.30")), []);
    assert.deepEqual(fog(await timeline(v631, "6.31")), []);

    const schedule = (body) => post(backend.port, "/admin/api/events/schedule", null, body);
    let res = await schedule({ event: "distantFog630", mode: "now" });
    assert.equal(res.status, 200);
    assert.equal(res.body.schedules.find(({ id }) => id === "distantFog630").mode, "custom");
    assert.deepEqual(fog(await timeline(v630, "6.30")), [distantFogApproach630]);
    assert.deepEqual(fog(await timeline(v631, "6.31")), [], "6.31's card is still on Epic's dates");

    res = await schedule({ event: "distantFog", mode: "now" });
    assert.equal(res.status, 200);
    assert.deepEqual(fog(await timeline(v631, "6.31")), [distantFogApproach]);
    assert.deepEqual(fog(await timeline(v630, "6.30")), [distantFogApproach630]);

    // Off on 6.30's card: 6.30's goes, 6.31's stays.
    res = await schedule({ event: "distantFog630", mode: "off" });
    assert.equal(res.status, 200);
    assert.deepEqual(fog(await timeline(v630, "6.30")), []);
    assert.deepEqual(fog(await timeline(v631, "6.31")), [distantFogApproach]);

    const overview = (await get(backend.port, "/admin/api/events/overview")).body;
    assert.deepEqual(overview.datedFlags.events.filter(({ id }) => id.startsWith("distantFog")).map(({ id, mode }) => [id, mode]),
      [["distantFog", "custom"], ["distantFog630", "off"]]);
  } finally {
    await backend.close();
  }
});

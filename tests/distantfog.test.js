import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { eventCard } from "../src/admin/eventschedules.js";
import { configureEvents, distantFogApproach, distantFogOverlap } from "../src/events/events.js";
import { distantFogEvent, distantFogStates } from "../src/events/distantfog.js";

// 6.31's Ice King iceberg (Core-Backend #362): BP_Distant_Fog's own two calendar events, served by Season 6's dates on its
// replay, and on 6.31 alone: its Athena_Background is the only one with SM_Iceberg.
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

test("the iceberg's steps are BP_Distant_Fog's two calendar events, back to back, to Season 6's end", () => {
  assert.deepEqual(distantFogEvent.steps.flatMap(({ flags }) => flags), [distantFogApproach, distantFogOverlap]);
  assert.deepEqual([distantFogApproach, distantFogOverlap], ["BR_S6_Approach_03", "BR_S6_Approach_Overlap"]);
  assert.ok(distantFogEvent.steps.every(({ flags }) => flags.length === 1), "one event a step");
  assert.deepEqual(distantFogEvent.steps.map(({ id }) => id), ["approach", "overlap"]);
  assert.equal(distantFogEvent.steps[1].start, distantFogEvent.steps[0].end, "the overlap starts as the approach ends");
  assert.equal(isoOf(distantFogEvent.steps[0].start), "2018-11-27T00:00:00.000Z", "Update v6.31's day");
  assert.equal(isoOf(distantFogEvent.steps[0].end), "2018-12-05T00:00:00.000Z");
  assert.equal(isoOf(distantFogEvent.steps[1].end), "2018-12-06T00:00:00.000Z", "Season 6's end");
});

test("6.31 serves the iceberg by Epic's Season 6 dates; 6.30 and 6.22 serve none of it", () => {
  withConfig(replay, () => {
    const flags = (build, iso) => served(build, iso).map(({ eventType }) => eventType);
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
    // Only 6.31's backdrop has the iceberg: 6.30's has the floes and the fog, and nothing before it any.
    for (const build of [v630, v622]) {
      for (const iso of ["2018-11-28T12:00:00Z", "2018-12-01T12:00:00Z", "2018-12-05T12:00:00Z"]) {
        assert.deepEqual(inBuild(build, () => distantFogStates(at(iso))), [], `${build} ${iso}`);
      }
    }
    // Switched off, none of it.
    withConfig({ ...replay, datedFlags: { distantFog: { mode: "off" } } }, () => assert.deepEqual(served(v631, "2018-12-01T12:00:00Z"), []));
  });
});

test("the Events page has the iceberg's card, on 6.31 alone, and it runs on the demand of its dates or the admin's", () => {
  const card = eventCard("distantFog");
  assert.ok(card, "a card");
  assert.equal(card.kind, "dated");
  assert.equal(card.dated, "distantFog");
  assert.deepEqual(card.ranges, [[4573279, 4573279]]);
  assert.equal(card.key, "approach");
  assert.equal(card.endStep, "overlap");
});

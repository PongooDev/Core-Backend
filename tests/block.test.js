import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { eventCard, eventSchedules, scheduleEventPatch } from "../src/admin/eventschedules.js";
import { datedFlagsStatus, sanitizeDatedFlags } from "../src/events/datedflags.js";
import { blockLanded, blockRiskyReels, blockSlab, configureEvents } from "../src/events/events.js";
import { block700Event, block710Event, blockEventOf, blockStates } from "../src/events/block.js";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

// Season 7's The Block (PongooDev/CoreV2#476): BP_SlabScripting's own calendar names on each build, by Epic's dates on
// Season 7's replay: 7.00's R0 (Risky Reels) and R1 (the blank Block), 7.10's slab1 to slab4 (its community builds).
const v700 = "4629139";
const v710 = "4667333";
const v631 = "4573279";
const replay = { mode: "auto", seasonStarts: { 7: "2018-12-06" } };
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
const served = (build, iso) => inBuild(build, () => blockStates(at(iso)))[0]?.events ?? [];
const flags = (build, iso) => served(build, iso).map(({ eventType }) => eventType);

test("the Block's names are BP_SlabScripting's: 7.00's R0 and R1, 7.10's slab1 to slab4, on Epic's days", () => {
  assert.deepEqual([blockRiskyReels, blockLanded], ["R0", "R1"]);
  assert.deepEqual([1, 2, 3, 4].map(blockSlab), ["slab1", "slab2", "slab3", "slab4"]);
  assert.deepEqual(block700Event.steps.map(({ id, flags: own }) => [id, own]), [["reels", ["R0"]], ["block", ["R1"]]]);
  assert.equal(isoOf(block700Event.steps[0].start), "2018-12-06T00:00:00.000Z", "Season 7's first day");
  assert.equal(isoOf(block700Event.steps[0].end), "2018-12-07T01:30:00.000Z", "The Game Awards 2018");
  assert.equal(block700Event.steps[1].start, block700Event.steps[0].end);
  assert.equal(block700Event.steps[1].end, null, "on to the season's end");
  assert.deepEqual(block710Event.steps.map(({ id, flags: own, start }) => [id, own, isoOf(start)]), [
    ["slab1", ["slab1"], "2018-12-06T00:00:00.000Z"], ["slab2", ["slab2"], "2018-12-23T00:00:00.000Z"],
    ["slab3", ["slab3"], "2018-12-30T00:00:00.000Z"], ["slab4", ["slab4"], "2019-01-08T00:00:00.000Z"]]);
  for (let index = 0; index < 3; index += 1) assert.equal(block710Event.steps[index].end, block710Event.steps[index + 1].start, "back to back");
  assert.equal(block710Event.steps[3].end, null, "DM Arena to the season's end");
  for (const event of [block700Event, block710Event]) {
    assert.equal(event.season, 7);
    assert.deepEqual(event.modes, ["dates", "custom"], "the map: never off");
  }
  assert.equal(blockEventOf(v700), block700Event);
  assert.equal(blockEventOf(v710), block710Event);
  assert.equal(blockEventOf(v631), null);
  // Its settings never take "off".
  assert.equal(sanitizeDatedFlags({ block700: { mode: "off" } }).block700.mode, "dates");
});

test("7.00 serves Risky Reels until the Block lands, then R1 to the season's end; 7.10 its builds by their days", () => {
  withConfig(replay, () => {
    assert.deepEqual(served(v700, "2018-12-06T12:00:00Z"), [{ eventType: "R0", activeSince: "2018-12-06T00:00:00.000Z", activeUntil: "2018-12-07T01:30:00.000Z" }]);
    assert.deepEqual(flags(v700, "2018-12-07T02:00:00Z"), ["R1"]);
    assert.deepEqual(flags(v700, "2019-01-20T12:00:00Z"), ["R1"], "no community builds on 7.00");
    assert.deepEqual(flags(v700, "2019-02-27T12:00:00Z"), ["R1"], "the season's last day");
    const parts = inBuild(v700, () => blockStates(at("2018-12-06T12:00:00Z")));
    assert.equal(isoOf(parts[1].validFrom), "2018-12-07T01:30:00.000Z", "a server started then asks again as the Block lands");
    assert.deepEqual(parts[1].events.map(({ eventType }) => eventType), ["R1"]);

    assert.deepEqual(flags(v710, "2018-12-06T12:00:00Z"), ["slab1"], "7.10 shipped with Grimy Greens up");
    assert.deepEqual(flags(v710, "2018-12-18T12:00:00Z"), ["slab1"]);
    assert.deepEqual(flags(v710, "2018-12-24T12:00:00Z"), ["slab2"]);
    assert.deepEqual(flags(v710, "2019-01-01T12:00:00Z"), ["slab3"]);
    assert.deepEqual(served(v710, "2019-01-20T12:00:00Z"), [{ eventType: "slab4", activeSince: "2019-01-08T00:00:00.000Z", activeUntil: "2019-02-28T00:00:00.000Z" }]);
    for (const iso of ["2018-12-06T12:00:00Z", "2018-12-20T12:00:00Z", "2019-01-20T12:00:00Z"]) {
      assert.equal(flags(v700, iso).length, 1, `7.00 ${iso}: one name at a time`);
      assert.ok(flags(v700, iso).every((eventType) => ["R0", "R1"].includes(eventType)), `7.00 ${iso}`);
      assert.equal(flags(v710, iso).length, 1, `7.10 ${iso}: one name at a time`);
      assert.ok(flags(v710, iso).every((eventType) => eventType.startsWith("slab")), `7.10 ${iso}`);
      assert.deepEqual(inBuild(v631, () => blockStates(at(iso))), [], `6.31 ${iso}`);
    }
  });
});

test("the Block is the map: served with the seasonal events' mode off or custom too", () => {
  for (const mode of ["off", "custom", "force_fortnitemares"]) {
    withConfig({ ...replay, mode }, () => {
      assert.deepEqual(flags(v700, "2018-12-20T12:00:00Z"), ["R1"], mode);
      assert.deepEqual(flags(v710, "2018-12-20T12:00:00Z"), ["slab1"], mode);
    });
  }
});

test("the Events page's two cards: always on, Start now lands the Block now, a custom step puts DM Arena up", () => {
  for (const [id, ranges, key] of [["block700", [[4629139, 4629139]], "block"], ["block710", [[4667333, 4667333]], "slab1"]]) {
    const card = eventCard(id);
    assert.deepEqual([card.kind, card.dated, card.key, card.always], ["dated", id, key, true]);
    assert.deepEqual(card.ranges, ranges);
  }
  const now = at("2026-11-16T12:00:00.000Z");
  const config = { mode: "auto", seasonStarts: { 7: "2026-11-16" } };
  assert.equal(scheduleEventPatch({ event: "block700", mode: "off" }, config, now).error.includes("mode must be"), true, "no off");
  const landed = scheduleEventPatch({ event: "block700", mode: "now" }, config, now).patch.datedFlags;
  assert.deepEqual(landed.block700.schedule, [
    { step: "reels", startAt: "2026-11-15T10:30:00.000Z", endAt: "2026-11-16T12:00:00.000Z" },
    { step: "block", startAt: "2026-11-16T12:00:00.000Z", endAt: null }]);
  withConfig({ ...config, datedFlags: landed }, () => {
    assert.deepEqual(flags(v700, now.toISOString()), ["R1"]);
    assert.deepEqual(flags(v710, now.toISOString()), ["slab1"], "7.10 keeps Epic's dates");
  });
  const arena = { block710: { mode: "custom", schedule: [{ step: "slab4", startAt: now.toISOString(), endAt: null }] } };
  withConfig({ ...config, datedFlags: arena }, () => assert.deepEqual(flags(v710, now.toISOString()), ["slab4"]));
  // With the Seasonal Events switch off, the cards still say what the map shows.
  const status = datedFlagsStatus(now.getTime(), () => Date.parse("2018-12-20T12:00:00Z"), config);
  const cards = eventSchedules({ now, config, seasonalEvents: false, dated: status });
  const block = cards.find(({ id }) => id === "block700");
  assert.notEqual(block.state.tone, "off");
  assert.deepEqual(block.modes, ["dates", "custom"]);
  assert.equal(cards.find(({ id }) => id === "season7Warmup2018").state.tone, "off");
});

test("a 7.00, a 7.10, a 7.20, a 7.30, a 7.40 and an 8.00 gameserver's calendar timeline carries the Block's names", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "TheBlock");
    const timeline = async (cl, version) => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": `game=FortniteGame, engine=UE4, build=++Fortnite+Release-${version}-CL-${cl}`, Authorization: `bearer ${token}` } }))
      .body.channels["client-events"].states[0];
    const names = (state) => state.activeEvents.map(({ eventType }) => eventType).filter((eventType) => /^(R[01]|slab\d)$/.test(eventType));
    // On a replay that starts today: Risky Reels on 7.00, Grimy Greens on 7.10, Looming Llama on 7.20, CoLLAMAsseum on 7.30,
    // Oily Oaks on 7.40, Cryptic Castle on 8.00 (CoreV2 #550), none on 6.31.
    const reels = await timeline(v700, "7.00");
    assert.deepEqual(names(reels), ["R0"]);
    assert.ok(reels.state.activeEventFlags.includes("R0"));
    assert.deepEqual(names(await timeline(v710, "7.10")), ["slab1"]);
    assert.deepEqual(names(await timeline("4727874", "7.20")), ["slab1"]);
    assert.deepEqual(names(await timeline("4834550", "7.30")), ["slab1"]);
    assert.deepEqual(names(await timeline("5046157", "7.40")), ["slab1"], "Oily Oaks");
    assert.deepEqual(names(await timeline("5203069", "8.00")), ["slab1"], "Cryptic Castle");
    assert.deepEqual(names(await timeline(v631, "6.31")), []);

    // Start now on 7.00's card lands the Block; no card takes "off".
    const schedule = (body) => post(backend.port, "/admin/api/events/schedule", null, body);
    assert.equal((await schedule({ event: "block700", mode: "now" })).status, 200);
    assert.deepEqual(names(await timeline(v700, "7.00")), ["R1"]);
    assert.equal((await schedule({ event: "block710", mode: "off" })).status, 400);

    const overview = (await get(backend.port, "/admin/api/events/overview")).body;
    assert.deepEqual(overview.datedFlags.events.filter(({ id }) => id.startsWith("block")).map(({ id, mode }) => [id, mode]),
      [["block700", "custom"], ["block710", "dates"], ["block720", "dates"], ["block730", "dates"], ["block740", "dates"], ["block800", "dates"], ["block820", "dates"]]);
  } finally {
    await backend.close();
  }
});

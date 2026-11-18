import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { eventSchedules, scheduleEventPatch } from "../src/admin/eventschedules.js";
import { datedFlagsStatus } from "../src/events/datedflags.js";
import { configureEvents } from "../src/events/events.js";
import { iceKingState, iceKingStates, iceKingStormSoon } from "../src/events/icestorm.js";
import { defaultReplacements, iceStormMatchBucket, ltmOn } from "../src/events/ltms.js";
import { createSettingsStore } from "../src/settings/store.js";
import { seasonMoment } from "../src/store/itemshop.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// 7.20's Ice King and his Ice Storm (Core-Backend #354, PongooDev/CoreV2 #490): the calendar names 7.20's blueprints
// watch, the event held before the storm by default and started from the admin panel, Solo, Duos and Squads switching to
// the Ice Storm's at the storm, and the snow switch (events/icestorm.js).
const v720 = "4727874";
const v710 = "4667333";
const season7 = { mode: "auto", seasonStarts: { 7: "2018-12-06" } };
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const typesAt = (states, ms) => (states.filter(({ validFrom }) => validFrom === -Infinity || validFrom <= ms).at(-1)?.events ?? [])
  .map(({ eventType }) => eventType).sort();
const at = (iso) => new Date(iso);
// The real time now at which Season 7's replay is at the given moment.
const onReplay = (iso) => new Date(Date.now() + (Date.parse(iso) - seasonMoment(new Date(), null, 7).getTime()));

test("before the event (the default): the sphere and the storm's idle sequence level, the default modes, on 7.20 only", () => {
  const defaults = createSettingsStore(null).get();
  withConfig(season7, () => {
    const now = new Date();
    const states = inBuild(v720, () => iceKingStates(now));
    assert.deepEqual(typesAt(states, now.getTime()), ["LoadLevel", "LoadSequence"]);
    assert.equal(states.length, 1, "nothing scheduled");
    assert.equal(inBuild(v720, () => iceKingState(now)), "before");
    assert.deepEqual(inBuild(v710, () => iceKingStates(now)), [], "7.10 has no Ice King");
    assert.equal(inBuild(v710, () => iceKingState(now)), null);
    for (const id of ["iceStormSolo", "iceStormDuos", "iceStormSquads"]) assert.equal(ltmOn(id, v720, defaults, now), false, id);
    assert.deepEqual(defaultReplacements(v720, defaults, now), {});
  });
});

// CoreV2 #490: the server must have MooneySequenceMap before a client makes it visible, or 7.20's replication graph never
// sends that client MooneySequence (the storm). So no admin change turns LoadSequence on in a running match: it is on
// before the event and stays on through Start now, a time or Epic's dates, the storm and after it.
test("the storm's sequence level is on before the event and stays on through the storm, whatever starts it", () => {
  const now = new Date();
  const ms = now.getTime();
  const sequenceAt = (config, t) => withConfig(config, () => inBuild(v720, () => iceKingStates(now)))
    .filter(({ validFrom }) => validFrom === -Infinity || validFrom <= t).at(-1)?.events.find(({ eventType }) => eventType === "LoadSequence");
  const before = sequenceAt(season7, ms);
  assert.ok(before, "before the event");
  for (const body of [{ mode: "now" }, { mode: "custom", startAt: new Date(ms + 5 * 60000).toISOString() }, { mode: "custom", startAt: new Date(ms + 3 * 86400000).toISOString() }]) {
    const { patch } = scheduleEventPatch({ event: "iceKing", ...body }, season7, now);
    const started = { ...season7, ...patch };
    const storm = Date.parse(patch.datedFlags.iceKing.schedule.find(({ step }) => step === "storm").startAt);
    const own = sequenceAt(started, ms);
    assert.ok(own, `${JSON.stringify(body)}: on at once, not turned on by the change`);
    assert.ok(Date.parse(own.activeSince) < ms - 86400000, `${JSON.stringify(body)}: on long before (with the sphere)`);
    assert.ok(sequenceAt(started, storm + 60000), `${JSON.stringify(body)}: on through the storm`);
    assert.ok(sequenceAt(started, storm + 86400000), `${JSON.stringify(body)}: and after it, so a second start doesn't turn it on anew`);
  }
  withConfig({ ...season7, datedFlags: { iceKing: { mode: "dates" } } }, () => {
    const replay = onReplay("2019-01-10T12:00:00Z");
    assert.ok(typesAt(inBuild(v720, () => iceKingStates(replay)), replay.getTime()).includes("LoadSequence"), "Epic's dates: from the replay's first day");
  });
  // The Events page names the step that shows, not the idle level.
  const { patch } = scheduleEventPatch({ event: "iceKing", mode: "now" }, season7, now);
  const config = { ...season7, ...patch };
  const dated = withConfig(config, () => datedFlagsStatus(ms, (season) => seasonMoment(now, null, season).getTime(), config));
  const king = eventSchedules({ now, config, dated }).find(({ id }) => id === "iceKing");
  assert.match(king.state.text, /^On now: The last 12 minutes/);
});

test("7.20's timeline: LoadSequence before the event, and Start now changes the revision without turning it on anew", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "IceKing");
    const authed = (path) => send({ host: "127.0.0.1", port: backend.port, method: "GET", path,
      headers: { "User-Agent": "game=FortniteGame, engine=UE4, build=++Fortnite+Release-7.20-CL-4727874", Authorization: `bearer ${token}` } });
    const events = async () => (await authed("/fortnite/api/calendar/v1/timeline")).body.channels["client-events"].states[0].activeEvents
      .filter(({ eventType }) => ["LoadLevel", "LoadSequence", "WD1", "WD2"].includes(eventType));
    const before = await events();
    assert.deepEqual(before.map(({ eventType }) => eventType).sort(), ["LoadLevel", "LoadSequence"]);
    const revision = (await authed("/fortnite/api/game/v2/calendar/revision")).body.revision;
    assert.equal((await post(backend.port, "/admin/api/events/schedule", null, { event: "iceKing", mode: "now" })).status, 200);
    const started = await events();
    assert.deepEqual(started.map(({ eventType }) => eventType).sort(), ["LoadLevel", "LoadSequence", "WD1"]);
    // On in both downloads, so a running match's loader sees it still on (OnEventUpdated), not newly on.
    const since = Date.parse(started.find(({ eventType }) => eventType === "LoadSequence").activeSince);
    assert.ok(since < Date.now() - 86400000, "on since long before the change");
    assert.notEqual((await authed("/fortnite/api/game/v2/calendar/revision")).body.revision, revision, "a running server fetches it again");
  } finally {
    await backend.close();
  }
});

test("Start now: the last 12 minutes on at once, the storm 30 seconds on, then the island under snow and the Ice Storm modes", () => {
  const defaults = createSettingsStore(null).get();
  const now = new Date();
  const { patch } = scheduleEventPatch({ event: "iceKing", mode: "now" }, season7, now);
  assert.equal(patch.datedFlags.iceKing.mode, "custom");
  const config = { ...season7, ...patch };
  withConfig(config, () => {
    const states = inBuild(v720, () => iceKingStates(now));
    const ms = now.getTime();
    assert.deepEqual(typesAt(states, ms), ["Countdown", "LoadLevel", "LoadSequence", "R0", "WD1", "warning"]);
    const storm = states.find(({ events }) => events.some(({ eventType }) => eventType === "WD2"));
    assert.equal(storm.validFrom, ms + 30000, "the storm 30 seconds on");
    assert.deepEqual(typesAt(states, ms + 30000), ["LoadLevel", "LoadSequence", "SP", "WD2", "WDSPAWN"]);
    assert.deepEqual(typesAt(states, ms + 30000 + 10 * 60000), ["LoadLevel", "LoadSequence", "SP", "WDSPAWN"], "the storm's 10 minutes over, the snow and the Ice Legion stay");
    const wd1 = states[0].events.find(({ eventType }) => eventType === "WD1");
    assert.equal(Date.parse(wd1.activeUntil), ms + 30000, "WD1 ends at the storm");
    assert.equal(Date.parse(wd1.activeSince), ms + 30000 - 12 * 60000);
    const countdown = states[0].events.find(({ eventType }) => eventType === "Countdown");
    assert.equal(Date.parse(countdown.activeUntil), ms + 30000, "the TVs count to the storm");
    assert.equal(inBuild(v720, () => iceKingState(now)), "before");
    const after = new Date(ms + 31000);
    assert.equal(inBuild(v720, () => iceKingState(after)), "after");
    for (const id of ["iceStormSolo", "iceStormDuos", "iceStormSquads"]) {
      assert.equal(ltmOn(id, v720, defaults, now), false, `${id} before the storm`);
      assert.equal(ltmOn(id, v720, defaults, after), true, `${id} after it`);
      assert.equal(ltmOn(id, v720, { ...defaults, matchmakingModes: { ...defaults.matchmakingModes, [id]: false } }, after), false, `${id}'s switch`);
      assert.equal(ltmOn(id, v720, { ...defaults, ltmOriginalDates: true }, after), true, `${id}: the admin's storm, not the dates`);
    }
    assert.deepEqual(Object.keys(defaultReplacements(v720, defaults, after)).sort(), ["Playlist_DefaultDuo", "Playlist_DefaultSolo", "Playlist_DefaultSquad"]);
  });
  // Before the event brings the sphere and the default modes back.
  const before = scheduleEventPatch({ event: "iceKing", mode: "before" }, config, now);
  assert.deepEqual(before.patch, { datedFlags: { iceKing: { mode: "before" } } });
  withConfig({ ...config, datedFlags: { iceKing: { mode: "before", schedule: config.datedFlags.iceKing.schedule } } }, () => {
    const later = new Date(now.getTime() + 3600000);
    assert.equal(inBuild(v720, () => iceKingState(later)), "before");
    assert.deepEqual(typesAt(inBuild(v720, () => iceKingStates(later)), later.getTime()), ["LoadLevel", "LoadSequence"]);
    assert.equal(ltmOn("iceStormSolo", v720, defaults, later), false);
  });
});

test("Epic's dates on Season 7's replay: the sphere, the Ice King, the TVs, the clock, the last 12 minutes, the storm at 19 January 19:00 UTC", () => {
  const config = { ...season7, datedFlags: { iceKing: { mode: "dates" } } };
  withConfig(config, () => {
    const typesOnReplay = (iso) => {
      const now = onReplay(iso);
      return typesAt(inBuild(v720, () => iceKingStates(now)), now.getTime());
    };
    assert.deepEqual(typesOnReplay("2019-01-10T12:00:00Z"), ["LoadLevel", "LoadSequence"], "7.20 shipped with the sphere");
    assert.deepEqual(typesOnReplay("2019-01-16T12:00:00Z"), ["LoadLevel", "LoadSequence", "WDK"]);
    assert.deepEqual(typesOnReplay("2019-01-17T12:00:00Z"), ["Countdown", "LoadLevel", "LoadSequence", "R0", "WDK", "warning"]);
    assert.deepEqual(typesOnReplay("2019-01-19T12:00:00Z"), ["Countdown", "LoadLevel", "LoadSequence", "R0", "WD0", "warning"]);
    assert.deepEqual(typesOnReplay("2019-01-19T18:50:00Z"), ["Countdown", "LoadLevel", "LoadSequence", "R0", "WD1", "warning"]);
    assert.deepEqual(typesOnReplay("2019-01-19T19:05:00Z"), ["LoadLevel", "LoadSequence", "SP", "WD2", "WDSPAWN"]);
    assert.deepEqual(typesOnReplay("2019-01-25T12:00:00Z"), ["LoadLevel", "LoadSequence", "SP", "WDSPAWN"]);
    assert.equal(inBuild(v720, () => iceKingState(onReplay("2019-01-19T18:59:00Z"))), "before");
    assert.equal(inBuild(v720, () => iceKingState(onReplay("2019-01-19T19:01:00Z"))), "after");
    const defaults = createSettingsStore(null).get();
    const dated = { ...defaults, ltmOriginalDates: true };
    assert.equal(ltmOn("iceStormSolo", v720, dated, onReplay("2019-01-22T12:00:00Z")), true, "after the storm, in its dates");
    assert.equal(ltmOn("iceStormSolo", v720, dated, onReplay("2019-02-10T12:00:00Z")), false, "after its dates (Update v7.30)");
    assert.equal(ltmOn("iceStormSolo", v720, defaults, onReplay("2019-02-10T12:00:00Z")), true, "on by its switch without Original dates");
  });
});

test("the snow switch: SP by the storm, never, or always; the modes follow the storm whatever it says", () => {
  const now = new Date();
  const { patch } = scheduleEventPatch({ event: "iceKing", mode: "now" }, season7, now);
  const after = now.getTime() + 60000;
  const typesWith = (snow, ms) => withConfig({ ...season7, ...patch, iceKingSnow: snow }, () => typesAt(inBuild(v720, () => iceKingStates(now)), ms));
  assert.ok(typesWith("event", after).includes("SP"));
  assert.ok(!typesWith("event", now.getTime()).includes("SP"));
  assert.ok(!typesWith("none", after).includes("SP"), "Season 7's own snow after the storm");
  assert.ok(typesWith("full", now.getTime()).includes("SP"), "the island under snow before it");
  withConfig({ ...season7, iceKingSnow: "full" }, () => {
    assert.deepEqual(typesAt(inBuild(v720, () => iceKingStates(now)), now.getTime()), ["LoadLevel", "LoadSequence", "SP"], "before the event, under snow");
    assert.equal(inBuild(v720, () => iceKingState(now)), "before", "the snow doesn't start the storm");
  });
  const store = createSettingsStore(null);
  assert.equal(store.get().events.iceKingSnow, "event");
  assert.equal(store.update({ events: { iceKingSnow: "full" } }).events.iceKingSnow, "full");
  assert.equal(store.update({ events: { iceKingSnow: "stages" } }).events.iceKingSnow, "full", "an unknown value keeps the current");
  assert.deepEqual(scheduleEventPatch({ event: "iceKingSnow", mode: "none" }, {}, now), { patch: { iceKingSnow: "none" } });
  assert.ok(scheduleEventPatch({ event: "iceKingSnow", mode: "half" }, {}, now).error);
});

test("the Events page's cards: the Ice King held before the event with Start now, and its snow", () => {
  const now = new Date();
  const dated = datedFlagsStatus(now.getTime(), (season) => seasonMoment(now, null, season).getTime(), season7);
  const cards = eventSchedules({ now, config: season7, dated });
  const king = cards.find(({ id }) => id === "iceKing");
  assert.deepEqual([king.mode, king.modes, king.now], ["before", ["before", "dates", "custom"], true]);
  assert.equal(king.state.nowLabel, "before the event");
  assert.ok(king.flags.includes("WD2") && king.flags.includes("SP") && king.flags.includes("LoadLevel"));
  const snow = cards.find(({ id }) => id === "iceKingSnow");
  assert.deepEqual([snow.mode, snow.modes], ["event", ["event", "none", "full"]]);
  assert.equal(snow.modeLabels.full, "Island under snow");
  const meteor = cards.find(({ id }) => id === "meteorStrike");
  assert.deepEqual([meteor.mode, meteor.modes], ["meteors", ["none", "broadcast", "meteors", "impact"]], "the meteor shower's choice as it was");
  assert.deepEqual(scheduleEventPatch({ event: "meteorStrike", mode: "impact" }, {}, now), { patch: { meteorStrike: "impact" } });
});

// CoreV2 #490 (the reporter's second logs): Start now pressed in a running Solo match played the storm there (its storm
// circle held 54 s longer), but that match had started on Playlist_DefaultSolo, so no Ice Legion could come. Start in 5
// minutes gives the time to start a match after it, which is then the Ice Storm's and gets the Ice Legion.
test("Start in 5 minutes: the storm 5 minutes on, and a match started now is the Ice Storm's; Start now's running match isn't", () => {
  const defaults = createSettingsStore(null).get();
  const now = new Date();
  const ms = now.getTime();
  const solo = `${v720}:0:NAE:playlist_defaultsolo`;
  const { patch } = scheduleEventPatch({ event: "iceKing", mode: "soon" }, season7, now);
  assert.equal(patch.datedFlags.iceKing.mode, "custom");
  withConfig({ ...season7, ...patch }, () => {
    const states = inBuild(v720, () => iceKingStates(now));
    const storm = states.find(({ events }) => events.some(({ eventType }) => eventType === "WD2"));
    assert.equal(storm.validFrom, ms + 5 * 60000, "the storm 5 minutes on");
    assert.deepEqual(typesAt(states, ms), ["Countdown", "LoadLevel", "LoadSequence", "R0", "WD1", "warning"], "the last 12 minutes on at once");
    assert.equal(iceStormMatchBucket(solo, v720, defaults, now), `${v720}:0:NAE:playlist_deimos_solo_winter`, "a match started now");
    assert.equal(iceStormMatchBucket(solo, v720, defaults, new Date(ms + 4 * 60000)), `${v720}:0:NAE:playlist_deimos_solo_winter`, "and up to the storm");
  });
  // Start now: the match already running stays on the playlist it started on; one started in its 30 seconds is the Ice Storm's.
  const started = scheduleEventPatch({ event: "iceKing", mode: "now" }, season7, now).patch;
  withConfig({ ...season7, ...started }, () => assert.equal(iceStormMatchBucket(solo, v720, defaults, now), `${v720}:0:NAE:playlist_deimos_solo_winter`));
  // Only the Ice King has it.
  assert.ok(scheduleEventPatch({ event: "cube", mode: "soon" }, {}, now).error);
  const dated = datedFlagsStatus(ms, (season) => seasonMoment(now, null, season).getTime(), season7);
  const cards = eventSchedules({ now, config: season7, dated });
  const king = cards.find(({ id }) => id === "iceKing");
  assert.equal(king.soon.seconds, 300);
  assert.equal(king.soon.label, "Start in 5 minutes");
  assert.match(king.soon.confirm, /Ice Fiends/);
  assert.match(king.nowConfirm, /no Ice Fiends/);
  assert.equal(cards.find(({ id }) => id === "cube").soon, null, "another card has Start now alone");
});

// CoreV2 #490: the storm's Ice Legion comes only to a match on an Ice Storm playlist (its Mutator_DeimosMissions_W); its
// dynamic spawners wait for WDSPAWN, which DeimosTurnOn stands in for at the storm.
test("the Ice Legion: WDSPAWN from the storm on, whatever the snow, and the default modes' matches on the Ice Storm's in the half hour before it", () => {
  const defaults = createSettingsStore(null).get();
  const now = new Date();
  const ms = now.getTime();
  const solo = `${v720}:0:NAE:playlist_defaultsolo`;
  withConfig(season7, () => {
    assert.equal(inBuild(v720, () => iceKingStormSoon(now)), false, "before the event: no storm coming");
    assert.equal(iceStormMatchBucket(solo, v720, defaults, now), solo);
  });
  // The storm 10 minutes on: the default modes' matches are the Ice Storm's.
  const soon = scheduleEventPatch({ event: "iceKing", mode: "custom", startAt: new Date(ms + 10 * 60000).toISOString() }, season7, now).patch;
  withConfig({ ...season7, ...soon }, () => {
    assert.equal(iceKingStormSoon(now, v720), true);
    assert.equal(iceStormMatchBucket(solo, v720, defaults, now), `${v720}:0:NAE:playlist_deimos_solo_winter`);
    assert.equal(iceStormMatchBucket(`${v720}:0:NAE:playlist_defaultduo`, v720, defaults, now), `${v720}:0:NAE:playlist_deimos_duo_winter`);
    assert.equal(iceStormMatchBucket(`${v720}:0:NAE:playlist_defaultsquad`, v720, defaults, now), `${v720}:0:NAE:playlist_deimos_squad_winter`);
    assert.equal(iceStormMatchBucket(`${v720}:0:NAE:playlist_respawn_24`, v720, defaults, now), `${v720}:0:NAE:playlist_respawn_24`, "another mode as it is");
    assert.equal(iceStormMatchBucket(solo, v710, defaults, now), solo, "7.10 has no Ice Storm");
    assert.equal(iceStormMatchBucket(solo, v720, { ...defaults, matchmakingModes: { ...defaults.matchmakingModes, iceStormSolo: false } }, now), solo, "Ice Storm Solo's switch off");
    assert.equal(iceStormMatchBucket(solo, v720, { ...defaults, fortnitemaresReplacesDefaults: false }, now), solo, "the defaults kept");
    const storm = ms + 10 * 60000;
    assert.equal(iceStormMatchBucket(solo, v720, defaults, new Date(storm + 1000)), solo, "after the storm the lobby has the Ice Storm modes");
    assert.equal(iceStormMatchBucket(solo, v720, defaults, new Date(storm - 31 * 60000)), solo, "more than half an hour before it");
    const states = inBuild(v720, () => iceKingStates(now));
    assert.ok(!typesAt(states, ms).includes("WDSPAWN"), "no Ice Legion before the storm");
    assert.ok(typesAt(states, storm).includes("WDSPAWN"), "from the storm");
    assert.ok(typesAt(states, storm + 86400000).includes("WDSPAWN"), "and after it");
  });
  withConfig({ ...season7, ...soon, iceKingSnow: "none" }, () => {
    assert.ok(typesAt(inBuild(v720, () => iceKingStates(now)), ms + 11 * 60000).includes("WDSPAWN"), "Season 7's own snow keeps the Ice Legion");
  });
  withConfig({ ...season7, iceKingSnow: "full" }, () => {
    assert.ok(!typesAt(inBuild(v720, () => iceKingStates(now)), ms).includes("WDSPAWN"), "the snow alone brings no Ice Legion");
  });
  // Epic's dates: the half hour before 19 January 2019, 19:00 UTC, on the replay.
  withConfig({ ...season7, datedFlags: { iceKing: { mode: "dates" } } }, () => {
    assert.equal(iceStormMatchBucket(solo, v720, defaults, onReplay("2019-01-19T18:40:00Z")), `${v720}:0:NAE:playlist_deimos_solo_winter`);
    assert.equal(iceStormMatchBucket(solo, v720, defaults, onReplay("2019-01-19T18:20:00Z")), solo);
  });
});

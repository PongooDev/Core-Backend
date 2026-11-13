import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { activeEventFlags, configureEvents, eventsActiveUntil, isEventActive } from "../src/events/events.js";
import { mergeTimedStates, odditiesStates, season4FlagsStatus } from "../src/events/oddities.js";
import { rocketLaunchStates } from "../src/events/rocketlaunch.js";
import { oddities, odditySchedulePatch, sanitizeSeason4Flags, season4Flag, season4FlagGroups, spacedOdditySchedule } from "../src/events/season4flags.js";
import { seasonHistoryStart } from "../src/store/itemshop.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Season 4's event flags (Core-Backend #296): every EventFlag.* of 4.0's to 4.5's paks known, grouped and switchable,
// and the rifts of July 2018 scheduled.
const v40 = "4039451";
const v42 = "4072250";
const v442 = "4132537";
const v450 = "4159770";
const v45 = "4166199";
const v36 = "4019403";

const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};

test("every event flag of Season 4's paks is in the catalog, in a group", () => {
  // The byte scans events/events.js lists: 4.0's (with the MissionAlerts rows' flags), 4.2's, 4.4.2's and 4.5's, and 5.0's
  // RoadTrip2018 (Core-Backend #298), 5.10's (CL-4240749) Birthday and Season 5 map flags, 5.21's Tomato Town rift, 5.30's
  // Cube and 5.40's lake names and High Stakes, and 6.00's LobbySeason6; and 6.00's floating island, whose sixteen are in
  // the server-only BP_IslandServerOnly (CL-4395664's server-assets pak), not the client's paks.
  const scanned = ["ActiveMiniBosses", "ActiveStorms", "Fortnitemares", "GroupMission", "Horde", "PassiveMiniBosses", "PassiveStorms",
    "SurviveTheStorm", "Blockbuster2018Phase1", "Blockbuster2018Phase2", "Blockbuster2018Phase3", "Blockbuster2018Phase4", "BR.Allow50v50",
    "BR.CandyCaneGuns", "BR.DisallowDuo", "BR.DisallowSolo", "BR.DisallowSquad", "SupplyDropGift", "LobbyHalloweenDecor", "LobbyWinterDecor",
    "LobbySeason4", "RoadTrip2018", "Anniversary2018_BR", "BirthdayBattleBus", "SupplyDropBDay", "BR_S5_Rift_Shrink", "BR_S5_RiskyReels_Event",
    "BR_S5_Oddity_Tomato_Tell", "BR_S5_Oddity_Tomato_Event", "BR_S5_Rift_Corrupt", "BR_S5_Cube_Lightning", "BR_S5_Cube_TurnOn", "BR_S5_Cube_StartMove", "BR_S5_Cube_MoveTo1", "BR_S5_Cube_Rune1", "BR_S5_Cube_MoveTo2", "BR_S5_Cube_Rune2", "BR_S5_Cube_MoveTo3", "BR_S5_Cube_Rune3", "BR_S5_Cube_MoveTo4", "BR_S5_Cube_Rune4", "BR_S5_Cube_MoveTo5", "BR_S5_Cube_Rune5", "BR_S5_Cube_MoveTo6", "BR_S5_Cube_Rune6", "BR_S5_Cube_MoveTo7", "BR_S5_Cube_Rune7", "BR_S5_Cube_MoveToLake", "BR_S5_Cube_Lake", "BR_S5_Cube_MoveTo8", "BR_S5_Cube_Destination", "LTM_Heist", "LobbySeason6",
    "BR_S4_Geode_Begin", "BR_S4_Geode_Countdown", "BR_S4_Geode_Over", "BR_S4_Rift_Growth",
    ...Array.from({ length: 8 }, (_, i) => [`BR_S4_Oddity_0${i + 1}_Tell`, `BR_S4_Oddity_0${i + 1}_Event`]).flat(),
    ...Array.from({ length: 7 }, (_, i) => `BR_S6_Island_MoveTo${i + 1}`), ...Array.from({ length: 8 }, (_, i) => `BR_S6_Island_Rune${i}`),
    // and 6.10's seventeenth (CL-4464155's server-assets pak),
    "BR_S6_Island_MoveTo8", "BR_S6_Island_Rune8",
    // and 6.20's three new ones and the Fortnitemares quest map's two (events/events.js),
    "LTM_Fortnitemares", "LobbySeason6Halloween", "HalloweenBattleBus", "FortnitemaresPhase1", "FortnitemaresPhase2",
    // and 6.20's island scripting's crack (CL-4497486's server-assets pak) and 6.21's two new ones,
    "BR_S6_Island_Crack", "LTM_LilKevin", "Fortnitemares_Part4"].map((name) => `EventFlag.${name}`)
    // and that scripting's POI0 and POI1, which aren't EventFlag.* (events/events.js islandPoi).
    .concat(["POI0", "POI1"]);
  for (const flag of scanned) assert.ok(season4Flag(flag), flag);
  const all = season4FlagGroups.flatMap((group) => group.flags.map(({ flag }) => flag));
  assert.equal(new Set(all).size, all.length, "each flag once");
  assert.deepEqual(new Set(all), new Set(scanned));
  // The comment's list of 4.5's scan matches the catalog's 4.5 flags.
  const source = fs.readFileSync(new URL("../src/events/events.js", import.meta.url), "utf8");
  assert.match(source, /events\/season4flags\.js's catalog/);
});

test("the admin switches a Season 4 flag on or off over what each build serves, on the builds whose paks have it", () => {
  const config = { mode: "auto", season4Flags: { overrides: { "EventFlag.Blockbuster2018Phase4": "on", "EventFlag.LobbySeason4": "off", "EventFlag.BR.DisallowSolo": "on" } } };
  withConfig(config, () => {
    assert.ok(activeEventFlags(v40).includes("EventFlag.Blockbuster2018Phase1"));
    assert.ok(!activeEventFlags(v40).includes("EventFlag.Blockbuster2018Phase4"), "4.0's paks have no Phase4");
    assert.ok(activeEventFlags(v442).includes("EventFlag.Blockbuster2018Phase4"));
    assert.ok(isEventActive("EventFlag.Blockbuster2018Phase4", v442));
    assert.ok(!activeEventFlags(v45).includes("EventFlag.LobbySeason4"));
    assert.ok(!isEventActive("EventFlag.LobbySeason4", v45));
    assert.ok(activeEventFlags(v42).includes("EventFlag.BR.DisallowSolo"));
    assert.ok(!activeEventFlags(v442).includes("EventFlag.BR.DisallowSolo"), "4.4.2's paks dropped it");
    assert.ok(!activeEventFlags(v36).includes("EventFlag.Blockbuster2018Phase4"), "not a Season 3 flag");
  });
  // The forced and Custom modes are their own lists.
  withConfig({ ...config, mode: "custom", customFlags: ["EventFlag.Horde"] }, () => assert.deepEqual(activeEventFlags(v45), ["EventFlag.Horde"]));
  // Without overrides 4.5 serves what it did.
  withConfig({ mode: "auto" }, () => assert.ok(activeEventFlags(v45).includes("EventFlag.LobbySeason4")));
});

test("the overrides' input: switchable catalog flags only, auto removes one; the rocket's flags follow the launch", () => {
  const current = sanitizeSeason4Flags({ overrides: { "eventflag.horde": "on", "EventFlag.BR_S4_Geode_Begin": "on", "EventFlag.Nope": "on" }, oddities: "launch" });
  assert.deepEqual(current, { overrides: { "EventFlag.Horde": "on" }, oddities: "launch", schedule: [] });
  assert.deepEqual(sanitizeSeason4Flags({ overrides: { "EventFlag.Horde": "auto" }, oddities: "sometimes" }, current), { overrides: {}, oddities: "launch", schedule: [] });
});

test("the rifts' own times (Core-Backend #304): a start and spacing for all eight, or rift by rift over the current ones", () => {
  const spaced = spacedOdditySchedule({ startAt: "2026-11-10T18:00:00Z", spacingHours: 12, warningHours: 2 });
  assert.equal(spaced.length, oddities.length);
  assert.deepEqual(spaced[0], { number: 1, tellAt: "2026-11-10T18:00:00.000Z", eventAt: "2026-11-10T20:00:00.000Z" });
  assert.deepEqual(spaced[7], { number: 8, tellAt: "2026-11-14T06:00:00.000Z", eventAt: "2026-11-14T08:00:00.000Z" });
  assert.equal(spacedOdditySchedule({ startAt: "nope" }), null);
  assert.equal(spacedOdditySchedule({ startAt: "2026-11-10T18:00:00Z", spacingHours: -1 }), null);
  // Epic's spacing by default: a day apart, each prop a day after its rift.
  assert.equal(spacedOdditySchedule({ startAt: "2026-11-10T18:00:00Z" })[1].eventAt, "2026-11-12T18:00:00.000Z");

  const current = sanitizeSeason4Flags({ oddities: "custom", schedule: { startAt: "2026-11-10T18:00:00Z" } });
  assert.equal(current.schedule.length, 8);
  const edited = sanitizeSeason4Flags({ schedule: [{ number: 3, tellAt: "2026-12-01T00:00:00Z", eventAt: "2026-12-01T01:00:00Z" }, { number: 8, tellAt: null, eventAt: null }] }, current);
  assert.deepEqual(edited.schedule.map(({ number }) => number), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(edited.schedule[2].eventAt, "2026-12-01T01:00:00.000Z");
  assert.equal(edited.schedule[0].tellAt, current.schedule[0].tellAt, "the others keep theirs");
  assert.equal(odditySchedulePatch([{ number: 3, tellAt: "2026-12-02T00:00:00Z", eventAt: "2026-12-01T00:00:00Z" }], current.schedule), null, "a prop can't go before its rift forms");
  assert.equal(odditySchedulePatch([{ number: 9, tellAt: "2026-12-01T00:00:00Z", eventAt: "2026-12-01T00:00:00Z" }]), null);
  assert.deepEqual(sanitizeSeason4Flags({ schedule: null }, current).schedule, []);
  assert.deepEqual(sanitizeSeason4Flags({ schedule: "soon" }, current).schedule, current.schedule, "bad input keeps the current times");
});

test("the custom mode serves each rift at the admin's times, and a rift without times isn't scheduled", () => {
  const schedule = [{ number: 1, tellAt: "2026-11-10T18:00:00Z", eventAt: "2026-11-10T20:00:00Z" }, { number: 3, tellAt: "2026-11-11T18:00:00Z", eventAt: "2026-11-12T18:00:00Z" }];
  const config = { mode: "auto", season4Flags: { oddities: "custom", schedule } };
  const at = (iso) => new Date(iso);
  assert.deepEqual(odditiesStates(at("2026-11-10T19:00:00Z"), v45, config)[0].events,
    [{ eventType: oddities[0].tell, activeSince: "2026-11-10T18:00:00.000Z", activeUntil: "2026-11-10T20:00:00.000Z" }]);
  const later = odditiesStates(at("2026-11-11T19:00:00Z"), v45, config);
  assert.deepEqual(later[0].events.map(({ eventType }) => eventType), [oddities[0].event, oddities[2].tell]);
  assert.equal(later[0].events[0].activeUntil, eventsActiveUntil, "a rifted prop stays rifted");
  assert.deepEqual(later.slice(1).map(({ validFrom }) => validFrom), [Date.parse("2026-11-12T18:00:00Z")]);
  assert.deepEqual(odditiesStates(at("2026-11-10T19:00:00Z"), v442, config), [], "4.5 only");
  const status = season4FlagsStatus(at("2026-11-10T19:00:00Z"), config, []);
  assert.equal(status.oddities, "custom");
  assert.equal(status.rifts[2].tellAt, "2026-11-11T18:00:00.000Z");
  assert.equal(status.rifts[1].tellAt, undefined, "rift 2 has no times");
});

test("the rifts follow the rocket launch by Epic's days, each _Tell until its _Event, which stays", () => {
  const launch = Date.parse("2026-11-10T18:00:00Z");
  const config = { mode: "auto", rocketLaunch: { at: new Date(launch).toISOString(), countdownHours: 48 }, season4Flags: { oddities: "launch" } };
  const shift = launch - Date.parse("2018-06-30T18:00:00Z");
  const at = (iso) => new Date(Date.parse(iso) + shift);
  assert.deepEqual(odditiesStates(new Date(launch), v442, config), [], "4.5 only");
  assert.deepEqual(odditiesStates(new Date(launch), v45, { ...config, season4Flags: { oddities: "off" } }), []);
  assert.deepEqual(odditiesStates(new Date(launch), v45, { mode: "auto", season4Flags: { oddities: "launch" } }), [], "no launch time, no rifts");
  // The evening of the launch: the Lonely Lodge sign's rift has formed.
  const evening = odditiesStates(at("2018-06-30T20:00:00Z"), v45, config);
  assert.deepEqual(evening[0].events, [{ eventType: oddities[0].tell, activeSince: at("2018-06-30T18:04:00Z").toISOString(), activeUntil: at("2018-06-30T22:00:00Z").toISOString() }]);
  assert.equal(evening[1].validFrom, at("2018-06-30T22:00:00Z").getTime());
  // 4 July: the motel sign and the Tomato Head are gone for good, the Noms sign is going, the Durrr Burger's rift forms.
  const july4 = odditiesStates(at("2018-07-04T23:00:00Z"), v450, config)[0].events;
  assert.deepEqual(july4.map(({ eventType }) => eventType), [oddities[0].event, oddities[1].event, oddities[2].event, oddities[3].event, oddities[4].tell]);
  assert.ok(july4.filter(({ eventType }) => eventType.endsWith("_Event")).every(({ activeUntil }) => activeUntil === eventsActiveUntil));
  // A rift switched off by hand isn't scheduled.
  const off = { ...config, season4Flags: { oddities: "launch", overrides: { [oddities[4].tell]: "off" } } };
  assert.ok(!odditiesStates(at("2018-07-04T23:00:00Z"), v45, off)[0].events.some(({ eventType }) => eventType === oddities[4].tell));
  // With the rocket's own parts, as the calendar serves them.
  const merged = mergeTimedStates(rocketLaunchStates(new Date(launch + 1000), v45, config), odditiesStates(new Date(launch + 1000), v45, config));
  assert.deepEqual(merged[0].events.map(({ eventType }) => eventType), ["EventFlag.BR_S4_Geode_Begin"]);
  assert.deepEqual(merged[1].events.map(({ eventType }) => eventType), ["EventFlag.BR_S4_Geode_Over", "EventFlag.BR_S4_Rift_Growth", oddities[0].tell]);
});

test("the rifts on Epic's dates run on Season 4's replay and end with its 12 July", () => {
  const start = "2026-11-01";
  const config = { mode: "auto", seasonStarts: { 4: start }, season4Flags: { oddities: "dates" } };
  // The replay's day 1 is Season 4's first day: a real moment stands at the same moment of Epic's season shifted by that.
  const shift = Date.parse(`${start}T00:00:00Z`) - seasonHistoryStart(4);
  const real = (iso) => new Date(Date.parse(iso) + shift);
  withConfig(config, () => {
    const states = odditiesStates(real("2018-07-05T23:00:00Z"), v45, config);
    assert.deepEqual(states[0].events.map(({ eventType }) => eventType), [...oddities.slice(0, 5).map(({ event }) => event), oddities[5].tell]);
    assert.equal(states[0].events[0].activeUntil, real("2018-07-12T00:00:00Z").toISOString(), "until the replay reaches Season 5");
    assert.equal(states.at(-1).validFrom, real("2018-07-12T00:00:00Z").getTime());
    assert.deepEqual(states.at(-1).events, []);
    assert.deepEqual(odditiesStates(real("2018-06-01T00:00:00Z"), v45, config)[0].events, [], "June: nothing yet");
    const status = season4FlagsStatus(real("2018-07-05T23:00:00Z"), config, []);
    assert.equal(status.rifts[4].eventAt, real("2018-07-05T22:00:00Z").toISOString());
    assert.equal(status.groups.find(({ id }) => id === "rocket").managedBy, "rocketLaunch");
  });
});

test("the admin panel switches Season 4 flags and the rift schedule, and 4.5's timeline serves them", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Flags45");
    const timeline = async (changelist) => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": `game=FortniteGame, engine=UE4, build=++Fortnite+Release-4.5-CL-${changelist}`, Authorization: `bearer ${token}` } })).body.channels["client-events"];
    const types = (state) => state.activeEvents.map(({ eventType }) => eventType);

    const switched = await post(backend.port, "/admin/api/events/flags", null, { flag: oddities[2].event, state: "on" });
    assert.equal(switched.status, 200);
    const flag = switched.body.season4Flags.groups.find(({ id }) => id === "oddities").flags.find((entry) => entry.flag === oddities[2].event);
    assert.deepEqual([flag.override, flag.servedOn45], ["on", true]);
    const served = await timeline(v45);
    assert.ok(types(served.states[0]).includes(oddities[2].event), "the Tomato Head is rifted away");
    assert.ok(served.states[0].state.activeEventFlags.includes(oddities[2].event));
    assert.ok(!types((await timeline(v442)).states[0]).includes(oddities[2].event), "4.4.2's paks have no oddities");

    assert.equal((await post(backend.port, "/admin/api/events/flags", null, { flag: "EventFlag.BR_S4_Geode_Begin", state: "on" })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/events/flags", null, { flag: "EventFlag.Nope", state: "on" })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/events/flags", null, { flag: oddities[2].event, state: "maybe" })).status, 400);
    await post(backend.port, "/admin/api/events/flags", null, { flag: oddities[2].event, state: "auto" });
    assert.ok(!types((await timeline(v45)).states[0]).includes(oddities[2].event));

    // The rifts after a launch an hour ago: the Lonely Lodge sign's rift has formed, and the timeline changes when it goes.
    assert.equal((await post(backend.port, "/admin/api/events/rocket", null, { action: "schedule", at: new Date(Date.now() - 3600000).toISOString(), countdownHours: 48 })).status, 200);
    assert.equal((await post(backend.port, "/admin/api/events/flags", null, { oddities: "launch" })).status, 200);
    const rifts = await timeline(v45);
    assert.ok(types(rifts.states[0]).includes(oddities[0].tell));
    assert.ok(Date.parse(rifts.cacheExpire) <= Date.now() + 3 * 3600000 + 60000, "good until the sign goes");
    const events = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/admin/api/events/overview" });
    assert.equal(events.body.season4Flags.oddities, "launch");
    assert.ok(events.body.season4Flags.rifts[0].tellAt);

    // The admin's own times (Core-Backend #304): saved, switched to the custom mode, served, and the revision moves.
    const revision = async () => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/game/v2/calendar/revision",
      headers: { "User-Agent": `game=FortniteGame, engine=UE4, build=++Fortnite+Release-4.5-CL-${v45}`, Authorization: `bearer ${token}` } })).body.revision;
    const before = await revision();
    const startAt = new Date(Date.now() - 3600000).toISOString();
    const custom = await post(backend.port, "/admin/api/events/flags", null, { schedule: { startAt, spacingHours: 0.5, warningHours: 2 } });
    assert.equal(custom.status, 200);
    assert.equal(custom.body.season4Flags.oddities, "custom");
    assert.equal(custom.body.season4Flags.schedule.length, 8);
    assert.notEqual(await revision(), before, "running gameservers refresh");
    // An hour in, rifts 1 and 2 have formed (0 and 30 minutes ago) and rift 3 forms now; none of the props has gone yet.
    const customTypes = types((await timeline(v45)).states[0]);
    assert.ok(customTypes.includes(oddities[0].tell) && customTypes.includes(oddities[1].tell));
    assert.ok(!customTypes.some((type) => type.endsWith("_Event")));
    // One rift moved into the past: its prop is gone.
    const moved = await post(backend.port, "/admin/api/events/flags", null, { schedule: [{ number: 5, tellAt: new Date(Date.now() - 7200000).toISOString(), eventAt: new Date(Date.now() - 60000).toISOString() }] });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.season4Flags.schedule.length, 8);
    assert.ok(types((await timeline(v45)).states[0]).includes(oddities[4].event));
    assert.equal((await post(backend.port, "/admin/api/events/flags", null, { schedule: [{ number: 5, tellAt: "2026-12-02T00:00:00Z", eventAt: "2026-12-01T00:00:00Z" }] })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/events/flags", null, { schedule: { startAt: "soon" } })).status, 400);
    const cleared = await post(backend.port, "/admin/api/events/flags", null, { schedule: null, oddities: "off" });
    assert.deepEqual([cleared.body.season4Flags.oddities, cleared.body.season4Flags.schedule], ["off", []]);
  } finally {
    backend.close();
  }
});

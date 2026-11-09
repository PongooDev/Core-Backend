import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { activeEventFlags, configureEvents, eventsActiveUntil, isEventActive } from "../src/events/events.js";
import { mergeTimedStates, odditiesStates, season4FlagsStatus } from "../src/events/oddities.js";
import { rocketLaunchStates } from "../src/events/rocketlaunch.js";
import { oddities, sanitizeSeason4Flags, season4Flag, season4FlagGroups } from "../src/events/season4flags.js";
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
  // The byte scans events/events.js lists: 4.0's (with the MissionAlerts rows' flags), 4.2's, 4.4.2's and 4.5's.
  const scanned = ["ActiveMiniBosses", "ActiveStorms", "Fortnitemares", "GroupMission", "Horde", "PassiveMiniBosses", "PassiveStorms",
    "SurviveTheStorm", "Blockbuster2018Phase1", "Blockbuster2018Phase2", "Blockbuster2018Phase3", "Blockbuster2018Phase4", "BR.Allow50v50",
    "BR.CandyCaneGuns", "BR.DisallowDuo", "BR.DisallowSolo", "BR.DisallowSquad", "SupplyDropGift", "LobbyHalloweenDecor", "LobbyWinterDecor",
    "LobbySeason4", "BR_S4_Geode_Begin", "BR_S4_Geode_Countdown", "BR_S4_Geode_Over", "BR_S4_Rift_Growth",
    ...Array.from({ length: 8 }, (_, i) => [`BR_S4_Oddity_0${i + 1}_Tell`, `BR_S4_Oddity_0${i + 1}_Event`]).flat()].map((name) => `EventFlag.${name}`);
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
  assert.deepEqual(current, { overrides: { "EventFlag.Horde": "on" }, oddities: "launch" });
  assert.deepEqual(sanitizeSeason4Flags({ overrides: { "EventFlag.Horde": "auto" }, oddities: "sometimes" }, current), { overrides: {}, oddities: "launch" });
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
  } finally {
    backend.close();
  }
});

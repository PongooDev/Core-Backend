import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { activeEventFlags, activeMiniBosses, blockbuster2018Phase1, blockbuster2018Phase2, blockbuster2018Phase3, blockbuster2018Phase4,
  configureEvents, eventsActiveUntil, groupMission, lobbySeason4, passiveStorms } from "../src/events/events.js";
import { contentUpdateStates, lootHotfixSection } from "../src/events/contentupdates.js";
import { finalFightRows } from "../src/events/finalfight.js";
import { hasLtm, inOriginalWindow, ltmNewMode, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, ltms } from "../src/events/ltms.js";
import { meteorStrikeRows } from "../src/events/meteorstrike.js";
import { geodeBegin, geodeCountdown, geodeOver, nextRocketLaunchChange, riftGrowth, rocketLaunchFlags, rocketLaunchStates, rocketLaunchStatus,
  sanitizeRocketLaunch } from "../src/events/rocketlaunch.js";
import { athenaChallengeBundles, athenaCosmetics, athenaLootTables, athenaSeason } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { brokenChallengeOf } from "../src/profiles/challenges.js";
import { mtxProfileId, usesCommonProfiles } from "../src/profiles/common.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Fortnite 4.5: CL-4159770 (++Fortnite+Release-4.5, "4.5.0", Update v4.50, 27 June 2018) and CL-4166199 ("4.5"), both on
// CL-4166199's data (gamedata/4166199).
const v450 = "4159770";
const v45 = "4166199";
const v45s = [v450, v45];
const v442 = "4132537";
const v40 = "4039451";
const now = new Date("2026-11-09T12:00:00Z");

test("4.5's two builds are known by their versions, play on CL-4166199's data and are Season 4's newest", () => {
  assert.deepEqual(v45s.map(versionOf), ["4.5.0", "4.5"]);
  for (const build of v45s) {
    assert.equal(dataBuild(build), v45, `${build} plays on CL-4166199's data, not 4.4.2's`);
    assert.ok(buildChoices().includes(build));
  }
  assert.equal(dataBuild(v442), v442);
  assert.equal(dataBuild("4150000"), v442, "a build between them Core doesn't know still plays on 4.4.2's");
  assert.equal(dataBuild("4170000"), v45);
  assert.equal(allowedBuildList(["4.5.0", "4.5"]).join(), v45s.join());
  assert.deepEqual(inBuild(v45, athenaSeason), inBuild(v40, athenaSeason), "4.5 keeps 4.0's AthenaSeason4");
  assert.deepEqual(inBuild(v450, athenaCosmetics), inBuild(v45, athenaCosmetics));
  assert.equal(buildOfSeason(4), v45);
  assert.equal(seasonName(4), "Season 4 (4.0 – 4.5)");
});

test("4.5's data: its 33 cosmetics, revised weeks 9 and 10, the Dual Pistols and the vaulted SMG rows", () => {
  const c45 = inBuild(v45, athenaCosmetics);
  const c44 = inBuild(v442, athenaCosmetics);
  const added = Object.keys(c45).filter((id) => !c44[id]);
  assert.equal(added.length, 33);
  assert.deepEqual(["AthenaCharacter:cid_160_athena_commando_m_speedyred", "AthenaCharacter:cid_155_athena_commando_f_gumshoe",
    "AthenaCharacter:cid_156_athena_commando_f_fuzzybearind", "AthenaCharacter:cid_153_athena_commando_f_carbideblack", "AthenaDance:eid_infinitedab"]
    .map((id) => c45[id].name), ["Vertex", "Gumshoe", "Fireworks Team Leader", "Oblivion", "Infinite Dab"]);
  assert.ok(!c45["AthenaDance:eid_pinwheel"], "4.5's data has no Pinwheel");
  const bundles = inBuild(v45, athenaChallengeBundles);
  assert.ok(bundles.questbundle_s4_week_009.quests.some(({ quest }) => quest === "quest_br_visit_namedlocations_singlematch"));
  const loot = inBuild(v45, athenaLootTables)["/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client"];
  assert.ok(loot["WorldList.AthenaLoot.Weapon.DualPistol.01"], "the Dual Pistols");
  assert.equal(loot["WorldList.AthenaLoot.Ammo.Shells.01"].Count, 4, "shotgun ammo in stacks of 4");
});

test("4.5's shop adds 4.5's cosmetics on their days, which 4.4 doesn't sell", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season4.json", import.meta.url), "utf8")).days;
  const c44 = inBuild(v442, athenaCosmetics);
  const sold = new Set(history.flatMap((day) => [...day.featured, ...day.daily].map(([id]) => id)).filter((id) => !c44[id]));
  assert.equal(sold.size, 22);
  const june29 = history.find(({ date }) => date === "2018-06-29");
  assert.deepEqual(june29.featured[0], ["AthenaCharacter:cid_160_athena_commando_m_speedyred", 2000]);
  // 30 June is the season's day 61: Vertex on 4.5 only.
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 4: "2026-09-10" } };
  const featured = (build) => inBuild(build, () => itemShopOffers(now, config)).BRWeeklyStorefront.map(({ templateId }) => templateId);
  for (const build of v45s) assert.ok(featured(build).includes("AthenaCharacter:cid_160_athena_commando_m_speedyred"), build);
  assert.ok(!featured(v442).includes("AthenaCharacter:cid_160_athena_commando_m_speedyred"));
});

test("4.5's event flags: Blockbuster Parts 1 to 4 with 4.4's others", () => {
  for (const build of v45s) {
    assert.deepEqual(activeEventFlags(build), [groupMission, blockbuster2018Phase1, blockbuster2018Phase2, blockbuster2018Phase3, blockbuster2018Phase4,
      activeMiniBosses, passiveStorms, lobbySeason4], build);
  }
  assert.ok(!activeEventFlags(v442).includes(blockbuster2018Phase4), "Part 4 is 4.5's");
});

test("4.5's modes: Playground its new mode, Final Fight Teams of 12, 50v50 v3; no Snipers, Blitz or Soaring 50s", () => {
  const none = { matchmakingModes: {} };
  for (const build of v45s) {
    assert.equal(ltmNewMode(build, none).id, "playground", build);
    assert.equal(ltmOn("playground", build, none), true);
    assert.deepEqual(playlistTeamsOf(`${build}:0:NA:35`, build), { maxTeamCount: 1, maxTeamSize: 4, maxSquadSize: 4 });
    assert.equal(hasLtm("finalFightTeams12", build), true);
    assert.equal(ltmOfPlaylist(103, build).id, "finalFightTeams12");
    assert.deepEqual(playlistTeamsOf(`${build}:0:NA:103`, build), { maxTeamCount: 8, maxTeamSize: 12, maxSquadSize: 4 });
    assert.equal(ltmOn("finalFightTeams12", build, none), false, "by its switch");
    assert.ok(ltmPlaylistOverrides(build, { matchmakingModes: { finalFightTeams12: true } }).includes("Playlist_Final_12"));
    assert.equal(hasLtm("fiftyFiftyV3", build), true);
    for (const id of ["sniperShootoutV3", "sniperShootoutV3Solo", "blitzV2", "finalFight", "fiftyFiftyV2"]) assert.equal(hasLtm(id, build), false, `${id} ${build}`);
  }
  assert.equal(hasLtm("finalFightTeams12", v442), false);
  assert.equal(ltmOn("playground", v442, none), false, "4.4 by its switch still");
  configureEvents({ mode: "auto", seasonStarts: { 4: "2018-05-01" } });
  try {
    const dated = { ltmOriginalDates: true, matchmakingModes: {} };
    const at = (date) => new Date(`${date}T12:00:00Z`);
    assert.equal(inOriginalWindow("playground", v45, at("2018-06-27"), dated), true);
    assert.equal(inOriginalWindow("playground", v45, at("2018-06-30"), dated), false, "pulled for its servers");
    assert.equal(inOriginalWindow("playground", v45, at("2018-07-05"), dated), true);
    assert.equal(inOriginalWindow("fiftyFiftyV3", v45, at("2018-07-01"), dated), true);
    assert.equal(inOriginalWindow("fiftyFiftyV3", v442, at("2018-07-01"), dated), false);
  } finally {
    configureEvents(null);
  }
  assert.ok(ltms.every(({ id }) => id !== "soaringFifties"));
});

test("4.5 keeps 4.4's gates and Final Fight's circle hotfix; no content update or curve RowUpdate of its own", () => {
  for (const build of v45s) {
    assert.equal(inBuild(build, () => usesCommonProfiles()), true);
    assert.equal(inBuild(build, () => mtxProfileId()), "common_core");
    assert.deepEqual(inBuild(build, () => contentUpdateStates(now)), []);
    assert.deepEqual(meteorStrikeRows(build), []);
    assert.deepEqual(finalFightRows(build), finalFightRows(v442));
    assert.ok(inBuild(build, () => lootHotfixSection(now, null, [], finalFightRows(build), build)).includes("Default.SafeZone.01.WaitTime;0;180"));
  }
});

test("no broken challenge is listed for 4.5", () => {
  for (const quest of ["quest_br_score_goals", "quest_br_use_shoppingcart", "quest_br_visit_craters_singlematch", "quest_br_visit_namedlocations_singlematch",
    "quest_br_skydive_rings", "quest_br_eliminate_weapon_minigunlmg"]) {
    for (const build of v45s) assert.equal(brokenChallengeOf(quest, build), undefined, `${quest} on ${build}`);
  }
});

test("Blast Off: the rocket's calendar events by the admin's launch time, on 4.5 only", () => {
  const launch = Date.parse("2026-11-10T18:00:00Z");
  const config = { mode: "auto", rocketLaunch: { at: new Date(launch).toISOString(), countdownHours: 48 } };
  const at = (ms) => new Date(ms);
  assert.deepEqual(rocketLaunchStates(now, v45, { mode: "auto" }), [], "nothing without a launch time");
  assert.deepEqual(rocketLaunchStates(now, v442, config), [], "4.4 has no rocket");
  // Before the countdown: no flag, and the next change is the countdown's start.
  assert.deepEqual(rocketLaunchFlags(at(launch - 49 * 3600000), v45, config), []);
  assert.equal(nextRocketLaunchChange(at(launch - 49 * 3600000), v45, config), launch - 48 * 3600000);
  // The countdown: its activeUntil is the launch, which the hologram counts to.
  const counting = rocketLaunchStates(at(launch - 3600000), v450, config);
  assert.deepEqual(counting[0].events, [{ eventType: geodeCountdown, activeSince: new Date(launch - 48 * 3600000).toISOString(), activeUntil: new Date(launch).toISOString() }]);
  assert.deepEqual(counting.map(({ validFrom }) => validFrom).slice(1), [launch, launch + 240000, launch + 240000 + Math.round(13.6 * 86400000)]);
  // The launch: 240 seconds of _Begin, then _Over for good and the rift for 13.6 days.
  assert.deepEqual(rocketLaunchFlags(at(launch + 1000), v45, config), [geodeBegin]);
  assert.equal(rocketLaunchStates(at(launch + 1000), v45, config)[0].events[0].activeUntil, new Date(launch + 240000).toISOString());
  assert.deepEqual(rocketLaunchFlags(at(launch + 300000), v45, config), [geodeOver, riftGrowth]);
  assert.equal(rocketLaunchStates(at(launch + 300000), v45, config)[0].events[0].activeUntil, eventsActiveUntil);
  assert.deepEqual(rocketLaunchFlags(at(launch + 20 * 86400000), v45, config), [geodeOver]);
  assert.equal(nextRocketLaunchChange(at(launch + 20 * 86400000), v45, config), null);
  assert.deepEqual(rocketLaunchFlags(at(launch + 1000), v45, { ...config, mode: "off" }), [], "the events off");
  // The admin's input and status.
  assert.deepEqual(sanitizeRocketLaunch({ at: "nonsense", countdownHours: 500 }), { at: null, countdownHours: 48 });
  assert.deepEqual(sanitizeRocketLaunch({ at: "2026-11-10T18:00:00Z", countdownHours: 0 }), { at: "2026-11-10T18:00:00.000Z", countdownHours: 0 });
  assert.equal(rocketLaunchStatus(at(launch - 3600000), config).phase, "countdown");
  assert.equal(rocketLaunchStatus(now, { mode: "auto" }).phase, "unscheduled");
  // A zero-hour countdown goes straight to the launch.
  const noCountdown = { mode: "auto", rocketLaunch: { at: new Date(launch).toISOString(), countdownHours: 0 } };
  assert.deepEqual(rocketLaunchStates(at(launch - 1000), v45, noCountdown).map(({ events }) => events.map(({ eventType }) => eventType)),
    [[], [geodeBegin], [geodeOver, riftGrowth], [geodeOver]]);
});

test("Blast Off end to end: the admin schedules or starts the launch, and 4.5's timeline carries it", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Rocket45");
    const timeline = async (changelist) => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": `game=FortniteGame, engine=UE4, build=++Fortnite+Release-4.5-CL-${changelist}`, Authorization: `bearer ${token}` } })).body;
    const types = (state) => state.activeEvents.map(({ eventType }) => eventType);
    assert.equal((await timeline(v45)).channels["client-events"].states.length, 1, "no launch: one state, no rocket");
    // A launch an hour from now: the countdown now, then the launch, the rift and after.
    const launch = Date.now() + 3600000;
    const scheduled = await post(backend.port, "/admin/api/events/rocket", null, { action: "schedule", at: new Date(launch).toISOString(), countdownHours: 48 });
    assert.equal(scheduled.status, 200);
    assert.equal(scheduled.body.rocketLaunch.phase, "countdown");
    const body = await timeline(v45);
    const states = body.channels["client-events"].states;
    assert.equal(states.length, 4);
    assert.ok(types(states[0]).includes(geodeCountdown) && types(states[0]).includes(blockbuster2018Phase4));
    assert.equal(states[0].activeEvents.find(({ eventType }) => eventType === geodeCountdown).activeUntil, new Date(launch).toISOString());
    assert.ok(states[0].state.activeEventFlags.includes(geodeCountdown));
    assert.deepEqual([states[1].validFrom, types(states[1]).at(-1)], [new Date(launch).toISOString(), geodeBegin]);
    assert.deepEqual(types(states[2]).slice(-2), [geodeOver, riftGrowth]);
    assert.ok(Date.parse(body.channels["client-events"].cacheExpire) <= launch);
    assert.equal((await timeline(v442)).channels["client-events"].states.length, 1, "4.4 has no rocket");
    // Launch now: the launch sequence runs.
    await post(backend.port, "/admin/api/events/rocket", null, { action: "now", inSeconds: 0 });
    assert.ok(types((await timeline(v450)).channels["client-events"].states[0]).includes(geodeBegin));
    assert.equal((await post(backend.port, "/admin/api/events/rocket", null, { action: "fly" })).status, 400);
    await post(backend.port, "/admin/api/events/rocket", null, { action: "clear" });
    assert.ok(!types((await timeline(v45)).channels["client-events"].states[0]).includes(geodeBegin));
  } finally {
    backend.close();
  }
});

test("The calendar's revision changes when the admin changes the rocket launch, so running gameservers fetch the timeline again", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Revision45");
    const revision = async () => {
      const response = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/game/v2/calendar/revision",
        headers: { "User-Agent": `game=FortniteGame, engine=UE4, build=++Fortnite+Release-4.5-CL-${v45}`, Authorization: `bearer ${token}` } });
      assert.equal(response.status, 200);
      assert.match(response.body.revision, /^[0-9a-f]{12}$/);
      return response.body.revision;
    };
    const first = await revision();
    assert.equal(await revision(), first, "nothing changed: the same revision");
    await post(backend.port, "/admin/api/events/rocket", null, { action: "now", inSeconds: 600 });
    const launched = await revision();
    assert.notEqual(launched, first, "an admin launch changes it");
    await post(backend.port, "/admin/api/events/rocket", null, { action: "clear" });
    assert.notEqual(await revision(), launched, "clearing it changes it again");
  } finally {
    backend.close();
  }
});

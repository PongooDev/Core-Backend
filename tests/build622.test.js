import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { activeEventFlags, configureEvents, fortnitemares, fortnitemares2018, fortnitemaresPart4, fortnitemaresPhase2, halloweenBattleBus, isEventActive,
  islandCrack, islandDrain, islandPoi, lobbySeason6, lobbySeason6Halloween, ltmFortnitemares, ltmLilKevin } from "../src/events/events.js";
import { defaultReplacements, hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmOfPlaylist, ltmOn, playlistIdOfName } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaLootTables, athenaSeason, getAthenaQuest } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { botModeIds, botModeOf, botsForMode } from "../src/matchmaking/botmodes.js";
import { formTeams, parseBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { athenaQuestLogin, setUpAthena } from "../src/profiles/athena.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { rewardModeOf } from "../src/services/fortnite/battleroyale.js";
import { contentPage } from "../src/services/content/pages.js";
import { epicPlaylistImages } from "../src/services/content/playlistimages.js";
import { createSettingsStore } from "../src/settings/store.js";
import { eventStoreInstanceNow, eventStoreOffers } from "../src/store/eventstore.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { hasShowdown } from "../src/tournaments/showdown.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Fortnite 6.22 (Update v6.22, 6 November 2018, Season 6): one build, CL-4543176, on its own data (gamedata/4543176).
// Battle Royale's Fortnitemares is over (its Deimos playlists and five of the six Disco Dominations are gone from the
// paks); it adds Team Terror (Playlist_Deimos_50v50, PlaylistName Playlist_Deimos_50, 450: two teams of 32 with the Cube
// Monsters, on by default), the Heavy Assault Rifle, the NFL outfits in the shop, A.I.M. and E.L.I.M. for Season 6's
// cumulative challenges, and Save the World's Fortnitemares Part 2 (Kill Vlad's Sanguine Dusk, Dire in the Event Store).
const v622 = "4543176";
const v621 = "4526925";
const v620 = "4497486";
const v610 = "4480234";
const replay = { mode: "auto", seasonStarts: { 6: "2018-09-27" } };
const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 6: "2018-09-27" } };
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const at = (iso) => new Date(iso);
const agentOf = (build, version = "6.22") => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "core-622-"));
const withSession = (build, name, run) => {
  const dir = tempDir();
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const held = (session, profileId = "athena") => Object.values(session.profile(profileId).profile.items).map(({ templateId }) => templateId);
const asBuild = (build, version = "6.22") => (port, urlPath, token, method = "GET", body) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": agentOf(build, version), ...(token ? { Authorization: `bearer ${token}` } : {}) };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
};

test("6.22 is known, on its own data, in Season 6", () => {
  assert.equal(versionOf(v622), "6.22");
  assert.equal(allowedBuildList(["6.22"]).join(), v622);
  assert.equal(dataBuild(v622), v622);
  assert.equal(dataBuild("4535000"), v621, "a build between 6.21 and 6.22 plays on 6.21's");
  assert.equal(dataBuild(v621), v621, "6.21 keeps its own data");
  assert.equal(dataBuild("4560000"), v622, "a build between 6.22 and 6.30 plays on 6.22's");
  assert.equal(buildOfSeason(6), "4573279", "Season 6's newest data is 6.31's now (tests/build631.test.js)");
  assert.equal(seasonName(6), "Season 6 (6.00 – 6.31)");
  assert.equal(inBuild(v622, athenaSeason).seasonNumber, 6);
  assert.deepEqual({ ...inBuild(v622, athenaSeason), seasonRewards: null }, { ...inBuild(v621, athenaSeason), seasonRewards: null }, "AthenaSeason6's tiers are 6.21's");
});

test("6.22's data against 6.21's: nineteen cosmetics and none gone, the Heavy Assault Rifle in the loot, A.I.M. for the cumulative challenges, Part 2's rewards", () => {
  const [c622, c621] = [inBuild(v622, athenaCosmetics), inBuild(v621, athenaCosmetics)];
  const added = Object.keys(c622).filter((id) => !c621[id]);
  assert.equal(added.length, 19);
  assert.deepEqual(Object.keys(c621).filter((id) => !c622[id]), []);
  for (const [id, name] of [["AthenaCharacter:cid_207_athena_commando_m_footballdudea", "End Zone"], ["AthenaCharacter:cid_238_athena_commando_f_footballgirld", "Juke"],
    ["AthenaCharacter:cid_214_athena_commando_f_footballreferee", "Whistle Warrior"], ["AthenaCharacter:cid_267_athena_commando_m_robotred", "A.I.M."],
    ["AthenaBackpack:bid_148_robotred", "E.L.I.M."], ["AthenaPickaxe:pickaxe_id_121_robotred", "A.X.E."], ["AthenaDance:eid_touchdown", "Spike It"],
    ["AthenaDance:eid_disagree", "Denied"], ["AthenaGlider:glider_id_071_football", "Touchdown"]]) {
    assert.equal(c622[id]?.name, name, id);
  }
  // Update v6.22's "Heavy AR ... Can be found in floor loot, chests, Vending Machines, and Supply Drops ... Rare, Epic and
  // Legendary".
  const loot = JSON.stringify(inBuild(v622, athenaLootTables));
  assert.ok(loot.includes("WID_Assault_Heavy_Athena_R_Ore_T03"));
  assert.equal(JSON.stringify(inBuild(v621, athenaLootTables)).includes("WID_Assault_Heavy_Athena"), false);
  for (const rarity of ["r", "vr", "sr"]) assert.ok(inBuild(v622, () => getItem(`Weapon:wid_assault_heavy_athena_${rarity}_ore_t03`)), rarity);
  // Season 6's cumulative challenges give A.I.M. and E.L.I.M. at seven (6.21's gave nothing); week 7's damage chain.
  const bundles = inBuild(v622, athenaChallengeBundles);
  assert.deepEqual(bundles.questbundle_s6_cumulative.completionSteps.map(({ count, rewards }) => [count, rewards.map(({ templateId }) => templateId)]),
    [[7, ["AthenaCharacter:cid_267_athena_commando_m_robotred", "AthenaBackpack:bid_148_robotred"]]]);
  assert.deepEqual(inBuild(v621, athenaChallengeBundles).questbundle_s6_cumulative.completionSteps, []);
  assert.ok(bundles.questbundle_s6_week_007.quests.some(({ quest }) => quest === "quest_br_damage_singlematch_chain_1"));
  assert.equal(inBuild(v622, () => getAthenaQuest("quest_br_damage_singlematch_chain_1")).objectives[0].count, 300);
  // The Korean PC bang quests (quest_br_pcb_bundle1_*) are in the data, but no schedule grants them (the backend's partner
  // grants, which Core has none of).
  assert.ok(inBuild(v622, () => getAthenaQuest("quest_br_pcb_bundle1_play_match")));
  assert.deepEqual(Object.keys(inBuild(v622, athenaChallengeSchedules)), Object.keys(inBuild(v621, athenaChallengeSchedules)));
  // Save the World: Part 2's quests have their rewards now (6.21's had none): Kill Vlad's Sanguine Dusk.
  assert.deepEqual(inBuild(v622, () => getQuest("halloweenquest_killvlad")).rewards, [{ templateId: "Hero:hid_outlander_018_sr_t01", quantity: 1 }]);
  assert.deepEqual(inBuild(v621, () => getQuest("halloweenquest_killvlad")).rewards ?? [], []);
  assert.deepEqual(inBuild(v622, () => getQuest("reactivequest_halloween_fetch_6")).rewards, [{ templateId: "Schematic:sid_assault_lmg_halloween_sr_ore_t01", quantity: 1 }]);
  // A full install again (pakchunk1 is back): three of 6.21's Athena mission generators gone.
  const generators = Object.keys(buildGameData(v622, "world", {}).missionGenerators);
  assert.equal(generators.some((id) => id.includes("MissionGen_AthenaEvent36.")), false);
});

test("6.22's event flags: Save the World's Fortnitemares with Part 2, the challenges and POI1; the Halloween lobby and bus, POI0 and Part 4 not", () => {
  assert.deepEqual(activeEventFlags(v622), ["EventFlag.Fortnitemares", "EventFlag.FortnitemaresPhase1", fortnitemaresPhase2, "EventFlag.ActiveMiniBosses",
    ltmFortnitemares, "POI1", ltmLilKevin, "EventFlag.PassiveStorms", lobbySeason6]);
  assert.equal(activeEventFlags(v621).includes(fortnitemaresPhase2), false, "6.21 is as it was");
  assert.ok(activeEventFlags(v621).includes(islandPoi(0)));
  assert.equal(activeEventFlags(v621).includes(islandPoi(1)), false);
  for (const flag of [islandPoi(0), islandPoi(1), islandCrack]) assert.equal(season4Flag(flag).builds[1], Number(v622), flag);
  // and on to 6.31 (tests/build631.test.js), but the Cube's end.
  for (const flag of [ltmFortnitemares, lobbySeason6Halloween, halloweenBattleBus, fortnitemaresPhase2]) assert.equal(season4Flag(flag).builds[1], 4573279, flag);
  assert.deepEqual(season4Flag(islandDrain).builds, [Number(v621), Number(v622)]);
  assert.deepEqual(season4Flag(ltmLilKevin).builds, [Number(v621), 4573279]);
  assert.deepEqual(season4Flag(fortnitemaresPart4).builds, [Number(v621), Number(v621)], "gone from 6.22's paks");
  assert.equal(inBuild(v622, () => isEventActive(fortnitemares)), true);
  assert.equal(inBuild(v622, () => isEventActive(fortnitemares2018)), true);
  // The admin's switches still put Battle Royale's Fortnitemares lobby and bus, and POI0, on 6.22.
  withConfig({ mode: "auto", season4Flags: { overrides: { [lobbySeason6Halloween]: "on", [halloweenBattleBus]: "on", POI0: "on", POI1: "off" } } }, () => {
    const flags = activeEventFlags(v622);
    assert.ok(flags.includes(lobbySeason6Halloween) && flags.includes(halloweenBattleBus) && flags.includes("POI0"));
    assert.equal(flags.includes("POI1"), false);
  });
});

test("a 6.22 gameserver's calendar has POI1 and Fortnitemares Part 2, not POI0", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Calendar622");
    const timeline = (await asBuild(v622)(backend.port, "/fortnite/api/calendar/v1/timeline", token)).body;
    const [state] = timeline.channels["client-events"].states;
    const types = state.activeEvents.map(({ eventType }) => eventType);
    assert.ok(types.includes("POI1") && types.includes(fortnitemaresPhase2), JSON.stringify(types));
    assert.equal(types.includes("POI0"), false);
  } finally {
    await backend.close();
  }
});

test("Team Terror: 6.22's Playlist_Deimos_50 (450), two teams of 32 in squads, on by default and listed as New, its Original dates 6 to 14 November", () => {
  const defaults = createSettingsStore(null).get();
  assert.equal(defaults.matchmakingModes.teamTerror, true, "on by default in the admin panel");
  assert.equal(hasLtm("teamTerror", v622), true);
  assert.equal(hasLtm("teamTerror", v621), false, "6.22's alone");
  assert.equal(ltmOn("teamTerror", v622, defaults), true);
  assert.equal(ltmOn("teamTerror", v622, { ...defaults, matchmakingModes: { ...defaults.matchmakingModes, teamTerror: false } }), false, "its switch turns it off");
  assert.equal(ltmOfPlaylist(450, v622).id, "teamTerror");
  for (const name of ["playlist_deimos_50", "Playlist_Deimos_50"]) {
    assert.equal(playlistIdOfName(name, v622), 450, name);
    assert.equal(parseBucket(`${v622}:0:NAE:${name.toLowerCase()}`, v622).playlistId, 450);
  }
  assert.deepEqual(playlistTeamsOf(`${v622}:0:NAE:playlist_deimos_50`, v622), { maxTeamCount: 2, maxTeamSize: 32, maxSquadSize: 4 });
  // As the other large-team modes: the 32 a side Disco Domination's teams, squads' rewards.
  assert.deepEqual(playlistTeamsOf(`${v622}:0:NAE:playlist_deimos_50`, v622), playlistTeamsOf(`${v622}:0:NAE:playlist_disco_32`, v622));
  assert.equal(rewardModeOf(450, v622), rewardModeOf(217, v622));
  // Two solos face each other, as in 50v50 (#135); a party of four is one squad on one side.
  const teams = playlistTeamsOf(`${v622}:0:NAE:playlist_deimos_50`, v622);
  const formed = formTeams([{ players: ["a"], fill: true }, { players: ["b"], fill: true }, { players: ["c", "d", "e", "f"], fill: false }], teams, { teamsAreSquads: false });
  assert.deepEqual([...formed], [[["c", "d", "e", "f"]], [["a"], ["b"]]]);
  // The lobby lists it enabled; Fortnitemares' modes are gone, so nothing takes the defaults' place (#348's switch on).
  const entry = ltmFrontEndPlaylists(v622, defaults).find(({ name }) => name === "Playlist_Deimos_50");
  assert.deepEqual([entry.enabled, entry.ltm.advertise], [true, "New"]);
  assert.deepEqual(defaultReplacements(v622, defaults), {});
  assert.deepEqual(defaultReplacements(v622, { ...defaults, fortnitemaresReplacesDefaults: true }), {});
  assert.equal(Object.keys(defaultReplacements(v621, defaults)).length, 3, "6.21's Fortnitemares still replaces the defaults");
  withConfig(replay, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    assert.equal(inOriginalWindow("teamTerror", v622, at("2018-11-05T23:59:00Z"), dated), false);
    assert.equal(inOriginalWindow("teamTerror", v622, at("2018-11-06T00:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("teamTerror", v622, at("2018-11-13T23:59:00Z"), dated), true);
    assert.equal(inOriginalWindow("teamTerror", v622, at("2018-11-14T00:00:00Z"), dated), false, "Update v6.30's day");
  });
  // The player bots: a mode of its own in the Player bots card, on by default; off, a Team Terror match has no panel bots.
  assert.ok(botModeIds.includes("teamTerror"));
  assert.equal(botModeOf(450, v622), "teamTerror");
  assert.equal(botModeOf("playlist_deimos_50", v622), "teamTerror");
  assert.equal(defaults.bots.modes.teamTerror, true);
  assert.equal(botsForMode({ forcePlayerAIs: true, fillPlayerTeams: true, modes: { teamTerror: false } }, "teamTerror").fillPlayerTeams, false);
  // Epic's tile.
  assert.match(epicPlaylistImages.Playlist_Deimos_50, /^https:\/\/cdn2\.unrealengine\.com\/Fortnite\/fortnite-game\/playlistinformation\/BR06_In-GamePlaylist_TeamTerror-1024x512-310430bdaf1b1dd0ecb4d3b180bb6409b7ff6e27\.jpg$/);
  const tiles = contentPage(undefined, undefined, v622).playlistinformation.playlist_info.playlists;
  assert.deepEqual(tiles.find(({ playlist_name }) => playlist_name === "Playlist_Deimos_50"),
    { image: epicPlaylistImages.Playlist_Deimos_50, playlist_name: "Playlist_Deimos_50", special_border: "None", _type: "FortPlaylistInfo" });
});

test("6.22's other modes: 6.21's but Fortnitemares' and five Disco Dominations; Playlist_Disco_32, Blitz! and the tournaments kept", () => {
  const defaults = createSettingsStore(null).get();
  for (const id of ["fortnitemares2018Solo", "fortnitemares2018Duos", "fortnitemares2018Squads", "fortnitemaresShowSolo", "discoDomination602", "discoDomination40",
    "discoDominationAlt", "discoDomination40Alt", "discoDomination32Alt"]) {
    assert.equal(hasLtm(id, v622), false, id);
    assert.equal(hasLtm(id, v621), true, `${id} is 6.21's still`);
  }
  for (const id of ["fiftyFiftySeason6", "playgroundV2"]) assert.equal(ltmOn(id, v622, defaults), true, id);
  for (const id of ["discoDomination32", "soaring50s", "highExplosivesSeason6Solo", "blitzSeason6Solo", "blitzSeason6Duos", "blitzSeason6Squads", "showdownSolo"]) {
    assert.equal(hasLtm(id, v622), true, id);
  }
  assert.equal(hasShowdown(v622), true);
  const lobby = ltmFrontEndPlaylists(v622, defaults).map(({ name }) => name);
  assert.equal(lobby.includes("Playlist_Deimos_Solo"), false);
  assert.ok(lobby.includes("Playlist_Deimos_50") && lobby.includes("Playlist_Showdown_Solo"));
});

test("a 6.22 client's hotfix lists Team Terror enabled and the defaults as shipped", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Lobby622");
    const lines = (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/cloudstorage/system/DefaultGame.ini",
      headers: { "User-Agent": agentOf(v622), Authorization: `bearer ${token}` } })).body.toString().split("\r\n").filter((line) => line.includes("FrontEndPlaylistData"));
    const terror = lines.find((line) => line.includes("PlaylistName=Playlist_Deimos_50,"));
    assert.ok(terror && terror.includes("bEnabled=true") && terror.includes("AdvertiseType=New"), terror);
    assert.ok(lines.some((line) => line.includes("PlaylistName=Playlist_DefaultSolo,") && line.includes("bEnabled=true")), "Solo isn't replaced");
    assert.equal(lines.some((line) => line.includes("Playlist_Deimos_Solo")), false);
  } finally {
    await backend.close();
  }
});

test("6.22's shop: the NFL outfits, their referees and tools from 10 November, Spike It, Denied and A.X.E.; 6.21's days are as they were", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season6.json", import.meta.url), "utf8")).days;
  assert.equal(history.length, 70);
  const [c622, c621] = [inBuild(v622, athenaCosmetics), inBuild(v621, athenaCosmetics)];
  // The history holds 6.30's sixteen too (tests/build630.test.js); 6.22 is shown its own.
  const c631 = inBuild("4573279", athenaCosmetics);
  assert.ok(history.every((day) => [...day.featured, ...day.daily].every(([id]) => c631[id])), "only 6.31's cosmetics");
  const own = [...new Set(history.flatMap((day) => [...day.featured, ...day.daily]).map(([id]) => id).filter((id) => !c621[id] && c622[id]))];
  assert.equal(own.length, 17);
  const days = (id) => history.filter((day) => [...day.featured, ...day.daily].some(([entry]) => entry === id)).map(({ date }) => date.slice(5));
  assert.deepEqual(days("AthenaCharacter:cid_207_athena_commando_m_footballdudea"), ["11-10", "11-11", "11-12", "11-13"]);
  assert.deepEqual(days("AthenaGlider:glider_id_071_football"), ["11-10", "11-11", "11-12", "11-13"]);
  assert.deepEqual(days("AthenaDance:eid_touchdown"), ["11-11"]);
  assert.deepEqual(days("AthenaDance:eid_disagree"), ["11-12"]);
  assert.deepEqual(days("AthenaPickaxe:pickaxe_id_121_robotred"), ["11-20"]);
  assert.deepEqual(days("AthenaCharacter:cid_267_athena_commando_m_robotred"), [], "A.I.M. is a challenge reward");
  const nov10 = history.find(({ date }) => date === "2018-11-10");
  assert.deepEqual(nov10.featured.map(([, , tile]) => tile.tile), [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3]);
  assert.deepEqual(nov10.featured.find(([id]) => id === "AthenaCharacter:cid_214_athena_commando_f_footballreferee"),
    ["AthenaCharacter:cid_214_athena_commando_f_footballreferee", 800, { tile: 3, banner: "PickYourStyle" }]);
  const featured = (build, iso) => inBuild(build, () => itemShopOffers(at(iso), shopConfig)).BRWeeklyStorefront;
  const endZone = featured(v622, "2018-11-10T12:00:00Z").find(({ templateId }) => templateId === "AthenaCharacter:cid_207_athena_commando_m_footballdudea");
  assert.equal(endZone.price, 1500);
  assert.equal(featured(v621, "2018-11-10T12:00:00Z").length, 0, "6.21 sells none of them");
  const daily = (build, iso) => inBuild(build, () => itemShopOffers(at(iso), shopConfig)).BRDailyStorefront.map(({ templateId }) => templateId);
  assert.deepEqual(daily(v621, "2018-11-12T12:00:00Z"), daily(v622, "2018-11-12T12:00:00Z").filter((id) => c621[id]));
});

test("6.22's Save the World: Fortnitemares Part 2's quest map, Dire in the Event Store (6.22's alone), Sanguine Dusk from Kill Vlad", () => {
  assert.equal(inBuild(v622, eventStoreInstanceNow), "Fortnitemares2018.STWSpecialEventStoreFront");
  const offers = (build) => JSON.stringify(inBuild(build, () => eventStoreOffers(at("2018-11-08T12:00:00Z"))));
  assert.ok(offers(v622).includes("Hero:hid_ninja_019_sr_t01"));
  for (const hero of ["Hero:hid_commando_018_sr_t01", "Hero:hid_outlander_zoneharvesthw_sr_t01", "Hero:hid_ninja_018_sr_t01"]) assert.ok(offers(v622).includes(hero), hero);
  assert.equal(offers(v621).includes("hid_ninja_019"), false, "6.21's store as it was");
  assert.ok(inBuild(v622, () => getItem("Hero:hid_ninja_019_sr_t01")));
  assert.ok(inBuild(v622, () => activeEventFlags()).includes(fortnitemaresPhase2));
});

test("6.22 players keep the Fortnitemares and Lil' Kev challenges", () => {
  withSession(v622, "fnm622", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    assert.ok(held(session).includes("ChallengeBundleSchedule:schedule_fortnitemares"));
    assert.ok(held(session).includes("ChallengeBundleSchedule:schedule_ltm_lilkevin"));
  });
  assert.equal(activeEventFlags(v610).includes(ltmLilKevin), false);
});

// The matchmaking service's client is 6.21's: 6.22's exe adds no ticket attribute, query parameter, MCP command or route
// (its strings against CL-4526925's).
function matchmakingClient(port, authorization) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/", headers: { Connection: "Upgrade", Upgrade: "websocket",
      "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"), Authorization: authorization } });
    request.on("error", reject);
    request.on("upgrade", (response, socket, head) => {
      const messages = [];
      const waiters = [];
      let buffer = Buffer.alloc(0);
      const deliver = (text) => (waiters.length ? waiters.shift()(text) : messages.push(text));
      const receive = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          let length = buffer[1] & 0x7f;
          let offset = 2;
          if (length === 126) {
            length = buffer.readUInt16BE(2);
            offset = 4;
          }
          if (buffer.length < offset + length) return;
          if ((buffer[0] & 0x0f) === 0x1) deliver(buffer.subarray(offset, offset + length).toString("utf8"));
          buffer = buffer.subarray(offset + length);
        }
      };
      receive(head);
      socket.on("data", receive);
      socket.on("close", () => {
        while (waiters.length) waiters.shift()(null);
      });
      resolve({
        send: (text) => {
          const payload = Buffer.from(text);
          const mask = crypto.randomBytes(4);
          const header = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length])
            : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
          socket.write(Buffer.concat([header, mask, Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]))]));
        },
        next: () => (messages.length ? Promise.resolve(messages.shift()) : new Promise((done) => waiters.push(done))),
        close: () => socket.destroy()
      });
    });
    request.end();
  });
}
const authorizationOf = ({ ticketType, payload, signature }) => `Epic-Signed ${ticketType} ${payload} ${signature}`;
async function nextOf(connection, name) {
  for (;;) {
    const text = await connection.next();
    if (text === null) return null;
    const message = JSON.parse(text);
    if (message.name === name || message.payload?.state === name) return message;
  }
}

test("a 6.22 player matchmakes: Solo and Team Terror reach Queued and a 6.22 server, Team Terror's squads option; Team Terror switched off is refused", async () => {
  const as = asBuild(v622);
  const backend = await startBackend({ matchmakingGatherMs: 100 });
  const clients = [];
  try {
    const server = await userLogin(backend.port, "Server622");
    for (const playlist of ["playlist_defaultsolo", "playlist_deimos_50"]) {
      const session = (await as(backend.port, "/fortnite/api/matchmaking/session", server.token, "POST", {
        ownerId: server.accountId, ownerName: "Core", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
        maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: v622, attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NAE" }
      })).body;
      const gameserver = await matchmakingClient(backend.port, authorizationOf((await as(backend.port,
        `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent(`${v622}:0:NAE:**`)}&minPlayers=1&maxPlayers=100`,
        server.token)).body));
      clients.push(gameserver);
      assert.equal(JSON.parse(await gameserver.next()).name, "Registered");
      const player = await userLogin(backend.port, `P622${playlist.length}`);
      const ticket = await as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
        `&bucketId=${v622}:0:NAE:${playlist}&player.platform=Windows&player.option.fillTeam=true`, player.token);
      assert.equal(ticket.status, 200, `${playlist}: ${JSON.stringify(ticket.body)}`);
      const client = await matchmakingClient(backend.port, authorizationOf(ticket.body));
      clients.push(client);
      const states = [];
      for (;;) {
        const { name, payload } = JSON.parse(await client.next());
        states.push(name === "StatusUpdate" ? payload.state : name);
        if (states.at(-1) === "Queued") break;
      }
      assert.deepEqual(states, ["Connecting", "Waiting", "Queued"], playlist);
      const assign = await nextOf(gameserver, "AssignMatch");
      assert.equal(assign.payload.bucketId, `Fortnite:Fortnite:${v622}:0:NAE:${playlist}`);
      // A team of several squads: the squads option names its squads (one solo here).
      if (playlist === "playlist_deimos_50") assert.equal(assign.payload.matchOptions["match.option.squads"], "1");
      gameserver.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
      const play = await nextOf(client, "Play");
      assert.deepEqual([play.payload.matchId, play.payload.sessionId], [assign.payload.matchId, session.id]);
      gameserver.close();
    }
    const player = await userLogin(backend.port, "Off622");
    const ticketFor = (playlist) => as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
      `&bucketId=${v622}:0:NAE:${playlist}&player.platform=Windows&player.option.fillTeam=true`, player.token);
    assert.equal((await post(backend.port, "/admin/api/matchmaking/config", null, { modes: { teamTerror: false } })).status, 200);
    assert.equal((await ticketFor("playlist_deimos_50")).status, 400, "switched off");
  } finally {
    for (const client of clients) client.close();
    backend.close();
  }
});

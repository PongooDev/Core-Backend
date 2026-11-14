import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { activeEventFlags, configureEvents, fortnitemaresPhase2, isEventActive, fortnitemares2018, islandPoi, lobbySeason6, ltmFortnitemares, ltmLilKevin } from "../src/events/events.js";
import { defaultReplacements, hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmOfPlaylist, ltmOn, playlistIdOfName } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaCosmetics, athenaLootTables, athenaSeason } from "../src/gamedata/athena.js";
import { getNodeByTemplateId, nodeLevels } from "../src/gamedata/homebase.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { botModeIds, botModeOf } from "../src/matchmaking/botmodes.js";
import { parseBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { respecTokensNeedSetUp, setUpRespecTokens } from "../src/profiles/respec.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { settleLevel } from "../src/profiles/xp.js";
import { rewardModeOf } from "../src/services/fortnite/battleroyale.js";
import { contentPage } from "../src/services/content/pages.js";
import { epicPlaylistImages } from "../src/services/content/playlistimages.js";
import { clientCommands } from "../src/services/mcp/commands/index.js";
import { createSettingsStore } from "../src/settings/store.js";
import { eventStoreOffers } from "../src/store/eventstore.js";
import { configureItemShop, itemShopOffers } from "../src/store/itemshop.js";
import { hasShowdown } from "../src/tournaments/showdown.js";
import { tournamentPlaylists } from "../src/tournaments/store.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Fortnite 6.31 (Update v6.31, 27 November 2018; Season 6): CL-4573279, on its own data (gamedata/4573279: 6.30's but for
// its own additions). Battle Royale: Team Rumble (Playlist_Respawn_24, 2 × 20), the Epic and Legendary Pump Shotgun, the
// Alchemist Pop-Up Cup on 6.30's ShowdownAlt playlists; Food Fight, Wild West and Team Terror gone from its paks. Save the
// World: Canny Valley Act 2's quests and zones, Shock Trooper Carlos, the Six Feet Under shovel; 6.30's front end as it was.
const v631 = "4573279";
const v630 = "4573096";
const replay = { mode: "auto", seasonStarts: { 6: "2018-09-27" } };
const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 6: "2018-09-27" } };
const at = (iso) => new Date(iso);
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const agentOf = (build, version = "6.31") => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;
const withSession = (build, name, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-631-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

test("6.31 is known, on its own data, Season 6's newest", () => {
  assert.equal(versionOf(v631), "6.31");
  assert.equal(allowedBuildList(["6.31"]).join(), v631);
  assert.equal(dataBuild(v631), v631);
  assert.equal(dataBuild("4573200"), v630, "a build between 6.30 and 6.31 plays on 6.30's");
  assert.equal(dataBuild(v630), v630, "6.30 keeps its own data");
  assert.equal(dataBuild("4600000"), v631, "a later build Core doesn't know plays on 6.31's");
  assert.equal(buildOfSeason(6), v631);
  assert.equal(seasonName(6), "Season 6 (6.00 – 6.31)");
  assert.equal(inBuild(v631, athenaSeason).seasonNumber, 6);
});

test("6.31's data is 6.30's but for its own files: thirteen overlays the same, eight its own", () => {
  const dir = new URL("../gamedata/", import.meta.url);
  const read = (build, name) => fs.readFileSync(new URL(`${build}/${name}`, dir), "utf8").replace(/\r\n/g, "\n");
  const names = fs.readdirSync(new URL(v631, dir)).sort();
  assert.deepEqual(names, fs.readdirSync(new URL(v630, dir)).sort(), "the same files as 6.30's");
  const own = names.filter((name) => read(v631, name) !== read(v630, name));
  assert.deepEqual(own, ["athena.json", "characters.json", "fabricator.json", "items.json", "objectivestats.json", "quests.json", "upgrades.json", "world.json"]);
});

test("6.31's Battle Royale data against 6.30's: thirteen cosmetics and none gone, the Epic and Legendary Pump Shotgun", () => {
  const [c631, c630] = [inBuild(v631, athenaCosmetics), inBuild(v630, athenaCosmetics)];
  assert.equal(Object.keys(c631).filter((id) => !c630[id]).length, 13);
  assert.deepEqual(Object.keys(c630).filter((id) => !c631[id]), []);
  for (const [id, name] of [["AthenaCharacter:cid_275_athena_commando_m_sniperhood", "Longshot"], ["AthenaCharacter:cid_276_athena_commando_f_sniperhood", "Insight"],
    ["AthenaCharacter:cid_277_athena_commando_m_moth", "Mothmando"], ["AthenaGlider:glider_id_099_moth", "Flutterbug"], ["AthenaDance:eid_saxophone", "Phone It In"]]) {
    assert.equal(c631[id]?.name, name, id);
  }
  // Update v6.31: "New Epic and Legendary Pump Shotgun ... Available from floor loot, chests, Supply Drops, and Vending
  // Machines", "Added Stink Bombs to Supply Drops", "Removed Double Barrel Shotguns from floor loot".
  for (const id of ["Weapon:wid_shotgun_standard_athena_vr_ore_t03", "Weapon:wid_shotgun_standard_athena_sr_ore_t03"]) assert.ok(inBuild(v631, () => getItem(id)), id);
  assert.equal(inBuild(v630, () => getItem("Weapon:wid_shotgun_standard_athena_sr_ore_t03")), undefined);
  const rows = (build) => Object.values(inBuild(build, athenaLootTables)).flatMap((table) => Object.entries(table.rows ?? table));
  const weight = (build, rowName) => rows(build).find(([name]) => name === rowName)?.[1].Weight;
  assert.deepEqual([weight(v630, "WorldList.AthenaLoot.Weapon.Shotgun.13"), weight(v631, "WorldList.AthenaLoot.Weapon.Shotgun.13")], [0, 0.043]);
  assert.ok(rows(v631).some(([name]) => name === "WorldList.AthenaSupplyDropConsumables.17"));
});

test("6.31's Save the World: Canny Valley Act 2, Shock Trooper Carlos and Six Feet Under; 6.30's nodes, research and level rewards", () => {
  for (const id of ["Hero:hid_commando_019_sr_t01", "Schematic:sid_blunt_shovel_halloween_sr_ore_t01", "Weapon:wid_blunt_shovel_halloween_sr_ore_t01"]) {
    assert.ok(inBuild(v631, () => getItem(id)), id);
  }
  assert.equal(buildGameData(v631, "items", {})["Weapon:wid_blunt_shovel_halloween_sr_ore_t01"].name, "Six Feet Under");
  for (const id of ["cannyvalley_landmark_mansion", "cannyvalley_reactive_tinfoil", "cannyvalleyquest_launchtherocket"]) {
    assert.ok(inBuild(v631, () => getQuest(id)), id);
    assert.equal(inBuild(v630, () => getQuest(id)), undefined, `${id} is 6.31's`);
  }
  const themes = Object.keys(buildGameData(v631, "world", {}).zoneThemes);
  assert.ok(themes.some((theme) => theme.includes("BP_ZT_GhostTown_A")) && themes.some((theme) => theme.includes("ZT_StabilizeTheRift")));
  for (const name of ["homebasenodes", "research", "accountlevels", "inventory"]) {
    assert.deepEqual(buildGameData(v631, name, {}), buildGameData(v630, name, {}), `${name} is 6.30's`);
  }
  assert.ok(nodeLevels(inBuild(v631, () => getNodeByTemplateId("HomebaseNode:SkillTree_BackpackSize"))).length > 1);
});

test("6.30's Upgrades and Research commands answer 6.31, and its first campaign load gives the respec tokens", () => {
  for (const command of ["PurchaseOrUpgradeHomebaseNode", "PurchaseResearchStatUpgrade", "RespecUpgrades", "RespecResearch"]) {
    assert.equal(typeof clientCommands[command], "function", command);
  }
  withSession(v631, "respec631", (session) => {
    const { profile } = session.profile("profile0");
    // A new account's campaign profile is set up as it opens (profiles/setup.js); the grant is the same one.
    if (respecTokensNeedSetUp(profile)) setUpRespecTokens(session);
    const held = Object.values(profile.items).map(({ templateId }) => templateId.toLowerCase());
    assert.ok(held.includes("token:upgrades_respec") && held.includes("token:research_respec"));
    assert.equal(respecTokensNeedSetUp(profile), false, "once");
  });
  withSession(v631, "level631", (session) => {
    session.profile("profile0").setStat("xp", 40_000_000);
    assert.deepEqual(settleLevel(session), [2, 3, 4, 5]);
    const held = Object.values(session.profile("profile0").profile.items).map(({ templateId, quantity }) => `${templateId} ${quantity}`);
    assert.ok(held.includes("Stat:fortitude 3"), "6.30's level-up rewards");
  });
});

test("6.31's event flags are 6.30's", () => {
  assert.deepEqual(activeEventFlags(v631), activeEventFlags(v630));
  for (const flag of ["EventFlag.Fortnitemares", fortnitemaresPhase2, ltmFortnitemares, ltmLilKevin, lobbySeason6, "EventFlag.PassiveStorms"]) {
    assert.ok(activeEventFlags(v631).includes(flag), flag);
    assert.equal(season4Flag(flag).builds[1], Number(v631), flag);
  }
  assert.equal(activeEventFlags(v631).includes(islandPoi(1)), false);
  assert.equal(season4Flag(islandPoi(1)).builds[1], 4543176, "the Cube's end stays 6.22's");
  assert.equal(inBuild(v631, () => isEventActive(fortnitemares2018)), true);
});

test("Team Rumble: 6.31's Playlist_Respawn_24 (280), two teams of 20 in squads, on by default and listed as New, its Original dates 27 November to 6 December", () => {
  const defaults = createSettingsStore(null).get();
  assert.equal(defaults.matchmakingModes.teamRumble, true, "on by default in the admin panel");
  assert.equal(hasLtm("teamRumble", v631), true);
  assert.equal(hasLtm("teamRumble", v630), false, "6.31's alone");
  assert.equal(ltmOn("teamRumble", v631, defaults), true);
  assert.equal(ltmOn("teamRumble", v631, { ...defaults, matchmakingModes: { ...defaults.matchmakingModes, teamRumble: false } }), false);
  assert.equal(ltmOfPlaylist(280, v631).id, "teamRumble");
  assert.equal(playlistIdOfName("playlist_respawn_24", v631), 280);
  assert.equal(parseBucket(`${v631}:0:NAE:playlist_respawn_24`, v631).playlistId, 280);
  assert.deepEqual(playlistTeamsOf(`${v631}:0:NAE:playlist_respawn_24`, v631), { maxTeamCount: 2, maxTeamSize: 20, maxSquadSize: 4 });
  assert.equal(rewardModeOf(280, v631), "squads");
  withConfig(replay, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    assert.equal(inOriginalWindow("teamRumble", v631, at("2018-11-26T23:59:00Z"), dated), false);
    assert.equal(inOriginalWindow("teamRumble", v631, at("2018-11-27T00:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("teamRumble", v631, at("2018-12-06T00:00:00Z"), dated), false, "the season's end");
  });
  assert.ok(botModeIds.includes("teamRumble"));
  assert.equal(botModeOf("playlist_respawn_24", v631), "teamRumble");
  assert.match(epicPlaylistImages.Playlist_Respawn_24, /BR06_ModeTile_TDM-1024x512-878ba9f92deb153ec85f2bcbce925e185344290e\.jpg$/);
  const tiles = contentPage(undefined, undefined, v631).playlistinformation.playlist_info.playlists;
  assert.deepEqual(tiles.find(({ playlist_name }) => playlist_name === "Playlist_Respawn_24"),
    { image: epicPlaylistImages.Playlist_Respawn_24, playlist_name: "Playlist_Respawn_24", special_border: "None", _type: "FortPlaylistInfo" });
});

test("6.31's other modes: 6.30's but Food Fight, Wild West and Team Terror; the Pop-Up Cup's tournaments on", () => {
  const defaults = createSettingsStore(null).get();
  for (const id of ["foodFight", "foodFight12", "wildWestSolo", "wildWestDuos", "wildWestSquads", "teamTerror"]) {
    assert.equal(hasLtm(id, v631), false, id);
    assert.equal(hasLtm(id, v630), true, `${id} is 6.30's still`);
  }
  for (const id of ["fiftyFiftySeason6", "playgroundV2"]) assert.equal(ltmOn(id, v631, defaults), true, id);
  for (const id of ["discoDomination32", "discoDomination32Alt630", "soaring50s", "highExplosivesSeason6Solo", "highExplosivesSeason6Squads", "showdownSolo"]) {
    assert.equal(hasLtm(id, v631), true, id);
  }
  for (const [id, playlistId] of [["scavengerSolo", 58074], ["scavengerDuos", 58075], ["scavengerSquads", 58076]]) {
    assert.equal(ltmOfPlaylist(playlistId, v631).id, id);
    assert.equal(ltmOn(id, v631, defaults), false, "a tournament playlist is no lobby mode");
    assert.ok(tournamentPlaylists.some((entry) => entry.id === id && entry.inGame), id);
  }
  assert.equal(hasShowdown(v631), true);
  assert.deepEqual(defaultReplacements(v631, defaults), {});
  const lobby = ltmFrontEndPlaylists(v631, defaults);
  const entry = lobby.find((own) => own.name === "Playlist_Respawn_24");
  assert.deepEqual([entry?.enabled, entry?.ltm.advertise], [true, "New"]);
  for (const name of ["Playlist_Barrier", "Playlist_WW_Solo", "Playlist_Deimos_50"]) assert.equal(lobby.some((own) => own.name === name), false, name);
});

test("a 6.31 client's hotfix lists Team Rumble enabled and the defaults as shipped", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Lobby631");
    const lines = (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/cloudstorage/system/DefaultGame.ini",
      headers: { "User-Agent": agentOf(v631), Authorization: `bearer ${token}` } })).body.toString().split("\r\n").filter((line) => line.includes("FrontEndPlaylistData"));
    const line = lines.find((own) => own.includes("PlaylistName=Playlist_Respawn_24,"));
    assert.ok(line && line.includes("bEnabled=true") && line.includes("AdvertiseType=New"), line);
    assert.equal(lines.some((own) => own.includes("PlaylistName=Playlist_Barrier,")), false, "no Food Fight");
    assert.ok(lines.some((own) => own.includes("PlaylistName=Playlist_DefaultSolo,") && own.includes("bEnabled=true")), "Solo isn't replaced");
  } finally {
    await backend.close();
  }
});

test("6.31's shop: Mothmando, Lamp and Flutterbug, Scorecard and Phone It In on their days; 6.30 sells none of them", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season6.json", import.meta.url), "utf8")).days;
  assert.equal(history.length, 70);
  const [c631, c630] = [inBuild(v631, athenaCosmetics), inBuild(v630, athenaCosmetics)];
  assert.ok(history.every((day) => [...day.featured, ...day.daily].every(([id]) => c631[id])), "only 6.31's cosmetics");
  const own = [...new Set(history.flatMap((day) => [...day.featured, ...day.daily]).map(([id]) => id).filter((id) => !c630[id]))];
  assert.equal(own.length, 5);
  const days = (id) => history.filter((day) => [...day.featured, ...day.daily].some(([entry]) => entry === id)).map(({ date }) => date.slice(5));
  assert.deepEqual(days("AthenaCharacter:cid_277_athena_commando_m_moth"), ["11-30", "12-01"]);
  assert.deepEqual(days("AthenaDance:eid_scorecard"), ["12-01"]);
  assert.deepEqual(days("AthenaDance:eid_saxophone"), ["12-03"]);
  assert.deepEqual(days("AthenaCharacter:cid_275_athena_commando_m_sniperhood"), [], "Longshot wasn't sold in Season 6");
  const featured = (build, iso) => inBuild(build, () => itemShopOffers(at(iso), shopConfig)).BRWeeklyStorefront.map(({ templateId }) => templateId);
  assert.ok(featured(v631, "2018-11-30T12:00:00Z").includes("AthenaCharacter:cid_277_athena_commando_m_moth"));
  assert.equal(featured(v630, "2018-11-30T12:00:00Z").includes("AthenaCharacter:cid_277_athena_commando_m_moth"), false, "6.30 sells none of them");
});

test("6.31's Weekly Store: Six Feet Under from 29 November; 6.30's weeks are as they were", (t) => {
  configureItemShop(() => shopConfig);
  t.after(() => configureItemShop(null));
  const offers = (build, iso) => JSON.stringify(inBuild(build, () => eventStoreOffers(at(iso))));
  assert.ok(offers(v631, "2018-11-29T12:00:00Z").includes("Schematic:sid_blunt_shovel_halloween_sr_ore_t01"));
  assert.ok(offers(v631, "2018-11-23T12:00:00Z").includes("Schematic:sid_pistol_halloween_handcannon_sr_ore_t01"), "6.30's week before it");
  assert.equal(offers(v630, "2018-11-29T12:00:00Z").includes("sid_blunt_shovel_halloween"), false);
});

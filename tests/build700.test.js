import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { releasedOn, seasonName, versionOf } from "../src/builds/detect.js";
import { battlePassOffers } from "../src/battlepass/season2.js";
import { activeEventFlags, configureEvents, isEventActive, lobbySeason6, lobbySeason7, season7Warmup2018 } from "../src/events/events.js";
import { hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmOfPlaylist, ltmOn, playlistIdOfName } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { parseBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { equipCustomization, grantCosmetic, setUpAthena } from "../src/profiles/athena.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { contentPage } from "../src/services/content/pages.js";
import { epicPlaylistImages } from "../src/services/content/playlistimages.js";
import { clientCommands } from "../src/services/mcp/commands/index.js";
import { serverCommands } from "../src/services/mcp/commands/server.js";
import { createSettingsStore } from "../src/settings/store.js";
import { eventStoreOffers } from "../src/store/eventstore.js";
import { configureItemShop, itemShopOffers } from "../src/store/itemshop.js";
import { tournamentPlaylists } from "../src/tournaments/store.js";
import { cannyValleyId } from "../src/world/cannyvalley.js";
import { landmarkMissions } from "../src/world/landmarks.js";
import { worldInfo } from "../src/world/theaters.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Fortnite 7.00 (Update v7.00, 6 December 2018; Season 7): CL-4629139, the first UE 4.22 build, on its own data
// (gamedata/4629139). Battle Royale: Season 7's Battle Pass with Wraps, the Season 7 lobby, Close Encounters, Siphon, Unvaulted,
// Sniper Shootout and Soaring back in the paks, the Explorer Pop-Up Cup; Creative's early access (its profile, kept empty).
// Save the World: the Season 7 Warmup, Canny Valley Act 3's landmarks, the Frostbite in the Weekly Store.
const v700 = "4629139";
const v631 = "4573279";
const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 6: "2018-09-27", 7: "2018-12-06" } };
const at = (iso) => new Date(iso);
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const agentOf = (build, version) => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;
const agent700 = agentOf(v700, "7.00");
const agent631 = agentOf(v631, "6.31");
const withSession = (build, name, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-700-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const mcp = (port, { token, accountId }, agent, command, profileId, body = {}, route = "client") => send({ host: "127.0.0.1", port, method: "POST",
  path: `/fortnite/api/game/v2/profile/${accountId}/${route}/${command}?profileId=${profileId}&rvn=-1`,
  headers: { "User-Agent": agent, Authorization: `bearer ${token}`, "Content-Type": "application/json" } }, JSON.stringify(body));
const profileOf = (response) => (response.body.profileChanges ?? []).find((change) => change.changeType === "fullProfileUpdate")?.profile;

test("7.00 is known, on its own data, Season 7's first build", () => {
  assert.equal(versionOf(v700), "7.00");
  assert.equal(allowedBuildList(["7.00"]).join(), v700);
  assert.equal(dataBuild(v700), v700);
  assert.equal(dataBuild("4600000"), v631, "a build between 6.31 and 7.00 plays on 6.31's");
  assert.equal(dataBuild("4650000"), v700, "a build between 7.00 and 7.10 plays on 7.00's");
  assert.equal(releasedOn(v700), Date.UTC(2018, 11, 6));
  assert.equal(buildOfSeason(7), "5046157", "Season 7's newest is 7.40");
  assert.equal(buildOfSeason(6), v631, "Season 6's newest is still 6.31");
  assert.equal(seasonName(7), "Season 7 (7.00 – 7.40)");
  const season = inBuild(v700, athenaSeason);
  assert.equal(season.seasonNumber, 7);
  assert.equal(season.storefront, "BRSeason7");
  assert.equal(season.battlePassLevelOfferId, "64A3020B098841A7805EE257D68C554F");
  assert.deepEqual(season.firstWinRewards, [{ quantity: 1, templateId: "AthenaGlider:umbrella_season_07" }]);
});

test("7.00's data: read as UE 4.22, its curve tables whole; nine overlays the same as 6.31's", () => {
  // Read as 4.21 the curve tables came out empty (tools/extractor): the Research page's stats and the level costs.
  assert.ok(Object.keys(buildGameData(v700, "research", {}).stats ?? {}).length > 0);
  assert.ok(Object.keys(buildGameData(v700, "upgrades", {}).levelCosts ?? {}).length > 0);
  const dir = new URL("../gamedata/", import.meta.url);
  const read = (build, name) => fs.readFileSync(new URL(`${build}/${name}`, dir), "utf8").replace(/\r\n/g, "\n");
  const names = fs.readdirSync(new URL(v700, dir)).sort();
  assert.deepEqual(names, fs.readdirSync(new URL(v631, dir)).sort(), "the same files as 6.31's");
  const same = names.filter((name) => read(v700, name) === read(v631, name));
  assert.deepEqual(same, ["accountlevels.json", "collectionbook.json", "dailyrewards.json", "expeditions.json", "homebasenodes.json", "inventory.json",
    "research.json", "squads.json", "transmog.json"]);
});

test("7.00's cosmetics: 113 new, none gone, the six Battle Pass wraps and the Random wrap", () => {
  const [c700, c631] = [inBuild(v700, athenaCosmetics), inBuild(v631, athenaCosmetics)];
  assert.equal(Object.keys(c700).filter((id) => !c631[id]).length, 113);
  assert.deepEqual(Object.keys(c631).filter((id) => !c700[id]), []);
  const wraps = Object.entries(c700).filter(([, { class: kind }]) => kind === "AthenaItemWrapDefinition").map(([id]) => id).sort();
  assert.deepEqual(wraps, ["AthenaItemWrap:wrap_001_arcticcamo", "AthenaItemWrap:wrap_002_holidaygreen", "AthenaItemWrap:wrap_003_anodizedred",
    "AthenaItemWrap:wrap_004_durrburgerpjs", "AthenaItemWrap:wrap_005_carbonfiber", "AthenaItemWrap:wrap_006_ice", "AthenaItemWrap:wrap_random"]);
  for (const [id, name] of [["AthenaCharacter:cid_287_athena_commando_m_arcticsniper", "Zenith"], ["AthenaCharacter:cid_286_athena_commando_f_neoncat", "Lynx"],
    ["AthenaCharacter:cid_288_athena_commando_m_iceking", "The Ice King"], ["AthenaGlider:umbrella_season_07", "Snowfall"], ["AthenaItemWrap:wrap_001_arcticcamo", "Arctic Camo"]]) {
    assert.equal(c700[id]?.name, name, id);
  }
  assert.equal(c631["AthenaItemWrap:wrap_001_arcticcamo"], undefined);
});

test("Season 7's Battle Pass: 950 and 2,800 V-Bucks on BRSeason7, its challenges by tier, its wraps", () => {
  const offers = inBuild(v700, () => battlePassOffers());
  const pass = offers.find(({ battlePass }) => battlePass === "pass");
  const bundle = offers.find(({ battlePass }) => battlePass === "bundle");
  assert.deepEqual([pass.offerId, pass.price, pass.storefront, pass.devName], ["core_br_season7_battlepass", 950, "BRSeason7", "BR.Season7.BattlePass.01"]);
  assert.equal(pass.displayAssetPath, "/Game/Catalog/DisplayAssets/DA_BR_Season7_BattlePass.DA_BR_Season7_BattlePass");
  assert.match(pass.description, /^Season 7: Dec 6 - Feb 27/);
  assert.ok(pass.description.includes("Zenith Outfit") && pass.description.includes("6 Wraps"));
  assert.deepEqual([bundle.price, bundle.offerId], [2800, "core_br_season7_battlebundle"]);
  assert.equal(offers.find(({ battlePass }) => battlePass === "tier").offerId, "64A3020B098841A7805EE257D68C554F");
  const season = inBuild(v700, athenaSeason);
  const paidAt = (level) => season.bookPaidRewards.find((tier) => tier.level === level).rewards.map(({ templateId }) => templateId);
  assert.ok(paidAt(1).includes("ChallengeBundleSchedule:season7_paid_schedule") && paidAt(1).includes("ChallengeBundleSchedule:season7_progressivea_schedule"));
  assert.ok(paidAt(23).includes("ChallengeBundleSchedule:season7_sgtwinter_schedule"));
  assert.ok(paidAt(100).includes("ChallengeBundleSchedule:season7_iceking_schedule") && paidAt(100).includes("AthenaCharacter:cid_288_athena_commando_m_iceking"));
  assert.deepEqual([5, 11, 26, 43, 60, 74].map((level) => paidAt(level).find((id) => id.startsWith("AthenaItemWrap:"))),
    ["AthenaItemWrap:wrap_001_arcticcamo", "AthenaItemWrap:wrap_002_holidaygreen", "AthenaItemWrap:wrap_003_anodizedred",
      "AthenaItemWrap:wrap_004_durrburgerpjs", "AthenaItemWrap:wrap_006_ice", "AthenaItemWrap:wrap_005_carbonfiber"]);
  assert.deepEqual(season.grantsToEveryone, [{ quantity: 1, templateId: "ChallengeBundleSchedule:season7_free_schedule" }]);
  // The Snowfall challenges: Season7_Paid_Schedule's cumulative bundle, the weekly challenges and the loading screens' tokens.
  const schedules = buildGameData(v700, "athena", {}).challengeSchedules;
  assert.deepEqual(schedules.season7_paid_schedule.bundles.map(({ bundle }) => bundle), ["questbundle_s7_cumulative"]);
  assert.equal(schedules.season7_free_schedule.bundles.length, 10);
});

test("7.00's locker: seven wrap slots, a wrap for one or every slot; 6.31 has none", () => {
  withSession(v700, "wraps700", (session) => {
    setUpAthena(session);
    const { attributes } = session.profile("athena").profile.stats;
    assert.deepEqual(attributes.favorite_itemwraps, ["", "", "", "", "", "", ""]);
    grantCosmetic(session, "AthenaItemWrap:wrap_001_arcticcamo");
    grantCosmetic(session, "AthenaItemWrap:wrap_006_ice");
    equipCustomization(session, "ItemWrap", "AthenaItemWrap:wrap_001_arcticcamo", 2);
    assert.deepEqual(attributes.favorite_itemwraps, ["", "", "AthenaItemWrap:wrap_001_arcticcamo", "", "", "", ""]);
    equipCustomization(session, "ItemWrap", "AthenaItemWrap:wrap_006_ice", -1);
    assert.deepEqual(attributes.favorite_itemwraps, Array(7).fill("AthenaItemWrap:wrap_006_ice"));
    equipCustomization(session, "ItemWrap", "", 0);
    assert.equal(attributes.favorite_itemwraps[0], "");
    assert.throws(() => equipCustomization(session, "ItemWrap", "AthenaCharacter:cid_287_athena_commando_m_arcticsniper", 0), /doesn't go in the ItemWrap slot|item_not_found|No item/);
  });
  withSession(v631, "wraps631", (session) => {
    setUpAthena(session);
    assert.equal("favorite_itemwraps" in session.profile("athena").profile.stats.attributes, false, "6.31's profile has no wrap slots");
    assert.throws(() => equipCustomization(session, "ItemWrap", "", 0), /No locker slot ItemWrap/);
  });
});

test("7.00's event flags: the Season 7 lobby and Save the World's Season 7 Warmup; Season 6's end with 6.31", () => {
  const flags = activeEventFlags(v700);
  for (const flag of [lobbySeason7, "EventFlag.ActiveStorms", "EventFlag.PassiveMiniBosses"]) assert.ok(flags.includes(flag), flag);
  for (const flag of [lobbySeason6, "EventFlag.PassiveStorms", "EventFlag.Fortnitemares", "EventFlag.ActiveMiniBosses", "EventFlag.LTM_LilKevin"]) {
    assert.equal(flags.includes(flag), false, flag);
  }
  assert.equal(inBuild(v700, () => isEventActive(season7Warmup2018)), true);
  assert.equal(inBuild(v631, () => isEventActive(season7Warmup2018)), false);
  assert.equal(activeEventFlags(v631).includes(lobbySeason7), false);
  assert.deepEqual(season4Flag(lobbySeason7).builds, [4629139, 5046157], "7.00's to 7.40's");
  assert.deepEqual(season4Flag("EventFlag.WinterBattleBus").builds, [4629139, 4629139], "gone from 7.10's paks");
  assert.equal(season4Flag(lobbySeason6).builds[0] <= 4629139 && season4Flag(lobbySeason6).builds[1] >= 4629139, true,
    "Season 6's lobby still switches by hand on 7.00");
});

test("7.00's modes: 50v50, Playground, Team Rumble and Close Encounters on by default; Season 7's others by their switches", () => {
  const defaults = createSettingsStore(null).get();
  for (const id of ["fiftyFiftySeason7", "playgroundV2", "teamRumble", "closeEncountersSeason7Squads", "closeEncountersSeason7Solo", "closeEncountersSeason7Duos"]) {
    assert.equal(ltmOn(id, v700, defaults), true, id);
  }
  for (const id of ["unvaultedSquads", "siphonSolo", "sniperShootoutSeason7Duos", "soaringSeason7Solo", "highExplosivesSeason7Squads", "discoDomination32", "soaring50s"]) {
    assert.equal(hasLtm(id, v700), true, id);
    assert.equal(ltmOn(id, v700, defaults), false, id);
  }
  for (const id of ["fiftyFiftySeason7", "unvaultedSquads", "siphonSolo", "closeEncountersSeason7Squads"]) assert.equal(hasLtm(id, v631), false, `${id} is 7.00's`);
  assert.equal(ltmOn("fiftyFiftySeason6", v700, defaults), false, "Season 6's 50v50 entry ends with 6.31");
  assert.equal(ltmOfPlaylist(216, v700).id, "unvaultedSquads");
  assert.equal(playlistIdOfName("playlist_vamp_solo", v700), 265);
  assert.deepEqual(playlistTeamsOf(`${v700}:0:NAE:playlist_classic_squads`, v700), { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v700}:0:NAE:playlist_vamp_solo`, v700), { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 });
  assert.equal(parseBucket(`${v700}:0:NAE:playlist_respawn_24`, v700).playlistId, 280);
  withConfig({ mode: "auto", seasonStarts: { 7: "2018-12-06" } }, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    assert.equal(inOriginalWindow("closeEncountersSeason7Squads", v700, at("2018-12-10T23:59:00Z"), dated), false);
    assert.equal(inOriginalWindow("closeEncountersSeason7Squads", v700, at("2018-12-11T00:00:00Z"), dated), true, "Update v7.01's day");
    assert.equal(inOriginalWindow("siphonSolo", v700, at("2018-12-20T12:00:00Z"), dated), true, "the 14 Days' day 2");
    assert.equal(inOriginalWindow("siphonSolo", v700, at("2018-12-21T00:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("unvaultedSquads", v700, at("2018-12-19T12:00:00Z"), dated), true, "the 14 Days' day 1");
    assert.equal(inOriginalWindow("playgroundV2", v700, at("2019-02-27T12:00:00Z"), dated), true, "Playground through Season 7");
  });
  for (const id of ["scavengerSolo", "scavengerDuos", "scavengerSquads", "showdownSolo"]) {
    assert.equal(hasLtm(id, v700), true, id);
    assert.ok(tournamentPlaylists.some((entry) => entry.id === id && entry.inGame), id);
  }
  const lobby = ltmFrontEndPlaylists(v700, defaults);
  for (const name of ["Playlist_50v50", "Playlist_Playground", "Playlist_Respawn_24", "Playlist_Close_Squad"]) {
    assert.equal(lobby.find((own) => own.name === name)?.enabled, true, name);
  }
});

test("7.00's tiles: Unvaulted's and Siphon's on its page only; 6.31's page is as it was", () => {
  assert.match(epicPlaylistImages.Playlist_Classic_Squads, /BR_LTM_Unvaulted-1024x512-d3cbe3c4a756190279af4ce98773d6599f7aab4f\.jpg$/);
  assert.match(epicPlaylistImages.Playlist_Vamp_Squad, /BR_LTM_Siphon-1024x512-66cb27084be50387682989b50a01dbc9e42f5a5d\.jpg$/);
  const names = (build) => contentPage(undefined, undefined, build).playlistinformation.playlist_info.playlists.map(({ playlist_name }) => playlist_name);
  for (const name of ["Playlist_Classic_Squads", "Playlist_Vamp_Solo", "Playlist_Close_Squad", "Playlist_Respawn_24"]) assert.ok(names(v700).includes(name), name);
  for (const name of ["Playlist_Classic_Squads", "Playlist_Classic_Solo", "Playlist_Vamp_Solo", "Playlist_Vamp_Squad"]) {
    assert.equal(names(v631).includes(name), false, `${name} isn't on 6.31's page`);
  }
});

test("Season 7's shop: 84 days of 7.00's cosmetics, replayed from 7.00's first day; Waypoint and the Slushy Soldier with their back blings", (t) => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season7.json", import.meta.url), "utf8")).days;
  assert.equal(history.length, 84);
  assert.deepEqual([history[0].date, history.at(-1).date], ["2018-12-06", "2019-02-27"]);
  const c700 = inBuild(v700, athenaCosmetics);
  const c740 = inBuild("5046157", athenaCosmetics);
  // 7.10's to 7.40's own (Krampus, The Ice Queen, Marshmello, Skully...) are in the history too; 7.00 is shown only its own.
  assert.ok(history.every((day) => [...day.featured, ...day.daily].every(([id]) => c740[id])), "only 7.40's cosmetics");
  configureItemShop(() => shopConfig);
  const offered700 = inBuild(v700, () => itemShopOffers(at("2018-12-20T12:00:00Z"), shopConfig));
  assert.ok([...offered700.BRWeeklyStorefront, ...offered700.BRDailyStorefront].every(({ templateId }) => c700[templateId]), "7.00 sells only its own");
  t.after(() => configureItemShop(null));
  const featured = (iso) => inBuild(v700, () => itemShopOffers(at(iso), shopConfig)).BRWeeklyStorefront.map(({ templateId }) => templateId);
  assert.ok(featured("2018-12-06T12:00:00Z").includes("AthenaCharacter:cid_100_athena_commando_m_cuchulainn"), "Battle Hound on Season 7's first day");
  const waypointDays = history.filter((day) => [...day.featured, ...day.daily].some(([id]) => id === "AthenaCharacter:cid_290_athena_commando_f_bluebadass"));
  assert.ok(waypointDays.length > 0);
});

test("7.00's Weekly Store: the Frostbite from Season 7's first day; 6.31's weeks are as they were", (t) => {
  configureItemShop(() => shopConfig);
  t.after(() => configureItemShop(null));
  const offers = (build, iso) => JSON.stringify(inBuild(build, () => eventStoreOffers(at(iso))));
  assert.ok(offers(v700, "2018-12-07T12:00:00Z").includes("Schematic:sid_sniper_standard_winter_sr_ore_t01"));
  assert.equal(offers(v700, "2018-12-07T12:00:00Z").includes("Schematic:sid_blunt_shovel_halloween_sr_ore_t01"), false, "not 6.31's Six Feet Under");
  assert.ok(offers(v631, "2018-11-29T12:00:00Z").includes("Schematic:sid_blunt_shovel_halloween_sr_ore_t01"));
});

test("7.00's Save the World: Canny Valley Act 3's two landmarks on zone 5; 6.31's map is as it was", () => {
  for (const id of ["cannyvalley_landmark_deploytheprobe", "cannyvalley_landmark_mansion", "cannyvalley_landmark_bossfight", "stormking_checkemail"]) {
    assert.ok(inBuild(v700, () => getQuest(id)), id);
  }
  assert.ok(inBuild(v700, () => getItem("Hero:hid_outlander_024_sr_t01")), "Steel Wool Anthony");
  const placed = (build) => {
    const info = inBuild(build, () => worldInfo(at("2026-11-16T12:00:00Z")));
    const theater = info.theaters.find(({ uniqueId }) => uniqueId === cannyValleyId);
    return theater.tiles.filter((tile) => tile.requirements?.activeQuestDefinition).map((tile) => tile.zoneTheme);
  };
  const act3 = landmarkMissions.filter(({ questId }) => ["cannyvalley_landmark_deploytheprobe", "cannyvalley_landmark_mansion"].includes(questId));
  assert.equal(act3.length, 2);
  for (const { zoneTheme } of act3) {
    assert.ok(placed(v700).includes(zoneTheme), zoneTheme);
    assert.equal(placed(v631).includes(zoneTheme), false, `${zoneTheme} isn't on 6.31's map`);
  }
});

test("a 7.00 client: Creative's profile empty, PopulatePrerolledOffers answered, general chat by reserveGeneralChatRooms, no island codes", async () => {
  assert.equal(typeof clientCommands.PopulatePrerolledOffers, "function");
  for (const command of ["SetLastUsedCreativePlot", "ModifyCreativePlotPermissions"]) assert.equal(typeof serverCommands[command], "function", command);
  assert.equal(clientCommands.SetCreativePlotIslandName, undefined, "no 7.00 code sends it");
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Creative700");
    const creative = await mcp(backend.port, player, agent700, "QueryProfile", "creative");
    assert.equal(creative.status, 200);
    const profile = profileOf(creative);
    assert.deepEqual([creative.body.profileId, profile.items, profile.stats.attributes], ["creative", {}, {}]);
    const older = await mcp(backend.port, player, agent631, "QueryProfile", "creative");
    assert.deepEqual([older.status, older.body.errorCode], [400, "errors.com.epicgames.modules.profiles.invalid_profile_id"], "6.31 is refused as before");
    assert.equal((await mcp(backend.port, player, agent700, "PopulatePrerolledOffers", "campaign")).status, 200);
    const chat = await send({ host: "127.0.0.1", port: backend.port, method: "POST",
      path: `/fortnite/api/game/v2/chat/${player.accountId}/reserveGeneralChatRooms/Athena/Windows`,
      headers: { "User-Agent": agent700, Authorization: `bearer ${player.token}`, "Content-Type": "application/json" } }, "{}");
    assert.equal(chat.status, 200);
    assert.equal(chat.body.globalChatRooms[0].roomName, "GlobalBattleRoyale");
    const code = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/links/api/fn/mnemonic/1234-5678-9012",
      headers: { "User-Agent": agent700, Authorization: `bearer ${player.token}` } });
    assert.deepEqual([code.status, code.body.errorCode], [404, "errors.com.epicgames.links.no_active_version"]);
    const links = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: `/links/api/fn/author/${player.accountId}`,
      headers: { "User-Agent": agent700, Authorization: `bearer ${player.token}` } });
    assert.deepEqual([links.status, links.body], [200, []]);
  } finally {
    await backend.close();
  }
});

test("a 7.00 client's athena profile has its seven wrap slots and equips a wrap; a 6.31 client's has none", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Wraps700");
    const seen = profileOf(await mcp(backend.port, player, agent700, "QueryProfile", "athena"));
    assert.deepEqual(seen.stats.attributes.favorite_itemwraps, Array(7).fill(""));
    assert.equal(seen.stats.attributes.season_num, 7);
    const refused = await mcp(backend.port, player, agent700, "EquipBattleRoyaleCustomization", "athena",
      { slotName: "ItemWrap", itemToSlot: "AthenaItemWrap:wrap_001_arcticcamo", indexWithinSlot: 0 });
    assert.equal(refused.status, 400, "a wrap the player doesn't own");
    const other = await userLogin(backend.port, "Wraps631");
    const older = profileOf(await mcp(backend.port, other, agent631, "QueryProfile", "athena"));
    assert.equal("favorite_itemwraps" in older.stats.attributes, false);
  } finally {
    await backend.close();
  }
});

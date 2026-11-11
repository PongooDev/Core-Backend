import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { cubeStates } from "../src/events/cube.js";
import { activeEventFlags, configureEvents, cubeDestination, cubeMoveTo, cubeStartMove, cubeTurnOn, hordeFlag, lobbySeason5, ltmHeist,
  passiveStorms, roadTrip2018Flag } from "../src/events/events.js";
import { highStakesFlagsNow, highStakesStates } from "../src/events/highstakes.js";
import { hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmNewMode, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, playlistIdOfName } from "../src/events/ltms.js";
import { weeklyHordeWeek } from "../src/events/roadtrip2018.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { dataBuild } from "../src/gamedata/read.js";
import { missionAlertCategory } from "../src/gamedata/world.js";
import { parseBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { playlistInformationFor, epicPlaylistImages } from "../src/services/content/playlistimages.js";
import { createSettingsStore } from "../src/settings/store.js";
import { eventStoreOffers, weeklyStorefront } from "../src/store/eventstore.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { hordeWeeklyTheater } from "../src/world/horde.js";
import { isGroupMission, worldInfo } from "../src/world/theaters.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Fortnite 5.41, Season 5: CL-4363240 (++Fortnite+Release-5.41, Update v5.41, 18 September 2018), on its own data
// (gamedata/4363240), Season 5's last update.
const v541 = "4363240";
const v540 = "4352937";
// Season 5's replay from its real first day, so the replay's dates are Epic's.
const replay = { mode: "auto", seasonStarts: { 5: "2018-07-12" } };
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const at = (iso) => new Date(iso);

test("5.41 is known by its version, plays on its own data and is Season 5's newest", () => {
  assert.equal(versionOf(v541), "5.41");
  assert.equal(dataBuild(v541), v541);
  assert.ok(buildChoices().includes(v541));
  assert.equal(allowedBuildList(["5.41"]).join(), v541);
  assert.equal(dataBuild("4360000"), v540, "a build between 5.40 and 5.41 Core doesn't know plays on 5.40's");
  assert.equal(buildOfSeason(5), v541);
  assert.equal(seasonName(5), "Season 5 (5.0 – 5.41)");
  const season = inBuild(v541, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.numBookLevels, season.storefront], [5, 100, "BRSeason5"]);
});

test("5.41's data: 7 new cosmetics (Valkyrie, Nite Nite, Grill Sergeant...), 5.40's items, quests and High Stakes schedule", () => {
  const c541 = inBuild(v541, athenaCosmetics);
  const c540 = inBuild(v540, athenaCosmetics);
  const added = Object.keys(c541).filter((id) => !c540[id]);
  assert.equal(added.length, 7);
  assert.ok(Object.keys(c540).every((id) => c541[id]), "5.41 drops none of 5.40's");
  assert.deepEqual(["AthenaCharacter:cid_222_athena_commando_f_darkviking", "AthenaCharacter:cid_221_athena_commando_m_clown",
    "AthenaCharacter:cid_184_athena_commando_m_durrburgerworker", "AthenaGlider:glider_id_070_darkviking", "AthenaBackpack:bid_113_darkvikingfemale"]
    .map((id) => c541[id].name.trim()), ["Valkyrie", "Nite Nite", "Grill Sergeant", "Frostwing", "Valkyrie Wings"]);
  inBuild(v541, () => {
    assert.equal(getItem("Weapon:athena_supertowergrenade_a").name, "Port-a-Fortress");
    assert.equal(getItem("Weapon:athena_spikearena_grenade").name, "Spiky Stadium", "Update v5.41's name for the Spike Arena");
    assert.equal(getItem("Hero:hid_outlander_myth03_sr_t01").name, "Field Agent Rio");
    assert.ok(getItem("Schematic:sid_launcher_flintlock_sr_ore_t01"), "the Bowler");
    // Update v5.41's "Weekly Horde Challenge 7 ... Earn 1500 Gold for the first-time completion".
    assert.deepEqual(getQuest("hordequest_weekly7_twine1").rewards, [{ quantity: 1500, templateId: "AccountResource:eventcurrency_scaling" }]);
    assert.equal(athenaChallengeSchedules().schedule_ltm_heist.eventName, ltmHeist);
    assert.deepEqual(missionAlertCategory("MegaAlertCategory"), { category: "MegaAlertCategory", quota: 3, repeatable: false });
  });
  inBuild(v540, () => assert.equal(getItem("Weapon:athena_spikearena_grenade").name, "Spike Arena"));
});

test("5.41's event flags: 5.40's, the Cube and High Stakes by their dates on Season 5's replay", () => {
  assert.deepEqual(activeEventFlags(v541), [passiveStorms, lobbySeason5, roadTrip2018Flag, hordeFlag]);
  for (const flag of [cubeTurnOn, cubeMoveTo(8), cubeDestination, ltmHeist, "EventFlag.RoadTrip2018", "EventFlag.Horde"]) {
    assert.equal(season4Flag(flag).builds[1], 4363240, flag);
  }
  withConfig(replay, () => {
    const cube = (iso) => inBuild(v541, () => cubeStates(at(iso)))[0].events.map(({ eventType }) => eventType).sort();
    assert.deepEqual(cube("2018-09-18T00:00:00Z"), [cubeMoveTo(8), cubeStartMove, cubeTurnOn].sort(), "5.40's name for the leg to the lake");
    assert.deepEqual(cube("2018-09-20T00:00:00Z"), [cubeDestination, cubeTurnOn].sort());
    assert.deepEqual(inBuild(v541, () => highStakesFlagsNow(at("2018-09-10T12:00:00Z"))), [ltmHeist], "on the replay's High Stakes days");
    assert.deepEqual(inBuild(v541, () => highStakesFlagsNow(at("2018-09-19T12:00:00Z"))), [], "over with Update v5.41");
    assert.equal(inBuild(v541, () => highStakesStates(at("2018-09-10T12:00:00Z")))[0].events[0].activeUntil, "2018-09-18T08:00:00.000Z");
  });
  withConfig({ ...replay, season4Flags: { overrides: { [ltmHeist]: "on" } } }, () => {
    assert.ok(inBuild(v541, () => activeEventFlags()).includes(ltmHeist), "switched on, always served");
  });
});

test("5.41's modes: Soaring Solos (Playlist_Soaring_Solo 185) new and on by default, The Getaway and Close Encounters kept", () => {
  const defaults = createSettingsStore(null).get();
  assert.equal(ltmOn("soaringSolos", v541, defaults), true);
  assert.equal(ltmOn("soaringDuos", v541, defaults), false, "Duos by its switch");
  assert.equal(ltmOn("soaringSquads", v541, defaults), false, "Squads by its switch");
  assert.equal(hasLtm("soaringSolos", v540), false, "5.40 has no Soaring Solos");
  assert.equal(ltmNewMode(v541, defaults), null, "on by default, not forced: its switch turns it off");
  for (const id of ["getaway", "getawayDuos"]) assert.equal(ltmOn(id, v541, defaults), true, id);
  assert.equal(ltmOn("getawaySolo", v541, defaults), false);
  const off = { ...defaults, matchmakingModes: { ...defaults.matchmakingModes, soaringSolos: false } };
  assert.equal(ltmOn("soaringSolos", v541, off), false);
  assert.deepEqual(ltmPlaylistOverrides(v541, defaults),
    ["Playlist_50v50", "Playlist_Playground", "Playlist_Bling_Squads", "Playlist_Bling_Duos", "Playlist_Soaring_Solo"]);
  assert.deepEqual([185, 186, 187, 142, 141, 140, 44, 45, 46, 1993, 35, 50, 53].map((id) => ltmOfPlaylist(id, v541)?.id),
    ["soaringSolos", "soaringDuos", "soaringSquads", "getaway", "getawayDuos", "getawaySolo", "closeEncountersSeason5Solo",
      "closeEncountersSeason5Duos", "closeEncountersSeason5", "fiftyFiftySolidGold", "playgroundV2", "fiftyFiftySeason5", "soaring50s"]);
  assert.deepEqual([185, 186, 187].map((id) => playlistTeamsOf(`${v541}:0:NA:${id}`, v541)),
    [1, 2, 4].map((size) => ({ maxTeamCount: 100, maxTeamSize: size, maxSquadSize: size })));
  for (const [name, id] of [["playlist_soaring_solo", 185], ["playlist_soaring_duos", 186], ["playlist_soaring_squads", 187], ["playlist_bling_squads", 142]]) {
    assert.equal(playlistIdOfName(name, v541), id, name);
    assert.equal(parseBucket(`${v541}:0:NAE:${name}`, v541).playlistId, id, name);
  }
  // The lobby's list (#314): Soaring Solos listed, enabled and advertised as New; its Duos and Squads hidden.
  const listed = ltmFrontEndPlaylists(v541, defaults);
  const soaring = listed.find(({ name }) => name === "Playlist_Soaring_Solo");
  assert.equal(soaring.enabled, true);
  assert.equal(soaring.ltm.advertise, "New");
  assert.equal(listed.find(({ name }) => name === "Playlist_Soaring_Duos").enabled, false);
  assert.ok(!ltmFrontEndPlaylists(v540, defaults).some(({ name }) => name.startsWith("Playlist_Soaring_S") || name === "Playlist_Soaring_Duos"));
  withConfig(replay, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    assert.equal(inOriginalWindow("soaringSolos", v541, at("2018-09-20T12:00:00Z"), dated), true, "Update v5.41's mode");
    assert.equal(inOriginalWindow("soaringSolos", v541, at("2018-09-15T12:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("closeEncountersSeason5", v541, at("2018-09-20T12:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("closeEncountersSeason5", v540, at("2018-09-20T12:00:00Z"), dated), false, "5.40's by its switch");
    assert.equal(inOriginalWindow("getaway", v541, at("2018-09-08T12:00:00Z"), dated), true, "beside the High Stakes Challenges");
    assert.equal(inOriginalWindow("getaway", v541, at("2018-09-19T12:00:00Z"), dated), false);
  });
  // The mode select's pictures (#321): 5.41 reads playlistinformation too; Soaring Solos has Soaring 50's tile.
  const tiles = Object.fromEntries(playlistInformationFor(v541).playlist_info.playlists.map((entry) => [entry.playlist_name, entry]));
  for (const name of ["Playlist_Soaring_Solo", "Playlist_Soaring_Duos", "Playlist_Soaring_Squads"]) {
    assert.equal(tiles[name].image, epicPlaylistImages.Playlist_Soaring_50s, name);
  }
  assert.equal(tiles.Playlist_Bling_Squads.special_border, "HighStakes");
});

test("5.41's Save the World: Weekly Horde Challenge 7 and the Bowler by their week, Mega Alerts on every group mission", () => {
  withConfig(replay, () => inBuild(v541, () => {
    const week7 = at("2018-09-22T12:00:00Z");
    assert.equal(weeklyHordeWeek(week7), 7);
    const weekly = hordeWeeklyTheater(week7);
    assert.deepEqual(weekly.data.runtimeInfo.theaterTags.gameplayTags, [{ tagName: "Stat.Theater.Weekly.Horde.WeekC" }]);
    assert.ok(weekly.data.tiles.every(({ zoneTheme }) => zoneTheme.includes("CCImmune")));
    assert.equal(eventStoreOffers(week7)[weeklyStorefront][0].templateId, "Schematic:sid_launcher_flintlock_sr_ore_t01");
  }));
  const now = at("2026-11-11T12:00:00Z");
  const info = inBuild(v541, () => worldInfo(now));
  const groups = info.missions.flatMap(({ availableMissions }) => availableMissions).filter(({ missionGenerator }) => isGroupMission(missionGenerator));
  const alerts = info.missionAlerts.flatMap(({ availableMissionAlerts }) => availableMissionAlerts);
  assert.ok(groups.length > 0);
  assert.equal(alerts.filter(({ categoryName }) => categoryName === "MegaAlertCategory").length, groups.length);
  assert.ok(!alerts.some(({ categoryName }) => categoryName === "GroupMissionCategory"));
});

test("5.41's shop: Season 5's history sells Valkyrie and Nite Nite on 5.41 with their back blings, and not on 5.40", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season5.json", import.meta.url), "utf8")).days;
  const c541 = inBuild(v541, athenaCosmetics);
  const c540 = inBuild(v540, athenaCosmetics);
  const sold = new Set(history.flatMap((day) => [...day.featured, ...day.daily].map(([id]) => id)));
  assert.ok([...sold].every((id) => c541[id]), "only 5.41's cosmetics");
  assert.deepEqual([...sold].filter((id) => !c540[id]).sort(), ["AthenaCharacter:cid_184_athena_commando_m_durrburgerworker",
    "AthenaCharacter:cid_221_athena_commando_m_clown", "AthenaCharacter:cid_222_athena_commando_f_darkviking", "AthenaGlider:glider_id_070_darkviking"]);
  // 21 September 2018 is the season's day 72: with the season from 27 September 2026, 7 December 2026.
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 5: "2026-09-27" } };
  const now = at("2026-12-07T12:00:00Z");
  const featured = (build) => inBuild(build, () => itemShopOffers(now, config)).BRWeeklyStorefront;
  const valkyrie = featured(v541).find(({ templateId }) => templateId === "AthenaCharacter:cid_222_athena_commando_f_darkviking");
  assert.ok(valkyrie);
  assert.deepEqual(valkyrie.itemGrants.map(({ templateId }) => templateId),
    ["AthenaCharacter:cid_222_athena_commando_f_darkviking", "AthenaBackpack:bid_113_darkvikingfemale"]);
  assert.ok(!featured(v540).some(({ templateId }) => !c540[templateId]), "5.40 sells none of them");
});

// The owner's 5.41 client logged "[VerifyProfileToken_HttpRequestComplete] Failed with error code:
// [errors.com.epicgames.common.not_found]": 5.41 posts its profile tokens to profileToken/verify/<accountId> when its app
// environment check fails, and takes a 204 as verified.
test("5.41's profile token check: POST profileToken/verify/<accountId> answers 204 for the player's own account", async () => {
  const agent = `Fortnite/++Fortnite+Release-5.41-CL-${v541} Windows/10.0.19045.1.256.64bit`;
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Tokens541");
    const verify = (accountId, token) => send({ host: "127.0.0.1", port: backend.port, method: "POST",
      path: `/fortnite/api/game/v2/profileToken/verify/${accountId}`,
      headers: { "User-Agent": agent, "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `bearer ${token}` } : {}) } },
      JSON.stringify({ profileTokens: { version: "12", migrationType: "0", class: "abcdefg", progressHash: "0" } }));
    const answer = await verify(player.accountId, player.token);
    assert.equal(answer.status, 204);
    assert.equal((await verify(player.accountId)).status, 401, "signed in only");
    const other = await userLogin(backend.port, "Other541");
    assert.equal((await verify(other.accountId, player.token)).status, 403, "for its own account only");
  } finally {
    backend.close();
  }
});

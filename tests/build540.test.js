import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { cubeStates } from "../src/events/cube.js";
import { activeEventFlags, configureEvents, cubeDestination, cubeLake, cubeMoveTo, cubeMoveToLake, cubeRune, cubeStartMove, cubeTurnOn,
  groupMission, hordeFlag, lobbySeason5, ltmHeist, passiveStorms, roadTrip2018Flag } from "../src/events/events.js";
import { highStakesFlagsNow, highStakesStates } from "../src/events/highstakes.js";
import { hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmNewMode, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, playlistIdOfName } from "../src/events/ltms.js";
import { eventQuestLine } from "../src/events/quests.js";
import { roadTrip2018, roadTripEventQuests, weeklyHordeQuests, weeklyHordeWeek } from "../src/events/roadtrip2018.js";
import { athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { dataBuild } from "../src/gamedata/read.js";
import { parseBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { clientToken, post, send, startBackend, userLogin } from "./helpers.js";
import { createSettingsStore } from "../src/settings/store.js";
import { eventStoreOffers, eventStorefront, weeklyStorefront } from "../src/store/eventstore.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { missionAlertCategory } from "../src/gamedata/world.js";
import { alertsRemaining, completeMissionAlert } from "../src/profiles/alerts.js";
import { trackChanges } from "../src/profiles/changes.js";
import { defaultStats } from "../src/profiles/defaults.js";
import { season4Flag } from "../src/events/season4flags.js";
import { hordeTheater, hordeWeeklyTheater } from "../src/world/horde.js";
import { isGroupMission, worldInfo } from "../src/world/theaters.js";

// Fortnite 5.40, Season 5: CL-4352937 (++Fortnite+Release-5.40, Update v5.40, 6 September 2018), on its own data
// (gamedata/4352937). Content Update v5.40's (11 September) and Update v5.41's (18 September) items are in its paks already.
const v540 = "4352937";
const v530 = "4305896";
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

test("5.40 is known by its version and plays on its own data", () => {
  assert.equal(versionOf(v540), "5.40");
  assert.equal(dataBuild(v540), v540);
  assert.ok(buildChoices().includes(v540));
  assert.equal(allowedBuildList(["5.40"]).join(), v540);
  assert.equal(dataBuild("4330000"), v530, "a build between 5.30 and 5.40 Core doesn't know plays on 5.30's");
  assert.equal(buildOfSeason(5), "4363240", "Season 5's newest data is 5.41's now (build541.test.js)");
  assert.equal(seasonName(5), "Season 5 (5.0 – 5.41)");
  const season = inBuild(v540, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.numBookLevels, season.storefront], [5, 100, "BRSeason5"]);
});

test("5.40's data: 30 new cosmetics, the Grappler, Port-a-Fortress, Field Agent Rio, Harvester Fiona, the Wraith, Horde weeks 5 to 7", () => {
  const c540 = inBuild(v540, athenaCosmetics);
  const c530 = inBuild(v530, athenaCosmetics);
  assert.equal(Object.keys(c540).filter((id) => !c530[id]).length, 30);
  assert.ok(Object.keys(c530).every((id) => c540[id]), "5.40 drops none of 5.30's");
  assert.deepEqual(["AthenaCharacter:cid_206_athena_commando_m_bling", "AthenaPickaxe:pickaxe_id_092_bling", "AthenaSkyDiveContrail:trails_id_021_bling",
    "AthenaDance:spid_044_bling"].map((id) => c540[id].name.trim()), ["Wild Card", "Crowbar", "Cash Flow", "Suited Up"]);
  inBuild(v540, () => {
    assert.equal(getItem("Weapon:wid_hook_gun_vr_ore_t03").name, "Grappler");
    assert.equal(getItem("Weapon:athena_supertowergrenade_a").name, "Port-a-Fortress");
    assert.equal(getItem("Hero:hid_outlander_myth03_sr_t01").name, "Field Agent Rio");
    assert.equal(getItem("Hero:hid_ninja_015_f_v1_roadtrip_sr_t01").name, "Harvester Fiona");
    assert.ok(getItem("Schematic:sid_assault_military_silenced_sr_ore_t01"), "the Wraith");
    // "Win 1500 Gold for the first-time completion"; "Earn Field Agent Rio for the first-time completion".
    assert.deepEqual(getQuest("hordequest_weekly5_twine1").rewards, [{ quantity: 1500, templateId: "AccountResource:eventcurrency_scaling" }]);
    assert.deepEqual(getQuest("hordequest_weekly6_twine1").rewards, [{ quantity: 1, templateId: "Hero:hid_outlander_myth03_sr_t01" }]);
    assert.ok(getQuest("hordequest_hidden_weekly7"));
    // The High Stakes Challenges' schedule names its event flag.
    assert.equal(athenaChallengeSchedules().schedule_ltm_heist.eventName, ltmHeist);
  });
  inBuild(v530, () => assert.equal(getItem("Hero:hid_outlander_myth03_sr_t01"), undefined));
});

test("5.40's event flags: 5.30's but GroupMission (#317), and High Stakes (EventFlag.LTM_Heist) from 6 to 18 September on Season 5's replay", () => {
  assert.deepEqual(activeEventFlags(v540), [passiveStorms, lobbySeason5, roadTrip2018Flag, hordeFlag], "its group missions carry Mega Alerts");
  assert.ok(activeEventFlags(v530).includes(groupMission));
  assert.deepEqual(season4Flag(groupMission).builds, [4072250, 4305896], "the admin's switch stops at 5.30");
  withConfig(replay, () => {
    const types = (iso) => inBuild(v540, () => highStakesStates(at(iso)))[0]?.events.map(({ eventType }) => eventType) ?? [];
    assert.deepEqual(types("2018-09-05T12:00:00Z"), []);
    assert.deepEqual(types("2018-09-10T12:00:00Z"), [ltmHeist]);
    assert.equal(inBuild(v540, () => highStakesStates(at("2018-09-10T12:00:00Z")))[0].events[0].activeUntil, "2018-09-18T08:00:00.000Z",
      "the challenges count down to Update v5.41");
    assert.deepEqual(types("2018-09-19T12:00:00Z"), []);
    assert.deepEqual(inBuild(v540, () => highStakesFlagsNow(at("2018-09-10T12:00:00Z"))), [ltmHeist]);
    assert.deepEqual(inBuild(v530, () => highStakesStates(at("2018-09-10T12:00:00Z"))), [], "5.30 has no High Stakes");
  });
  withConfig({ ...replay, season4Flags: { overrides: { [ltmHeist]: "on" } } }, () => {
    assert.ok(inBuild(v540, () => activeEventFlags()).includes(ltmHeist), "switched on, always served");
    assert.ok(!inBuild(v530, () => activeEventFlags()).includes(ltmHeist));
  });
  withConfig({ ...replay, datedFlags: { highStakes: { mode: "off" } } }, () => {
    assert.deepEqual(inBuild(v540, () => highStakesFlagsNow(at("2018-09-10T12:00:00Z"))), []);
  });
});

test("5.40's Cube: its rune legs and runes by their dates, the lake as _MoveTo8 and _Destination", () => {
  withConfig(replay, () => {
    const types = (iso) => inBuild(v540, () => cubeStates(at(iso)))[0].events.map(({ eventType }) => eventType).sort();
    assert.deepEqual(types("2018-09-06T12:00:00Z"), [cubeRune(3), cubeTurnOn].sort(), "5.40's release: the Cube at Salty Springs");
    assert.deepEqual(types("2018-09-18T00:00:00Z"), [cubeMoveTo(8), cubeStartMove, cubeTurnOn].sort(), "5.40's name for the leg to the lake");
    assert.deepEqual(types("2018-09-20T00:00:00Z"), [cubeDestination, cubeTurnOn].sort());
    const on530 = (iso) => inBuild(v530, () => cubeStates(at(iso)))[0].events.map(({ eventType }) => eventType).sort();
    assert.deepEqual(on530("2018-09-20T00:00:00Z"), [cubeLake, cubeTurnOn].sort(), "5.30 keeps its own names");
    assert.ok(!on530("2018-09-18T00:00:00Z").includes(cubeMoveTo(8)));
    assert.ok(on530("2018-09-18T00:00:00Z").includes(cubeMoveToLake));
  });
});

test("5.40's modes: The Getaway (Playlist_Bling_Squads 142, _Duos 141, _Solo 140) on by default, by its dates with Original dates", () => {
  const defaults = createSettingsStore(null).get();
  assert.equal(ltmOn("getaway", v540, defaults), true);
  assert.equal(ltmOn("getawayDuos", v540, defaults), true);
  assert.equal(ltmOn("getawaySolo", v540, defaults), false, "Solo by its switch");
  assert.equal(ltmOn("getaway", v530, defaults), false, "5.30 has no Getaway");
  assert.equal(ltmNewMode(v540, defaults), null, "on by default, not forced: its switch turns it off");
  const off = { ...defaults, matchmakingModes: { ...defaults.matchmakingModes, getaway: false } };
  assert.equal(ltmOn("getaway", v540, off), false);
  assert.deepEqual(ltmPlaylistOverrides(v540, defaults), ["Playlist_50v50", "Playlist_Playground", "Playlist_Bling_Squads", "Playlist_Bling_Duos"]);
  assert.deepEqual([142, 141, 140, 44, 45, 46, 1993, 35, 50, 53].map((id) => ltmOfPlaylist(id, v540)?.id),
    ["getaway", "getawayDuos", "getawaySolo", "closeEncountersSeason5Solo", "closeEncountersSeason5Duos", "closeEncountersSeason5",
      "fiftyFiftySolidGold", "playgroundV2", "fiftyFiftySeason5", "soaring50s"]);
  assert.deepEqual([140, 141, 142].map((id) => playlistTeamsOf(`${v540}:0:NA:${id}`, v540)),
    [1, 2, 4].map((size) => ({ maxTeamCount: 100, maxTeamSize: size, maxSquadSize: size })));
  for (const [name, id] of [["playlist_bling_squads", 142], ["playlist_bling_duos", 141], ["playlist_bling_solo", 140], ["playlist_close_squad", 46]]) {
    assert.equal(playlistIdOfName(name, v540), id, name);
    assert.equal(parseBucket(`${v540}:0:NAE:${name}`, v540).playlistId, id, name);
  }
  for (const id of ["scoreRoyaleSolo", "solidGoldSeason5", "solidGoldSeason5Solo"]) assert.equal(hasLtm(id, v540), false, `${id}'s playlists are gone`);
  assert.equal(hasLtm("fiftyFiftySolidGold", v540), true);
  // The lobby's list (#314): the Getaway listed, enabled and advertised as New.
  const listed = ltmFrontEndPlaylists(v540, defaults);
  const getaway = listed.find(({ name }) => name === "Playlist_Bling_Squads");
  assert.equal(getaway.enabled, true);
  assert.equal(getaway.ltm.advertise, "New");
  assert.equal(listed.find(({ name }) => name === "Playlist_Bling_Solo").enabled, false);
  withConfig(replay, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    assert.equal(inOriginalWindow("getaway", v540, at("2018-09-08T12:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("getaway", v540, at("2018-09-12T12:00:00Z"), dated), false, "Duos then");
    assert.equal(inOriginalWindow("getawayDuos", v540, at("2018-09-12T12:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("getaway", v540, at("2018-09-15T12:00:00Z"), dated), true, "switched back to Squads on 13 September");
    assert.equal(inOriginalWindow("getaway", v540, at("2018-09-19T12:00:00Z"), dated), false, "High Stakes ended with Update v5.41");
    assert.equal(ltmOn("getaway", v540, dated, at("2018-09-20T12:00:00Z")), false);
    assert.deepEqual(ltmPlaylistOverrides(v540, dated, at("2018-09-12T12:00:00Z")), ["Playlist_Playground", "Playlist_Bling_Duos"]);
  });
  // A settings file saved before 5.40 has no Getaway key: the default (on) holds.
  const dataDir = fs.mkdtempSync(`${process.env.TEMP ?? "/tmp"}/core-backend-540-`);
  try {
    fs.writeFileSync(`${dataDir}/settings.json`, JSON.stringify({ matchmakingModesRevision: 1, matchmakingModes: { playgroundV2: false } }));
    const kept = createSettingsStore(dataDir).get();
    assert.deepEqual([kept.matchmakingModes.getaway, kept.matchmakingModes.getawayDuos, kept.matchmakingModes.getawaySolo], [true, true, false]);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("5.40's Weekly Horde Challenges 5 to 7: by their weeks, in their theater, tagged WeekA, WeekB and WeekC", () => {
  withConfig(replay, () => inBuild(v540, () => {
    const week5 = at("2018-09-08T12:00:00Z");
    const week6 = at("2018-09-15T12:00:00Z");
    const week7 = at("2018-09-22T12:00:00Z");
    assert.deepEqual([week5, week6, week7].map((now) => weeklyHordeWeek(now)), [5, 6, 7]);
    assert.ok(weeklyHordeQuests(6).every((questId) => roadTripEventQuests(week6).includes(questId)));
    assert.ok(eventQuestLine(roadTrip2018).has("hordequest_weekly7_twine1_repeatable"));
    for (const [now, tag, themeName] of [[week5, "WeekA", "Indestructible"], [week6, "WeekB", "NoShields"], [week7, "WeekC", "CCImmune"]]) {
      const weekly = hordeWeeklyTheater(now);
      assert.deepEqual(weekly.data.runtimeInfo.theaterTags.gameplayTags, [{ tagName: `Stat.Theater.Weekly.Horde.${tag}` }]);
      assert.ok(weekly.data.tiles.every(({ zoneTheme }) => zoneTheme.includes(themeName)), themeName);
      assert.ok(weekly.fixedMissions.every(({ missionGenerator }) => missionGenerator.includes("MissionGen_WeeklyHordeChallenge_03")));
      assert.equal(weekly.fixedMissions.length, 4);
    }
    assert.equal(hordeTheater(week5).data.regions.length, 10);
  }));
});

test("5.40's stores: the Wraith and the Bowler in the Weekly Store by their weeks, Harvester Fiona in the Event Store", () => {
  withConfig(replay, () => {
    const offers = (build, iso) => inBuild(build, () => eventStoreOffers(at(iso)));
    const ids = (list) => list.map(({ templateId }) => templateId);
    assert.equal(offers(v540, "2018-09-08T12:00:00Z")[weeklyStorefront][0].templateId, "Schematic:sid_assault_flintlock_sr_ore_t01");
    assert.equal(offers(v540, "2018-09-15T12:00:00Z")[weeklyStorefront][0].templateId, "Schematic:sid_assault_military_silenced_sr_ore_t01");
    const bowlerWeek = offers(v540, "2018-09-22T12:00:00Z");
    assert.equal(bowlerWeek[weeklyStorefront][0].templateId, "Schematic:sid_launcher_flintlock_sr_ore_t01");
    assert.ok(!ids(bowlerWeek[eventStorefront]).includes("Schematic:sid_launcher_flintlock_sr_ore_t01"), "it leaves the event items in its week");
    assert.ok(ids(bowlerWeek[eventStorefront]).includes("Hero:hid_ninja_015_f_v1_roadtrip_sr_t01"));
    assert.equal(offers(v530, "2018-09-15T12:00:00Z")[weeklyStorefront][0].templateId, "Schematic:sid_assault_flintlock_sr_ore_t01", "5.30 keeps the Bundlebuss");
    assert.ok(!ids(offers(v530, "2018-09-15T12:00:00Z")[eventStorefront]).includes("Hero:hid_ninja_015_f_v1_roadtrip_sr_t01"));
  });
});

test("5.40's shop: Season 5's history sells 5.40's cosmetics on 5.40 with their back blings, and not on 5.30", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season5.json", import.meta.url), "utf8")).days;
  const c540 = inBuild(v540, athenaCosmetics);
  const c530 = inBuild(v530, athenaCosmetics);
  // The history keeps 5.41's too (build541.test.js); 5.40 sells only its own.
  const sold = new Set(history.flatMap((day) => [...day.featured, ...day.daily].map(([id]) => id)).filter((id) => c540[id]));
  assert.equal([...sold].filter((id) => !c530[id]).length, 19);
  assert.equal(history.find((day) => [...day.featured, ...day.daily].some(([id]) => id === "AthenaCharacter:cid_206_athena_commando_m_bling")).date, "2018-09-07");
  // 7 September 2018 is the season's day 58: with the season from 27 September 2026, 23 November 2026.
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 5: "2026-09-27" } };
  const now = at("2026-11-23T12:00:00Z");
  const featured = (build) => inBuild(build, () => itemShopOffers(now, config)).BRWeeklyStorefront;
  const wildCard = featured(v540).find(({ templateId }) => templateId === "AthenaCharacter:cid_206_athena_commando_m_bling");
  assert.ok(wildCard);
  assert.deepEqual(wildCard.itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_206_athena_commando_m_bling", "AthenaBackpack:bid_108_blingmale"]);
  assert.ok(!featured(v530).some(({ templateId }) => !c530[templateId]), "5.30 sells none of them");
});

// The lobby's list is the backend's from 5.0 (Core-Backend #314): 5.40's shipped DefaultGame.ini names no Getaway, so the
// hotfix lists it, and the matchmaking ticket takes it; switched off, the lobby hides it and the ticket is refused.
test("5.40's lobby lists The Getaway and its matchmaking ticket is taken; switched off, neither", async () => {
  const agent = `Fortnite/++Fortnite+Release-5.40-CL-${v540} Windows/10.0.19045.1.256.64bit`;
  const backend = await startBackend();
  try {
    const getawayLine = async () => {
      const token = await clientToken(backend.port);
      const ini = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/cloudstorage/system/DefaultGame.ini",
        headers: { "User-Agent": agent, Authorization: `bearer ${token}` } });
      return String(ini.body ?? "").split("\r\n").find((line) => line.startsWith("+FrontEndPlaylistData=(PlaylistName=Playlist_Bling_Squads,"));
    };
    assert.match(await getawayLine(), /^\+FrontEndPlaylistData=\(PlaylistName=Playlist_Bling_Squads, PlaylistAccess=\(bEnabled=true, bIsDefaultPlaylist=false, bVisibleWhenDisabled=false, AdvertiseType=New, bDisplayAsLimitedTime=true, DisplayPriority=\d+\)\)$/);
    const player = await userLogin(backend.port, "Getaway540");
    const ticket = () => send({ host: "127.0.0.1", port: backend.port, method: "GET",
      path: `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
        `&bucketId=${v540}:0:NAE:playlist_bling_squads&player.platform=Windows`,
      headers: { "User-Agent": agent, Authorization: `bearer ${player.token}` } });
    assert.equal((await ticket()).status, 200);
    await post(backend.port, "/admin/api/matchmaking/config", undefined, { modes: { getaway: false } });
    assert.match(await getawayLine(), /PlaylistAccess=\(bEnabled=false,/);
    assert.equal((await ticket()).status, 400);
  } finally {
    backend.close();
  }
});

// Core-Backend #317: "New Mega Alerts now show up on all group missions. A Mega Alert combines Elemental Storms with Mutant
// Storm modifiers, and has a Miniboss too! They may grant XP, evolution materials, perk materials, schematics or
// survivors ... These rewards can be earned 3 times every 24 hours."
test("5.40's Mega Alerts: one on every group mission, an element, the storm mutations and a Mini-Boss, 3 a day (#317)", () => {
  const now = at("2026-11-11T12:00:00Z");
  const mapOf = (build) => {
    const info = inBuild(build, () => worldInfo(now));
    const missions = info.missions.flatMap(({ theaterId, availableMissions }) => availableMissions.map((mission) => ({ ...mission, theaterId })));
    const alerts = info.missionAlerts.flatMap(({ theaterId, availableMissionAlerts }) => availableMissionAlerts.map((alert) => ({ ...alert, theaterId })));
    return { missions, alerts };
  };
  const { missions, alerts } = mapOf(v540);
  const groups = missions.filter(({ missionGenerator }) => isGroupMission(missionGenerator));
  const megas = alerts.filter(({ categoryName }) => categoryName === "MegaAlertCategory");
  assert.ok(groups.length > 0);
  assert.equal(megas.length, groups.length, "every group mission, Stonewood's first ones too");
  assert.ok(!alerts.some(({ categoryName }) => categoryName === "GroupMissionCategory"), "in place of the group alerts");
  const zones = new Set();
  for (const mega of megas) {
    const mission = missions.find(({ theaterId, tileIndex }) => theaterId === mega.theaterId && tileIndex === mega.tileIndex);
    assert.ok(isGroupMission(mission.missionGenerator), "only on group missions");
    assert.equal(alerts.filter(({ theaterId, tileIndex }) => theaterId === mega.theaterId && tileIndex === mega.tileIndex).length, 1, "one alert a tile");
    // Its modifiers: an Elemental Storm's zone modifier, the zone's storm mutations, the Mini-Boss.
    const zone = /^MegaAlert\.ZoneMods_(\w+)$/.exec(mega.missionAlertModifiers.tierGroupName)?.[1];
    zones.add(zone);
    const modifiers = mega.missionAlertModifiers.items.map(({ itemType }) => itemType);
    assert.match(modifiers[0], /^GameplayModifier:elementalzone(fire|nature|water)enableitem$/);
    assert.equal(modifiers.at(-1), "GameplayModifier:minibossenableprimarymissionitem");
    const mutations = modifiers.slice(1, -1);
    assert.equal(mutations.length, { Stonewood: 1, Plankerton: 2, CanneyValley: 2, TwinePeaks: 3 }[zone], zone);
    assert.ok(mutations.every((itemType) => /^GameplayModifier:gm_(enemy|basehusk)_/.test(itemType)));
    // Its rewards: one kind of the notes'.
    assert.equal(mega.missionAlertRewards.tierGroupName, "MissionAlert_MegaAlert");
    const rewards = mega.missionAlertRewards.items.map(({ itemType, quantity }) => `${itemType} x${quantity}`).join(", ");
    assert.match(rewards, /^(CardPack:zcp_(heroxp|schematicxp|personnelxp)_t\d\d x5|CardPack:zcp_reagent_c_t0\d_veryhigh x3|CardPack:zcp_reagent_alteration_generic_(medium|high|veryhigh) x3, CardPack:zcp_reagent_alteration_upgrade_(uc|r|vr|sr) x3|CardPack:cardpack_(ranged|melee|trap|worker)_(vr|sr) x1)$/, rewards);
    if (zone === "Stonewood") assert.doesNotMatch(rewards, /alteration/, "perk materials from Plankerton");
    const tier = /_T(\d\d)$/.exec(mission.missionRewards.tierGroupName)[1];
    if (/xp_t/.test(rewards)) assert.ok(rewards.includes(`_t${tier} `), "XP of the mission's tier");
  }
  assert.ok(zones.size >= 3, [...zones].join());
  assert.equal(new Set(megas.map(({ missionAlertGuid }) => missionAlertGuid)).size, megas.length);
  assert.deepEqual(inBuild(v540, () => worldInfo(now)).missionAlerts, inBuild(v540, () => worldInfo(now)).missionAlerts, "the same all day");
  // 5.30 has none: its group missions keep their group alerts.
  const on530 = mapOf(v530).alerts;
  assert.ok(!on530.some(({ categoryName }) => categoryName === "MegaAlertCategory"));
  assert.ok(on530.some(({ categoryName }) => categoryName === "GroupMissionCategory"));
  // The category's quota: 3 a day, each alert once.
  inBuild(v540, () => {
    assert.deepEqual(missionAlertCategory("MegaAlertCategory"), { category: "MegaAlertCategory", quota: 3, repeatable: false });
    const trackers = {};
    const session = { profile: (profileId) => (trackers[profileId] ??= trackChanges({ profileId, stats: { attributes: defaultStats(profileId) }, items: {} })) };
    const record = () => session.profile("profile0").profile.stats.attributes.mission_alert_redemption_record;
    assert.equal(completeMissionAlert(session, megas[0].theaterId, megas[0], now), true);
    assert.equal(completeMissionAlert(session, megas[0].theaterId, megas[0], now), false, "not repeatable");
    assert.equal(completeMissionAlert(session, megas[1].theaterId, megas[1], now), true);
    assert.equal(completeMissionAlert(session, megas[2].theaterId, megas[2], now), true);
    assert.equal(alertsRemaining(record(), now, "MegaAlertCategory"), 0);
    assert.equal(completeMissionAlert(session, megas[3].theaterId, megas[3], now), false, "3 a day");
    assert.equal(alertsRemaining(record(), new Date(now.getTime() + 24 * 60 * 60 * 1000), "MegaAlertCategory"), 3, "back the next day");
  });
});

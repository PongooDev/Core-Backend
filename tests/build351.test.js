import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { battlePassOffers } from "../src/battlepass/season2.js";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { versionOf } from "../src/builds/detect.js";
import { specialBookPages } from "../src/collectionbook/pages.js";
import { contentUpdateStates, updatedLootTables } from "../src/events/contentupdates.js";
import { activeEventFlags, activeStorms, groupMission, hasEventEnded, isEventActive, passiveMiniBosses, passiveStorms, spring2018, spring2018Phase1,
  storm2018, storm2018Phase1, surviveTheStorm } from "../src/events/events.js";
import { eventQuestLine } from "../src/events/quests.js";
import { springEventQuests } from "../src/events/spring2018.js";
import { firecrackerConversion } from "../src/events/springgold.js";
import { intoTheStormQuests, stormEventQuests } from "../src/events/storm2018.js";
import { stormConversion2018 } from "../src/events/stormllamas.js";
import { eventTagOfPlaylist, hasLtm, ltmEventFlags, ltmForcedQueues, ltmNewMode, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, ltmQuests,
  lastSelectedPlaylistOf } from "../src/events/ltms.js";
import { athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { assignmentBucket, playlistTeamsOf, showsMatchStart } from "../src/matchmaking/service.js";
import { challengeWeekCount } from "../src/profiles/challenges.js";
import { changeTemplate, trackChanges } from "../src/profiles/changes.js";
import { isAccountView, itemView, noteClientBuild, viewChanges, viewProfile } from "../src/profiles/common.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { findOffer } from "../src/store/catalog.js";
import { eventStoreEnds, eventStoreInstanceNow, eventStoreOffers, hasEventStore } from "../src/store/eventstore.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { worldInfo } from "../src/world/theaters.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Fortnite 3.5.1 (++Fortnite+Release-3.5-CL-4000805, UE 4.20, 11 April 2018): Season 3, on its own data
// (gamedata/4000805), sharing 3.0's Battle Pass, clock and leaderboards. Core has no 3.4.
const v351 = "4000805";
const v33 = "3942182";
const v30 = "3901517";
const now = new Date("2026-11-04T12:00:00Z");

test("3.5.1 is known by its version, plays on its own data and is Season 3's newest, with 3.0's pass", () => {
  assert.equal(versionOf(v351), "3.5.1");
  assert.equal(dataBuild(v351), v351);
  assert.equal(dataBuild("3950000"), v33, "a 3.4 would play on 3.3's data");
  assert.ok(buildChoices().includes(v351));
  assert.equal(allowedBuildList(["3.5.1"]).join(), v351);
  assert.deepEqual(inBuild(v351, athenaSeason), inBuild(v30, athenaSeason), "AthenaSeason3 is 3.0's");
  assert.equal(buildOfSeason(3), v351);
  assert.deepEqual(inBuild(v351, () => battlePassOffers()).map(({ offerId, storefront, price }) => [offerId, storefront, price]),
    inBuild(v30, () => battlePassOffers()).map(({ offerId, storefront, price }) => [offerId, storefront, price]));
});

test("3.5.1's cosmetics: 3.4's and 3.5's added, the locker's Random entries kept, the test gliders and debug pickaxe left out", () => {
  const now351 = inBuild(v351, athenaCosmetics);
  const before = inBuild(v33, athenaCosmetics);
  const added = Object.keys(now351).filter((id) => !before[id]);
  for (const [id, name] of [["AthenaCharacter:cid_102_athena_commando_m_raven", "Raven"], ["AthenaCharacter:cid_103_athena_commando_m_bunny", "Rabbit Raider"],
    ["AthenaCharacter:cid_108_athena_commando_m_fishhead", "Leviathan"], ["AthenaCharacter:cid_107_athena_commando_f_pajamaparty", "Tricera Ops"],
    ["AthenaBackpack:bid_036_raven", "Iron Cage"], ["AthenaGlider:glider_id_024_reaper", "Feathered Flyer"], ["AthenaDance:eid_rockpaperscissors", "Rock Paper Scissors"],
    ["AthenaCharacter:cid_random", "Random Character"]]) {
    assert.ok(added.includes(id), id);
    assert.equal(now351[id].name, name, id);
  }
  assert.equal(added.length, 46);
  for (const id of ["AthenaGlider:dynamicstestglider", "AthenaGlider:glider_proxytest", "AthenaGlider:glider_teststaticparts", "AthenaPickaxe:pickaxe_id_zzz_statdebugger"]) {
    assert.equal(now351[id], undefined, id);
  }
  assert.equal(now351["AthenaBattleBus:bbid_winterbus"], undefined, "3.5's paks drop the Winter Bus");
  assert.equal(before["AthenaGlider:glider_id_019_taxi"].rarity, "Sturdy");
  assert.equal(now351["AthenaGlider:glider_id_019_taxi"].rarity, "Ordinary");
});

test("3.5.1's loot and weapons: the Port-a-Fort and Guided Missile in, the shotguns' new rarity, Vending Machines", () => {
  assert.equal(inBuild(v351, () => getItem("Weapon:athena_towergrenade")).name, "Port-a-Fort");
  assert.equal(inBuild(v351, () => getItem("Weapon:wid_rc_rocket_athena_sr_t03")).name, "Guided Missile");
  assert.equal(inBuild(v33, () => getItem("Weapon:wid_rc_rocket_athena_sr_t03")), undefined);
  // "Tactical Shotguns are now Common/Uncommon/Rare (was Uncommon/Rare/Epic)."
  assert.equal(inBuild(v351, () => getItem("Weapon:wid_shotgun_semiauto_athena_vr_ore_t03")).rarity, "Sturdy");
  assert.equal(inBuild(v33, () => getItem("Weapon:wid_shotgun_semiauto_athena_vr_ore_t03")).rarity, "Quality");
  // Its overlay is the notes' loot, served as it ships.
  assert.deepEqual(inBuild(v351, () => contentUpdateStates(now, { mode: "season" })), []);
  assert.deepEqual(inBuild(v351, () => updatedLootTables(now)), {});
  const { loot } = buildGameData(v351, "athena", {});
  const packages = loot["/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client"];
  const tiers = loot["/Game/Items/Datatables/AthenaLootTierData_Client.AthenaLootTierData_Client"];
  assert.ok(Object.values(packages).some((row) => /Athena_TowerGrenade/.test(row.ItemDefinition) && row.Weight > 0));
  assert.ok(Object.keys(tiers).some((row) => /^Loot_AthenaVending_/.test(row)));
});

test("3.5.1's weekly challenges are 3.3's ten weeks, with week 7's gnomes and week 10's skydiving rings", () => {
  assert.equal(inBuild(v351, challengeWeekCount), 10);
  const { challengeBundles } = buildGameData(v351, "athena", {});
  assert.ok(challengeBundles.s3_week7_questbundle.quests.some(({ quest }) => quest === "quest_br_interact_gnicegnomes"));
  assert.ok(challengeBundles.s3_week10_questbundle.quests.some(({ quest }) => quest === "quest_br_skydive_rings"));
});

// The shop's replay: Season 3's day 1 is 2018-02-22, so day 44 (index 43) is 6 April 2018, Raven's first day.
test("Season 3's shop on 3.5.1 sells 3.4's and 3.5's cosmetics on Epic's days, with their back blings; 3.3's shop is as it was", () => {
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 3: "2026-10-04" } };
  const day = (index) => new Date(Date.parse("2026-10-04T12:00:00Z") + index * 86400000);
  const offers = (build, index) => inBuild(build, () => itemShopOffers(day(index), config)).BRWeeklyStorefront;
  const raven = offers(v351, 43).find(({ templateId }) => templateId === "AthenaCharacter:cid_102_athena_commando_m_raven");
  assert.equal(raven.price, 2000);
  assert.deepEqual(raven.itemGrants.map(({ templateId }) => templateId), ["AthenaCharacter:cid_102_athena_commando_m_raven", "AthenaBackpack:bid_036_raven"]);
  assert.ok(!offers(v33, 43).some(({ templateId }) => /raven/.test(templateId)));
  // 1 April 2018 (index 38): Bunny Brawler and Rabbit Raider share a "Pick your Style!" tile.
  const bunnies = offers(v351, 38).filter(({ templateId }) => /_bunny$/.test(templateId));
  assert.equal(bunnies.length, 2);
  assert.ok(bunnies.every((offer) => offer.banner === "PickYourStyle" && offer.category === bunnies[0].category));
  assert.deepEqual(offers(v33, 38), [], "3.3 has none of that day's featured items");
});

test("3.5.1 ends Spring It On! and runs Into the Storm: Opening Act, Survive the Storm and the active Mutant Storms", () => {
  assert.deepEqual(activeEventFlags(v351), [passiveMiniBosses, activeStorms, surviveTheStorm, storm2018Phase1]);
  for (const flag of [spring2018Phase1, passiveStorms, groupMission]) assert.ok(!activeEventFlags(v351).includes(flag), flag);
  assert.ok(!activeEventFlags(v33).includes(storm2018Phase1));
  assert.deepEqual(activeEventFlags("3950000"), []);
  assert.equal(inBuild(v351, () => isEventActive(storm2018)), true);
  assert.equal(inBuild(v351, () => hasEventEnded(spring2018)), true);
  assert.equal(inBuild(v33, () => hasEventEnded(spring2018)), false);
});

test("Into the Storm's quests are granted on 3.5.1 only and lead to the Neon weapons and the Cyberpunk heroes; Spring It On!'s go", () => {
  const started = (build) => inBuild(build, stormEventQuests);
  assert.deepEqual(started(v351), intoTheStormQuests);
  assert.deepEqual(started(v33), []);
  assert.deepEqual(inBuild(v351, springEventQuests), []);
  const line = inBuild(v351, () => [...eventQuestLine("Storm2018")]);
  for (const id of ["stormquest_2018_reactive_servicecars", "stormquest_2018_reactive_skyatlases", "stormquest_2018_reactive_telescopes",
    "stormquest_2018_landmark_lars", "stormquest_2018_landmark_observe"]) assert.ok(line.includes(id), id);
  const atlases = inBuild(v351, () => getQuest("stormquest_2018_reactive_skyatlases"));
  assert.deepEqual(atlases.selectableRewards.map(([reward]) => reward.templateId),
    ["CardPack:cardpack_pistol_neonglow_sr", "CardPack:cardpack_shotgun_neonglow_sr", "CardPack:cardpack_assault_neonglow_sr"]);
  assert.equal(inBuild(v351, () => getQuest("stormquest_2018_landmark_observe")).selectableRewards.length, 4);
});

test("3.5.1's llama store sells the Into the Storm Llama for Storm Tickets, not the Spring Llama", () => {
  const llama = inBuild(v351, () => findOffer("core_event_intothestorm_llama"));
  assert.deepEqual([llama.templateId, llama.currencySubType, llama.price], ["CardPack:cardpack_event_2018_storm", "AccountResource:eventcurrency_stormzone", 1000]);
  assert.equal(inBuild(v351, () => findOffer("core_event_spring_llama")), undefined);
  assert.equal(inBuild(v33, () => findOffer("core_event_intothestorm_llama")), undefined);
});

test("3.5.1's leftovers: Firecracker Tickets become Spring Llamas, Storm Tickets stay Into the Storm's", () => {
  assert.equal(inBuild(v351, () => firecrackerConversion.due()), true);
  assert.equal(inBuild(v33, () => firecrackerConversion.due()), false, "Spring It On! still runs on 3.3");
  assert.deepEqual(inBuild(v351, () => firecrackerConversion.options()).llama, "CardPack:cardpack_event_2018_spring");
  assert.equal(inBuild(v351, () => stormConversion2018.due()), false, "Into the Storm's Storm Tickets buy its own llama");
  assert.equal(inBuild("3889387", () => stormConversion2018.due()), true, "2.5 still converts the storms' return");
});

test("3.5.1's Event Store stays Spring It On!'s, with Wukong and Rabbit Raider Jonesy", () => {
  assert.equal(inBuild(v351, hasEventStore), true);
  assert.equal(inBuild(v351, eventStoreInstanceNow), "Spring2018.STWSpecialEventStoreFront");
  const store = inBuild(v351, () => eventStoreOffers(now)).STWSpecialEventStoreFront.map(({ templateId }) => templateId);
  assert.ok(store.includes("Hero:hid_commando_014_wukong_sr_t01"));
  assert.ok(store.includes("Hero:hid_commando_011_m_easter_sr_t01"));
  assert.ok(!inBuild(v33, () => eventStoreOffers(now)).STWSpecialEventStoreFront.some(({ templateId }) => /easter/.test(templateId)));
  assert.ok(inBuild(v351, () => eventStoreEnds(now)).stwEventStoreEnd);
});

test("3.5.1's world: the Survive the Storm theater, Storm Ticket storms and survivals, no group mission alerts", () => {
  const info = inBuild(v351, () => worldInfo(now));
  const survival = info.theaters.find(({ displayName }) => displayName?.en === "Survive the Storm");
  assert.ok(survival, "the Survive the Storm theater is back");
  assert.equal(survival.runtimeInfo.worldMapPinClass, "/Game/Environments/WorldMap/Blueprints/WM_Pin_Round.WM_Pin_Round_C");
  const alerts = info.missionAlerts.flatMap(({ availableMissionAlerts }) => availableMissionAlerts);
  const rewardsOf = (category) => alerts.filter(({ categoryName }) => categoryName === category)
    .flatMap(({ missionAlertRewards }) => missionAlertRewards.items.map(({ itemType }) => itemType));
  assert.ok(rewardsOf("StormCategory").includes("AccountResource:eventcurrency_stormzone"));
  assert.ok(rewardsOf("Survival3DayCategory").includes("AccountResource:eventcurrency_stormzone"));
  assert.ok(!alerts.some(({ categoryName }) => categoryName === "GroupMissionCategory" || categoryName === "StormLowCategory"));
  assert.ok(!inBuild(v33, () => worldInfo(now)).theaters.some(({ displayName }) => displayName?.en === "Survive the Storm"));
});

test("3.5.1's book: the Neon weapons and Cyberpunk heroes pages are given where the data has them", () => {
  const pages = inBuild(v351, specialBookPages);
  for (const page of ["PageSpecial_StormZoneCyber_Heroes", "PageSpecial_StormZoneCyber_Ranged", "PageSpecial_StormZoneCyber_Melee_Crystal"]) assert.ok(pages.includes(page), page);
  assert.ok(!inBuild(v33, specialBookPages).some((page) => /StormZoneCyber/.test(page)));
});

test("3.5.1's LTMs: its playlist assets, 50v50 v2 its new mode, by PlaylistOverrides and not the event queues", () => {
  for (const id of ["blitz", "blitzSolo", "blitzDuo", "fiveByTwenty", "skySupply", "solidGold", "fiftyFiftyV2", "highExplosivesSolo", "highExplosivesSquads",
    "sniperShootoutSolo", "sniperShootoutDuos", "sniperShootoutSquads", "skySupplyDuos", "skySupplySquads", "solidGoldSolo", "impactSolo", "impactDuos", "impactSquads"]) {
    assert.ok(hasLtm(id, v351), id);
  }
  for (const id of ["sneakySilencers", "highExplosives", "speedyStorm", "takeToTheSkies", "lotsaLoot", "sniperShootout", "highJump", "useItOrLoseIt", "steadyStorm", "shotguns"]) {
    assert.ok(!hasLtm(id, v351), id);
    assert.ok(hasLtm(id, v33), id);
  }
  assert.ok(!hasLtm("fiftyFiftyV2", v33));
  const none = { matchmakingModes: {} };
  // 50v50 is paused, so 50v50 v2 is no new mode: it follows its switch, off by default (CoreV2 #262).
  assert.equal(ltmNewMode(v351, none), null);
  assert.equal(ltmOn("fiftyFiftyV2", v351, { matchmakingModes: { fiftyFiftyV2: false } }), false);
  assert.equal(ltmOn("fiftyFiftyV2", v351, { matchmakingModes: { fiftyFiftyV2: true } }), true);
  assert.deepEqual(ltmPlaylistOverrides(v351, none), []);
  assert.deepEqual(ltmPlaylistOverrides(v351, { matchmakingModes: { fiftyFiftyV2: true } }), ["Playlist_50v50"]);
  assert.deepEqual(ltmPlaylistOverrides(v351, { matchmakingModes: { blitz: true, solidGoldSolo: true } }), ["Playlist_Blitz_Squad", "Playlist_SolidGold_Solo"]);
  assert.deepEqual(ltmPlaylistOverrides(v33, { matchmakingModes: { blitz: true } }), []);
  assert.deepEqual(ltmForcedQueues(v351, { matchmakingModes: { fiveByTwenty: true } }), []);
  assert.deepEqual(ltmEventFlags(v351, { matchmakingModes: { blitz: true } }), []);
  // Two ids changed modes: 23 is High Jump to 3.3, High Explosives v2 (Solo) on 3.5.1; 26 Steady Storm, then Solid Gold v2 (Solo).
  assert.equal(ltmOfPlaylist(23, v351).id, "highExplosivesSolo");
  assert.equal(ltmOfPlaylist(23, v33).id, "highJump");
  assert.equal(ltmOfPlaylist(26, v351).id, "solidGoldSolo");
  // A 3.5.1 playlist's matches count Athena.Playlist.Event.<PlaylistId>, Blitz Squads' Event.8.
  assert.deepEqual([19, 36, 37, 26, 50].map((id) => eventTagOfPlaylist(id, v351)), [8, 36, 37, 26, 50]);
  assert.deepEqual([19, 36, 37].map((id) => eventTagOfPlaylist(id, v33)), [8, 8, 8]);
  // With nothing turned on no LTM runs there, so no event quest is counted.
  assert.deepEqual(ltmQuests({ running: true }, v351), []);
});

test("3.5.1's playlist teams are its assets': 50v50 v2's two sides of 50, High Explosives v2 solo on 23", () => {
  assert.deepEqual(playlistTeamsOf(`${v351}:0:NA:50`, v351), { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v351}:0:NA:24`, v351), { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v351}:0:NA:41`, v351), { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v351}:0:NA:22`, v351), { maxTeamCount: 5, maxTeamSize: 20, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v351}:0:NA:2`, v351), { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 });
  assert.equal(playlistTeamsOf(`${v33}:0:NA:50`, v33), null);
});

test("3.5.1 takes AssignMatch's six fields and no match start countdown", () => {
  assert.equal(assignmentBucket(`${v351}:0:NA:2`, v351), `Fortnite:Fortnite:${v351}:0:NA:2`);
  assert.ok(!showsMatchStart(v351));
});

// 3.5's profiles (profiles/common.js): no profile0, but campaign, common_core and common_public, Core's views of it.
const agent351 = "Fortnite/4.20.0-4000805+++Fortnite+Release-3.5 Windows/10.0.17134.1.256.64bit";
const agent33 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-3.3-CL-3942182";
const mcp = (backend, player, userAgent, command, profileId, body = {}, rvn = -1) => {
  const text = JSON.stringify(body);
  return send({ host: "127.0.0.1", port: backend.port, method: "POST",
    path: `/fortnite/api/game/v2/profile/${player.accountId}/client/${command}?profileId=${profileId}&rvn=${rvn}`,
    headers: { "User-Agent": userAgent, Authorization: `bearer ${player.token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
};
const fullOf = (body) => body.profileChanges[0].profile;
const mtx = (profile) => Object.values(profile.items).filter((item) => /^currency:mtx/i.test(item.templateId))
  .reduce((sum, item) => sum + item.quantity, 0);
const ofType = (profile, type) => Object.values(profile.items).filter((item) => item.templateId.toLowerCase().startsWith(`${type.toLowerCase()}:`));
const setVbucks = (backend, player, quantity) => post(backend.port, `/admin/api/accounts/${player.accountId}/currency`, undefined, { key: "vbucks", quantity });

test("3.5.1 asks for common_core and common_public and gets them; profile0 is 3.3's and earlier builds' only", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Profiles351");
    for (const profileId of ["common_public", "common_core", "campaign", "athena", "metadata"]) {
      const response = await mcp(backend, player, agent351, "QueryProfile", profileId);
      assert.equal(response.status, 200, profileId);
      assert.equal(response.body.profileId, profileId);
      assert.equal(response.body.profileChanges[0].changeType, "fullProfileUpdate");
    }
    const profile0 = await mcp(backend, player, agent351, "QueryProfile", "profile0");
    assert.equal(profile0.status, 400);
    assert.equal(profile0.body.errorCode, "errors.com.epicgames.modules.profiles.invalid_profile_id");
    for (const profileId of ["common_core", "common_public", "campaign"]) {
      assert.equal((await mcp(backend, player, agent33, "QueryProfile", profileId)).status, 400, `3.3 has no ${profileId}`);
    }

    // Each holds its part of the account: common_public the three stats other players read, common_core the account's
    // banners and platform, campaign Save the World's (quests, heroes, rest XP, the homebase).
    const pub = fullOf((await mcp(backend, player, agent351, "QueryProfile", "common_public")).body);
    assert.deepEqual(Object.keys(pub.stats.attributes).sort(), ["banner_color", "banner_icon", "homebase_name"]);
    assert.deepEqual(pub.items, {});
    const core = fullOf((await mcp(backend, player, agent351, "QueryProfile", "common_core")).body);
    assert.ok(ofType(core, "HomebaseBannerIcon").length && ofType(core, "HomebaseBannerColor").length);
    assert.equal(core.stats.attributes.current_mtx_platform, "Epic");
    assert.ok(Object.values(core.items).every((item) => itemView(item.templateId) === "common_core"));
    const campaign = fullOf((await mcp(backend, player, agent351, "QueryProfile", "campaign")).body);
    assert.ok(ofType(campaign, "Quest").length && ofType(campaign, "Quota").length);
    assert.equal(ofType(campaign, "HomebaseBannerIcon").length, 0);
    assert.equal(campaign.stats.attributes.current_mtx_platform, undefined);
    assert.ok(campaign.stats.attributes.homebase);
    assert.equal(itemView("Token:campaignaccess"), "common_core");
    assert.equal(itemView("Token:homebasepoints"), "campaign");
    assert.equal(itemView("GiftBox:gb_battlepass"), "common_core");
  } finally {
    backend.close();
  }
});

test("3.5.1's V-Bucks are common_core's, and a change brings only the view it is in, by that view's revision", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Vbucks351");
    const login = (await mcp(backend, player, agent351, "QueryProfile", "common_core")).body;
    assert.equal((await setVbucks(backend, player, 1500)).status, 200);
    assert.equal(mtx(fullOf((await mcp(backend, player, agent351, "QueryProfile", "common_core")).body)), 1500);
    const campaignLogin = (await mcp(backend, player, agent351, "QueryProfile", "campaign")).body;
    assert.equal(mtx(fullOf(campaignLogin)), 0);

    // A command on common_core from its revision gets its delta, a revision on; campaign's revision stays.
    const core = (await mcp(backend, player, agent351, "QueryProfile", "common_core")).body;
    const platform = (await mcp(backend, player, agent351, "SetMtxPlatform", "common_core", { newPlatform: "PSN" }, core.profileRevision)).body;
    assert.equal(platform.profileChangesBaseRevision, core.profileRevision);
    assert.equal(platform.profileRevision, core.profileRevision + 1);
    assert.deepEqual(platform.profileChanges, [{ changeType: "statModified", name: "current_mtx_platform", value: "PSN" }]);
    assert.equal(platform.multiUpdate, undefined, "nothing of campaign changed");
    const campaign = (await mcp(backend, player, agent351, "QueryProfile", "campaign", {}, campaignLogin.profileRevision)).body;
    assert.equal(campaign.profileRevision, campaignLogin.profileRevision);
    assert.deepEqual(campaign.profileChanges, []);
    assert.ok(core.profileRevision > login.profileRevision);

    // In Battle Royale the client asks for athena alone after a match (#236): the V-Bucks come along as common_core,
    // never as profile0.
    await mcp(backend, player, agent351, "QueryProfile", "athena");
    assert.equal((await setVbucks(backend, player, 2000)).status, 200);
    const athena = (await mcp(backend, player, agent351, "QueryProfile", "athena")).body;
    const ids = (athena.multiUpdate ?? []).map(({ profileId }) => profileId);
    assert.deepEqual(ids, ["common_core"]);
    assert.equal(mtx(fullOf(athena.multiUpdate[0])), 2000);
  } finally {
    backend.close();
  }
});

// Core-Backend #247: 3.5.1 sets its MTX platform to EpicPC at login and logged out on "Unknown platform EpicPC". 3.5
// counts the V-Bucks items whose platform is Shared or the account's wallet (EpicPC, or EpicPCKorea; 3.5.1 0xDFA5E0),
// so common_core shows Core's "Epic" ones as Shared; profile0 keeps them "Epic" for the builds before.
const spendable351 = (profile, wallet = "EpicPC") => Object.values(profile.items)
  .filter((item) => /^currency:mtx/i.test(item.templateId) && ["Shared", wallet].includes(item.attributes.platform))
  .reduce((sum, item) => sum + item.quantity, 0);

test("3.5.1 sets EpicPC and its other MTX platforms, and its V-Bucks count for its wallet; 3.3's stay Epic", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "EpicPC351");
    const login = (await mcp(backend, player, agent351, "QueryProfile", "common_core")).body;
    const platform = await mcp(backend, player, agent351, "SetMtxPlatform", "common_core", { newPlatform: "EpicPC" }, login.profileRevision);
    assert.equal(platform.status, 200);
    assert.deepEqual(platform.body.profileChanges, [{ changeType: "statModified", name: "current_mtx_platform", value: "EpicPC" }]);
    for (const newPlatform of ["Shared", "EpicPCKorea", "IOSAppStore", "EpicAndroid", "Live", "EpicPC"]) {
      assert.equal((await mcp(backend, player, agent351, "SetMtxPlatform", "common_core", { newPlatform })).status, 200, newPlatform);
    }
    assert.equal((await mcp(backend, player, agent351, "SetMtxPlatform", "common_core", { newPlatform: "Steam" })).status, 400);

    assert.equal((await setVbucks(backend, player, 1200)).status, 200);
    const core = fullOf((await mcp(backend, player, agent351, "QueryProfile", "common_core")).body);
    assert.equal(core.stats.attributes.current_mtx_platform, "EpicPC");
    assert.equal(spendable351(core), 1200);
    assert.equal(spendable351(core, "EpicPCKorea"), 1200);

    // 3.3 (and every build before 3.5) is served profile0 as saved: the same V-Bucks, tagged Epic, once each.
    const profile0 = fullOf((await mcp(backend, player, agent33, "QueryProfile", "profile0")).body);
    const currency = Object.values(profile0.items).filter((item) => /^currency:mtx/i.test(item.templateId));
    assert.equal(mtx(profile0), 1200);
    assert.ok(currency.every((item) => item.attributes.platform === "Epic"));
  } finally {
    backend.close();
  }
});

test("V-Bucks given while a 3.5.1 client holds its common_core come in its delta as Shared, and stay Epic in profile0", () => {
  const item = { templateId: "Currency:MtxGiveaway", attributes: { platform: "Epic" }, quantity: 300 };
  const profile = { stats: { attributes: {} }, items: { held: structuredClone(item) } };
  const tracker = trackChanges(profile);
  tracker.addItem("given", structuredClone(item));
  tracker.setItemAttribute("held", "platform", "Epic");
  tracker.setQuantity("held", 500);
  const changes = viewChanges(tracker.changes, "common_core", profile, changeTemplate);
  assert.deepEqual(changes.map((change) => change.changeType), ["itemAdded", "itemAttrChanged", "itemQuantityChanged"]);
  assert.equal(changes[0].item.attributes.platform, "Shared");
  assert.equal(changes[1].attributeValue, "Shared");
  assert.equal(changes[2].quantity, 500);
  assert.equal(profile.items.given.attributes.platform, "Epic");
  assert.equal(profile.items.held.attributes.platform, "Epic");
  const view = viewProfile({ version: "", wipeNumber: 1, stats: profile.stats, items: profile.items }, "common_core");
  assert.equal(spendable351(view), 800);
  assert.equal(profile.items.given.attributes.platform, "Epic");
});

test("an account that played 3.3 has the same V-Bucks, banners and homebase on 3.5.1, and the other way round", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Carried33");
    const on33 = fullOf((await mcp(backend, player, agent33, "QueryProfile", "profile0")).body);
    const [icon] = ofType(on33, "HomebaseBannerIcon").map(({ templateId }) => templateId.split(":")[1]);
    const [, color] = ofType(on33, "HomebaseBannerColor").map(({ templateId }) => templateId.split(":")[1]);
    assert.equal((await mcp(backend, player, agent33, "SetHomebaseName", "profile0", { homebaseName: "Fort Pongo" })).status, 200);
    assert.equal((await mcp(backend, player, agent33, "SetHomebaseBanner", "profile0", { homebaseBannerIconId: icon, homebaseBannerColorId: color })).status, 200);
    await setVbucks(backend, player, 950);
    const before = fullOf((await mcp(backend, player, agent33, "QueryProfile", "profile0")).body);

    const pub = fullOf((await mcp(backend, player, agent351, "QueryProfile", "common_public")).body);
    assert.deepEqual(pub.stats.attributes, { banner_icon: icon, banner_color: color, homebase_name: "Fort Pongo" });
    const core = fullOf((await mcp(backend, player, agent351, "QueryProfile", "common_core")).body);
    assert.equal(mtx(core), 950);
    assert.deepEqual(ofType(core, "HomebaseBannerIcon").map(({ templateId }) => templateId).sort(),
      ofType(before, "HomebaseBannerIcon").map(({ templateId }) => templateId).sort());
    const campaign = fullOf((await mcp(backend, player, agent351, "QueryProfile", "campaign")).body);
    assert.equal(Object.keys(campaign.items).length + Object.keys(core.items).length, Object.keys(before.items).length, "every item is in one view");

    // 3.5.1's homebase name is common_public's command, and its change is that view's three stats.
    const renamed = (await mcp(backend, player, agent351, "SetHomebaseName", "common_public", { homebaseName: "Storm Base" })).body;
    assert.equal(renamed.profileId, "common_public");
    assert.equal(fullOf(renamed).stats.attributes.homebase_name, "Storm Base");
    const pubNow = (await mcp(backend, player, agent351, "QueryProfile", "common_public")).body;
    const named = (await mcp(backend, player, agent351, "SetHomebaseName", "common_public", { homebaseName: "Storm Base 2" }, pubNow.profileRevision)).body;
    assert.deepEqual(named.profileChanges.find(({ name }) => name === "homebase_name"), { changeType: "statModified", name: "homebase_name", value: "Storm Base 2" });
    assert.ok((named.multiUpdate ?? []).some(({ profileId }) => profileId === "campaign"), "campaign's homebase follows");

    // Back on 3.3, profile0 is all of it.
    const back = fullOf((await mcp(backend, player, agent33, "QueryProfile", "profile0")).body);
    assert.equal(back.stats.attributes.homebase.townName, "Storm Base 2");
    assert.equal(mtx(back), 950);
  } finally {
    backend.close();
  }
});

test("3.3 still uses profile0: its responses name no 3.5 profile", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Still33");
    const login = (await mcp(backend, player, agent33, "QueryProfile", "profile0")).body;
    assert.equal(login.profileId, "profile0");
    const athena = (await mcp(backend, player, agent33, "QueryProfile", "athena")).body;
    await setVbucks(backend, player, 300);
    const after = (await mcp(backend, player, agent33, "QueryProfile", "athena", {}, athena.profileRevision)).body;
    assert.deepEqual((after.multiUpdate ?? []).map(({ profileId }) => profileId), ["profile0"]);
    const quests = (await mcp(backend, player, agent33, "ClientQuestLogin", "profile0", {}, login.profileRevision)).body;
    assert.ok([quests, ...(quests.multiUpdate ?? [])].every(({ profileId }) => !isAccountView(profileId)));
  } finally {
    backend.close();
  }
});

test("profile notifications name 3.5's views for an account whose client is 3.5.1", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-views-"));
  try {
    const profiles = createProfileStore(dataDir);
    noteClientBuild("viewer351", v351);
    noteClientBuild("viewer33", v33);
    const changed = (accountId) => {
      const session = openSession(profiles, accountId);
      session.profile("profile0");
      session.commit();
      const next = openSession(profiles, accountId);
      next.profile("profile0").setStat("current_mtx_platform", "Live");
      next.commit();
      return next.changedProfiles().map(({ profileId, changes }) => [profileId, changes.length]);
    };
    assert.deepEqual(changed("viewer351"), [["common_core", 1]]);
    assert.deepEqual(changed("viewer33"), [["profile0", 1]]);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

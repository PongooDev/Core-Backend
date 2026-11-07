import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { rollContents } from "../src/cardpacks/contents.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { contentUpdateStates, lootHotfixSection } from "../src/events/contentupdates.js";
import { activeEventFlags, activeMiniBosses, blockbuster2018, blockbuster2018Phase1, configureEvents, groupMission, isEventActive, lobbySeason4,
  passiveStorms } from "../src/events/events.js";
import { hasLtm, inOriginalWindow, ltmNewMode, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, ltms } from "../src/events/ltms.js";
import { meteorStrikePhase, meteorStrikeRows } from "../src/events/meteorstrike.js";
import { athenaChallengeBundles, athenaCosmetics, athenaLootTables, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { playlistTeamsOf } from "../src/matchmaking/service.js";
import { mtxProfileId, usesCommonProfiles } from "../src/profiles/common.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { eventStoreInstanceNow, eventStoreOffers, hasEventStore } from "../src/store/eventstore.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { hasRefunds } from "../src/store/refunds.js";
import { missionRewardQuantity, worldInfo } from "../src/world/theaters.js";

// Fortnite 4.2 (++Fortnite+Release-4.2-CL-4072250, UE 4.20, 16 May 2018): its own data (gamedata/4072250) and Season 4 as
// 4.0's.
const v42 = "4072250";
const v41 = "4053532";
const v40 = "4039451";
const now = new Date("2026-11-06T12:00:00Z");
const new42 = ["AthenaBackpack:bid_050_hazmat", "AthenaBackpack:bid_051_merman", "AthenaBackpack:bid_052_hazmatfemale",
  "AthenaCharacter:cid_127_athena_commando_m_hazmat", "AthenaCharacter:cid_128_athena_commando_f_hazmat", "AthenaCharacter:cid_129_athena_commando_m_deco",
  "AthenaCharacter:cid_130_athena_commando_m_merman", "AthenaCharacter:cid_131_athena_commando_m_warpaint", "AthenaDance:eid_bendy",
  "AthenaDance:eid_clapperboard", "AthenaDance:eid_popdance01", "AthenaDance:eid_yeet", "AthenaGlider:glider_id_037_hazmat",
  "AthenaGlider:glider_id_038_deco", "AthenaPickaxe:pickaxe_id_052_hazmat", "AthenaPickaxe:pickaxe_id_053_deco", "AthenaPickaxe:pickaxe_id_054_filmcamera", "AthenaPickaxe:pickaxe_id_055_stop"];

test("4.2 is known by its version, plays on its own data and is Season 4's newest", () => {
  assert.equal(versionOf(v42), "4.2");
  assert.equal(dataBuild(v42), v42);
  assert.equal(dataBuild(v41), v41);
  assert.ok(buildChoices().includes(v42));
  assert.equal(allowedBuildList(["4.2"]).join(), v42);
  const season = inBuild(v42, athenaSeason);
  assert.deepEqual(season, inBuild(v40, athenaSeason), "4.2 keeps 4.0's AthenaSeason4");
  assert.equal(buildOfSeason(4), v42);
  assert.equal(seasonName(4), "Season 4 (4.0 – 4.2)");
});

test("4.2's data: eighteen new cosmetics, the revised weekly challenges, the Burst AR and Apples", () => {
  const cosmetics42 = inBuild(v42, athenaCosmetics);
  const cosmetics41 = inBuild(v41, athenaCosmetics);
  assert.deepEqual(Object.keys(cosmetics42).filter((id) => !cosmetics41[id]).sort(), [...new42].sort());
  assert.deepEqual(new42.slice(3, 8).map((id) => cosmetics42[id].name), ["Toxic Trooper", "Hazard Agent", "Venturion", "Moisty Merman", "Bandolier"]);
  // The Blockbuster loading screens get their names.
  assert.deepEqual(["AthenaLoadingScreen:lsid_011_s4cumulative3", "AthenaLoadingScreen:lsid_012_s4cumulative4"].map((id) => [cosmetics41[id].name, cosmetics42[id].name]),
    [["Blockbuster #3", "A Looming Threat"], ["Blockbuster #4", "Retribution"]]);
  // Week 9's bundle is 4.2's: its Use a Jetpack challenge, the Content Update's item.
  const week9 = inBuild(v42, athenaChallengeBundles).questbundle_s4_week_009.quests.map(({ quest }) => quest);
  assert.ok(week9.includes("quest_br_use_jetpack"));
  const loot = inBuild(v42, athenaLootTables)["/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client"];
  assert.equal(loot["WorldList.AthenaLoot.Weapon.Assault.05"].Weight, 0.075, "the Epic Burst AR on the floor");
  assert.equal(loot["WorldList.AthenaHighConsumables.12"].Weight, 0.315, "Impulse Grenade +5%");
  assert.ok(loot["WorldList.ForagedItems.Grassland.01"].ItemDefinition.includes("Athena_Foraged_HealthSmall"), "Apples");
  // Save the World: the perk resources (4.1's paks have them unnamed: PP.Generic...), their card packs, the scaled Storm
  // Shield Mini Llamas, schematic rarity upgrades.
  assert.deepEqual(["AccountResource:reagent_alteration_generic", "AccountResource:reagent_alteration_upgrade_r", "AccountResource:reagent_alteration_ele_fire",
    "AccountResource:reagent_alteration_ele_nature", "AccountResource:reagent_alteration_ele_water"].map((id) => [inBuild(v41, () => getItem(id)).name, inBuild(v42, () => getItem(id)).name]),
  [["PP.Generic", "RE-PERK!"], ["PP.Upgrade.R", "Rare PERK-UP!"], ["PP.Ele.Fire", "FIRE-UP!"], ["PP.Ele.Nature", "AMP-UP!"], ["PP.Ele.Water", "FROST-UP!"]]);
  for (const id of ["CardPack:zcp_reagent_alteration_generic_low", "CardPack:zcp_voucher_basicpack_outpost_theater4"]) {
    assert.ok(inBuild(v42, () => getItem(id)), id);
    assert.equal(inBuild(v41, () => getItem(id)), undefined, id);
  }
  assert.ok(inBuild(v42, () => getItem("Schematic:sid_blunt_light_c_ore_t01")).rarityUpgrade);
  const world = (build) => buildGameData(build, "world", {});
  assert.deepEqual(world(v42).missionAlerts, world(v41).missionAlerts, "4.2's paks name no MissionAlerts: 4.1's (4.0's) rows");
});

test("4.2's shop is Season 4's with 4.2's cosmetics, which 4.1 doesn't sell", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season4.json", import.meta.url), "utf8")).days;
  const cosmetics = inBuild(v42, athenaCosmetics);
  for (const day of history) for (const [templateId] of [...day.featured, ...day.daily]) assert.ok(cosmetics[templateId], `${day.date} ${templateId}`);
  const sold = new Set(history.flatMap((day) => [...day.featured, ...day.daily].map(([templateId]) => templateId)));
  assert.deepEqual(new42.filter((id) => sold.has(id)).length, 15, "the back blings weren't sold on their own");
  const may21 = history.find(({ date }) => date === "2018-05-21");
  assert.deepEqual(may21.featured, [["AthenaCharacter:cid_129_athena_commando_m_deco", 1500],
    ["AthenaPickaxe:pickaxe_id_053_deco", 800, { tile: 1, banner: "CollectTheSet" }], ["AthenaGlider:glider_id_038_deco", 500, { tile: 1, banner: "CollectTheSet" }]]);
  // 17 May is the season's day 17: Star Power on 4.2 only.
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 4: "2026-10-21" } };
  const daily = (build) => inBuild(build, () => itemShopOffers(now, config)).BRDailyStorefront.map(({ templateId }) => templateId);
  assert.ok(daily(v42).includes("AthenaDance:eid_popdance01"));
  assert.ok(!daily(v41).includes("AthenaDance:eid_popdance01"));
  assert.deepEqual(daily(v42).filter((templateId) => templateId !== "AthenaDance:eid_popdance01"), daily(v41));
});

test("4.2's event flags are 4.1's and the group missions': Blockbuster Part 1, active Mini-Bosses, passive storms and the Season 4 lobby", () => {
  assert.deepEqual(activeEventFlags(v42), [groupMission, blockbuster2018Phase1, activeMiniBosses, passiveStorms, lobbySeason4]);
  assert.ok(!activeEventFlags(v41).includes(groupMission));
  assert.ok(!activeEventFlags(v42).includes("EventFlag.Blockbuster2018Phase2"), "Part 2 is 30 May's");
  assert.equal(inBuild(v42, () => isEventActive(blockbuster2018)), true);
});

test("4.2's Event Store: the Quad Launcher in the Weekly Store, the HackSAW back in the event items, perk resources weekly", () => {
  const quad = "Schematic:sid_explosive_launcher_military_sr_ore_t01";
  const hackSaw = "Schematic:sid_assault_lmg_military_sr_ore_t01";
  assert.equal(inBuild(v42, hasEventStore), true);
  assert.equal(inBuild(v42, eventStoreInstanceNow), "Blockbuster2018.STWSpecialEventStoreFront");
  const offers = (build) => inBuild(build, () => eventStoreOffers(now));
  const ids = (list) => list.map(({ templateId }) => templateId);
  const o42 = offers(v42);
  const weekly = o42.STWRotationalEventStorefront;
  assert.deepEqual(ids(weekly).slice(0, 1), [quad]);
  assert.deepEqual([weekly[0].price, weekly[0].eventLimit], [1680, 1]);
  assert.ok(!ids(o42.STWSpecialEventStoreFront).includes(quad));
  assert.ok(ids(o42.STWSpecialEventStoreFront).includes(hackSaw));
  assert.equal(o42.STWSpecialEventStoreFront.length, 14);
  const perks = ["AccountResource:reagent_alteration_generic", "AccountResource:reagent_alteration_upgrade_uc", "AccountResource:reagent_alteration_upgrade_r",
    "AccountResource:reagent_alteration_upgrade_vr", "AccountResource:reagent_alteration_upgrade_sr"];
  for (const id of perks) assert.ok(ids(weekly).includes(id), id);
  const weekly41 = ids(offers(v41).STWRotationalEventStorefront);
  assert.ok(weekly41.includes(hackSaw) && !weekly41.includes(quad));
  for (const id of perks) assert.ok(!weekly41.includes(id), `4.1 sells no ${id}`);
});

test("4.2's LTMs: 4.1's but Impact, and Solo Showdown, Close Encounters and Solid Gold v2 Duos; no new mode", () => {
  const none = { matchmakingModes: {} };
  for (const ltm of ltms.filter((candidate) => hasLtm(candidate.id, v41))) {
    assert.equal(hasLtm(ltm.id, v42), !ltm.id.startsWith("impact"), ltm.id);
  }
  assert.equal(ltmNewMode(v42, none), null);
  assert.equal(ltmOn("infinityGauntlet", v42, none), false, "by its switch on 4.2");
  assert.equal(ltmOn("infinityGauntlet", v42, { matchmakingModes: { infinityGauntlet: true } }), true);
  // Playground (#279): 4.2's paks have Playlist_Playground, so the panel's switch offers it there (4.1's don't).
  assert.equal(hasLtm("playground", v42), true);
  assert.equal(ltmOn("playground", v42, { matchmakingModes: { playground: true } }), true);
  assert.equal(ltmOn("playground", v42, none), false);
  assert.ok(ltmPlaylistOverrides(v42, { matchmakingModes: { playground: true } }).includes("Playlist_Playground"));
  const playlists = { soloShowdown: [51, "Playlist_Comp_Solo", 1], closeEncountersSolo: [44, "Playlist_Close_Solo", 1],
    closeEncountersDuos: [45, "Playlist_Close_Duos", 2], closeEncounters: [46, "Playlist_Close_Squad", 4], solidGoldDuos: [34, "Playlist_SolidGold_Duos", 2] };
  for (const [id, [playlistId, name, size]] of Object.entries(playlists)) {
    assert.equal(hasLtm(id, v42), true, id);
    assert.equal(hasLtm(id, v41), false, id);
    assert.equal(ltmOfPlaylist(playlistId, v42).id, id);
    assert.deepEqual(playlistTeamsOf(`${v42}:0:NA:${playlistId}`, v42), { maxTeamCount: 100, maxTeamSize: size, maxSquadSize: size }, id);
    assert.ok(ltmPlaylistOverrides(v42, { matchmakingModes: { [id]: true } }).includes(name), id);
  }
  // 44 to 46 are still Impact on 4.1.
  assert.equal(ltmOfPlaylist(44, v41).id, "impactSolo");
  // Original dates on Season 4's replay from its own first day: the Gauntlet to 16 May, Solo Showdown 17 to 21 May, Solid
  // Gold v2 (Duos too) from 22 May, Close Encounters on 25 May, 50v50 v2 again from 22 May.
  configureEvents({ mode: "auto", seasonStarts: { 4: "2018-05-01" } });
  try {
    const dated = { ltmOriginalDates: true, matchmakingModes: {} };
    const at = (date) => new Date(`${date}T12:00:00Z`);
    for (const [id, inside, outside] of [["infinityGauntlet", "2018-05-16", "2018-05-17"], ["soloShowdown", "2018-05-17", "2018-05-22"],
      ["soloShowdown", "2018-05-21", "2018-05-16"], ["solidGoldDuos", "2018-05-22", "2018-05-21"], ["closeEncountersSolo", "2018-05-25", "2018-05-26"],
      ["fiftyFiftyV2", "2018-05-22", "2018-05-21"]]) {
      assert.equal(ltmOn(id, v42, dated, at(inside)), true, `${id} ${inside}`);
      assert.equal(ltmOn(id, v42, dated, at(outside)), false, `${id} ${outside}`);
    }
    assert.equal(inOriginalWindow("solidGoldDuos", v42, at("2018-05-25"), dated), false, "Close Encounters' day");
    assert.equal(inOriginalWindow("soloShowdown", v41, at("2018-05-18"), dated), false);
  } finally {
    configureEvents(null);
  }
});

test("4.2 keeps 4.1's gates: common profiles, returns, no content update or curve RowUpdate", () => {
  assert.equal(inBuild(v42, () => usesCommonProfiles()), true);
  assert.equal(inBuild(v42, () => mtxProfileId()), "common_core");
  assert.equal(hasRefunds(v42), true);
  assert.deepEqual(inBuild(v42, () => contentUpdateStates(now)), []);
  assert.equal(meteorStrikePhase(v42), null);
  assert.deepEqual(meteorStrikeRows(v42), []);
  assert.equal(inBuild(v42, () => lootHotfixSection(now, null, [], meteorStrikeRows(v42), v42)), "");
});

// Core-Backend #277: 4.2's map had no group mission alerts and no Elemental Storm alerts.
test("4.2's mission alerts: every group mission has one, and Elemental Storm alerts from Plankerton (#277)", () => {
  const alertsOf = (build) => inBuild(build, () => worldInfo(now)).missionAlerts.flatMap(({ theaterId, availableMissionAlerts }) =>
    availableMissionAlerts.map((alert) => ({ ...alert, theaterId })));
  const alerts42 = alertsOf(v42);
  const alerts41 = alertsOf(v41);
  const group = alerts42.filter(({ categoryName }) => categoryName === "GroupMissionCategory");
  assert.ok(group.length > 0);
  assert.ok(!alerts41.some(({ categoryName }) => categoryName === "GroupMissionCategory"));
  for (const alert of group) {
    assert.deepEqual(alert.missionAlertRewards.items.map(({ itemType, quantity }) => [itemType.replace(/t0\d/, "t0N"), quantity]),
      [["CardPack:zcp_reagent_c_t0N_high", 2]], "the zone's evolution materials, no Firecracker Tickets");
  }
  const missions = inBuild(v42, () => worldInfo(now)).missions.flatMap(({ availableMissions }) => availableMissions);
  for (const alert of group) {
    const mission = missions.find((candidate) => candidate.tileIndex === alert.tileIndex && /_Group(_PVE02on)?\./.test(candidate.missionGenerator));
    assert.ok(mission, "on a group mission");
  }
  const elements = { ElemementalZoneFireCategory: ["fire", "elementalzonefireenableitem"], ElemementalZoneNatureCategory: ["nature", "elementalzonenatureenableitem"],
    ElemementalZoneWaterCategory: ["water", "elementalzonewaterenableitem"] };
  for (const [category, [element, modifier]] of Object.entries(elements)) {
    const ofElement = alerts42.filter(({ categoryName }) => categoryName === category);
    assert.equal(ofElement.length, 3, `${category}: Plankerton, Canny Valley and Twine Peaks`);
    for (const alert of ofElement) {
      assert.deepEqual(alert.missionAlertModifiers.items, [{ itemType: `GameplayModifier:${modifier}`, quantity: 1 }]);
      const [reward] = alert.missionAlertRewards.items;
      assert.equal(reward.itemType, `AccountResource:reagent_alteration_ele_${element}`);
      assert.ok([30, 40, 50].includes(reward.quantity));
    }
    assert.ok(!alerts41.some(({ categoryName }) => categoryName === category));
  }
  // None in Stonewood's theater (elemental husks are Plankerton's and up).
  const stonewood = inBuild(v42, () => worldInfo(now)).theaters.find((theater) => (theater.runtimeInfo.theaterTags?.gameplayTags ?? [])
    .some(({ tagName }) => tagName === "Stat.Theater.PvE01"));
  if (stonewood) assert.ok(!alerts42.some(({ theaterId, categoryName }) => theaterId === stonewood.uniqueId && /Elemem/.test(categoryName)));
});

// Core-Backend #273: "Mini Llama rewards now scale for Storm Shield Defenses ... Stonewood: 1 to 4, Plankerton: 2 to 5,
// Canny Valley: 3 to 6, Twine Peaks: 4 to 7".
test("4.2's storm shield defenses give their zone's Mini Llamas: 1 to 4, 2 to 5, 3 to 6, 4 to 7 (#273)", () => {
  const outposts = (build) => inBuild(build, () => worldInfo(now)).missions.flatMap(({ availableMissions }) => availableMissions)
    .filter(({ missionRewards }) => /^Outpost_Select_Theater\d$/.test(missionRewards.tierGroupName));
  const defenses42 = outposts(v42);
  assert.ok(defenses42.length > 0);
  for (const { missionRewards } of defenses42) {
    const theater = missionRewards.tierGroupName.at(-1);
    assert.ok(missionRewards.items.some(({ itemType }) => itemType === `CardPack:zcp_voucher_basicpack_outpost_theater${theater}`), missionRewards.tierGroupName);
    assert.ok(!missionRewards.items.some(({ itemType }) => itemType === "CardPack:zcp_voucher_basicpack"));
  }
  for (const { missionRewards } of outposts(v41)) {
    assert.ok(!missionRewards.items.some(({ itemType }) => /voucher_basicpack_outpost/.test(itemType)), "4.1 keeps the plain pack");
  }
  const llamas = (theater) => [1, 2, 3, 4, 5, 6].map((level) => missionRewardQuantity(`CardPack:zcp_voucher_basicpack_outpost_theater${theater}`, 1, level));
  assert.deepEqual([1, 2, 3, 4].map(llamas), [[1, 2, 3, 4, 4, 4], [2, 3, 4, 5, 5, 5], [3, 4, 5, 6, 6, 6], [4, 5, 6, 7, 7, 7]]);
  assert.equal(missionRewardQuantity("CardPack:zcp_voucher_basicpack", 1, 5), 5, "the plain pack still goes by the chest");
  assert.equal(missionRewardQuantity("CardPack:zcp_heroxp_outpost_theater2", 1, 3), 3);
  // Each pack is one Mini Reward Llama voucher.
  for (const theater of [1, 4]) {
    assert.deepEqual(inBuild(v42, () => rollContents(`CardPack:zcp_voucher_basicpack_outpost_theater${theater}`)).map(({ templateId, quantity }) => [templateId, quantity]),
      [["AccountResource:voucher_basicpack", 1]]);
  }
});

// Core-Backend #272: "Updated Mission Rewards and Mini-Boss Mission Alerts to sometimes award RE-PERK and PERK-UP as
// secondary loot rewards, beginning in early Plankerton".
test("4.2's missions from Plankerton and its Mini-Boss alerts sometimes give RE-PERK! and PERK-UP! (#272)", () => {
  const perk = /^CardPack:zcp_reagent_alteration_/;
  const missionsOf = (build) => inBuild(build, () => worldInfo(now)).missions.flatMap(({ availableMissions }) => availableMissions);
  const tierOf = ({ missionRewards }) => Number(/^Mission_Select_(?:Group_)?T(\d\d)$/.exec(missionRewards.tierGroupName)?.[1] ?? 0);
  const missions42 = missionsOf(v42);
  const withPerks = missions42.filter(({ missionRewards }) => missionRewards.items.some(({ itemType }) => perk.test(itemType)));
  assert.ok(withPerks.length > 0, "some missions give perk resources");
  assert.ok(withPerks.length < missions42.filter((mission) => tierOf(mission) >= 6).length, "only sometimes");
  for (const mission of withPerks) assert.ok(tierOf(mission) >= 6, mission.missionRewards.tierGroupName);
  assert.ok(!missionsOf(v41).some(({ missionRewards }) => missionRewards.items.some(({ itemType }) => perk.test(itemType))), "not on 4.1");
  // Each zone's PERK-UP!: Uncommon in Plankerton, Legendary only in Twine Peaks.
  for (const mission of withPerks) {
    for (const { itemType } of mission.missionRewards.items.filter(({ itemType }) => /upgrade_/.test(itemType))) {
      const rarity = itemType.split("_").at(-1);
      const tier = tierOf(mission);
      assert.ok(tier <= 10 ? rarity === "uc" : tier <= 15 ? ["uc", "r", "vr"].includes(rarity) : ["vr", "sr"].includes(rarity), `${tier} ${rarity}`);
    }
  }
  // The perk packs open to their resources.
  const opened = (id) => inBuild(v42, () => rollContents(id)).map(({ templateId, quantity }) => [templateId, quantity]);
  assert.deepEqual(opened("CardPack:zcp_reagent_alteration_generic_low"), [["AccountResource:reagent_alteration_generic", 10]]);
  assert.deepEqual(opened("CardPack:zcp_reagent_alteration_generic_veryhigh"), [["AccountResource:reagent_alteration_generic", 30]]);
  assert.deepEqual(opened("CardPack:zcp_reagent_alteration_upgrade_sr"), [["AccountResource:reagent_alteration_upgrade_sr", 10]]);
  // Mini-Boss alerts from Plankerton carry one perk pack; Stonewood's don't.
  const miniBosses = inBuild(v42, () => worldInfo(now)).missionAlerts.flatMap(({ availableMissionAlerts }) => availableMissionAlerts)
    .filter(({ categoryName }) => categoryName === "MiniBossCategory");
  const perked = miniBosses.filter(({ missionAlertRewards }) => missionAlertRewards.items.some(({ itemType }) => perk.test(itemType)));
  assert.ok(perked.length > 0 && perked.length < miniBosses.length);
  for (const { missionAlertRewards } of perked) assert.equal(missionAlertRewards.items.filter(({ itemType }) => perk.test(itemType)).length, 1);
});

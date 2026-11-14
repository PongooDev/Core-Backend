import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { cramSessionEventItems, cramSessionQuests } from "../src/events/cramsession2018.js";
import { cubeStates } from "../src/events/cube.js";
import { activeEventFlags, activeMiniBosses, configureEvents, cramSession2018, isEventActive, islandMoveTo, islandRune, lobbySeason6,
  passiveStorms } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { islandStates } from "../src/events/island.js";
import { hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, playlistIdOfName } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaLootTables, athenaSeason, athenaVariantTokens,
  getAthenaQuest } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { dataBuild } from "../src/gamedata/read.js";
import { customMatchOptionsOf, customMatchOptionsText, parseBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { battlePassPurchaseGiftBox } from "../src/profiles/giftboxes.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { subgameSelectImages, subgameSelectImagesFor } from "../src/services/content/pages.js";
import { playlistInformationFor } from "../src/services/content/playlistimages.js";
import { stwMfaRewardOffered, stwMfaRewards } from "../src/services/mcp/commands/ClaimMfaEnabled.js";
import { createSettingsStore } from "../src/settings/store.js";
import { eventStoreEnds, eventStoreOffers, eventStorefront, weeklyStorefront } from "../src/store/eventstore.js";
import { bundledBackBlings, itemShopOffers, seasonEnd } from "../src/store/itemshop.js";
import { worldInfo } from "../src/world/theaters.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Fortnite 6.01 (Update v6.01, 3 October 2018, Season 6): CL-4424678 ("6.01", the owner's build, on its own data,
// gamedata/4424678) and CL-4417689 ("6.01.0", the earlier one, whose paks Core has no copy of, on CL-4424678's). It keeps
// 6.00's Season 6 (Battle Pass, styles, floating island, Cram Session, matchmaking) and adds the Chiller, eleven
// cosmetics, Playground's custom options and, in its paks ahead of Update v6.02, Disco Domination.
const v601 = "4424678";
const v6010 = "4417689";
const v600 = "4402180";
const v541 = "4363240";
const builds601 = [v6010, v601];
// Season 6's replay from its real first day, so the replay's dates are Epic's.
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
const agentOf = (build) => `Fortnite/++Fortnite+Release-6.01-CL-${build} Windows/10.0.19045.1.256.64bit`;

test("6.01's two changelists are known, both play on CL-4424678's data, Season 6's", () => {
  assert.equal(versionOf(v601), "6.01");
  assert.equal(versionOf(v6010), "6.01.0");
  for (const build of builds601) {
    assert.equal(dataBuild(build), v601, build);
    assert.ok(buildChoices().includes(build), build);
    const season = inBuild(build, athenaSeason);
    assert.deepEqual([season.seasonNumber, season.numSeasonLevels, season.numBookLevels, season.storefront], [6, 100, 100, "BRSeason6"]);
    assert.deepEqual(season.firstWinRewards, [{ quantity: 1, templateId: "AthenaGlider:umbrella_season_06" }]);
  }
  assert.equal(allowedBuildList(["6.01"]).join(), v601);
  assert.equal(allowedBuildList(["6.01.0"]).join(), v6010);
  assert.equal(dataBuild("4410000"), v600, "a build between 6.00 and 6.01 Core doesn't know plays on 6.00's");
  assert.equal(dataBuild(v600), v600, "6.00 keeps its own data");
  assert.equal(dataBuild("4395664"), v600);
  assert.equal(buildOfSeason(6), "4573096", "Season 6's newest data is 6.30's now (tests/build630.test.js)");
  assert.equal(buildOfSeason(5), v541);
  assert.equal(seasonName(6), "Season 6 (6.00 – 6.30)");
});

test("6.01's data against 6.00's: eleven cosmetics, the Chiller in the loot, the staged challenges' later stages; the Birthday's leftovers gone", () => {
  const [c601, c600] = [inBuild(v601, athenaCosmetics), inBuild(v600, athenaCosmetics)];
  const added = Object.keys(c601).filter((id) => !c600[id]).sort();
  assert.deepEqual(added.map((id) => [id, c601[id].name]), [
    ["AthenaBackpack:bid_115_dieselpunkmale", "Para-Provisions"], ["AthenaBackpack:bid_124_scarecrowmale", "Hay Nest"],
    ["AthenaBackpack:bid_125_scarecrowfemale", "Birdhovel"], ["AthenaCharacter:cid_223_athena_commando_m_dieselpunk", "Maximilian"],
    ["AthenaCharacter:cid_235_athena_commando_m_scarecrow", "Hay Man"], ["AthenaCharacter:cid_236_athena_commando_f_scarecrow", "Straw Ops"],
    ["AthenaDance:eid_tpose", "T-Pose"], ["AthenaGlider:glider_id_082_scarecrow", "Field Wraith"], ["AthenaGlider:glider_id_083_darkbomber", "Dark Glyph"],
    ["AthenaPickaxe:pickaxe_id_105_scarecrow", "Harvester"], ["AthenaPickaxe:pickaxe_id_106_darkbomber", "Thunder Crash"]]);
  assert.deepEqual(Object.keys(c600).filter((id) => !c601[id]), ["AthenaBattleBus:bbid_birthdaybus"]);
  // Dark Bomber and her Dark Bag are in 6.01's two keyed paks, which the extractor doesn't read (as Maximilian was in 6.00's).
  assert.equal(c601["AthenaCharacter:cid_229_athena_commando_f_darkbomber"], undefined);

  // "Chiller added. Common Trap ... Drops in stacks of 3 in Treasure Chests, Supply Drops, Vending Machines, Supply Llamas, and floor loot."
  const chiller = (build) => Object.entries(inBuild(build, athenaLootTables)["/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client"])
    .filter(([, row]) => String(row.ItemDefinition).endsWith("TID_Context_Freeze_Athena")).map(([name, row]) => [name, row.Weight, row.Count]);
  assert.deepEqual(chiller(v601).sort(), [["WorldList.AthenaLoot.VendingMachine.Consumables.Common.03", 0.2, 3],
    ["WorldList.AthenaSupplyDropTraps.04", 0.5, 3], ["WorldList.AthenaTraps.11", 1, 3]]);
  assert.deepEqual(chiller(v600), []);

  inBuild(v601, () => {
    // Week 4's staged challenges: 6.00's data has their first stage only.
    assert.deepEqual(["b", "c", "d", "e"].map((stage) => getAthenaQuest(`quest_br_land_chain_02${stage}`).objectives[0].stat),
      ["land_location_wailingwoods", "land_location_dustydivot", "land_location_pleasantpark", "land_location_paradisepalms"]);
    assert.deepEqual(getAthenaQuest("quest_br_land_chain_02a").rewards.at(-1), { quantity: 1, templateId: "Quest:quest_br_land_chain_02b" });
    assert.ok(getAthenaQuest("quest_br_dance_scavengerhunt_locations_chain_01b") && getAthenaQuest("quest_br_dance_scavengerhunt_locations_chain_01c"));
    assert.equal(getAthenaQuest("quest_br_play_birthday"), undefined);
    // Its trap items carry a tier ("Added star ratings to the UI elements of all trap items").
    assert.equal(getItem("Trap:tid_floor_player_launch_pad_athena").tier, "IV");
    assert.equal(getItem("Trap:tid_floor_creative_control_panel").name, "Creative Control Panel");
    assert.equal(getItem("Weapon:wid_launcher_military_athena_sr_ore_t03"), undefined, "the Quad Launcher is Update v6.02's");
  });
  assert.equal(inBuild(v600, () => getAthenaQuest("quest_br_land_chain_02b")), undefined);
  // Save the World's quests are 6.00's.
  assert.deepEqual(inBuild(v601, () => getQuest("autumnquest_explorezones_1")), inBuild(v600, () => getQuest("autumnquest_explorezones_1")));
});

test("6.01 keeps 6.00's Battle Pass: the same tiers, styles and challenges, and the purchase's own gift box", () => {
  const [s601, s600] = [inBuild(v601, athenaSeason), inBuild(v600, athenaSeason)];
  assert.deepEqual(s601, s600, "AthenaSeason6 is unchanged");
  assert.deepEqual(inBuild(v601, athenaVariantTokens), inBuild(v600, athenaVariantTokens));
  // Season 6's schedules and bundles are 6.00's, entry for entry. 6.01's overlay, extracted again for #334, also has what
  // the extractor has kept since 6.00's was made (6.00's paks aren't at hand): CleanUpOnBundleCompletion, the rewards'
  // gift box, Tomatohead's own schedule and the two of Season 5 that outlast it (Drift's and Ragnarok's), with their bundles.
  const [schedules601, schedules600] = [inBuild(v601, athenaChallengeSchedules), inBuild(v600, athenaChallengeSchedules)];
  assert.deepEqual(Object.keys(schedules601).filter((id) => !schedules600[id]),
    ["bundleschedule_styles_tomatohead", "season5_progressivea_schedule", "season5_progressiveb_schedule"]);
  for (const id of Object.keys(schedules600)) {
    assert.deepEqual({ ...schedules601[id], cleanUpOnBundleCompletion: undefined }, { ...schedules600[id], cleanUpOnBundleCompletion: undefined }, id);
  }
  const [bundles601, bundles600] = [inBuild(v601, athenaChallengeBundles), inBuild(v600, athenaChallengeBundles)];
  assert.deepEqual(Object.keys(bundles601).filter((id) => !bundles600[id]), ["questbundle_s5_progressivea", "questbundle_s5_progressiveb", "questbundle_styles_tomatohead"]);
  const withoutGiftBox = (bundle) => JSON.parse(JSON.stringify(bundle, (key, value) => (key === "giftBox" ? undefined : value)));
  for (const id of Object.keys(bundles600)) assert.deepEqual(withoutGiftBox(bundles601[id]), bundles600[id], id);
  for (const build of builds601) {
    assert.equal(inBuild(build, battlePassPurchaseGiftBox), "GiftBox:gb_battlepasspurchased", build);
    // Bonesy's white style at tier 59 (#332).
    const tier59 = inBuild(build, athenaSeason).bookPaidRewards.find(({ level }) => level === 59).rewards.map(({ templateId }) => templateId);
    assert.ok(tier59.includes("CosmeticVariantToken:vtid_033_petcarrier_dog_styleb"), build);
    assert.equal(inBuild(build, athenaChallengeSchedules).season6_free_schedule.bundles.length, 10);
  }
});

test("a 6.01 client buys the Battle Pass in a GB_BattlePassPurchased and owns Bonesy's style at tier 59, on either changelist", async () => {
  const backend = await startBackend();
  try {
    for (const build of builds601) {
      const agent = `game=Fortnite, engine=UE4, build=++Fortnite+Release-6.01-CL-${build}`;
      const player = await userLogin(backend.port, `Pass601_${build}`);
      const command = (name, profileId, body = {}) => {
        const text = JSON.stringify(body);
        return send({ host: "127.0.0.1", port: backend.port, method: "POST",
          path: `/fortnite/api/game/v2/profile/${player.accountId}/client/${name}?profileId=${profileId}&rvn=-1`,
          headers: { "User-Agent": agent, Authorization: `bearer ${player.token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
      };
      const profileOf = (body, profileId) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === profileId).profileChanges[0].profile;
      const query = async (profileId) => profileOf((await command("QueryProfile", profileId)).body, profileId);
      await query("athena");
      assert.equal((await post(backend.port, `/admin/api/accounts/${player.accountId}/currency`, undefined, { key: "vbucks", quantity: 10000 })).status, 200);
      const buy = async (offerId, expectedPrice, purchaseQuantity = 1) => {
        const bought = await command("PurchaseCatalogEntry", "common_core", { offerId, purchaseQuantity, currency: "MtxCurrency", expectedPrice });
        assert.equal(bought.status, 200, `${build}: ${JSON.stringify(bought.body)}`);
        return bought.body.notifications[0].lootResult.items;
      };
      const giftBoxes = async () => Object.values((await query("common_core")).items).filter((item) => item.templateId.toLowerCase().startsWith("giftbox:"));
      const before = (await giftBoxes()).length;
      const loot = await buy("core_br_season6_battlepass", 950);
      const boxes = await giftBoxes();
      assert.equal(boxes.length, before + 1, build);
      const box = boxes.find((item) => item.templateId.toLowerCase() === "giftbox:gb_battlepasspurchased");
      assert.deepEqual(box.attributes.lootList, loot, "the purchase's own box (#326)");
      assert.ok(loot.some((item) => item.itemType.toLowerCase() === "athenacharacter:cid_237_athena_commando_f_cowgirl"), "Calamity at once");
      const tiers = await buy("A6FE59C497B844068E1B5D84396F19BA", 150, 58);
      assert.ok(tiers.some((item) => item.itemType === "CosmeticVariantToken:vtid_033_petcarrier_dog_styleb" && item.itemProfile === "athena"), "the style is shown (#332)");
      const athena = await query("athena");
      assert.deepEqual(athena.items["AthenaBackpack:petcarrier_001_dog"].attributes.variants, [{ channel: "Material", active: "Mat0", owned: ["Mat0", "Mat1"] }]);
    }
  } finally {
    backend.close();
  }
});

test("6.01's event flags are 6.00's: LobbySeason6, the ticketless storms and Cram Session; its paks drop only the Birthday bus's", () => {
  for (const build of builds601) {
    assert.deepEqual(activeEventFlags(build), [passiveStorms, lobbySeason6, activeMiniBosses], build);
    assert.deepEqual(activeEventFlags(build), activeEventFlags(v600));
    assert.equal(inBuild(build, () => isEventActive(cramSession2018)), true);
  }
  // Every range that ran to 6.01 runs to 6.21 now (tests/build602.test.js, tests/build610.test.js, tests/build620.test.js,
  // tests/build621.test.js, tests/build622.test.js), but BR.CandyCaneGuns', whose item 6.20's paks drop.
  const v602 = "4573096";
  assert.equal(season4Flag("EventFlag.BR.CandyCaneGuns").builds[1], 4480234);
  assert.deepEqual(season4Flag(lobbySeason6).builds, [4395664, Number(v602)]);
  assert.equal(season4Flag("EventFlag.BirthdayBattleBus").builds[1], Number(v600), "BR_Decor_BirthdayBus isn't in 6.01's paks");
  for (const flag of ["EventFlag.SupplyDropBDay", "EventFlag.SupplyDropGift", "EventFlag.BR_S5_RiskyReels_Event",
    "EventFlag.Blockbuster2018Phase4", "EventFlag.Fortnitemares", "EventFlag.ActiveMiniBosses"]) {
    assert.equal(season4Flag(flag).builds[1], Number(v602), flag);
  }
  for (const flag of ["EventFlag.BR_S5_Cube_TurnOn", "EventFlag.LTM_Heist", "EventFlag.RoadTrip2018", "EventFlag.Horde"]) {
    assert.equal(season4Flag(flag).builds[1], Number(v541), flag);
  }
  withConfig(replay, () => assert.deepEqual(inBuild(v601, () => cubeStates(at("2018-10-04T00:00:00Z"))), [], "6.01 places no Cube"));
});

test("6.01 keeps the floating island: the same sixteen flags by Season 6's dates as 6.00, on both changelists", () => {
  const flags = [...[1, 2, 3, 4, 5, 6, 7, 8].map(islandMoveTo), ...[0, 1, 2, 3, 4, 5, 6, 7].map(islandRune)];
  for (const flag of flags) assert.deepEqual(season4Flag(flag).builds, [4395664, 4497486], flag);
  withConfig(replay, () => {
    for (const iso of ["2018-09-27T12:00:00Z", "2018-09-28T12:00:00Z", "2018-10-03T12:00:00Z", "2018-10-05T12:00:00Z", "2018-10-09T12:00:00Z",
      "2018-10-20T12:00:00Z", "2018-11-15T00:00:00Z", "2018-12-07T12:00:00Z"]) {
      const on600 = inBuild(v600, () => islandStates(at(iso)));
      assert.equal(on600[0].events.length, 1, iso);
      for (const build of builds601) assert.deepEqual(inBuild(build, () => islandStates(at(iso))), on600, `${build} at ${iso}`);
    }
    // Update v6.01's day: the island over the second rune, by Shifty Shafts.
    assert.deepEqual(inBuild(v601, () => islandStates(at("2018-10-03T12:00:00Z")))[0].events.map(({ eventType }) => eventType), [islandRune(2)]);
  });
  withConfig({ ...replay, datedFlags: { island: { mode: "off" } } },
    () => assert.deepEqual(inBuild(v601, () => islandStates(at("2018-10-03T12:00:00Z")))[0]?.events ?? [], [], "off by its switch"));
});

test("the admin panel's island stop reaches a 6.01 client's calendar, on both changelists", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Island601");
    const islandServed = async (build) => (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/calendar/v1/timeline",
      headers: { "User-Agent": agentOf(build), Authorization: `bearer ${token}` } }))
      .body.channels["client-events"].states[0].activeEvents.map(({ eventType }) => eventType).filter((type) => type.startsWith("EventFlag.BR_S6_Island_"));
    for (const build of builds601) assert.deepEqual(await islandServed(build), [islandRune(0)], build);
    const moved = await post(backend.port, "/admin/api/events/dated-flags/move", null, { event: "island", to: "rune5" });
    assert.equal(moved.status, 200);
    for (const build of builds601) assert.deepEqual(await islandServed(build), [islandRune(5)], build);
  } finally {
    await backend.close();
  }
});

test("6.01's modes: 6.00's lobby (50v50 and Playground on, Soaring 50's by its switch) and Disco Domination by its switch", () => {
  const defaults = createSettingsStore(null).get();
  assert.equal(defaults.matchmakingModes.discoDomination, false, "off unless turned on");
  for (const build of builds601) {
    assert.equal(ltmOfPlaylist(50, build).id, "fiftyFiftySeason6");
    assert.equal(ltmOfPlaylist(35, build).id, "playgroundV2");
    assert.equal(ltmOfPlaylist(202, build).id, "discoDomination");
    assert.equal(ltmOn("fiftyFiftySeason6", build, defaults), true);
    assert.equal(ltmOn("playgroundV2", build, defaults), true);
    assert.equal(ltmOn("soaring50s", build, defaults), false);
    assert.equal(ltmOn("discoDomination", build, defaults), false);
    for (const id of ["getaway", "soaringSolos", "closeEncountersSeason5", "fiftyFiftySolidGold", "fiftyFiftySeason5"]) assert.equal(hasLtm(id, build), false, id);
    assert.deepEqual(ltmPlaylistOverrides(build, defaults), ["Playlist_Playground", "Playlist_50v50"]);
    assert.deepEqual(ltmFrontEndPlaylists(build, defaults).map(({ name, enabled }) => [name, enabled]),
      [["Playlist_Playground", true], ["Playlist_Soaring_50s", false], ["Playlist_50v50", true], ["Playlist_Disco", false]]);
    // Switched on, the lobby offers it and its ticket's playlist is 202, two teams of fifty in squads of four.
    const withDisco = { ...defaults, matchmakingModes: { ...defaults.matchmakingModes, discoDomination: true } };
    assert.equal(ltmOn("discoDomination", build, withDisco), true);
    assert.deepEqual(ltmPlaylistOverrides(build, withDisco), ["Playlist_Playground", "Playlist_50v50", "Playlist_Disco"]);
    for (const [name, id] of [["playlist_50v50", 50], ["playlist_playground", 35], ["playlist_defaultsolo", 2], ["playlist_disco", 202]]) {
      assert.equal(playlistIdOfName(name, build), id);
      assert.equal(parseBucket(`${build}:0:NAE:${name}`, build).playlistId, id);
    }
    assert.deepEqual(playlistTeamsOf(`${build}:0:NAE:playlist_disco`, build), { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 });
    assert.deepEqual(playlistTeamsOf(`${build}:0:NAE:playlist_playground`, build), { maxTeamCount: 4, maxTeamSize: 4, maxSquadSize: 4 });
  }
  // 6.00's paks have no Playlist_Disco: its lobby is as it was.
  assert.equal(hasLtm("discoDomination", v600), false);
  assert.deepEqual(ltmFrontEndPlaylists(v600, defaults).map(({ name }) => name), ["Playlist_Playground", "Playlist_Soaring_50s", "Playlist_50v50"]);
  withConfig(replay, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    assert.equal(inOriginalWindow("playgroundV2", v601, at("2018-10-04T12:00:00Z"), dated), true, "Playground through Season 6");
    assert.equal(inOriginalWindow("discoDomination", v601, at("2018-10-11T12:00:00Z"), dated), false, "Update v6.02's, never 6.01's");
  });
});

test("6.01's mode select: Disco Domination's tile from playlistinformation, and Season 6's key art as on 6.00", () => {
  for (const build of builds601) {
    const playlists = playlistInformationFor(build).playlist_info.playlists;
    const tile = (name) => playlists.find(({ playlist_name: playlistName }) => playlistName === name)?.image ?? null;
    assert.match(tile("Playlist_Disco"), /playlistinformation\/BR06_LobbyTile_LTM_DiscoDomination-1024x512-c79f07de78d8283656fcf4d1ee757f880911d775\.jpg$/);
    assert.match(tile("Playlist_Playground"), /BR_LTM-Tile_Playground/);
    assert.match(tile("Playlist_50v50"), /LTM_50v50/);
    assert.deepEqual(subgameSelectImagesFor(build), subgameSelectImages[6], build);
  }
});

test("6.01's shop: Season 6's history with its eight cosmetics on their days; 6.00's days are as they were", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season6.json", import.meta.url), "utf8")).days;
  assert.equal(history.length, 70);
  const [c601, c600] = [inBuild(v601, athenaCosmetics), inBuild(v600, athenaCosmetics)];
  // The history holds 6.02's sixteen, 6.10's eight, 6.20's sixteen, 6.21's fourteen and 6.22's seventeen too
  // (tests/build602.test.js, tests/build610.test.js, tests/build620.test.js, tests/build621.test.js,
  // tests/build622.test.js); 6.01 is shown its own.
  const c602 = inBuild("4573096", athenaCosmetics);
  assert.ok(history.every((day) => [...day.featured, ...day.daily].every(([id]) => c602[id])), "only 6.30's cosmetics (6.30's sixteen too, tests/build630.test.js)");
  const days = (id) => history.filter((day) => [...day.featured, ...day.daily].some(([entry]) => entry === id)).map(({ date }) => date.slice(5));
  assert.deepEqual(days("AthenaCharacter:cid_223_athena_commando_m_dieselpunk"), ["09-30", "10-01", "10-29", "12-01"]);
  assert.deepEqual(days("AthenaPickaxe:pickaxe_id_106_darkbomber"), ["10-05", "10-06", "11-21"]);
  assert.deepEqual(days("AthenaGlider:glider_id_083_darkbomber"), ["10-05", "10-06", "11-21"]);
  for (const id of ["AthenaCharacter:cid_235_athena_commando_m_scarecrow", "AthenaCharacter:cid_236_athena_commando_f_scarecrow",
    "AthenaPickaxe:pickaxe_id_105_scarecrow", "AthenaGlider:glider_id_082_scarecrow"]) assert.deepEqual(days(id), ["10-07", "10-08", "11-15"], id);
  assert.deepEqual(days("AthenaDance:eid_tpose"), ["10-07", "10-18", "11-10", "11-23"]);
  assert.equal(history.filter((day) => day.featured.every(([id]) => !c601[id])).length, 29);

  const featured = (build, iso) => inBuild(build, () => itemShopOffers(at(iso), shopConfig)).BRWeeklyStorefront;
  for (const build of builds601) {
    // 7 October 2018: Hay Man and Straw Ops with their back blings, Harvester and Field Wraith.
    const scarecrows = featured(build, "2018-10-07T12:00:00Z");
    assert.deepEqual(scarecrows.map(({ title, price }) => [title, price]), [["Hay Man", 1500], ["Straw Ops", 1500], ["Harvester", 800], ["Field Wraith", 1200]], build);
    assert.deepEqual(scarecrows[0].itemGrants.map(({ templateId }) => templateId),
      ["AthenaCharacter:cid_235_athena_commando_m_scarecrow", "AthenaBackpack:bid_124_scarecrowmale"]);
    // 5 October: Dark Bomber's pickaxe and glider (she is in a keyed pak 6.01's data doesn't have).
    assert.deepEqual(featured(build, "2018-10-05T12:00:00Z").map(({ title, price }) => [title, price]), [["Thunder Crash", 1500], ["Dark Glyph", 500]]);
    // 30 September: Maximilian beside Airheart, with Para-Provisions.
    const maximilian = featured(build, "2018-09-30T12:00:00Z").find(({ templateId }) => templateId === "AthenaCharacter:cid_223_athena_commando_m_dieselpunk");
    assert.deepEqual([maximilian.price, maximilian.itemGrants.at(-1).templateId], [1200, "AthenaBackpack:bid_115_dieselpunkmale"]);
    assert.equal(inBuild(build, () => seasonEnd(at("2018-10-04T12:00:00Z"), shopConfig)).toISOString(), "2018-12-06T00:00:00.000Z");
  }
  assert.equal(bundledBackBlings["AthenaCharacter:cid_236_athena_commando_f_scarecrow"], "AthenaBackpack:bid_125_scarecrowfemale");
  // 6.00 has none of them: those days' featured sections stay empty there, and every other day is the same list.
  assert.deepEqual(featured(v600, "2018-10-07T12:00:00Z"), []);
  assert.deepEqual(featured(v600, "2018-10-05T12:00:00Z"), []);
  assert.ok(!featured(v600, "2018-09-30T12:00:00Z").some(({ title }) => title === "Maximilian"));
  for (const iso of ["2018-09-28T12:00:00Z", "2018-10-03T12:00:00Z", "2018-10-10T12:00:00Z"]) {
    assert.deepEqual(featured(v601, iso).map(({ templateId }) => templateId), featured(v600, iso).map(({ templateId }) => templateId), iso);
  }
  assert.ok(history.flatMap((day) => [...day.featured, ...day.daily]).filter(([id]) => !c600[id] && c601[id]).length === 26, "26 entries, 6.01's own");
});

test("6.01's Save the World: Cram Session runs on, with the Lead Sled and the Obliterator in the Weekly Store from 4 October", () => {
  withConfig(replay, () => {
    for (const build of builds601) {
      inBuild(build, () => {
        assert.deepEqual(eventQuests(), cramSessionQuests);
        assert.ok(cramSessionQuests.every((id) => getQuest(id)));
        const weekly = (iso) => eventStoreOffers(at(iso))[weeklyStorefront].slice(0, 2).map(({ templateId, price }) => [templateId, price]);
        // "Available Wednesday, October 3 at 8 PM ET until Wednesday, October 10 at 8 PM ET."
        assert.deepEqual(weekly("2018-10-04T00:00:00Z"), [["Schematic:sid_blunt_hammer_ratrod_sr_ore_t01", 1680], ["Schematic:sid_sniper_military_sr_ore_t01", 1680]]);
        assert.deepEqual(weekly("2018-10-09T12:00:00Z"), weekly("2018-10-04T00:00:00Z"));
        // Before it, 6.00's first week: the Ratatat and the Hydraulic Sledge.
        assert.deepEqual(weekly("2018-10-03T23:00:00Z"), [["Schematic:sid_pistol_ratrod_sr_ore_t01", 1680], ["Schematic:sid_blunt_hammer_hydraulic_vr_ore_t01", 600]]);
        const now = at("2018-10-05T12:00:00Z");
        assert.deepEqual(eventStoreOffers(now)[eventStorefront].map(({ templateId }) => templateId), cramSessionEventItems.map(({ templateId }) => templateId));
        assert.equal(eventStoreEnds(now).stwEventStoreEnd.toISOString(), "2018-12-06T00:00:00.000Z");
        // The 2FA reward (#328) is still asked for and still in the data.
        assert.equal(stwMfaRewardOffered(), true);
        assert.deepEqual(stwMfaRewards.map(({ templateId }) => getItem(templateId)?.name), ["Armory Slot", "Backpack Slot", "Legendary Troll Stash Llama"]);
      });
    }
    assert.equal(inBuild(v601, () => getItem("Weapon:wid_blunt_hammer_ratrod_sr_ore_t01").name), "Lead Sled");
    assert.equal(inBuild(v601, () => getItem("Weapon:wid_sniper_military_sr_ore_t01").name), "Obliterator");
    // 6.00 keeps its own week through the replay.
    assert.deepEqual(inBuild(v600, () => eventStoreOffers(at("2018-10-05T12:00:00Z")))[weeklyStorefront].slice(0, 2).map(({ templateId }) => templateId),
      ["Schematic:sid_pistol_ratrod_sr_ore_t01", "Schematic:sid_blunt_hammer_hydraulic_vr_ore_t01"]);
  });
  const info = inBuild(v601, () => worldInfo(at("2026-11-12T12:00:00Z")));
  const alerts = info.missionAlerts.flatMap(({ availableMissionAlerts }) => availableMissionAlerts);
  const miniBosses = alerts.filter(({ categoryName }) => categoryName === "MiniBossCategory");
  assert.ok(miniBosses.length > 0, "Mini-Boss alerts are active");
  for (const alert of miniBosses) {
    assert.ok(alert.missionAlertRewards.items.some(({ itemType }) => itemType.toLowerCase() === "accountresource:eventcurrency_scaling"), "Gold instead of tickets");
  }
  assert.ok(alerts.some(({ categoryName }) => categoryName === "MegaAlertCategory"), "Mega Alerts run on");
});

test("a 6.01 client's ClaimMfaEnabled gives the Save the World 2FA reward once (#328)", async () => {
  const backend = await startBackend();
  try {
    for (const build of builds601) {
      const { token, accountId } = await userLogin(backend.port, `Mfa601_${build}`);
      const mcp = (command, profileId, body = {}) => {
        const text = JSON.stringify(body);
        return send({ host: "127.0.0.1", port: backend.port, method: "POST", path: `/fortnite/api/game/v2/profile/${accountId}/client/${command}?profileId=${profileId}&rvn=-1`,
          headers: { "User-Agent": agentOf(build), Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
      };
      const campaignOf = (result) => (result.profileId === "campaign" ? result : result.multiUpdate?.find(({ profileId }) => profileId === "campaign"));
      const claim = await mcp("ClaimMfaEnabled", "common_core", { bClaimForStw: true });
      assert.equal(claim.status, 200, `${build}: ${JSON.stringify(claim.body)}`);
      const added = campaignOf(claim.body).profileChanges.filter(({ changeType }) => changeType === "itemAdded")
        .map(({ item }) => [item.templateId.toLowerCase(), item.quantity]);
      assert.deepEqual(added, [["token:accountinventorybonus", 50], ["token:worldinventorybonus", 10], ["cardpack:cardpack_jackpot", 1]], build);
      assert.equal(campaignOf((await mcp("ClaimMfaEnabled", "common_core", { bClaimForStw: true })).body), undefined, "once");
    }
  } finally {
    backend.close();
  }
});

// Update v6.01's "Playground Custom Options": the lobby adds each option the leader has set to its ticket request as
// player.option.custom_match_option.<scope class>:<OptionKey>, and the server reads them from AssignMatch's
// match.option.customMatchOptions, "<key>=<value>;<key>=<value>" (matchmaking/service.js).
test("custom match options: a ticket's player.option.custom_match_option.* fields become the server's key=value list", () => {
  const query = { partyPlayerIds: "a", bucketId: `${v601}:0:NAE:playlist_playground`, "player.platform": "Windows", "player.option.fillTeam": "true",
    "player.option.custom_match_option.CreativeMutator_Gravity_C:GravityOverride": "2",
    "player.option.custom_match_option.CreativeMutator_HealthAndShield_C:StartingHealth": "50.000000",
    "player.option.custom_match_option.CreativeMutator_TimeOfDay_C:TimeOfDayOverride": ["1", "2"] };
  const options = customMatchOptionsOf(query);
  assert.deepEqual(options, { "CreativeMutator_Gravity_C:GravityOverride": "2", "CreativeMutator_HealthAndShield_C:StartingHealth": "50.000000",
    "CreativeMutator_TimeOfDay_C:TimeOfDayOverride": "1" });
  assert.equal(customMatchOptionsText(options),
    "CreativeMutator_Gravity_C:GravityOverride=2;CreativeMutator_HealthAndShield_C:StartingHealth=50.000000;CreativeMutator_TimeOfDay_C:TimeOfDayOverride=1");
  assert.equal(customMatchOptionsOf({ "player.option.fillTeam": "true" }), null, "a ticket without any");
  assert.equal(customMatchOptionsOf(undefined), null);
  // Nothing that would break the server's list, or add a pair of its own to it.
  assert.equal(customMatchOptionsOf({ "player.option.custom_match_option.A": "1;B=2", "player.option.custom_match_option.C=D": "1",
    "player.option.custom_match_option.": "1", "player.option.custom_match_option.E": "" }), null);
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`player.option.custom_match_option.Option${index}`, String(index)]));
  assert.equal(Object.keys(customMatchOptionsOf(many)).length, 32);
});

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
const customOptions = "&player.option.custom_match_option.CreativeMutator_Gravity_C%3AGravityOverride=2" +
  "&player.option.custom_match_option.CreativeMutator_HealthAndShield_C%3AStartingHealth=50.000000";
const customOptionsText = "CreativeMutator_Gravity_C:GravityOverride=2;CreativeMutator_HealthAndShield_C:StartingHealth=50.000000";

// 6.01's MatchmakingServiceClient is 6.00's (the same ticket query, Epic-Signed WebSocket and messages: CL-4424678's exe
// against CL-4395664's), with Playground's custom options added to the ticket. A 6.01 player, on either changelist, takes
// a ticket for Solo, its 50v50 and Playground, hears Connecting, Waiting and Queued, and is sent to a registered 6.01
// server; the Playground party's custom options go to its server with AssignMatch, and never to a match shared with others.
test("a 6.01 player matchmakes on either changelist: Solo, 50v50 and Playground reach Queued and a 6.01 server, Playground with its custom options", async () => {
  for (const build of builds601) {
    const as = (port, urlPath, token, method = "GET", body) => {
      const text = body === undefined ? undefined : JSON.stringify(body);
      const headers = { "User-Agent": agentOf(build), Authorization: `bearer ${token}` };
      if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
      return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
    };
    const backend = await startBackend({ matchmakingGatherMs: 100 });
    const clients = [];
    try {
      const server = await userLogin(backend.port, `Server${build}`);
      for (const playlist of ["playlist_defaultsolo", "playlist_50v50", "playlist_playground"]) {
        const session = (await as(backend.port, "/fortnite/api/matchmaking/session", server.token, "POST", {
          ownerId: server.accountId, ownerName: "Core", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
          maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: build, attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NAE" }
        })).body;
        const gameserver = await matchmakingClient(backend.port, authorizationOf((await as(backend.port,
          `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent(`${build}:0:NAE:**`)}&minPlayers=1&maxPlayers=100`,
          server.token)).body));
        clients.push(gameserver);
        assert.equal(JSON.parse(await gameserver.next()).name, "Registered");
        const player = await userLogin(backend.port, `P${build}${playlist.length}`);
        // Every ticket carries the options here, to show that only Playground's match takes them.
        const ticket = await as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
          `&bucketId=${build}:0:NAE:${playlist}&player.platform=Windows&player.option.fillTeam=true${customOptions}`, player.token);
        assert.equal(ticket.status, 200, `${build} ${playlist}: ${JSON.stringify(ticket.body)}`);
        const client = await matchmakingClient(backend.port, authorizationOf(ticket.body));
        clients.push(client);
        const states = [];
        for (;;) {
          const { name, payload } = JSON.parse(await client.next());
          states.push(name === "StatusUpdate" ? payload.state : name);
          if (states.at(-1) === "Queued") break;
        }
        assert.deepEqual(states, ["Connecting", "Waiting", "Queued"], `${build} ${playlist}`);
        const assign = await nextOf(gameserver, "AssignMatch");
        assert.equal(assign.payload.bucketId, `Fortnite:Fortnite:${build}:0:NAE:${playlist}`);
        assert.equal(assign.payload.matchOptions["match.option.customMatchOptions"], playlist === "playlist_playground" ? customOptionsText : undefined,
          `${build} ${playlist}`);
        assert.equal(assign.payload.matchOptions["match.option.warmupRequiredPlayerCount"], "1");
        gameserver.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
        const play = await nextOf(client, "Play");
        assert.deepEqual([play.payload.matchId, play.payload.sessionId], [assign.payload.matchId, session.id]);
        const found = await as(backend.port, `/fortnite/api/matchmaking/session/${session.id}`, player.token);
        assert.equal(found.status, 200);
        // The next playlist gets a server of its own.
        gameserver.close();
      }
    } finally {
      for (const client of clients) client.close();
      backend.close();
    }
  }
});

// A party of two: only the leader's ticket carries the options (its lobby adds them as the party's leader); the member's
// follows it into the same match.
test("a 6.01 Playground party of two plays its leader's custom options, and the member follows", async () => {
  const build = v601;
  const as = (port, urlPath, token, method = "GET", body) => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const headers = { "User-Agent": agentOf(build), Authorization: `bearer ${token}` };
    if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
    return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
  };
  const backend = await startBackend({ matchmakingGatherMs: 100 });
  const clients = [];
  try {
    const server = await userLogin(backend.port, "PartyServer601");
    const session = (await as(backend.port, "/fortnite/api/matchmaking/session", server.token, "POST", {
      ownerId: server.accountId, ownerName: "Core", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: build, attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NAE" }
    })).body;
    const gameserver = await matchmakingClient(backend.port, authorizationOf((await as(backend.port,
      `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent(`${build}:0:NAE:**`)}&minPlayers=1&maxPlayers=100`,
      server.token)).body));
    clients.push(gameserver);
    assert.equal(JSON.parse(await gameserver.next()).name, "Registered");
    const leader = await userLogin(backend.port, "PartyLeader601");
    const member = await userLogin(backend.port, "PartyMember601");
    const party = `${leader.accountId},${member.accountId}`;
    const ticketOf = (player, extra = "") => as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${party}` +
      `&bucketId=${build}:0:NAE:playlist_playground&player.platform=Windows${extra}`, player.token);
    const leaderTicket = await ticketOf(leader, `&player.option.fillTeam=true${customOptions}`);
    const memberTicket = await ticketOf(member);
    assert.deepEqual([leaderTicket.status, memberTicket.status], [200, 200]);
    const leaderClient = await matchmakingClient(backend.port, authorizationOf(leaderTicket.body));
    clients.push(leaderClient);
    const assign = await nextOf(gameserver, "AssignMatch");
    assert.equal(assign.payload.matchOptions["match.option.customMatchOptions"], customOptionsText);
    assert.deepEqual(assign.payload.teams.flat(2).sort(), [leader.accountId, member.accountId].sort(), "the party, alone");
    const memberClient = await matchmakingClient(backend.port, authorizationOf(memberTicket.body));
    clients.push(memberClient);
    gameserver.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
    for (const client of [leaderClient, memberClient]) {
      const play = await nextOf(client, "Play");
      assert.deepEqual([play.payload.matchId, play.payload.sessionId], [assign.payload.matchId, session.id]);
    }
  } finally {
    for (const client of clients) client.close();
    backend.close();
  }
});

test("a 6.01 Playground party with no custom options, or a 6.00 one, is assigned as before", async () => {
  for (const [build, version] of [[v601, "6.01"], [v600, "6.00"]]) {
    const agent = `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;
    const as = (port, urlPath, token, method = "GET", body) => {
      const text = body === undefined ? undefined : JSON.stringify(body);
      const headers = { "User-Agent": agent, Authorization: `bearer ${token}` };
      if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
      return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
    };
    const backend = await startBackend({ matchmakingGatherMs: 100 });
    const clients = [];
    try {
      const server = await userLogin(backend.port, `Plain${build}`);
      const session = (await as(backend.port, "/fortnite/api/matchmaking/session", server.token, "POST", {
        ownerId: server.accountId, ownerName: "Core", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
        maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: build, attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NAE" }
      })).body;
      const gameserver = await matchmakingClient(backend.port, authorizationOf((await as(backend.port,
        `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent(`${build}:0:NAE:**`)}&minPlayers=1&maxPlayers=100`,
        server.token)).body));
      clients.push(gameserver);
      assert.equal(JSON.parse(await gameserver.next()).name, "Registered");
      const player = await userLogin(backend.port, `Q${build}`);
      const ticket = await as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
        `&bucketId=${build}:0:NAE:playlist_playground&player.platform=Windows&player.option.fillTeam=true`, player.token);
      assert.equal(ticket.status, 200);
      clients.push(await matchmakingClient(backend.port, authorizationOf(ticket.body)));
      const assign = await nextOf(gameserver, "AssignMatch");
      assert.deepEqual(Object.keys(assign.payload.matchOptions).filter((key) => key.startsWith("match.option.custom")), [], build);
    } finally {
      for (const client of clients) client.close();
      backend.close();
    }
  }
});

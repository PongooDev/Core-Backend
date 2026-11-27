import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eventCard } from "../src/admin/eventschedules.js";
import { battlePassOffers } from "../src/battlepass/season2.js";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { releasedOn, seasonName, versionOf } from "../src/builds/detect.js";
import { rollContents } from "../src/cardpacks/contents.js";
import { blockEventOf, blockStates } from "../src/events/block.js";
import { activeEventFlags, blockSlab, configureEvents, isEventActive, lobbySeason9, ltmVigilante, ltmWax } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { hasLtm, isHeldLtm, ltmOn } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { sciFiLlama, season9Flag, season9Phase1, season9Phase2, stellarHorizon, stellarHorizonQuests, talesOfBeyondEventQuests } from "../src/events/talesofbeyond.js";
import { wargamesDailyQuests, wargamesFlag, wargamesGlobals, wargamesQuests } from "../src/events/wargames.js";
import { athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { getCardPack, getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { dataBuild } from "../src/gamedata/read.js";
import { isForeignTemplate } from "../src/gamedata/templates.js";
import { teamsOfPlaylist } from "../src/matchmaking/service.js";
import { styleSchedules } from "../src/profiles/challenges.js";
import { playerPlotType, plotsOf, settleCreativePlots } from "../src/profiles/creative.js";
import { grant } from "../src/profiles/progress.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { viewProfile } from "../src/profiles/common.js";
import { refundMtxPurchase } from "../src/services/mcp/commands/RefundMtxPurchase.js";
import { storefronts } from "../src/store/catalog.js";
import { eventStorefront } from "../src/store/eventstore.js";
import { configureItemShop, itemShopOffers, seasonOfBuild } from "../src/store/itemshop.js";
import { hasUndo, purchaseHistoryOf, recordPurchase, undoCooldownMs, undoWindowMs } from "../src/store/refunds.js";
import { clientToken, send, startBackend } from "./helpers.js";

// Fortnite 9.20 (CL-6822798, Update v9.20, 6 June 2019), Season 9, on its own data (gamedata/6822798). Season 9's Battle
// Pass, lobby, Fortbytes, Wargames, Tales of Beyond, Arena and earlier seasons' held playlists run on; its own: Sword Fight,
// the Block's 9.20 builds, Breakpoint's styles, Save the World's Invasion, Beyond the Stellar Horizon, the Sci-Fi Llama,
// the Tar Pit and Archeolo-Jess, Creative's Canyon Island, and the item shop's Undo.
const v920 = "6822798";
const v910 = "6639283";
const v9100 = "6573057";
const v851 = "6165369";
const at = (iso) => new Date(iso);
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const season9 = { mode: "auto", seasonStarts: { 9: "2019-05-09" } };
const typesOf = (states) => states[0]?.events.map(({ eventType }) => eventType) ?? [];
const withSession = (build, name, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-920-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

test("9.20 is known as 9.20 on its own data", () => {
  assert.equal(versionOf(v920), "9.20");
  assert.equal(allowedBuildList(["9.20"]).join(), v920);
  assert.equal(dataBuild(v920), v920);
  assert.equal(dataBuild(v910), v910, "9.10 keeps its own data");
  assert.equal(dataBuild(v9100), v910, "Update v9.10's build still plays on Content Update v9.10's");
  assert.equal(dataBuild("6700000"), v910, "a build Core doesn't know before 9.20 plays on 9.10's");
  assert.equal(dataBuild("6900000"), v920, "a build Core doesn't know before 9.21 plays on 9.20's");
  assert.equal(releasedOn(v920), Date.UTC(2019, 5, 6));
  const season = inBuild(v920, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront, season.numBookLevels], [9, "BRSeason9", 100]);
  assert.equal(inBuild(v920, seasonOfBuild), 9);
  assert.deepEqual(inBuild(v920, () => battlePassOffers()).map(({ offerId, price }) => [offerId, price]),
    [["core_br_season9_battlepass", 950], ["core_br_season9_battlebundle", 2800], ["33E185A84ED7B64F2856E69AADFD092C", 150]]);
});

test("9.20's cosmetics: 9.10's but Gemini and 49 more; the Storm Flip; Breakpoint's styles come with her", () => {
  const [c920, c910] = [inBuild(v920, athenaCosmetics), inBuild(v910, athenaCosmetics)];
  assert.equal(Object.keys(c920).length, 1889);
  assert.deepEqual(Object.keys(c910).filter((id) => !c920[id]), ["AthenaCharacter:cid_389_athena_commando_f_spacebunny"]);
  assert.equal(Object.keys(c920).filter((id) => !c910[id]).length, 49);
  assert.deepEqual(["AthenaCharacter:cid_430_athena_commando_m_stormsoldier", "AthenaCharacter:cid_429_athena_commando_f_neonlines"]
    .map((id) => c920[id]?.name), ["Tempest", "Breakpoint"]);
  assert.equal(c910["AthenaCharacter:cid_430_athena_commando_m_stormsoldier"], undefined);
  assert.equal(styleSchedules.bundleschedule_styles_neonlines, "AthenaCharacter:cid_429_athena_commando_f_neonlines");
  assert.equal(inBuild(v920, athenaChallengeSchedules).bundleschedule_styles_neonlines.category, "ChallengeCategory.Style");
});

test("9.20's modes: Sword Fight by its dates (Squads), Season 9's run on, Horde Rush is 9.21's", () => {
  const dated = { ltmOriginalDates: true };
  assert.equal(hasLtm("swordFightSeason9Squads", v920), true);
  assert.equal(ltmOn("swordFightSeason9Squads", v920, {}, at("2019-06-08T12:00:00Z")), false, "off by default");
  assert.equal(ltmOn("swordFightSeason9Squads", v920, dated, at("2019-06-08T12:00:00Z")), true);
  assert.equal(ltmOn("swordFightSeason9Squads", v920, dated, at("2019-06-13T12:00:00Z")), false);
  for (const id of ["swordFightSeason9Solo", "swordFightSeason9Duos"]) {
    assert.equal(ltmOn(id, v920, dated, at("2019-06-08T12:00:00Z")), false, `${id} has no window`);
    assert.equal(ltmOn(id, v920, { matchmakingModes: { [id]: true } }, at("2019-06-08T12:00:00Z")), true, `${id} by its switch`);
  }
  for (const id of ["swordFightSeason9Squads", "swordFightSeason9Solo", "swordFightSeason9Duos"]) assert.equal(hasLtm(id, v910), false, `${id} isn't 9.10's`);
  for (const id of ["fiftyFiftySeason9", "playgroundV2", "creative"]) assert.equal(ltmOn(id, v920, {}, at("2019-06-08T12:00:00Z")), true, id);
  for (const id of ["triosSeason9", "wicksBountySquads", "teamRumbleSeason9", "unvaultedSeason9Squads", "arenaSolo", "arenaDuos", "tournamentS9Solo"]) assert.equal(hasLtm(id, v920), true, id);
  assert.equal(ltmOn("teamRumbleSeason9", v920, dated, at("2019-06-08T12:00:00Z")), true);
  assert.deepEqual([335, 336, 337].map((id) => teamsOfPlaylist(id, v920)).map(({ maxTeamCount, maxTeamSize }) => [maxTeamCount, maxTeamSize]),
    [[100, 1], [100, 2], [100, 4]]);
  assert.equal(hasLtm("hordeRush", v920), false, "Update v9.21's Horde Rush");
  // Core-Backend #440: 9.20 holds 9.10's 72 earlier seasons' playlists.
  for (const id of ["endgame", "getawaySeason8Squads", "foodFight"]) {
    assert.deepEqual([hasLtm(id, v920), isHeldLtm(id, v920), isHeldLtm(id, v851)], [true, true, false], id);
    assert.equal(ltmOn(id, v920, {}, at("2019-06-08T12:00:00Z")), false, `${id} off by default`);
    assert.equal(ltmOn(id, v920, { matchmakingModes: { [id]: true } }, at("2019-06-08T12:00:00Z")), true, `${id} by its switch`);
  }
  assert.equal(isHeldLtm("swordFightSquads", v920), false, "Sword Fight is 9.20's own rotation");
});

test("Season 9's events run on 9.20 with Beyond the Stellar Horizon; its Block plays Firebase Omega, then Mythical Mayhem", () => {
  const flags = activeEventFlags(v920);
  for (const flag of [lobbySeason9, wargamesFlag, season9Phase1, season9Phase2]) assert.ok(flags.includes(flag), flag);
  assert.equal(flags.includes(season9Flag), false, "9.20's paks no longer name EventFlag.Season9");
  assert.ok(activeEventFlags(v910).includes(season9Flag));
  assert.equal(activeEventFlags(v910).includes(season9Phase2), false);
  assert.equal(inBuild(v920, () => isEventActive(stellarHorizon)), true);
  assert.equal(blockEventOf(v920)?.id, "block920");
  assert.equal(blockEventOf(v910)?.id, "block910", "9.10 keeps its Block");
  withConfig(season9, () => {
    assert.deepEqual(typesOf(inBuild(v920, () => blockStates(at("2019-06-08T12:00:00Z")))), [blockSlab(1)]);
    assert.deepEqual(typesOf(inBuild(v920, () => blockStates(at("2019-06-14T12:00:00Z")))), [blockSlab(2)]);
  });
  for (const id of ["season9Lobby", "wargames", "talesOfBeyond"]) assert.deepEqual(eventCard(id).ranges, [[6337466, 7095426]], id);
  assert.deepEqual(eventCard("stellarHorizon").ranges, [[6822798, 7095426]]);
  assert.deepEqual(eventCard("block920").ranges, [[6822798, 6922310]]);
  assert.deepEqual(season4Flag(ltmWax).builds, [6428087, 7095426]);
  assert.deepEqual(season4Flag(ltmVigilante).builds, [6573057, 7095426]);
});

test("Beyond the Stellar Horizon: its first quest at quest login on 9.20, Azalea Clark on the fourteenth; 9.10 doesn't give it", () => {
  assert.deepEqual(stellarHorizonQuests, ["s9_fetch_quest_b1"]);
  inBuild(v920, () => {
    assert.deepEqual(talesOfBeyondEventQuests(), ["s9_fetch_quest_a1", "s9_fetch_quest_b1"]);
    assert.ok(eventQuests().includes("s9_fetch_quest_b1"));
    assert.deepEqual(getQuest("s9_fetch_quest_b14").rewards.map(({ templateId }) => templateId), ["Hero:hid_outlander_028_retroscifistoryoutlander_sr_t01"]);
    assert.deepEqual(getQuest("s9_fetch_quest_b1").hiddenRewards.map(({ templateId }) => templateId), ["Quest:s9_landmark_quest_b2"]);
  });
  assert.deepEqual(inBuild(v910, talesOfBeyondEventQuests), ["s9_fetch_quest_a1"]);
});

test("9.20's Wargames: Invasion on, Update v9.21's Quantum Countdown not yet; 9.10's unchanged", () => {
  assert.deepEqual(wargamesGlobals(v920), ["bEnableIronCity=true", "+IronCityWargameTagList=Stat.Mission.IronCity.Pods",
    "+IronCityWargameTagList=Stat.Mission.IronCity.MStorm", "+IronCityWargameTagList=Stat.Mission.IronCity.Tiki",
    "+IronCityWargameTagList=Stat.Mission.IronCity.Saucer"]);
  assert.deepEqual(wargamesGlobals(v910), ["bEnableIronCity=true", "+IronCityWargameTagList=Stat.Mission.IronCity.Pods",
    "+IronCityWargameTagList=Stat.Mission.IronCity.MStorm", "+IronCityWargameTagList=Stat.Mission.IronCity.Tiki"]);
  const [q920, q910] = [inBuild(v920, wargamesQuests), inBuild(v910, wargamesQuests)];
  assert.ok(q920.includes("wargames_quest_wargame_saucer"));
  assert.ok(q920.includes("wargames_visibilityquest_wargame_saucer"));
  assert.equal(q920.some((id) => id.includes("telebomb")), false);
  assert.equal(q910.includes("wargames_quest_wargame_saucer"), false);
  const dailies = inBuild(v920, () => wargamesDailyQuests("twine"));
  assert.ok(dailies.some((id) => id.startsWith("wargames_dailyquest_saucer_")));
  assert.equal(dailies.some((id) => id.startsWith("wargames_dailyquest_telebomb_")), false);
});

test("9.20's Sci-Fi Llama takes the Military Llama's place for 500 Summer Tickets and gives a Retro Sci-Fi hero or weapon", () => {
  const llamas = (build) => inBuild(build, () => storefronts(null)).flatMap(({ catalogEntries }) => catalogEntries)
    .filter(({ offerId }) => /^core_event_(military|scifi)2019_llama$/.test(offerId)).map(({ offerId, prices }) => [offerId, prices[0].finalPrice])
    .filter(([offerId], index, all) => all.findIndex(([other]) => other === offerId) === index);
  withConfig(season9, () => {
    assert.deepEqual(llamas(v920), [["core_event_scifi2019_llama", 500]]);
    assert.deepEqual(llamas(v910), [["core_event_military2019_llama", 500]]);
  });
  inBuild(v920, () => {
    assert.equal(getCardPack(sciFiLlama).displayName, "Sci-Fi Llama");
    for (let i = 0; i < 20; i++) {
      const rolled = rollContents(sciFiLlama).map(({ templateId }) => templateId.toLowerCase());
      assert.ok(rolled.some((id) => id.includes("retroscifi")), rolled.join());
    }
  });
});

test("9.20's Event Store adds the Tar Pit (600 Gold), its Weekly Store Archeolo-Jess from 6 to 13 June", () => {
  withConfig(season9, () => {
    const offers = (build, store) => (inBuild(build, () => storefronts(null)).find(({ name }) => name === store)?.catalogEntries ?? [])
      .map(({ itemGrants, prices }) => [itemGrants[0].templateId, prices[0].finalPrice]);
    const tarPit = ["Schematic:sid_floor_tar_vr_t01", 2 * 300];
    assert.ok(offers(v920, eventStorefront).some(([id, price]) => id === tarPit[0] && price === tarPit[1]));
    assert.ok(offers(v920, eventStorefront).some(([id]) => id === "Hero:hid_outlander_027_dinooutlander_sr_t01"), "the earlier heroes stay");
    assert.equal(offers(v910, eventStorefront).some(([id]) => id === tarPit[0]), false);
  });
  assert.ok(inBuild(v920, () => getItem("Schematic:sid_floor_tar_vr_t01")));
});

test("9.20's Creative adds Canyon Island, not Prop Hunt Farm; 9.10 doesn't get it", () => {
  const seasons = { mode: "auto", seasonStarts: { 8: "2019-02-28", 9: "2019-05-09" } };
  const idsOf = (session) => plotsOf(session.profile("creative").profile).map(([, item]) => item.templateId.replace("CreativePlot:", ""));
  const plots = (build, name) => withConfig(seasons, () => withSession(build, name, (session) => {
    settleCreativePlots(session, at("2019-06-20T12:00:00Z"));
    return idsOf(session);
  }));
  const p920 = plots(v920, "plots920");
  assert.equal(p920.filter((plot) => plot === "desert_large").length, 1);
  assert.equal(p920.filter((plot) => plot === "flatgrass_large").length, 1);
  assert.equal(p920.some((plot) => plot.startsWith("loki")), false);
  assert.equal(plots(v910, "plots910").includes("desert_large"), false);
  assert.equal(inBuild(v910, () => isForeignTemplate("CreativePlot:desert_large")), true);
  assert.equal(inBuild(v920, () => isForeignTemplate("CreativePlot:desert_large")), false);
  assert.deepEqual([playerPlotType("CreativePlot:Desert_Large").name, playerPlotType("CreativePlot:Desert_Large").count], ["Canyon Island", 1]);
});

test("9.20's shop: Season 9's history with its cosmetics in, Tempest from 7 June; 9.10 never shows them", () => {
  const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 9: "2019-05-09" } };
  configureItemShop(() => shopConfig);
  try {
    const tempest = "AthenaCharacter:cid_430_athena_commando_m_stormsoldier";
    const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season9.json", import.meta.url), "utf8")).days;
    const day = history.find(({ featured, daily }) => [...featured, ...daily].some(([templateId]) => templateId === tempest));
    assert.equal(day.date, "2019-06-07");
    const offersOn = (build) => inBuild(build, () => {
      const shop = itemShopOffers(at(`${day.date}T12:00:00Z`), shopConfig);
      return [...shop.BRWeeklyStorefront, ...shop.BRDailyStorefront].map(({ templateId }) => templateId);
    });
    assert.ok(offersOn(v920).includes(tempest));
    assert.equal(offersOn(v910).includes(tempest), false);
  } finally {
    configureItemShop(null);
  }
});

test("9.20's Undo: a purchase opens undo_timeout; RefundMtxPurchase {quickReturn} gives it back without a return, once per cooldown", () => {
  assert.deepEqual([hasUndo(v920), hasUndo(v910)], [true, false]);
  const undo = (session, purchaseId) => refundMtxPurchase({ req: { body: { purchaseId, quickReturn: true } }, session });
  const vbucks = (session) => Object.values(session.profile("profile0").profile.items)
    .filter(({ templateId }) => templateId.toLowerCase().startsWith("currency:mtx")).reduce((sum, item) => sum + item.quantity, 0);
  withSession(v920, "undo920", (session) => {
    const tracker = session.profile("profile0");
    grant(session, "Currency:mtxpurchased", 800);
    tracker.profile.items[Object.keys(tracker.profile.items).find((id) => tracker.profile.items[id].templateId.toLowerCase() === "currency:mtxpurchased")].quantity -= 800;
    const now = new Date();
    const entry = recordPurchase(tracker, { offerId: "core_br_test", lootResult: [], totalMtxPaid: 800, spent: { "Currency:mtxpurchased": 800 }, now });
    const attributes = () => tracker.profile.stats.attributes;
    assert.equal(Date.parse(attributes().undo_timeout), now.getTime() + undoWindowMs);
    // The purchase screen reads the window from common_core (Core-Backend #445): the purchase's common_core changes carry it,
    // and campaign has none of it.
    const coreChanges = () => session.changedProfiles().find(({ profileId }) => profileId === "common_core").changes;
    assert.ok(coreChanges().some(({ changeType, name }) => changeType === "statModified" && name === "undo_timeout"));
    assert.equal(viewProfile(tracker.profile, "common_core").stats.attributes.undo_timeout, attributes().undo_timeout);
    assert.equal(viewProfile(tracker.profile, "campaign").stats.attributes.undo_timeout, undefined);
    undo(session, entry.purchaseId);
    assert.equal(vbucks(session), 800);
    const history = purchaseHistoryOf(attributes());
    assert.deepEqual([history.refundCredits, history.refundsUsed], [3, 0], "an undo spends no return");
    assert.notEqual(history.purchases[0].refundDate, "max");
    assert.equal(attributes().undo_timeout, "min");
    assert.equal(attributes().undo_cooldowns.length, 1);
    assert.equal(attributes().undo_cooldowns[0].offerId, "core_br_test");
    assert.ok(coreChanges().some(({ changeType, name }) => changeType === "statModified" && name === "undo_cooldowns"));
    assert.deepEqual(viewProfile(tracker.profile, "common_core").stats.attributes.undo_cooldowns, attributes().undo_cooldowns);
    assert.equal(viewProfile(tracker.profile, "campaign").stats.attributes.undo_cooldowns, undefined);
    assert.ok(Math.abs(Date.parse(attributes().undo_cooldowns[0].cooldownExpires) - (Date.now() + undoCooldownMs)) < 60000);
    // The same offer bought again is on cooldown.
    const again = recordPurchase(tracker, { offerId: "core_br_test", lootResult: [], totalMtxPaid: 800, spent: { "Currency:mtxpurchased": 800 } });
    assert.throws(() => undo(session, again.purchaseId), /can't be undone again/);
    // Another offer, once its window is over, can't be undone either.
    const other = recordPurchase(tracker, { offerId: "core_br_other", lootResult: [], totalMtxPaid: 500, spent: { "Currency:mtxpurchased": 500 },
      now: new Date(Date.now() - 2 * undoWindowMs) });
    assert.throws(() => undo(session, other.purchaseId), /time to undo/);
  });
  withSession(v910, "undo910", (session) => {
    const tracker = session.profile("profile0");
    const entry = recordPurchase(tracker, { offerId: "core_br_test", lootResult: [], totalMtxPaid: 800, spent: { "Currency:mtxpurchased": 800 } });
    assert.equal(tracker.profile.stats.attributes.undo_timeout, undefined, "9.10 has no Undo");
    assert.throws(() => undo(session, entry.purchaseId), /no Undo/);
  });
});

test("9.20's hotfix turns Undo on (bEnableUndoPurchase); 9.10's doesn't", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    const options = async (version, build) => String((await send({ host: "127.0.0.1", port: backend.port, method: "GET",
      path: "/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini",
      headers: { "User-Agent": `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`, Authorization: `bearer ${token}` } })).body ?? "");
    assert.ok((await options("9.20", v920)).split("\r\n").includes("bEnableUndoPurchase=true"));
    assert.equal((await options("9.10", v910)).includes("bEnableUndoPurchase"), false);
  } finally {
    backend.close();
  }
});

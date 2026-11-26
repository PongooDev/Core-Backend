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
import { blockEventOf, blockStates } from "../src/events/block.js";
import { activeEventFlags, blockSlab, configureEvents, lobbySeason9 } from "../src/events/events.js";
import { fortbytesDay } from "../src/events/fortbytes.js";
import { eventDaysOf } from "../src/events/fourteendays.js";
import { hasLtm, ltmOn } from "../src/events/ltms.js";
import { unvaultingFlagsNow } from "../src/events/unvaulting.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { isForeignTemplate } from "../src/gamedata/templates.js";
import { athenaQuestLogin, seasonRewardFunctions, setUpAthena } from "../src/profiles/athena.js";
import { plotsOf, settleCreativePlots } from "../src/profiles/creative.js";
import { buildOfSeason, buyBattlePass, buyTiers } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { configureItemShop, hasSeasonHistory, itemShopOffers, seasonEnd, seasonOfBuild, shopDay } from "../src/store/itemshop.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Fortnite 9.00 (Update v9.00, 9 May 2019; Season 9's first build): CL-6337466, on its own data (gamedata/6337466).
// Season 9's Battle Pass (BRSeason9; Rox, Sentinel, Vendetta), the Fortbytes, the Season 9 lobby and shop, the Block's 9.00
// builds, Update v9.00's rotation (Trios, Solid Gold, One Shot) and its one new MCP command, SetCompetitiveRegion.
const v900 = "6337466";
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
const replayDaysAgo = (days) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - days * 86400000)
  .toISOString().slice(0, 10);
const withSession = (build, name, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-900-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const templatesOf = (session) => Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);

test("9.00 is known, on its own data, Season 9's first build", () => {
  assert.equal(versionOf(v900), "9.00");
  assert.equal(allowedBuildList(["9.00"]).join(), v900);
  assert.equal(dataBuild(v900), v900);
  assert.equal(dataBuild("6300000"), v851, "a build between 8.51 and 9.00 plays on 8.51's");
  assert.equal(dataBuild("6400000"), v900, "a later build Core doesn't know plays on 9.00's");
  assert.equal(releasedOn(v900), Date.UTC(2019, 4, 9));
  assert.equal(buildOfSeason(9), "6639283", "9.10's Content Update build is Season 9's newest");
  assert.equal(buildOfSeason(8), v851, "8.51 stays Season 8's newest");
  assert.equal(seasonName(9), "Season 9 (9.00 – 9.10)");
  const season = inBuild(v900, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront, season.numBookLevels, season.numSeasonLevels], [9, "BRSeason9", 100, 100]);
  assert.equal(inBuild(v900, seasonOfBuild), 9);
  assert.deepEqual(season.firstWinRewards, [{ quantity: 1, templateId: "AthenaGlider:umbrella_season_09" }]);
  assert.deepEqual(inBuild(v900, () => battlePassOffers()).map(({ offerId, storefront, price }) => [offerId, storefront, price]),
    [["core_br_season9_battlepass", "BRSeason9", 950], ["core_br_season9_battlebundle", "BRSeason9", 2800],
      ["33E185A84ED7B64F2856E69AADFD092C", "BRSeason9", 150]]);
});

test("9.00's cosmetics: Rox, Sentinel, Vendetta and the rest; 117 added, none removed since 8.51", () => {
  const [c900, c851] = [inBuild(v900, athenaCosmetics), inBuild(v851, athenaCosmetics)];
  assert.equal(Object.keys(c900).length, 1795);
  assert.equal(Object.keys(c900).filter((id) => !c851[id]).length, 117);
  assert.deepEqual(Object.keys(c851).filter((id) => !c900[id]), []);
  for (const [id, name] of [["AthenaCharacter:cid_408_athena_commando_f_strawberrypilot", "Rox"],
    ["AthenaCharacter:cid_403_athena_commando_m_rooster", "Sentinel"],
    ["AthenaCharacter:cid_407_athena_commando_m_battlesuit", "Vendetta"],
    ["AthenaCharacter:cid_409_athena_commando_m_bunkerman", "Bunker Jonesy"],
    ["AthenaSkyDiveContrail:trails_id_051_neontubes", "Neo Tubes"]]) assert.equal(c900[id]?.name, name, id);
});

test("Season 9's Battle Pass and challenges: ten free weeks, tier 1's paid, cumulative and Fortbyte schedules", () => {
  const season = inBuild(v900, athenaSeason);
  assert.deepEqual(season.grantsToEveryone, [{ quantity: 1, templateId: "ChallengeBundleSchedule:season9_free_schedule" }]);
  const tier1 = season.bookPaidRewards.find(({ level }) => level === 1).rewards.map(({ templateId }) => templateId);
  for (const id of ["AthenaCharacter:cid_408_athena_commando_f_strawberrypilot", "AthenaCharacter:cid_403_athena_commando_m_rooster",
    "ChallengeBundleSchedule:season9_paid_schedule", "ChallengeBundleSchedule:season9_cumulative_schedule",
    "ChallengeBundleSchedule:season9_fortbyte_schedule"]) assert.ok(tier1.includes(id), id);
  inBuild(v900, () => {
    assert.equal(athenaChallengeSchedules().season9_free_schedule.bundles.length, 10);
    assert.equal(athenaChallengeSchedules().season9_fortbyte_schedule.eventName, lobbySeason9);
    const fortbytes = athenaChallengeBundles().questbundle_s9_fortbyte.quests;
    assert.equal(fortbytes.length, 100);
    assert.equal(fortbytes.filter(({ unlockType, unlockValue }) => unlockType === "DaysFromEventStart" && unlockValue === 0).length, 18,
      "Update v9.00: 18 Fortbytes on the first day");
  });
  assert.equal(inBuild(v851, athenaChallengeSchedules).season9_free_schedule, undefined, "8.51 has no Season 9");
});

test("the Fortbytes count Season 9's days on 9.00, while LobbySeason9 is served", () => {
  withConfig(season9, () => {
    assert.equal(inBuild(v900, () => fortbytesDay(at("2019-05-09T12:00:00Z"))), 0);
    assert.equal(inBuild(v900, () => eventDaysOf(lobbySeason9, at("2019-05-25T12:00:00Z"))), 16);
    assert.equal(inBuild(v851, () => fortbytesDay(at("2019-05-25T12:00:00Z"))), null, "8.51 serves no LobbySeason9");
  });
  withConfig({ ...season9, mode: "off" }, () => {
    assert.equal(inBuild(v900, () => fortbytesDay(at("2019-05-25T12:00:00Z"))), null, "events off: no flag, no days");
  });
});

test("a 9.00 player gets the free weeks, but the Fortbytes only with the Battle Pass (not by the lobby's flag)", () => {
  withConfig({ mode: "auto", seasonStarts: { 9: replayDaysAgo(3) } }, () => withSession(v900, "season900", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const templates = templatesOf(session);
    assert.ok(templates.includes("ChallengeBundleSchedule:season9_free_schedule"), "the free schedule");
    assert.ok(templates.includes("ChallengeBundle:questbundle_s9_week_001"), "week 1");
    assert.equal(templates.includes("ChallengeBundle:questbundle_s9_week_002"), false, "week 2 waits for its ninth day");
    assert.equal(templates.includes("ChallengeBundleSchedule:season9_fortbyte_schedule"), false, "no pass, no Fortbytes");
    assert.equal(session.profile("athena").profile.stats.attributes.season_num, 9);
  }));
});

test("9.00's shop: Season 9's own history, day by day from Epic's 9 May shop, an 84-day replay", () => {
  const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 9: "2019-05-09" } };
  configureItemShop(() => shopConfig);
  try {
    assert.equal(hasSeasonHistory(9), true);
    const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season9.json", import.meta.url), "utf8")).days;
    assert.equal(history.length, 84);
    assert.deepEqual([history[0].date, history.at(-1).date], ["2019-05-09", "2019-07-31"]);
    const cosmetics = inBuild(v900, athenaCosmetics);
    inBuild(v900, () => {
      const first = itemShopOffers(at("2019-05-09T12:00:00Z"), shopConfig);
      const offers = [...first.BRWeeklyStorefront, ...first.BRDailyStorefront];
      const recorded = new Set([...history[0].featured, ...history[0].daily].map(([templateId]) => templateId));
      assert.ok(offers.length >= 10, "the day's shop");
      assert.ok(offers.every(({ templateId }) => recorded.has(templateId)), "only the day's recorded items");
      assert.ok(offers.every(({ templateId }) => cosmetics[templateId]), "only 9.00's cosmetics");
      assert.deepEqual(shopDay(at("2019-05-14T12:00:00Z"), shopConfig), history[5]);
      assert.equal(shopDay(at("2019-08-01T12:00:00Z"), shopConfig).date, "2019-05-09", "the 85th day is the first again");
      assert.equal(seasonEnd(at("2019-05-14T12:00:00Z"), shopConfig).toISOString().slice(0, 10), "2019-08-01");
    });
  } finally {
    configureItemShop(null);
  }
});

test("Season 9's LTMs: 9.00's lobby's 50v50 and Playground, Update v9.00's rotation by its Original dates", () => {
  const dated = { ltmOriginalDates: true };
  withConfig(season9, () => {
    for (const id of ["fiftyFiftySeason9", "playgroundV2", "creative"]) assert.equal(ltmOn(id, v900, {}, at("2019-05-20T12:00:00Z")), true, id);
    for (const id of ["triosSeason9", "solidGoldSeason9Squads", "oneShotSeason9Squads"]) {
      assert.equal(ltmOn(id, v900, {}, at("2019-05-10T12:00:00Z")), false, `${id} is off by default`);
      assert.equal(ltmOn(id, v900, dated, at("2019-05-10T12:00:00Z")), true, `${id} in its window`);
      assert.equal(ltmOn(id, v900, dated, at("2019-05-20T12:00:00Z")), false, `${id} after 9.01's day`);
      assert.deepEqual([hasLtm(id, v900), hasLtm(id, v851)], [true, false], id);
    }
    // Season 8's modes, the Arena and the tournaments end with 8.51; Air Royale's and Sword Fight's playlists are gone.
    for (const id of ["fiftyFiftySeason8", "airRoyaleDuos", "endgame", "unvaulting", "arenaSolo", "tournamentS8Solo"]) {
      assert.deepEqual([hasLtm(id, v900), hasLtm(id, v851)], [false, true], id);
    }
  });
});

test("9.00's lobby and Block: LobbySeason9, Modern Mansion then Custom Car Carpet; nothing of Season 8's", () => {
  assert.ok(activeEventFlags(v900).includes(lobbySeason9));
  for (const flag of ["EventFlag.LobbySeason8", "EventFlag.Spring2019"]) assert.equal(activeEventFlags(v900).includes(flag), false, flag);
  assert.equal(activeEventFlags(v851).includes(lobbySeason9), false);
  assert.equal(blockEventOf(v900)?.id, "block900");
  assert.equal(blockEventOf(v851)?.id, "block850", "8.51 keeps 8.50's Block");
  withConfig(season9, () => {
    assert.deepEqual(typesOf(inBuild(v900, () => blockStates(at("2019-05-10T12:00:00Z")))), [blockSlab(1)]);
    assert.deepEqual(typesOf(inBuild(v900, () => blockStates(at("2019-05-20T12:00:00Z")))), [blockSlab(2)]);
    assert.deepEqual(inBuild(v900, () => unvaultingFlagsNow(at("2019-05-10T12:00:00Z"))), [], "the Unvaulting is 8.51's");
  });
  assert.deepEqual(eventCard("block900").ranges, [[6337466, 6428087]]);
  assert.deepEqual(eventCard("season9Lobby").ranges, [[6337466, 6639283]]);
});

test("9.00's SetCompetitiveRegion is accepted with no profile change", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Region9");
    const command = (name, body) => send({
      host: "127.0.0.1",
      port: backend.port,
      method: "POST",
      path: `/fortnite/api/game/v2/profile/${player.accountId}/client/${name}?profileId=athena&rvn=-1`,
      headers: { "User-Agent": "game=Fortnite, engine=UE4, build=++Fortnite+Release-9.00-CL-6337466",
        Authorization: `bearer ${player.token}`, "Content-Type": "application/json" }
    }, JSON.stringify(body));
    const before = (await command("QueryProfile", {})).body.profileChanges[0].profile;
    const answer = await command("SetCompetitiveRegion", { newlySelectedRegionId: "EU" });
    assert.equal(answer.status, 200);
    assert.equal(answer.body.errorCode, undefined);
    const after = (await command("QueryProfile", {})).body.profileChanges[0].profile;
    assert.deepEqual(after.stats.attributes, before.stats.attributes);
  } finally {
    backend.close();
  }
});

test("buying Season 9's Battle Pass on 9.00 gives the Fortbytes: the first day's 18, not the later days'", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Fortbytes9");
    const command = (name, profileId, body) => send({
      host: "127.0.0.1",
      port: backend.port,
      method: "POST",
      path: `/fortnite/api/game/v2/profile/${player.accountId}/client/${name}?profileId=${profileId}&rvn=-1`,
      headers: { "User-Agent": "game=Fortnite, engine=UE4, build=++Fortnite+Release-9.00-CL-6337466",
        Authorization: `bearer ${player.token}`, "Content-Type": "application/json" }
    }, JSON.stringify(body));
    const templates = async () => Object.values((await command("QueryProfile", "athena", {})).body.profileChanges[0].profile.items)
      .map(({ templateId }) => templateId.toLowerCase());
    await command("ClientQuestLogin", "athena", {});
    assert.equal((await templates()).includes("challengebundleschedule:season9_fortbyte_schedule"), false);
    assert.equal((await post(backend.port, `/admin/api/accounts/${player.accountId}/currency`, undefined, { key: "vbucks", quantity: 5000 })).status, 200);
    const bought = await command("PurchaseCatalogEntry", "common_core",
      { offerId: "core_br_season9_battlepass", purchaseQuantity: 1, currency: "MtxCurrency", expectedPrice: 950 });
    assert.equal(bought.status, 200, JSON.stringify(bought.body));
    await command("ClientQuestLogin", "athena", {});
    const held = await templates();
    assert.ok(held.includes("challengebundleschedule:season9_fortbyte_schedule"), "tier 1 gives the schedule");
    assert.ok(held.includes("quest:quest_br_s9_fortbyte_01"), "a first day's Fortbyte");
    assert.equal(held.includes("quest:quest_br_s9_fortbyte_13"), false, "the sixteenth day's waits");
    assert.equal(held.filter((id) => /^quest:quest_br_s9_fortbyte_\d+$/.test(id)).length, 18);
  } finally {
    backend.close();
  }
});

// The tier Fortbytes (HasLeveledUpBattlePass): Quest_BR_S9_Fortbyte_06 to _10 at tiers 20 to 100; _07 (Weight 25) is
// Fortbyte #25, "Awarded at Battle Pass Tier 40".
const questOf = (session, questId) => Object.values(session.profile("athena").profile.items)
  .find(({ templateId }) => templateId.toLowerCase() === `quest:${questId}`);
const fortbytesHeld = (session) => Object.values(session.profile("athena").profile.items)
  .filter(({ templateId }) => templateId.toLowerCase() === "token:athenafortbyte").reduce((sum, { quantity }) => sum + quantity, 0);

test("buying tiers past 40 on 9.00 gives Fortbyte #25 (tier 40), and tier 20's, not tier 60's", () => {
  withConfig({ mode: "auto", seasonStarts: { 9: replayDaysAgo(0) } }, () => withSession(v900, "tierbytes900", (session) => {
    setUpAthena(session);
    buyBattlePass(session, seasonRewardFunctions());
    athenaQuestLogin(session);
    assert.equal(questOf(session, "quest_br_s9_fortbyte_07")?.attributes.quest_state, "Active");
    buyTiers(session, 40, seasonRewardFunctions());
    assert.equal(session.profile("athena").profile.stats.attributes.book_level, 41);
    assert.equal(questOf(session, "quest_br_s9_fortbyte_06").attributes.quest_state, "Claimed", "tier 20");
    assert.equal(questOf(session, "quest_br_s9_fortbyte_07").attributes.quest_state, "Claimed", "tier 40: Fortbyte #25");
    assert.equal(questOf(session, "quest_br_s9_fortbyte_08").attributes.quest_state, "Active", "tier 60 waits");
    assert.equal(questOf(session, "quest_br_s9_fortbyte_08").attributes.completion_glyph_08, 41);
    assert.equal(fortbytesHeld(session), 2);
  }));
});

test("a 9.00 player already past tier 40 when the Fortbytes come gets them at quest login", () => {
  withConfig({ mode: "auto", seasonStarts: { 9: replayDaysAgo(0) } }, () => withSession(v900, "pastbytes900", (session) => {
    setUpAthena(session);
    buyBattlePass(session, seasonRewardFunctions());
    buyTiers(session, 64, seasonRewardFunctions());
    athenaQuestLogin(session);
    for (const id of ["06", "07", "08"]) assert.equal(questOf(session, `quest_br_s9_fortbyte_${id}`).attributes.quest_state, "Claimed", id);
    assert.equal(questOf(session, "quest_br_s9_fortbyte_09").attributes.quest_state, "Active", "tier 80 waits");
  }));
});

test("the Battle Bundle's 25 tiers and bought tiers give 9.00's tier Fortbytes through PurchaseCatalogEntry", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "TierBytes9");
    const command = (name, profileId, body) => send({
      host: "127.0.0.1",
      port: backend.port,
      method: "POST",
      path: `/fortnite/api/game/v2/profile/${player.accountId}/client/${name}?profileId=${profileId}&rvn=-1`,
      headers: { "User-Agent": "game=Fortnite, engine=UE4, build=++Fortnite+Release-9.00-CL-6337466",
        Authorization: `bearer ${player.token}`, "Content-Type": "application/json" }
    }, JSON.stringify(body));
    const states = async () => Object.fromEntries(Object.values((await command("QueryProfile", "athena", {})).body.profileChanges[0].profile.items)
      .map(({ templateId, attributes }) => [templateId.toLowerCase(), attributes.quest_state]));
    await command("ClientQuestLogin", "athena", {});
    assert.equal((await post(backend.port, `/admin/api/accounts/${player.accountId}/currency`, undefined, { key: "vbucks", quantity: 6000 })).status, 200);
    const bundle = await command("PurchaseCatalogEntry", "common_core",
      { offerId: "core_br_season9_battlebundle", purchaseQuantity: 1, currency: "MtxCurrency", expectedPrice: 2800 });
    assert.equal(bundle.status, 200, JSON.stringify(bundle.body));
    await command("ClientQuestLogin", "athena", {});
    let held = await states();
    assert.equal(held["quest:quest_br_s9_fortbyte_06"], "Claimed", "the bundle's tier 26 is past tier 20");
    assert.equal(held["quest:quest_br_s9_fortbyte_07"], "Active");
    const tiers = await command("PurchaseCatalogEntry", "common_core",
      { offerId: "33E185A84ED7B64F2856E69AADFD092C", purchaseQuantity: 15, currency: "MtxCurrency", expectedPrice: 2250 });
    assert.equal(tiers.status, 200, JSON.stringify(tiers.body));
    held = await states();
    assert.equal(held["quest:quest_br_s9_fortbyte_07"], "Claimed", "tier 41: Fortbyte #25 with the purchase, no login needed");
    assert.equal(held["quest:quest_br_s9_fortbyte_08"], "Active");
  } finally {
    backend.close();
  }
});

// Sentinel's back bling (HasAccumulatedItem): Quest_BR_S9_Rooster_CollectGlyphs_01_A, 10 Fortbytes, gives BID_261_Rooster and
// leads to _01_B, Battle Pass tier 99, its second style (VTID_203_Rooster_BackBling_StyleB).
test("a 9.00 player's 10th Fortbyte gives Sentinel's back bling and his tier 99 stage, which tier 99 completes", () => {
  withConfig({ mode: "auto", seasonStarts: { 9: replayDaysAgo(0) } }, () => withSession(v900, "rooster900", (session) => {
    setUpAthena(session);
    buyBattlePass(session, seasonRewardFunctions());
    athenaQuestLogin(session);
    const tracker = session.profile("athena");
    assert.equal(questOf(session, "quest_br_s9_rooster_collectglyphs_01_a")?.attributes.quest_state, "Active");
    // Nine Fortbytes found before; tier 20's (Quest_BR_S9_Fortbyte_06) is the tenth.
    tracker.addItem("ninebytes", { templateId: "Token:athenafortbyte", attributes: { item_seen: false }, quantity: 9 });
    athenaQuestLogin(session);
    assert.equal(questOf(session, "quest_br_s9_strawberrypilot_collectglyphs_01").attributes.quest_state, "Claimed", "Rox's 5 Fortbytes");
    assert.equal(questOf(session, "quest_br_s9_rooster_collectglyphs_01_a").attributes.completion_athena_battlepass_rooster_collectglyphs_01_a, 9);
    assert.equal(questOf(session, "quest_br_s9_rooster_collectglyphs_01_b"), undefined, "not handed out before the 10th");
    buyTiers(session, 19, seasonRewardFunctions());
    assert.equal(fortbytesHeld(session), 10);
    assert.equal(questOf(session, "quest_br_s9_rooster_collectglyphs_01_a").attributes.quest_state, "Claimed");
    assert.ok(templatesOf(session).includes("AthenaBackpack:bid_261_rooster"));
    const stage = questOf(session, "quest_br_s9_rooster_collectglyphs_01_b");
    assert.equal(stage?.attributes.quest_state, "Active", "the tier 99 stage, given at once");
    assert.equal(stage.attributes.completion_athena_battlepass_rooster_collectglyphs_01_b, 20);
    assert.equal(questOf(session, "quest_br_s9_rooster_collectglyphs_02").attributes.quest_state, "Active", "20 Fortbytes waits");
    buyTiers(session, 79, seasonRewardFunctions());
    assert.equal(questOf(session, "quest_br_s9_rooster_collectglyphs_01_b").attributes.quest_state, "Claimed", "tier 99");
    const backpack = Object.values(tracker.profile.items).find(({ templateId }) => templateId === "AthenaBackpack:bid_261_rooster");
    assert.ok(backpack.attributes.variants.some(({ channel, owned }) => channel === "Particle" && owned.includes("Particle2")));
  }));
});

// Core-Backend #441: Update v9.00's Meadow Island (FlatGrass_Large), from 9.00, the only plot 9.00's, 9.01's and 9.10's paks
// add; 8.51 doesn't get it, and an account made on 8.51 gets it at its first 9.00 login.
test("Season 9's Creative island: 9.00, 9.01 and 9.10 a Meadow island, 8.51 none; an 8.51 account gets it on 9.00", () => {
  const [v901, v910] = ["6428087", "6639283"];
  const seasons = { mode: "auto", seasonStarts: { 8: "2019-02-28", 9: "2019-05-09" } };
  const now = at("2019-06-20T12:00:00Z");
  const idsOf = (session) => plotsOf(session.profile("creative").profile).map(([, item]) => item.templateId.replace("CreativePlot:", ""));
  const plots = (build, name) => withConfig(seasons, () => withSession(build, name, (session) => {
    settleCreativePlots(session, now);
    return idsOf(session);
  }));
  const season8 = ["temperate_medium", "arctic_medium", "theblock_season7", "arctic_competitive_medium1", "sandbar_large",
    "volcano_large", "blackglass_medium", "tropical_medium", "military_medium"];
  const count = (list, id) => list.filter((plot) => plot === id).length;
  assert.deepEqual([...new Set(plots(v851, "plots851-441"))].sort(), [...season8].sort());
  for (const [build, name] of [[v900, "plots900-441"], [v901, "plots901-441"], [v910, "plots910-441"]]) {
    const list = plots(build, name);
    assert.deepEqual([...new Set(list)].sort(), [...season8, "flatgrass_large"].sort(), build);
    assert.equal(count(list, "flatgrass_large"), 1, build);
    assert.equal(list.some((plot) => plot.startsWith("razor")), false, build);
  }
  assert.equal(inBuild(v851, () => isForeignTemplate("CreativePlot:flatgrass_large")), true);
  assert.equal(inBuild(v900, () => isForeignTemplate("CreativePlot:flatgrass_large")), false);
  assert.equal(inBuild(v910, () => isForeignTemplate("CreativePlot:flatgrass_large")), false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-900-"));
  try {
    withConfig(seasons, () => {
      const store = createProfileStore(dir);
      inBuild(v851, () => {
        const session = openSession(store, "meadow441");
        settleCreativePlots(session, now);
        session.commit();
      });
      const given = inBuild(v900, () => {
        const session = openSession(store, "meadow441");
        const added = settleCreativePlots(session, now);
        assert.equal(count(idsOf(session), "flatgrass_large"), 1);
        return added;
      });
      assert.equal(given, 1, "only the Meadow island is new at the 9.00 login");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

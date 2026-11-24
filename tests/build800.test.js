import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { battlePassOffers } from "../src/battlepass/season2.js";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { releasedOn, seasonName, versionOf } from "../src/builds/detect.js";
import { activeEventFlags, configureEvents } from "../src/events/events.js";
import { hasLtm, ltmFrontEndPlaylists, ltmOn, ltms } from "../src/events/ltms.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { athenaQuestLogin, setUpAthena } from "../src/profiles/athena.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { send, startBackend, userLogin } from "./helpers.js";
import { storefronts } from "../src/store/catalog.js";
import { hasGifting } from "../src/store/gifting.js";
import { configureItemShop, hasSeasonHistory, itemShopOffers, seasonEnd, seasonOfBuild, shopDay, weeklyStoreEnd } from "../src/store/itemshop.js";

// Fortnite 8.00 (Update v8.00, 28 February 2019; Season 8's first build): CL-5203069, on its own data (gamedata/5203069).
// Battle Royale: Season 8's Battle Pass (BRSeason8, 100 tiers; Blackheart, Hybrid, Peely, Sidewinder, Ember and Luxe),
// its ten free weekly challenge bundles, the cumulative and paid (Blackheart's and Hybrid's) ones.
const v800 = "5203069";
const v740 = "5046157";
const at = (iso) => new Date(iso);
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
// Season 8's replay started `days` days before today (UTC), so that today is 28 February 2019 + days on it.
const replayDaysAgo = (days) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - days * 86400000)
  .toISOString().slice(0, 10);
const season8 = { mode: "auto", seasonStarts: { 8: replayDaysAgo(3) } };
const withSession = (build, name, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-800-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

test("8.00 is known, on its own data, Season 8's first build", () => {
  assert.equal(versionOf(v800), "8.00");
  assert.equal(allowedBuildList(["8.00"]).join(), v800);
  assert.equal(dataBuild(v800), v800);
  assert.equal(dataBuild("5150000"), v740, "a build between 7.40 and 8.00 plays on 7.40's");
  assert.equal(dataBuild("5300000"), v800, "a build between 8.00 and 8.20 plays on 8.00's");
  assert.equal(releasedOn(v800), Date.UTC(2019, 1, 28));
  assert.equal(buildOfSeason(8), "6058028", "8.50 is Season 8's newest (tests/build850.test.js)");
  assert.equal(seasonName(8), "Season 8 (8.00 – 8.50)");
  const season = inBuild(v800, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront, season.numBookLevels, season.numSeasonLevels], [8, "BRSeason8", 100, 100]);
  assert.equal(inBuild(v800, seasonOfBuild), 8);
  // Gifting is 6.31's and later, so 8.00 has it.
  assert.equal(hasGifting(v800), true);
  // Its Battle Pass offers: Season 8's own pass and bundle, 950 and 2,800 V-Bucks, and its data's tier offer.
  assert.deepEqual(inBuild(v800, () => battlePassOffers()).map(({ offerId, storefront, price }) => [offerId, storefront, price]),
    [["core_br_season8_battlepass", "BRSeason8", 950], ["core_br_season8_battlebundle", "BRSeason8", 2800],
      ["E07E41D52D4A425F8DC6592496B75301", "BRSeason8", 150]]);
});

test("8.00's cosmetics: Blackheart, Hybrid, Peely, Sidewinder, Ember and Luxe; 123 added, none removed since 7.40", () => {
  const [c800, c740] = [inBuild(v800, athenaCosmetics), inBuild(v740, athenaCosmetics)];
  assert.equal(Object.keys(c800).length, 1510);
  assert.equal(Object.keys(c800).filter((id) => !c740[id]).length, 123);
  assert.deepEqual(Object.keys(c740).filter((id) => !c800[id]), []);
  for (const [id, name] of [["AthenaCharacter:cid_347_athena_commando_m_pirateprogressive", "Blackheart"],
    ["AthenaCharacter:cid_346_athena_commando_m_dragonninja", "Hybrid"],
    ["AthenaCharacter:cid_349_athena_commando_m_banana", "Peely"],
    ["AthenaCharacter:cid_348_athena_commando_f_medusa", "Sidewinder"],
    ["AthenaCharacter:cid_351_athena_commando_f_fireelf", "Ember"],
    ["AthenaCharacter:cid_352_athena_commando_f_shiny", "Luxe"],
    ["AthenaDance:eid_banana", "Nana Nana"], ["AthenaDance:eid_conga", "Conga"]]) {
    assert.equal(c800[id]?.name, name, id);
  }
});

test("Season 8's Battle Pass and challenges: BRSeason8, ten free weeks from the 28th, tier 1's paid bundles", () => {
  const season = inBuild(v800, athenaSeason);
  assert.deepEqual(season.grantsToEveryone, [{ quantity: 1, templateId: "ChallengeBundleSchedule:season8_free_schedule" }]);
  assert.deepEqual(season.challengeSchedulesAlwaysShown,
    ["season8_free_schedule", "season8_cumulative_schedule", "season8_paid_schedule"]);
  for (const token of ["Token:athenanextseasontierboost", "Token:athenabattlepass_weeklychallenge_token",
    "Token:athenabattlepass_weeklybundle_token"]) assert.ok(season.removedAtSeasonEnd.includes(token), token);
  assert.deepEqual(season.seasonRewards.find(({ level }) => level === 2).rewards,
    [{ quantity: 2, templateId: "AccountResource:athenabattlestar" }]);
  const tier1 = season.bookPaidRewards.find(({ level }) => level === 1).rewards.map(({ templateId }) => templateId);
  for (const id of ["AthenaCharacter:cid_347_athena_commando_m_pirateprogressive", "AthenaCharacter:cid_346_athena_commando_m_dragonninja",
    "ChallengeBundleSchedule:season8_paid_schedule"]) assert.ok(tier1.includes(id), id);

  const free = inBuild(v800, athenaChallengeSchedules).season8_free_schedule;
  assert.equal(free.bundles.length, 10);
  assert.deepEqual(free.bundles.slice(0, 3).map(({ unlockType, unlockValue }) => [unlockType, unlockValue]),
    [["OnScheduleGranted", 0], ["DaysSinceEventStart", 9], ["DaysSinceEventStart", 16]]);
  const week = (n) => inBuild(v800, athenaChallengeBundles)[`questbundle_s8_week_00${n}`].quests.map(({ quest }) => quest);
  assert.equal(week(1).length, 7);
  assert.ok(week(1).includes("quest_br_visit_piratecamps"));
  assert.ok(week(2).includes("quest_br_damage_player_with_cannon"));
  assert.equal(inBuild(v740, athenaChallengeSchedules).season8_free_schedule, undefined, "7.40 has no Season 8");
});

test("an 8.00 player's first login gets Season 8's free schedule and its first week, not the later ones", () => {
  withConfig(season8, () => withSession(v800, "season800", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const ids = Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);
    assert.ok(ids.includes("ChallengeBundleSchedule:season8_free_schedule"), "the schedule");
    assert.ok(ids.includes("ChallengeBundle:questbundle_s8_week_001"), "week 1");
    assert.ok(ids.includes("Quest:quest_br_visit_piratecamps"), "week 1's first challenge");
    assert.equal(ids.includes("ChallengeBundle:questbundle_s8_week_002"), false, "week 2 waits for its ninth day");
    assert.equal(session.profile("athena").profile.stats.attributes.season_num, 8);
  }));
});

test("8.00's shop: Season 8's own history, day by day from Epic's 28 February shop", () => {
  const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 8: "2019-02-28" } };
  configureItemShop(() => shopConfig);
  try {
    assert.equal(hasSeasonHistory(8), true);
    assert.equal(hasSeasonHistory(7), true);
    const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season8.json", import.meta.url), "utf8")).days;
    assert.equal(history.length, 70);
    assert.deepEqual([history[0].date, history.at(-1).date], ["2019-02-28", "2019-05-08"]);
    const cosmetics = inBuild(v800, athenaCosmetics);
    inBuild(v800, () => {
      // 28 February 2019 had 7.40's last shop and Season 8's launch shop (Fishstick's pirate style, Chomp Sr. with Chomp
      // Jr. and Laser Chomp): both are in, as 14 February's two were for 7.40.
      const launch = itemShopOffers(at("2019-02-28T12:00:00Z"), shopConfig);
      const offers = [...launch.BRWeeklyStorefront, ...launch.BRDailyStorefront];
      const ids = offers.map(({ templateId }) => templateId);
      const recorded = new Set([...history[0].featured, ...history[0].daily].map(([templateId]) => templateId));
      assert.ok(offers.length >= 20, "the day's two shops");
      assert.ok(ids.every((templateId) => recorded.has(templateId)), "only the day's recorded items");
      for (const templateId of ["AthenaCharacter:cid_315_athena_commando_m_teriyakifish", "AthenaCharacter:cid_168_athena_commando_m_shark",
        "AthenaPickaxe:pickaxe_id_017_shark", "AthenaGlider:glider_id_058_shark"]) assert.ok(ids.includes(templateId), templateId);
      assert.ok(offers.every(({ templateId }) => cosmetics[templateId]), "only 8.00's cosmetics");
      // Each UTC day is its own day of the 70, and the 71st is the first again.
      assert.deepEqual(shopDay(at("2019-03-05T12:00:00Z"), shopConfig), history[5]);
      assert.equal(shopDay(at("2019-05-09T12:00:00Z"), shopConfig).date, "2019-02-28");
      // Its countdowns follow the replay: the weekly pair at the end of its 7 seeded days, the season at the end of its own
      // 70 (28 February to 8 May 2019).
      const now = at("2019-03-05T12:00:00Z");
      const weekEnd = weeklyStoreEnd(now, shopConfig);
      const end = seasonEnd(now, shopConfig);
      assert.ok(weekEnd > now && weekEnd - now <= 7 * 86400000, "the weekly storefront's end");
      assert.equal(end.toISOString().slice(0, 10), "2019-05-09");
    });
  } finally {
    configureItemShop(null);
  }
});

test("Season 8's LTMs: 8.00's lobby, Close Encounters, Team Rumble and Buccaneer's Bounty's days", () => {
  const replay = { mode: "auto", seasonStarts: { 8: "2019-02-28" } };
  const dated = { ltmOriginalDates: true };
  withConfig(replay, () => {
    // 8.00's DefaultGame.ini: 50v50, Playground and Creative are on, and Close Encounters (Update v8.00's other mode) is
    // not a default.
    for (const id of ["fiftyFiftySeason8", "playgroundV2", "creative"]) assert.equal(ltmOn(id, v800, {}, at("2019-03-10T12:00:00Z")), true, id);
    assert.equal(ltmOn("closeEncountersSeason8Squads", v800, {}, at("2019-03-01T00:00:00Z")), false);
    // Playground and 50v50 stay on with Original dates too: their windows cover Season 8.
    for (const id of ["fiftyFiftySeason8", "playgroundV2"]) assert.equal(ltmOn(id, v800, dated, at("2019-03-10T12:00:00Z")), true, id);
    // Its launch window (8.00 to 8.10) and Buccaneer's Bounty's third day.
    assert.equal(ltmOn("closeEncountersSeason8Squads", v800, dated, at("2019-03-01T00:00:00Z")), true);
    assert.equal(ltmOn("closeEncountersSeason8Squads", v800, dated, at("2019-03-20T00:00:00Z")), false);
    const days = [["flyExplosivesSeason8Squads", "2019-04-10"], ["oneShotSeason8Squads", "2019-04-11"],
      ["closeEncountersSeason8Squads", "2019-04-12"], ["solidGoldSeason8Squads", "2019-04-13"],
      ["teamRumbleSeason8", "2019-04-10"], ["classicSeason8Squads", "2019-04-15"]];
    for (const [id, day] of days) assert.equal(ltmOn(id, v800, dated, at(`${day}T12:00:00Z`)), true, id);
    assert.equal(ltmOn("solidGoldSeason8Squads", v800, dated, at("2019-04-11T12:00:00Z")), false);
    assert.equal(ltmOn("classicSeason8Squads", v800, dated, at("2019-04-11T12:00:00Z")), false);
    // Nothing Season 8's later builds brought is served: no Getaway, lava or plane mode is one of 8.00's playlists.
    assert.equal(ltms.filter(({ id, seasons }) => seasons?.includes(8) && hasLtm(id, v800)).some(({ playlistName }) => /heist|lava|goose/i.test(playlistName ?? "")), false);
    // 8.00's entries are 8.00's alone, and 7.40's modes aren't 8.00's.
    for (const id of ["fiftyFiftySeason8", "closeEncountersSeason8Squads", "teamRumbleSeason8", "flyExplosivesSeason8Squads"])
      assert.deepEqual([hasLtm(id, v800), hasLtm(id, v740)], [true, false], id);
    assert.equal(hasLtm("fiftyFiftySeason7", v800), false);
    // The lobby hotfix keeps 8.00's shipped 50v50, Playground and Creative, and lists the Season 8 modes.
    const frontEnd = ltmFrontEndPlaylists(v800, {}).map(({ name }) => name);
    for (const name of ["Playlist_50v50", "Playlist_Playground", "Playlist_PlaygroundV2", "Playlist_Respawn_24"]) assert.ok(frontEnd.includes(name), name);
    assert.equal(frontEnd.includes("Playlist_Gungame_Solo"), false);
  });
});

test("8.00's lobby: the Season 8 background flag, which 7.40 doesn't serve", () => {
  assert.ok(activeEventFlags(v800).includes("EventFlag.LobbySeason8"));
  assert.equal(activeEventFlags(v740).includes("EventFlag.LobbySeason8"), false);
  assert.ok(activeEventFlags(v740).includes("EventFlag.LobbySeason7"));
});

test("8.00's Party Assist pins and clears athena's party_assist_quest", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Party8");
    const command = (name, profileId, body) => send({
      host: "127.0.0.1",
      port: backend.port,
      method: "POST",
      path: `/fortnite/api/game/v2/profile/${player.accountId}/client/${name}?profileId=${profileId}&rvn=-1`,
      headers: { "User-Agent": "game=Fortnite, engine=UE4, build=++Fortnite+Release-8.00-CL-5203069",
        Authorization: `bearer ${player.token}`, "Content-Type": "application/json" }
    }, JSON.stringify(body));
    const athena = async () => (await command("QueryProfile", "athena", {})).body.profileChanges[0].profile;
    const attributes = async () => (await athena()).stats.attributes;
    assert.equal((await attributes()).party_assist_quest, "", "none pinned yet");
    // The client pins the athena quest item's id (an items key), not its "Quest:<template>" templateId.
    await command("ClientQuestLogin", "athena", {});
    const items = (await athena()).items;
    const questItemId = Object.keys(items).find((id) => items[id].templateId.startsWith("Quest:"));
    const otherItemId = Object.keys(items).find((id) => !items[id].templateId.startsWith("Quest:"));
    assert.ok(questItemId, "week 1's quests");
    // Anything else (an unknown id, another item, a templateId) is refused and pins nothing.
    for (const id of ["5b0c6f2a-3e5d-4c8f-9a71-2d4b6e8c1f30", otherItemId, items[questItemId].templateId]) {
      const refused = await command("SetPartyAssistQuest", "athena", { questToPinAsPartyAssist: id });
      assert.equal(refused.body.errorCode, "errors.com.epicgames.fortnite.item_not_found", id);
    }
    assert.equal((await attributes()).party_assist_quest, "");
    const pinned = await command("SetPartyAssistQuest", "athena", { questToPinAsPartyAssist: questItemId });
    assert.equal(pinned.status, 200);
    assert.equal(pinned.body.profileChanges[0].profile.stats.attributes.party_assist_quest, questItemId);
    assert.equal((await attributes()).party_assist_quest, questItemId);
    await command("SetPartyAssistQuest", "athena", { questToPinAsPartyAssist: "" });
    assert.equal((await attributes()).party_assist_quest, "");
  } finally {
    backend.close();
  }
});

test("8.00's Hero Loadout (#399): a loadout led by the lead hero, the active one in selected_hero_loadout, and its commands", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Loadout8");
    const command = (name, body, build = "8.00-CL-5203069") => send({
      host: "127.0.0.1",
      port: backend.port,
      method: "POST",
      path: `/fortnite/api/game/v2/profile/${player.accountId}/client/${name}?profileId=campaign&rvn=-1`,
      headers: { "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-${build}`,
        Authorization: `bearer ${player.token}`, "Content-Type": "application/json" }
    }, JSON.stringify(body));
    const campaign = async () => (await command("QueryProfile", {})).body.profileChanges[0].profile;
    let profile = await campaign();
    const loadouts = Object.entries(profile.items).filter(([, item]) => item.templateId === "CampaignHeroLoadout:defaultloadout");
    assert.equal(loadouts.length, 1, "a new account starts with one loadout");
    const [loadoutId, loadout] = loadouts[0];
    assert.equal(profile.stats.attributes.selected_hero_loadout, loadoutId);
    const hero = Object.keys(profile.items).find((id) => profile.items[id].templateId === "Hero:hid_commando_grenadegun_uc_t01");
    assert.ok(hero, "the default hero");
    assert.deepEqual(loadout.attributes.crew_members, { commanderslot: hero, followerslot1: "", followerslot2: "", followerslot3: "",
      followerslot4: "", followerslot5: "" });
    assert.deepEqual(loadout.attributes.gadgets, [{ gadget: "", slot_index: 0 }, { gadget: "", slot_index: 1 }]);
    assert.deepEqual([loadout.attributes.loadout_index, loadout.attributes.loadout_name, loadout.attributes.team_perk], [0, "", ""]);
    assert.equal((await campaign()).stats.attributes.selected_hero_loadout, loadoutId, "set up once");

    // A follower slot opens with its quest reward node; the team perk slot with QuestReward_TeamPerk_Slot1.
    const locked = await command("AssignHeroToLoadout", { heroId: hero, loadoutId, slotName: "FollowerSlot1" });
    assert.equal(locked.body.errorCode, "errors.com.epicgames.fortnite.invalid_parameter");
    assert.equal((await command("AssignTeamPerkToLoadout", { teamPerkId: "", loadoutId })).body.errorCode,
      "errors.com.epicgames.fortnite.invalid_parameter");
    assert.equal((await command("AssignHeroToLoadout", { heroId: "nope", loadoutId, slotName: "CommanderSlot" })).body.errorCode,
      "errors.com.epicgames.fortnite.item_not_found");
    const cleared = await command("AssignHeroToLoadout", { heroId: "", loadoutId, slotName: "CommanderSlot" });
    assert.equal(cleared.status, 200);
    await command("AssignHeroToLoadout", { heroId: hero, loadoutId, slotName: "CommanderSlot" });
    await command("AssignGadgetToLoadout", { gadgetId: "Gadget:g_commando_goincommando", loadoutId, slotIndex: 1 });
    assert.equal((await command("AssignGadgetToLoadout", { gadgetId: "Hero:hid_commando_grenadegun_uc_t01", loadoutId, slotIndex: 0 }))
      .body.errorCode, "errors.com.epicgames.fortnite.invalid_parameter");
    await command("SetLoadoutName", { loadoutName: "Mine", loadoutId });
    profile = await campaign();
    assert.equal(profile.items[loadoutId].attributes.crew_members.commanderslot, hero);
    assert.deepEqual(profile.items[loadoutId].attributes.gadgets,
      [{ gadget: "", slot_index: 0 }, { gadget: "Gadget:g_commando_goincommando", slot_index: 1 }]);
    assert.equal(profile.items[loadoutId].attributes.loadout_name, "Mine");
    assert.equal((await command("SetActiveHeroLoadout", { selectedLoadout: hero })).body.errorCode,
      "errors.com.epicgames.fortnite.item_not_found");
    await command("ClearHeroLoadout", { loadoutId });
    profile = await campaign();
    assert.equal(profile.items[loadoutId].attributes.crew_members.commanderslot, "");
    assert.equal(profile.items[loadoutId].attributes.loadout_name, "Mine");

    // 7.40 has no Hero Loadout screen: the commands stay unknown there.
    assert.equal((await command("SetActiveHeroLoadout", { selectedLoadout: loadoutId }, "7.40-CL-5046157")).body.errorCode,
      "errors.com.epicgames.fortnite.operation_not_found");
  } finally {
    backend.close();
  }
});

test("8.00's Hero Loadout: the loadouts quests claimed before 8.00 name; 7.40 gets none", () => {
  for (const [build, expected] of [[v800, 2], [v740, 0]]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-800-"));
    try {
      const store = createProfileStore(dir);
      inBuild(v740, () => {
        const session = openSession(store, "quests");
        session.profile("profile0").addItem("claimed-ssd", { templateId: "Quest:outpostquest_t2_l2", attributes: { quest_state: "Claimed" }, quantity: 1 });
        session.commit();
      });
      const profile = inBuild(build, () => openSession(store, "quests").profile("profile0").profile);
      const held = Object.values(profile.items).filter((item) => item.templateId === "CampaignHeroLoadout:defaultloadout");
      assert.equal(held.length, expected, build);
      assert.deepEqual(held.map((item) => item.attributes.loadout_index).sort(), expected ? [0, 1] : []);
      assert.equal(profile.stats.attributes.selected_hero_loadout === undefined, !expected, build);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
});

test("7.40 is unchanged by 8.00: its own data, Season 7's pass, no Season 8 challenges", () => {
  assert.equal(dataBuild(v740), v740);
  assert.equal(buildOfSeason(7), v740);
  assert.equal(seasonName(7), "Season 7 (7.00 – 7.40)");
  const season = inBuild(v740, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront], [7, "BRSeason7"]);
  assert.deepEqual(season.challengeSchedulesAlwaysShown, ["season7_free_schedule", "season7_paid_schedule"]);
});

// Core-Backend #403: 8.00 finishes a V-Bucks purchase from the receipts service, verifying each receipt not yet in
// in_app_purchases.receipts.
test("8.00's V-Bucks purchase: the receipts service lists it, VerifyRealMoneyPurchase records it once", async () => {
  const backend = await startBackend();
  const agent = (cl) => `Fortnite/++Fortnite+Release-x-CL-${cl} Windows/10.0.19041.1.256.64bit`;
  const as = (path, token, cl, method = "GET", body) => send({ host: "127.0.0.1", port: backend.port, method, path,
    headers: { "User-Agent": agent(cl), ...(token ? { Authorization: `bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(JSON.stringify(body)) } : {}) } },
  body ? JSON.stringify(body) : undefined);
  try {
    const player = await userLogin(backend.port, "XrayBuyer");
    const catalog = (await as("/fortnite/api/storefront/v2/catalog", player.token, v800)).body;
    const appStoreId = catalog.storefronts.find(({ name }) => name === "CurrencyStorefront").catalogEntries[0].appStoreId[1];
    const page = await as(`/purchase?showNavigation=true&namespace=fn&offers=${appStoreId}`, undefined, v800);
    const purchaseId = /name="purchaseId" value="([^"]+)"/.exec(page.body)[1];
    const form = `purchaseId=${encodeURIComponent(purchaseId)}`;
    const done = await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/purchase/complete",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(form), Origin: `http://127.0.0.1:${backend.port}` } }, form);
    const receiptId = done.body.receipt.TransactionId;
    const profile = async () => (await as(`/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=common_core&rvn=-1`,
      player.token, v800, "POST", {})).body.profileChanges[0].profile.stats.attributes.in_app_purchases;
    assert.deepEqual((await profile()).receipts, []);
    assert.deepEqual((await profile()).fulfillmentCounts, { core_mtx_1000: 1 });

    const receipts = (cl) => as(`/fortnite/api/receipts/v1/account/${player.accountId}/receipts`, player.token, cl).then((r) => r.body);
    assert.deepEqual(await receipts(v800), [{ appStore: "EpicPurchasingService", appStoreId, receiptId, receiptInfo: receiptId }]);
    assert.equal((await receipts(v740)).length, 1);
    assert.deepEqual(await receipts("4573279"), []);

    const verify = (id) => as(`/fortnite/api/game/v2/profile/${player.accountId}/client/VerifyRealMoneyPurchase?profileId=common_core&rvn=-1`,
      player.token, v800, "POST", { appStore: "EpicPurchasingService", appStoreId, receiptId: id, receiptInfo: id });
    assert.equal((await verify("made-up")).status, 200);
    assert.deepEqual((await profile()).receipts, []);
    assert.equal((await verify(receiptId)).status, 200);
    await verify(receiptId);
    assert.deepEqual((await profile()).receipts, [`EPIC:${receiptId}`]);
  } finally {
    backend.close();
  }
});

// Core-Backend #404: from 7.10 the Loot tab's LOOT page reads CardPackStoreGameplay.
test("the llama offers are on CardPackStoreGameplay from 7.10, and only CardPackStore before", () => {
  const names = (cl) => inBuild(cl, () => storefronts(null)).map(({ name }) => name);
  const offers = (cl, name) => inBuild(cl, () => storefronts(null)).find((front) => front.name === name)?.catalogEntries.map(({ offerId }) => offerId);
  for (const cl of ["4727874", "4667333"]) assert.deepEqual(offers(cl, "CardPackStoreGameplay"), offers(cl, "CardPackStore"), cl);
  // From 7.30 the V-Bucks and token Upgrade Llamas are X-Ray llamas (Core-Backend #406, tests/xray-llamas.test.js).
  for (const cl of [v800, v740, "4834550"]) {
    const moved = ["core_cardpack_bronze", "core_cardpack_bronze_x10", "core_voucher_cardpack_bronze"];
    assert.deepEqual(offers(cl, "CardPackStoreGameplay"), offers(cl, "CardPackStore").filter((offerId) => !moved.includes(offerId)), cl);
  }
  assert.ok(offers("4727874", "CardPackStoreGameplay").includes("core_cardpack_bronze"));
  assert.ok(!names("4629139").includes("CardPackStoreGameplay"));
});

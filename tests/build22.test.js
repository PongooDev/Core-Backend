import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { battleRoyaleBuilds, versionOf } from "../src/builds/detect.js";
import { contentUpdateStates, lootHotfixSection } from "../src/events/contentupdates.js";
import { activeEventFlags, fiftyFifty, hasEventEnded, isEventActive, lobbyWinterDecor, passiveStorms, supplyDropGift, winter2017, winterBattleBus } from "../src/events/events.js";
import { holidayLlama, winterEventQuests } from "../src/events/winter2017.js";
import { athenaCosmetics, athenaDailyIds, athenaDisplayAssets, athenaLootTables, athenaSeason, getAthenaQuest } from "../src/gamedata/athena.js";
import { getCardPack, getItem } from "../src/gamedata/items.js";
import { dataBuild } from "../src/gamedata/read.js";
import { missionAlertCategories } from "../src/gamedata/world.js";
import { assignmentBucket, showsMatchStart } from "../src/matchmaking/service.js";
import { alertsRemaining, clearedAlertRecord, completeMissionAlert, emptyAlertRecord } from "../src/profiles/alerts.js";
import { advanceAthenaObjectives, grantAthenaQuest } from "../src/profiles/athena.js";
import { findItem } from "../src/profiles/items.js";
import { grant } from "../src/profiles/progress.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { earnScore, levelStartXp, xpForLevel } from "../src/profiles/xp.js";
import { hasEventStore } from "../src/store/eventstore.js";
import { itemShopOffers, seasonEnd } from "../src/store/itemshop.js";
import { dedicatedServerToken, post, send, startBackend, userLogin } from "./helpers.js";

// Fortnite 2.2 (++Fortnite+Release-Cert-CL-3841827, UE 4.19, 18 January 2018): its own game data and version, still
// Season 2 with 1.11 and 2.1, Save the World's winter event without Battle Royale's, and what its notes and data change.
const v22 = "3841827";
const v21 = "3825894";
const v111 = "3807424";
const agents = {
  [v22]: "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3841827",
  [v21]: "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3825894"
};
const as = (build, port, method, urlPath, token, body) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": agents[build], Authorization: `bearer ${token}` };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
};
const command = (port, { accountId, token }, name, profileId, body, build) =>
  as(build, port, "POST", `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`, token, body ?? {});
const updateOf = (body, profileId) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === profileId);
const profileOf = async (port, player, profileId, build) =>
  updateOf((await command(port, player, "QueryProfile", profileId, {}, build)).body, profileId).profileChanges[0].profile;
const withStore = (fn) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build22-"));
  try {
    return fn(createProfileStore(dataDir), dataDir);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

test("2.2 is known by its version and plays on its own game data: 2.1's with 2.2's changes", () => {
  assert.equal(versionOf(v22), "2.2");
  assert.equal(dataBuild(v22), v22);
  assert.equal(battleRoyaleBuilds.at(-1), v22);
  // Its two new emoticons; every other cosmetic and display asset is 2.1's.
  const added = inBuild(v22, () => Object.keys(athenaCosmetics())).filter((id) => !inBuild(v21, athenaCosmetics)[id]);
  assert.deepEqual(added.sort(), ["AthenaDance:emoji_bobwhat", "AthenaDance:emoji_marybobbins"]);
  assert.deepEqual(inBuild(v22, athenaDisplayAssets), inBuild(v21, athenaDisplayAssets));
  // Its new daily challenge, "Play matches with a friend".
  assert.deepEqual(inBuild(v22, () => getAthenaQuest("athenadaily_friend").objectives), [{ count: 1, name: "daily_athena_friend", stat: "complete_athena_friend" }]);
  assert.equal(inBuild(v21, () => getAthenaQuest("athenadaily_friend")), undefined);
  assert.ok(inBuild(v22, athenaDailyIds).includes("athenadaily_friend"));
  // The Battle Pass's "free 5 tier head start in Season 3" and the tier sale's token.
  assert.deepEqual(inBuild(v22, athenaSeason).bookPaidRewards.find(({ level }) => level === 2).rewards.at(-1),
    { quantity: 5, templateId: "Token:athenanextseasontierboost" });
  assert.ok(inBuild(v22, () => getItem("Token:athenabattlepassstarsale_s2")));
  // Survive the Holidays' llama is still sold (the Save the World winter event runs on).
  assert.deepEqual(inBuild(v22, () => getCardPack(holidayLlama)), inBuild(v21, () => getCardPack(holidayLlama)));
  // Mission alert categories name themselves: 2.2 has no EFortMissionAlertCategory.
  assert.equal(inBuild(v22, missionAlertCategories).MiniBossCategory.category, "MiniBossCategory");
  assert.equal(inBuild(v21, missionAlertCategories).MiniBossCategory.category, "MiniBoss");
});

test("2.2 is still Season 2: 2.1's levels, Battle Pass tiers and season clock, and its data is the season's newest", () => {
  const season = inBuild(v22, athenaSeason);
  assert.equal(season.seasonNumber, 2);
  const old = inBuild(v21, athenaSeason);
  for (const key of ["numBookLevels", "bookLevels", "storefront", "bookFreeRewards"]) assert.deepEqual(season[key], old[key], key);
  assert.equal(buildOfSeason(2), v22);
  const now = new Date("2026-11-02T12:00:00Z");
  assert.equal(inBuild(v22, () => seasonEnd(now, { rotationHour: 0 })).toISOString(), inBuild(v111, () => seasonEnd(now, { rotationHour: 0 })).toISOString());
  const config = { mode: "custom", custom: { featured: [["AthenaGlider:glider_prismatic", 800]], daily: [["AthenaPickaxe:skiicepickaxe", 800]] } };
  assert.deepEqual(inBuild(v22, () => itemShopOffers(now, config)), inBuild(v21, () => itemShopOffers(now, config)));
});

test("2.2 runs Save the World's winter event and 50v50, and ends Battle Royale's winter lobby, bus and gifts", () => {
  assert.deepEqual(activeEventFlags(v22), [fiftyFifty, winter2017, passiveStorms]);
  for (const flag of [fiftyFifty, winter2017, passiveStorms]) assert.ok(isEventActive(flag, v22), flag);
  for (const flag of [lobbyWinterDecor, winterBattleBus, supplyDropGift]) {
    assert.ok(!isEventActive(flag, v22), flag);
    assert.ok(hasEventEnded(flag, v22), flag);
  }
  assert.deepEqual(inBuild(v22, winterEventQuests), inBuild(v21, winterEventQuests));
  assert.ok(inBuild(v22, hasEventStore));
});

test("2.2 takes 1.11's Season 2 rules: AssignMatch's six fields, the match start countdown", () => {
  assert.equal(assignmentBucket(`${v22}:0:NA:11`, v22), `Fortnite:Fortnite:${v22}:0:NA:11`);
  assert.ok(showsMatchStart(v22));
});

// 2.2 ships Season 2's content updates in its own loot tables, at Epic's weights, so it takes no hotfix.
test("2.2's loot tables have Season 2's content updates in, so it gets no [AssetHotfix]", () => {
  const packages = "/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client";
  const rows = inBuild(v22, athenaLootTables)[packages];
  assert.equal(rows["WorldList.AthenaConsumables.10"].Weight, 1);
  assert.equal(rows["WorldList.AthenaTraps.01"].Weight, 4.5);
  assert.equal(rows["WorldList.AthenaTraps.02"].Weight, 0.5);
  assert.equal(rows["WorldList.AthenaHighConsumables.03"].Weight, 0.3);
  assert.equal(rows["WorldList.AthenaLoot.Weapon.Handgun.04"].Weight, 0.075);
  // "Removed the Scoped AR from Supply Drops."
  assert.equal(rows["WorldList.AthenaSupplyDrop.Weapon.Assault.02"].Weight, 0);
  const now = new Date("2026-11-02T12:00:00Z");
  assert.deepEqual(inBuild(v22, () => contentUpdateStates(now, { mode: "all" })), []);
  assert.equal(inBuild(v22, () => lootHotfixSection(now, { mode: "all" })), "");
  assert.ok(inBuild(v21, () => lootHotfixSection(now)).startsWith("[AssetHotfix]"));
});

test("2.2's mission alert record keys each category's claims by its row name, with its own next index", () => inBuild(v22, () => withStore((store) => {
  const session = openSession(store, "alerts22");
  const record = () => session.profile("profile0").profile.stats.attributes.mission_alert_redemption_record;
  const empty = emptyAlertRecord();
  assert.equal(empty.lastClaimTimesMap, undefined);
  assert.deepEqual(empty.claimDataMap.MiniBossCategory, { missionAlertGuids: Array(10).fill(""), lastClaimedTimes: Array(10).fill("0001-01-01T00:00:00.000Z"), nextClaimIndex: 0 });
  const alert = (guid, categoryName) => ({ categoryName, missionAlertGuid: guid,
    missionAlertRewards: { tierGroupName: "MissionAlert_MiniBoss", items: [{ itemType: "AccountResource:eventcurrency_snowballs", quantity: 10 }] } });
  const now = new Date("2026-11-02T12:00:00Z");
  assert.ok(completeMissionAlert(session, "t", alert("a", "MiniBossCategory"), now));
  assert.equal(completeMissionAlert(session, "t", alert("a", "MiniBossCategory"), now), false, "an alert once");
  assert.ok(completeMissionAlert(session, "t", alert("b", "MiniBossCategory"), now));
  const claims = record().claimDataMap.MiniBossCategory;
  assert.deepEqual(claims.missionAlertGuids.slice(0, 3), ["a", "b", ""]);
  assert.equal(claims.nextClaimIndex, 2);
  assert.equal(alertsRemaining(record(), now, "MiniBossCategory"), 8);
  const cleared = clearedAlertRecord(record());
  assert.deepEqual(cleared.claimDataMap.MiniBossCategory.missionAlertGuids, Array(10).fill(""));
  assert.equal(cleared.claimDataMap.MiniBossCategory.nextClaimIndex, 0);
})));

// "Daily challenge rewards are automatically collected if another challenge is completed in the same category" (2.1).
test("a challenge completed in 2.2 collects the Completed ones of its category, as in 2.1", () => inBuild(v22, () => withStore((store) => {
  const session = openSession(store, "collector22");
  const tracker = session.profile("athena");
  const chests = grantAthenaQuest(tracker, "athenadailyquest_interacttreasurechest");
  const ammo = grantAthenaQuest(tracker, "athenadailyquest_interactammocrate");
  advanceAthenaObjectives(session, [{ statName: "daily_athena_loot_chest_v2", count: 7 }]);
  advanceAthenaObjectives(session, [{ statName: "athena_daily_loot_ammobox_v2", count: 7 }]);
  assert.equal(tracker.profile.items[chests].attributes.quest_state, "Claimed");
  assert.equal(tracker.profile.items[ammo].attributes.quest_state, "Completed");
})));

test("2.2's Commander XP is ten times 2.1's, and an account's converts on the build of the other scale", () => withStore((store) => {
  assert.equal(inBuild(v21, () => xpForLevel(1)), 1_000_000);
  assert.equal(inBuild(v22, () => xpForLevel(1)), 10_000_000);
  assert.equal(inBuild(v22, () => levelStartXp(3)), 20_000_000);
  assert.equal(inBuild(v21, () => levelStartXp(3)), 2_000_000);

  const stateOn = (build) => inBuild(build, () => {
    const session = openSession(store, "commander");
    const { profile } = session.profile("profile0");
    const rest = profile.items[findItem(profile, "Quota:restxp")].attributes;
    return { xp: profile.stats.attributes.xp, boost: profile.items[findItem(profile, "Token:xpboost")]?.quantity,
      rest: rest.current_value, cap: rest.max_quota, scale: profile.coreXpScale ?? 1 };
  });
  inBuild(v21, () => {
    const session = openSession(store, "commander");
    session.profile("profile0").setStat("xp", 123_456);
    grant(session, "Token:xpboost", 1000);
    session.commit();
  });
  const before = stateOn(v21);
  const after = stateOn(v22);
  // The rest XP left, up to the level row's cap on 2.2 (19,637,889 at level 1, 2.1's 1,963,789).
  assert.deepEqual([after.xp, after.boost, after.cap, after.scale], [1_234_560, 10_000, 19_637_889, 10]);
  assert.equal(after.rest, Math.min(before.rest * 10, after.cap));
  // Back on 2.1 the account is as it was.
  assert.deepEqual(stateOn(v21), before);

  // A match's XP: 1,000,000 score is 612,901 XP on 2.1, ten times that on 2.2.
  const base = (build) => inBuild(build, () => {
    const session = openSession(store, `score-${build}`);
    return earnScore(session, 1_000_000).baseXPEarned;
  });
  assert.equal(base(v21), 612_901);
  assert.equal(base(v22), 6_129_010);
}));

test("2.2's \"Play matches with a friend\" counts a match whose squad had a friend in it; 1.11, 2.1 and 2.2 share Season 2's profile", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build22-test-"));
  const backend = await startBackend({ dataDir });
  try {
    const [one, two, three] = await Promise.all(["friend22a", "friend22b", "friend22c"].map((name) => userLogin(backend.port, name)));
    const friendsUrl = (id, other) => `/friends/api/public/friends/${id}/${other}`;
    assert.equal((await post(backend.port, friendsUrl(one.accountId, two.accountId), one.token)).status, 204);
    assert.equal((await post(backend.port, friendsUrl(two.accountId, one.accountId), two.token)).status, 204);
    for (const player of [one, three]) {
      await profileOf(backend.port, player, "athena", v22);
      const session = openSession(createProfileStore(dataDir), player.accountId);
      inBuild(v22, () => grantAthenaQuest(session.profile("athena"), "athenadaily_friend"));
      session.commit();
    }
    const dedicated = await dedicatedServerToken(backend.port);
    // A duo: one and two together (second), three with someone not their friend (fifth).
    assert.equal((await as(v22, backend.port, "POST", "/fortnite/api/game/v2/battleroyale/recordresults", dedicated, { playlistId: 10, matchId: "build22-friends",
      results: [{ accountId: one.accountId, place: 2, kills: 0, secondsAlive: 900 }, { accountId: two.accountId, place: 2, kills: 0, secondsAlive: 900 },
        { accountId: three.accountId, place: 5, kills: 0, secondsAlive: 600 }] })).status, 204);
    const friendQuest = async (player) => Object.values((await profileOf(backend.port, player, "athena", v22)).items)
      .find((item) => item.templateId === "Quest:athenadaily_friend");
    assert.equal((await friendQuest(one)).attributes.quest_state, "Completed");
    assert.equal((await friendQuest(three)).attributes.completion_daily_athena_friend ?? 0, 0);

    // One Season 2: a 2.1 lobby finds 2.2's level, and six emote slots.
    const two22 = (await profileOf(backend.port, one, "athena", v22)).stats.attributes;
    const two21 = (await profileOf(backend.port, one, "athena", v21)).stats.attributes;
    assert.deepEqual([two21.season_num, two21.level, two21.xp], [2, two22.level, two22.xp]);
    assert.equal((await command(backend.port, one, "EquipBattleRoyaleCustomization", "athena", { slotName: "Dance", itemToSlot: "", indexWithinSlot: 5 }, v22)).status, 200);
    assert.equal((await profileOf(backend.port, one, "athena", v22)).stats.attributes.favorite_dance.length, 6);
  } finally {
    await backend.close();
  }
});

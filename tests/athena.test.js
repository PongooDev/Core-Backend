import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { athenaDailyIds, getAthenaQuest, seasonLevels } from "../src/gamedata/athena.js";
import { addSeasonXp, advanceAthenaObjectives, grantAthenaQuest, matchXp, recordMatchProgress, refreshAthenaDailies } from "../src/profiles/athena.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { dedicatedServerToken, post, send, startBackend, userLogin } from "./helpers.js";

// Battle Royale's front end in 1.8 (Core-Backend #72): the season level and the daily challenges.
const agent18 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-Live-CL-3724489";

function command(port, { accountId, token }, name, profileId, body = {}, route = "client") {
  const text = JSON.stringify(body);
  return send({
    host: "127.0.0.1",
    port,
    method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/${route}/${name}?profileId=${profileId}&rvn=-1`,
    headers: { "User-Agent": agent18, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }
  }, text);
}

const athenaOf = (body) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === "athena");
const athena = async (port, player) => athenaOf((await command(port, player, "QueryProfile", "athena")).body).profileChanges[0].profile;
const record = (port, token, playlistId, results) => post(port, "/fortnite/api/game/v2/battleroyale/recordresults", token, { playlistId, results });

function withSession(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-athena-"));
  try {
    const profiles = createProfileStore(dataDir);
    const session = openSession(profiles, "athenatester");
    session.profile("athena");
    return run(session);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test("a match gives 1.8 players season XP and levels, and leaves players without a Battle Royale profile alone", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Level18");
    const older = await userLogin(backend.port, "Level172");
    await athena(backend.port, player);
    const dedicated = await dedicatedServerToken(backend.port);

    // 20 minutes alive (100), 20 eliminations (1000) and the win (300): 1400 XP, past levels 1-4 (100+250+300+350).
    assert.equal(matchXp(2, { place: 1, kills: 20, secondsAlive: 1200 }), 1400);
    assert.equal(matchXp(9, { place: 3, kills: 0, secondsAlive: 59 }), 100);
    assert.equal(matchXp(10, { place: 12, kills: 1, secondsAlive: 300 }), 125);
    await record(backend.port, dedicated, 2, [
      { accountId: player.accountId, place: 1, kills: 20, secondsAlive: 1200 },
      { accountId: older.accountId, place: 2, kills: 0, secondsAlive: 1100 }
    ]);
    const { level, xp, accountLevel } = (await athena(backend.port, player)).stats.attributes;
    assert.deepEqual({ level, xp, accountLevel }, { level: 5, xp: 400, accountLevel: 5 });
    assert.equal(createProfileStore(backend.dataDir).exists(older.accountId, "athena"), false);
  } finally {
    backend.close();
  }
});

test("the season level follows SeasonXpTable and stops at its last level", () => {
  const levels = seasonLevels();
  assert.deepEqual(levels.slice(0, 3).map(({ level, xpToNextLevel, xpTotal }) => [level, xpToNextLevel, xpTotal]), [[1, 100, 0], [2, 250, 100], [3, 300, 350]]);
  assert.equal(levels.find(({ level }) => level === 10).chaseReward, "HomebaseBannerIcon:brseason01");
  const last = levels[levels.length - 1];
  withSession((session) => {
    addSeasonXp(session, 4499);
    assert.deepEqual([session.profile("athena").profile.stats.attributes.level, session.profile("athena").profile.stats.attributes.xp], [9, 699]);
    addSeasonXp(session, 1);
    assert.deepEqual([session.profile("athena").profile.stats.attributes.level, session.profile("athena").profile.stats.attributes.xp], [10, 0]);
    addSeasonXp(session, last.xpTotal * 2);
    const { attributes } = session.profile("athena").profile.stats;
    assert.deepEqual([attributes.level, attributes.xp, attributes.accountLevel], [last.level, last.xpToNextLevel, last.level]);
  });
});

test("1.8's daily challenges: one a day up to 3, claimed ones cleared the next day, one reroll a day", async () => {
  const dailies = athenaDailyIds();
  assert.ok(dailies.length >= 10);
  assert.ok(dailies.every((id) => getAthenaQuest(id).type === "AthenaDailyQuest"));
  assert.ok(!dailies.includes("athenadaily_play10matches"), "the Archive's aren't offered");

  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Daily18");
    const login = await command(backend.port, player, "ClientQuestLogin", "athena");
    assert.equal(login.status, 200);
    const held = (profile) => Object.entries(profile.items).filter(([, item]) => item.templateId.startsWith("Quest:"));
    let profile = await athena(backend.port, player);
    assert.equal(held(profile).length, 1);
    const [[itemId, item]] = held(profile);
    assert.ok(dailies.includes(item.templateId.split(":")[1]));
    assert.equal(item.attributes.quest_state, "Active");
    assert.equal(profile.stats.attributes.quest_manager.dailyQuestRerolls, 1);
    // ClientQuestLogin on profile0 still does Save the World's.
    assert.equal((await command(backend.port, player, "ClientQuestLogin", "profile0")).status, 200);

    // The same day: no more.
    await command(backend.port, player, "ClientQuestLogin", "athena");
    assert.equal(held(await athena(backend.port, player)).length, 1);

    const reroll = await command(backend.port, player, "FortRerollDailyQuest", "athena", { questId: itemId });
    assert.equal(reroll.status, 200);
    const { newQuestId } = reroll.body.notifications.find((notification) => notification.type === "dailyQuestReroll");
    profile = await athena(backend.port, player);
    assert.deepEqual(held(profile).map(([id]) => id), [newQuestId]);
    assert.equal((await command(backend.port, player, "FortRerollDailyQuest", "athena", { questId: newQuestId })).body.errorCode,
      "errors.com.epicgames.fortnite.no_rerolls_remaining");
  } finally {
    backend.close();
  }

  withSession((session) => {
    const tracker = session.profile("athena");
    const day = (n) => new Date(Date.UTC(2026, 9, n, 12));
    for (let n = 1; n <= 5; n++) refreshAthenaDailies(session, day(n));
    const quests = () => Object.values(tracker.profile.items).filter((item) => item.templateId.startsWith("Quest:"));
    assert.equal(quests().length, 3);
    const [done] = quests();
    done.attributes.quest_state = "Claimed";
    refreshAthenaDailies(session, day(6));
    assert.equal(quests().length, 3);
    assert.ok(!quests().includes(done));
  });

  // Core-Backend #92: missed days stack, one daily a day up to MaxActiveDailyQuests (3); a done one stays, claimed, until
  // the next day and isn't replaced before it.
  withSession((session) => {
    const tracker = session.profile("athena");
    const day = (n, hour = 12) => new Date(Date.UTC(2026, 9, n, hour));
    const quests = () => Object.values(tracker.profile.items).filter((item) => item.templateId.startsWith("Quest:"));
    const open = () => quests().filter((item) => item.attributes.quest_state === "Active");
    refreshAthenaDailies(session, day(1));
    assert.equal(quests().length, 1, "the first login: one");
    const [first] = quests();
    first.attributes.quest_state = "Claimed";
    refreshAthenaDailies(session, day(1, 23));
    assert.deepEqual(quests(), [first], "done today: kept, claimed, and nothing new until tomorrow");

    refreshAthenaDailies(session, day(3, 0));
    assert.equal(quests().length, 2, "two days later: two new ones");
    assert.ok(!quests().includes(first));
    refreshAthenaDailies(session, day(10));
    assert.equal(open().length, 3, "a week away: up to 3");

    open()[0].attributes.quest_state = "Claimed";
    refreshAthenaDailies(session, day(11));
    assert.equal(open().length, 3);
  });
});

test("challenge progress: placements and eliminations from the match results, the rest from the gameserver; done ones pay XP", () => {
  withSession((session) => {
    const tracker = session.profile("athena");
    const ids = Object.fromEntries(["athenadaily_playmatches", "athenadaily_solo_top25", "athenadaily_squad_top6", "athenadailyquest_playerelimination",
      "athenadailyquest_playereliminationshotguns", "athenadaily_outlive_solo"].map((questId) => [questId, grantAthenaQuest(tracker, questId)]));
    const item = (questId) => tracker.profile.items[ids[questId]].attributes;

    recordMatchProgress(session, 2, { place: 20, kills: 4 });
    assert.equal(item("athenadaily_solo_top25").quest_state, "Claimed");
    assert.equal(item("athenadaily_squad_top6").completion_daily_athena_squad_top6_v2, 0, "another playlist's placement");
    assert.equal(item("athenadaily_playmatches").completion_daily_athena_play_matches_v2, 1);
    assert.equal(item("athenadailyquest_playerelimination").completion_athena_daily_kill_players_v2, 4);
    // 500 XP from the top 25 challenge: past levels 1 (100) and 2 (250).
    assert.deepEqual([tracker.profile.stats.attributes.level, tracker.profile.stats.attributes.xp], [3, 150]);

    // The gameserver's quest updates: by weapon and players outlived count; placements and eliminations are counted
    // from the results above, so the server's own count of them is left out.
    advanceAthenaObjectives(session, [
      { statName: "athena_daily_kill_players_shotgun", count: 5 },
      { statName: "daily_athena_outlive_solo_players", count: 40 },
      { statName: "daily_athena_play_matches_v2", count: 1 },
      { statName: "athena_daily_kill_players_v2", count: 4 }
    ]);
    assert.equal(item("athenadailyquest_playereliminationshotguns").quest_state, "Claimed");
    assert.equal(item("athenadaily_outlive_solo").completion_daily_athena_outlive_solo_players, 40);
    assert.equal(item("athenadaily_playmatches").completion_daily_athena_play_matches_v2, 1);
    assert.equal(item("athenadailyquest_playerelimination").completion_athena_daily_kill_players_v2, 4);

    recordMatchProgress(session, 9, { place: 5, kills: 7 });
    assert.equal(item("athenadaily_squad_top6").quest_state, "Claimed");
    assert.equal(item("athenadailyquest_playerelimination").quest_state, "Claimed");
    assert.equal(item("athenadailyquest_playerelimination").completion_athena_daily_kill_players_v2, 10);
    // 4 challenges at 500 XP: 2000, past levels 1-5 (1700), 300 into level 6.
    assert.deepEqual([tracker.profile.stats.attributes.level, tracker.profile.stats.attributes.xp], [6, 300]);
  });
});

test("Search Chests (Core-Backend #92): five chests the gameserver reports, one per search, claim it and pay 500 XP once", () => {
  withSession((session) => {
    const tracker = session.profile("athena");
    const itemId = grantAthenaQuest(tracker, "athenadailyquest_interacttreasurechest");
    const chest = [{ statName: "daily_athena_loot_chest", count: 1 }];
    for (let search = 0; search < 4; search++) advanceAthenaObjectives(session, chest);
    assert.equal(tracker.profile.items[itemId].attributes.quest_state, "Active");
    advanceAthenaObjectives(session, chest);
    assert.equal(tracker.profile.items[itemId].attributes.quest_state, "Claimed");
    assert.equal(tracker.profile.items[itemId].attributes.completion_daily_athena_loot_chest, 5);
    // From level 1 with 0 XP: level 1 takes 100 and level 2 250 (SeasonXpTable), so 500 is level 3 with 150.
    assert.deepEqual([tracker.profile.stats.attributes.level, tracker.profile.stats.attributes.xp], [3, 150]);
    advanceAthenaObjectives(session, chest);
    assert.deepEqual([tracker.profile.stats.attributes.level, tracker.profile.stats.attributes.xp], [3, 150], "done: no more XP");
  });
});

test("the gameserver's UpdateQuests, EndBattleRoyaleGame and ReportConsumableUsed on athena are answered", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Server18");
    await athena(backend.port, player);
    const server = { accountId: player.accountId, token: await dedicatedServerToken(backend.port) };
    const advance = [{ statName: "athena_daily_loot_chest", count: 1 }];
    for (const [name, body] of [["ServerQuestLogin", { matchmakingSessionId: "" }], ["UpdateQuests", { advance }],
      ["EndBattleRoyaleGame", { advance, matchType: "AthenaSolo", minutesAlive: 3, personalKills: 0, teamKills: 0, placement: 40, medals: [] }],
      ["ReportConsumableUsed", { usedQuantity: 1, itemType: "Consumable:athenaconsumable_shield" }]]) {
      const response = await command(backend.port, server, name, "athena", body, "dedicated_server");
      assert.equal(response.status, 200, name);
      assert.equal(athenaOf(response.body).profileId, "athena");
    }
    // ClaimQuestReward and SetPinnedQuests from the Battle Royale lobby have nothing to do.
    assert.equal((await command(backend.port, player, "SetPinnedQuests", "athena", { pinnedQuestIds: [] })).status, 200);
  } finally {
    backend.close();
  }
});

test("the season's level 10 banner (BRSeason01) is the player's from their next 1.8 quest login, for the Battle Royale banner", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Chase18");
    await athena(backend.port, player);
    const dedicated = await dedicatedServerToken(backend.port);
    // CoreV2's reports name no build: the XP counts, but Cert's banners lack the 1.8 one.
    for (let match = 0; match < 4; match++) {
      await record(backend.port, dedicated, 2, [{ accountId: player.accountId, place: 1, kills: 20, secondsAlive: 1200 }]);
    }
    assert.equal((await athena(backend.port, player)).stats.attributes.level, 11, "5600 XP: past level 10 (4500)");

    const login = await command(backend.port, player, "ClientQuestLogin", "athena");
    const added = (login.body.multiUpdate ?? []).find((update) => update.profileId === "profile0")?.profileChanges ?? [];
    assert.ok(added.some((change) => change.changeType === "itemAdded" && change.item.templateId === "HomebaseBannerIcon:BRSeason01"));
    const banner = await command(backend.port, player, "SetBattleRoyaleBanner", "athena", { homebaseBannerIconId: "BRSeason01", homebaseBannerColorId: "DefaultColor1" });
    assert.equal(banner.status, 200);
    assert.equal(athenaOf(banner.body).profileChanges[0].profile.stats.attributes.banner_icon, "BRSeason01");
  } finally {
    backend.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { dedicatedServerToken, get, post, startBackend, userLogin } from "./helpers.js";

const route = (kind, accountId, name, profileId = "profile0", rvn = -1) =>
  `/fortnite/api/game/v2/profile/${accountId}/${kind}/${name}?profileId=${profileId}&rvn=${rvn}`;
const profileOf = (response) => response.body.profileChanges[0].profile;
const byTemplate = (profile, templateId) => Object.values(profile.items).filter((item) => item.templateId === templateId);

async function setup(backend) {
  const server = await userLogin(backend.port, "CoreServer1");
  const dedicated = await dedicatedServerToken(backend.port);
  const player = await userLogin(backend.port, "ServerPlayer");
  const query = (kind, profileId = "profile0") => post(backend.port, route(kind, player.accountId, "QueryProfile", profileId), kind === "client" ? player.token : dedicated, {});
  const send = (name, body, profileId = "profile0", rvn = -1) =>
    post(backend.port, route("dedicated_server", player.accountId, name, profileId, rvn), dedicated, body);
  return { server, player, query, send };
}

test("other accounts' profiles can be read on the public route, and only read", async () => {
  const backend = await startBackend();
  try {
    const { server, player } = await setup(backend);
    await post(backend.port, route("client", player.accountId, "SetHomebaseName"), player.token, { homebaseName: "Shared Base" });
    const read = await post(backend.port, route("public", player.accountId, "QueryProfile"), server.token, {});
    assert.equal(profileOf(read).stats.attributes.homebase.townName, "Shared Base");

    const write = await post(backend.port, route("public", player.accountId, "SetHomebaseName"), server.token, { homebaseName: "Taken" });
    assert.equal(write.status, 400);
    assert.equal(write.body.errorCode, "errors.com.epicgames.fortnite.operation_not_found");
    assert.equal((await post(backend.port, route("public", "0".repeat(32), "QueryProfile"), server.token, {})).status, 404);
  } finally {
    backend.close();
  }
});

test("the gameserver logs its players into their quests and advances them", async () => {
  const backend = await startBackend();
  try {
    const { send } = await setup(backend);
    const login = await send("ServerQuestLogin", { matchmakingSessionId: "abc" });
    assert.equal(login.status, 200);
    assert.ok(byTemplate(profileOf(await send("QueryProfile", {})), "Quest:homebaseonboarding").length);

    for (const name of ["StartPrimaryMission", "UpdateQuests"]) {
      await send(name, { advance: [{ statName: "hbonboarding_namehomebase", count: 1 }], matchmakingSessionId: "abc", missionName: "x" });
    }
    const [quest] = byTemplate(profileOf(await send("QueryProfile", {})), "Quest:homebaseonboarding");
    assert.equal(quest.attributes.completion_hbonboarding_namehomebase, 1);

    for (const name of ["LockProfiles", "UnlockProfiles", "InitializeTheater", "ModifyMission"]) {
      assert.equal((await send(name, { code: "x", timeout: 60 }, "theater0")).status, 200, name);
    }
  } finally {
    backend.close();
  }
});

test("a won mission grants its rewards as Mission card packs, found through the server's game session", async () => {
  const backend = await startBackend();
  try {
    const { server, send } = await setup(backend);
    const info = await get(backend.port, "/fortnite/api/game/v2/world/info", server.token);
    const theater = info.body.missions.find((entry) => entry.availableMissions.length);
    const mission = theater.availableMissions[0];
    const zone = { worldId: "", theaterId: theater.theaterId, theaterMissionId: mission.missionGuid, theaterMissionAlertId: "", zoneThemeClass: "" };
    const registered = await post(backend.port, "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "CoreServer1", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 4, maxPrivatePlayers: 0, buildUniqueId: "595160781",
      attributes: { ZONEINSTANCEID_s: JSON.stringify(zone), GAMEMODE_s: "FORTPVE" }
    });
    const sessionId = registered.body.id;

    const lost = await send("EndPrimaryMission", { matchmakingSessionId: sessionId, missionName: "m", missionStatus: "Failed", advance: [] });
    assert.equal(lost.body.profileRevision, lost.body.profileChangesBaseRevision);
    // No points still sends the earnScore notification the server finalizes the player's experience on.
    assert.deepEqual(lost.body.notifications, [{ type: "earnScore", primary: false,
      baseXPEarned: 0, bonusXPEarned: 0, boostXPEarned: 0, boostXPMissed: 0, restXPEarned: 0, groupBoostXPEarned: 0 }]);

    // Mission points are the badges' MissionPoints, not score: they give no account XP.
    const scored = await send("EndPrimaryMission", { matchmakingSessionId: sessionId, missionName: "m", missionStatus: "Failed", advance: [],
      earnedBadgeData: [], numMissionPoints: 22, bCriticalMatchBonus: false });
    const [earned] = scored.body.notifications.filter((entry) => entry.type === "earnScore");
    assert.deepEqual([earned.baseXPEarned, earned.restXPEarned], [0, 0]);
    assert.equal(profileOf(await send("QueryProfile", {})).stats.attributes.xp, 0);
    await send("EndPrimaryMission", { matchmakingSessionId: sessionId, missionName: "m", missionStatus: "Succeeded", advance: [] });
    const profile = profileOf(await send("QueryProfile", {}));
    for (const { itemType } of mission.missionRewards.items) {
      const [pack] = byTemplate(profile, itemType);
      assert.ok(pack, itemType);
      assert.equal(pack.attributes.pack_source, "Mission");
    }
  } finally {
    backend.close();
  }
});

test("ModifyMission moves the session's zone to another difficulty row, and a won mission's rewards follow it", async () => {
  const backend = await startBackend();
  try {
    const { server, player, send } = await setup(backend);
    const dedicated = await dedicatedServerToken(backend.port);
    const info = await get(backend.port, "/fortnite/api/game/v2/world/info", server.token);
    const theater = info.body.missions.find((entry) => entry.availableMissions.length);
    const mission = theater.availableMissions.find((entry) => !/Outpost/.test(entry.missionGenerator));
    const zone = { worldId: "", theaterId: theater.theaterId, theaterMissionId: mission.missionGuid, theaterMissionAlertId: "", zoneThemeClass: "" };
    const registered = await post(backend.port, "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "CoreServer1", serverName: "Core-1", serverPort: 7777, maxPublicPlayers: 4, maxPrivatePlayers: 0,
      buildUniqueId: "595160781", attributes: { ZONEINSTANCEID_s: JSON.stringify(zone), GAMEMODE_s: "FORTPVE" }
    });
    const sessionId = registered.body.id;
    const validate = () => post(backend.port, `/fortnite/api/game/v2/world/validate?sessionId=${sessionId}`, dedicated, zone);
    assert.equal((await validate()).body.zoneDifficultyInfo.rowName, mission.missionDifficultyInfo.rowName);

    // The Cert server's body (UStructToJsonAttributes over the UFunction's MatchmakingSessionId and Difficulty).
    const harder = "Theater_Hard_Zone4";
    assert.notEqual(mission.missionRewards.tierGroupName, "Mission_Select_T14");
    for (const body of [{ matchmakingSessionId: sessionId, difficulty: "NoSuchRow" }, { matchmakingSessionId: "gone", difficulty: harder }]) {
      assert.equal((await send("ModifyMission", body)).status, 200);
    }
    assert.equal((await send("ModifyMission", { matchmakingSessionId: sessionId, difficulty: harder })).status, 200);
    const session = (await get(backend.port, `/fortnite/api/matchmaking/session/${sessionId}`, server.token)).body;
    assert.equal(session.zoneDifficulty, undefined);

    await send("EndPrimaryMission", { matchmakingSessionId: sessionId, missionName: "m", missionStatus: "Succeeded", advance: [] });
    const packs = Object.values(profileOf(await send("QueryProfile", {})).items)
      .filter((item) => item.attributes.pack_source === "Mission").map((item) => item.templateId).sort();
    assert.deepEqual(packs, ["CardPack:zcp_crystal_shadowshard_minimal", "CardPack:zcp_heroxp_t14"]);

    // The next zone on this session starts from what the gameserver's world/validate replies again. A player's own token
    // validating another mission for the session doesn't move it.
    await validate();
    const other = info.body.missions.flatMap((entry) => entry.availableMissions)
      .find((entry) => entry.missionRewards.items.length && entry.missionRewards.tierGroupName !== mission.missionRewards.tierGroupName);
    const playerValidate = await post(backend.port, `/fortnite/api/game/v2/world/validate?sessionId=${sessionId}`, player.token,
      { ...zone, theaterMissionId: other.missionGuid });
    assert.equal(playerValidate.body.missionRewards.tierGroupName, other.missionRewards.tierGroupName);
    const before = new Set(Object.keys(profileOf(await send("QueryProfile", {})).items));
    await send("EndPrimaryMission", { matchmakingSessionId: sessionId, missionName: "m", missionStatus: "Succeeded", advance: [] });
    const granted = Object.entries(profileOf(await send("QueryProfile", {})).items)
      .filter(([itemId, item]) => !before.has(itemId) && item.attributes.pack_source === "Mission").map(([, item]) => item.templateId);
    assert.deepEqual([...new Set(granted)].sort(), [...new Set(mission.missionRewards.items.map(({ itemType }) => itemType))].sort());
  } finally {
    backend.close();
  }
});

test("EarnScore gives every listed player XP, levels them up with their rewards, and notifies the caller", async () => {
  const backend = await startBackend();
  try {
    const { player, send } = await setup(backend);
    const other = await userLogin(backend.port, "ServerPlayerTwo");
    const earned = await send("EarnScore", { matchmakingSessionId: "abc", playersAndScores: [
      { accountId: player.accountId, totalScore: 2000000, bCriticalMatchBonus: false },
      { accountId: other.accountId, totalScore: 500000, bCriticalMatchBonus: false },
      { accountId: "0".repeat(32), totalScore: 100, bCriticalMatchBonus: false }
    ] });
    assert.equal(earned.status, 200);
    const [notification] = earned.body.notifications.filter((entry) => entry.type === "earnScore");
    // 2,000,000 score is 1,225,802 XP at ScoreToXPLinearRate; a new account's full rest XP doubles it; there's no boost.
    assert.deepEqual([notification.baseXPEarned, notification.restXPEarned, notification.boostXPEarned, notification.boostXPMissed],
      [1225802, 1225802, 0, 367741]);
    assert.deepEqual(earned.body.notifications.filter((entry) => entry.type === "levelUp").map((entry) => entry.level), [2, 3]);

    const stats = profileOf(await send("QueryProfile", {})).stats.attributes;
    assert.deepEqual([stats.level, stats.xp], [3, 2451604]);
    assert.equal(byTemplate(profileOf(await send("QueryProfile", {})), "Token:homebasepoints")[0]?.quantity, 2);
    const otherStats = profileOf(await post(backend.port, route("client", other.accountId, "QueryProfile"), other.token, {})).stats.attributes;
    assert.deepEqual([otherStats.level, otherStats.xp], [1, 612902]);
  } finally {
    backend.close();
  }
});

test("BatchUpdatePlayer applies the server's item changes to theater0 and outpost0, and ConsumeItems uses items up", async () => {
  const backend = await startBackend();
  try {
    const { send } = await setup(backend);
    const { profileRevision } = (await send("QueryProfile", {}, "theater0")).body;
    const update = await send("BatchUpdatePlayer", {
      theaterItemUpdate: { baseCommandRevision: 0, addRequests: [
        { itemId: "wood-1", templateId: "WorldItem:wooditemdata", quantity: 30, attributes: {} },
        { itemId: "rifle-1", templateId: "Weapon:wid_assault_auto_c_ore_t01", quantity: 1, attributes: { durability: 1 } }
      ] },
      outpostItemUpdate: { addRequests: [{ itemId: "stone-1", templateId: "WorldItem:stoneitemdata", quantity: 5 }] },
      questObjectiveUpdates: []
    }, "theater0", profileRevision);
    assert.equal(update.status, 200);
    assert.deepEqual(update.body.profileChanges.map((change) => change.itemId), ["wood-1", "rifle-1"]);
    assert.equal(update.body.multiUpdate[0].profileId, "outpost0");

    await send("BatchUpdatePlayer", { theaterItemUpdate: {
      changeQuantityRequests: [{ itemId: "wood-1", deltaQuantity: -10 }],
      changeAttributesRequests: [{ itemId: "rifle-1", attributes: { durability: 0.5 } }]
    } }, "theater0");
    await send("ConsumeItems", { itemsToConsumeIds: ["wood-1", "missing"], itemCountsToConsume: [5, 1], consumeReason: "build" }, "theater0");
    let theater = profileOf(await send("QueryProfile", {}, "theater0"));
    assert.equal(theater.items["wood-1"].quantity, 15);
    assert.equal(theater.items["rifle-1"].attributes.durability, 0.5);

    await send("BatchUpdatePlayer", { theaterItemUpdate: { removeRequests: [{ itemId: "rifle-1" }] } }, "theater0");
    theater = profileOf(await send("QueryProfile", {}, "theater0"));
    assert.deepEqual(Object.keys(theater.items), ["wood-1"]);
    assert.equal((await send("BatchUpdatePlayer", {}, "profile0")).status, 400);
  } finally {
    backend.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { dedicatedServerToken, post, send, startBackend, userLogin } from "./helpers.js";

// 5.21's UFortMcpProfileCampaign::EndMatch (CoreV2: "5.21: Save the World missions don't end (EndMatch)"), which
// replaced EndPrimaryMission and EarnScore's send: one FAccountIdAndMatchEndData a player, each with that player's
// EndPrimaryMission data and score, as the gameserver's MCP serializer writes it (parameters and members with their
// first letter lowered).
const agent521 = "Fortnite/++Fortnite+Release-5.21-CL-4288479 Windows/10.0.17134.1.256.64bit";
const quest = "Quest:stonewoodquest_filler_1_d2";

const mcp = (backend, accountId, token, kind, command, body = {}, profileId = "campaign") => {
  const text = JSON.stringify(body);
  return send({ host: "127.0.0.1", port: backend.port, method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/${kind}/${command}?profileId=${profileId}&rvn=-1`,
    headers: { "User-Agent": agent521, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
};

const entry = (accountId, fields = {}) => ({
  accountId, advance: [], earnedBadgeData: [], earnedItemCaches: [], totalScore: 0, bCriticalMatchBonus: false, numMissionPoints: 0,
  theaterNum: 0, theaterItemUpdate: { baseCommandRevision: 0, addRequests: [], removeRequests: [], changeQuantityRequests: [], changeAttributesRequests: [], changeStatRequests: [] },
  outpostNum: 0, outpostItemUpdate: { baseCommandRevision: 0, addRequests: [], removeRequests: [], changeQuantityRequests: [], changeAttributesRequests: [], changeStatRequests: [] },
  outpostId: "", outpostInfo: { placedBuildings: [], accountsWithEditPermission: [] }, deployableBaseItemId: "", cloudSaveInfo: { saveFileVersion: 0, savedRecords: [] }, lockCode: "",
  ...fields
});

const endMatch = (backend, accountId, dedicated, missionStatus, players) =>
  mcp(backend, accountId, dedicated, "dedicated_server", "EndMatch", { playersAndMatchEndData: players, matchmakingSessionId: "no-session",
    missionName: "MissionInfo_Fighting", missionStatus, difficultyIncreaseTier: 0 });

async function questState(backend, player) {
  const { profile } = (await mcp(backend, player.accountId, player.token, "client", "QueryProfile")).body.profileChanges[0];
  const { attributes } = Object.values(profile.items).find((item) => item.templateId === quest);
  return { survivors: attributes.completion_questcollect_survivoritemdata ?? 0, state: attributes.quest_state };
}

test("EndMatch ends the player's mission as EndPrimaryMission did, with their score's XP first in the response", async () => {
  const backend = await startBackend();
  try {
    const dedicated = await dedicatedServerToken(backend.port);
    const player = await userLogin(backend.port, "EndMatchWon");
    await mcp(backend, player.accountId, dedicated, "dedicated_server", "StartPrimaryMission", { advance: [], matchmakingSessionId: "no-session", missionName: "m" });
    // A survivor rescued in the zone (it counts once the mission is won), then the rest in EndMatch's advance.
    await post(backend.port, `/admin/api/accounts/${player.accountId}/grant`, undefined, { templateId: quest, quantity: 1 });
    await mcp(backend, player.accountId, dedicated, "dedicated_server", "UpdateQuests", { advance: [{ statName: "questcollect_survivoritemdata", count: 1 },
      { statName: "complete_pve01_diff2", count: 1 }] });
    assert.deepEqual(await questState(backend, player), { survivors: 1, state: "Active" });

    const ended = await endMatch(backend, player.accountId, dedicated, "Succeeded", [entry(player.accountId, {
      totalScore: 17029, advance: [{ statName: "questcollect_survivoritemdata", count: 2 }],
      earnedItemCaches: ["WorldItem:cache_evolvetier_vr_pickup_t02"] })]);
    assert.equal(ended.status, 200);
    const [first] = ended.body.notifications;
    assert.equal(first.type, "earnScore");
    // The score's XP as EarnScore gives it, doubled by a new account's rest XP.
    assert.ok(first.baseXPEarned > 0);
    assert.equal(first.restXPEarned, first.baseXPEarned);
    assert.notEqual((await questState(backend, player)).state, "Active", "the won mission completes the quest");

    const { profile } = (await mcp(backend, player.accountId, player.token, "client", "QueryProfile")).body.profileChanges[0];
    assert.ok(Object.values(profile.items).some((item) => item.templateId.toLowerCase().startsWith("cardpack:cardpack_cache_materials_t02")), "the item cache's pack");
  } finally {
    await backend.close();
  }
});

test("a failed EndMatch takes back the mission's progress and still finalizes the player with an earnScore", async () => {
  const backend = await startBackend();
  try {
    const dedicated = await dedicatedServerToken(backend.port);
    const player = await userLogin(backend.port, "EndMatchLost");
    await post(backend.port, `/admin/api/accounts/${player.accountId}/grant`, undefined, { templateId: quest, quantity: 1 });
    await mcp(backend, player.accountId, dedicated, "dedicated_server", "StartPrimaryMission", { advance: [], matchmakingSessionId: "no-session", missionName: "m" });
    await mcp(backend, player.accountId, dedicated, "dedicated_server", "UpdateQuests", { advance: [{ statName: "questcollect_survivoritemdata", count: 2 }] });

    const ended = await endMatch(backend, player.accountId, dedicated, "Failed", [entry(player.accountId)]);
    assert.deepEqual(ended.body.notifications.filter((notification) => notification.type === "earnScore").map((notification) => notification.baseXPEarned), [0]);
    assert.deepEqual(await questState(backend, player), { survivors: 0, state: "Active" });
  } finally {
    await backend.close();
  }
});

test("one EndMatch for several players: the sender's XP is in the response, another's in their next gameserver response", async () => {
  const backend = await startBackend();
  try {
    const dedicated = await dedicatedServerToken(backend.port);
    const sender = await userLogin(backend.port, "EndMatchSender");
    const other = await userLogin(backend.port, "EndMatchOther");
    const ended = await endMatch(backend, sender.accountId, dedicated, "Succeeded", [
      entry(sender.accountId, { totalScore: 1000 }), entry(other.accountId, { totalScore: 2000, bCriticalMatchBonus: true }),
      entry("no-such-account", { totalScore: 5 })]);
    assert.equal(ended.status, 200);
    const earned = ended.body.notifications.filter((notification) => notification.type === "earnScore");
    assert.equal(earned.length, 1, "only the sender's");
    assert.ok(earned[0].baseXPEarned > 0);

    const next = await mcp(backend, other.accountId, dedicated, "dedicated_server", "QueryProfile");
    const [held] = next.body.notifications.filter((notification) => notification.type === "earnScore");
    assert.ok(held.baseXPEarned > earned[0].baseXPEarned);
    assert.ok(held.bonusXPEarned > 0, "the critical match bonus");
    const again = await mcp(backend, other.accountId, dedicated, "dedicated_server", "QueryProfile");
    assert.equal(again.body.notifications?.filter((notification) => notification.type === "earnScore").length ?? 0, 0, "delivered once");
  } finally {
    await backend.close();
  }
});

// 5.40's UFortMcpProfileCampaign::FailsafeSaveMissionResults: one player's EndZoneScoreAndAwards, which the server sends
// through the player's own campaign profile when they leave with their results still unsaved.
const failsafe = (backend, accountId, dedicated, missionStatus, playerScoreData, matchmakingSessionId = "failsafe-session") =>
  mcp(backend, accountId, dedicated, "dedicated_server", "FailsafeSaveMissionResults", {
    playerScoreData: { bResultsPendingSave: true, totalScore: 0, bCriticalMatchBonus: false, earnedBadgeData: [], earnedItemCaches: [], numMissionPoints: 0, ...playerScoreData },
    matchmakingSessionId, missionName: "MissionInfo_Fighting", missionStatus, difficultyIncreaseTier: 0 });
const earnScores = (response) => (response.body.notifications ?? []).filter((notification) => notification.type === "earnScore");

test("FailsafeSaveMissionResults saves a leaving player's results as their EndMatch entry would have: the score's XP and the mission's end", async () => {
  const backend = await startBackend();
  try {
    const dedicated = await dedicatedServerToken(backend.port);
    const player = await userLogin(backend.port, "FailsafeWon");
    await post(backend.port, `/admin/api/accounts/${player.accountId}/grant`, undefined, { templateId: quest, quantity: 1 });
    await mcp(backend, player.accountId, dedicated, "dedicated_server", "StartPrimaryMission", { advance: [], matchmakingSessionId: "failsafe-session", missionName: "m" });
    // Progress that needs the mission won, reported in the zone and held until the mission's end.
    await mcp(backend, player.accountId, dedicated, "dedicated_server", "UpdateQuests", { advance: [{ statName: "questcollect_survivoritemdata", count: 3 },
      { statName: "complete_pve01_diff2", count: 1 }] });
    assert.deepEqual(await questState(backend, player), { survivors: 3, state: "Active" });

    const saved = await failsafe(backend, player.accountId, dedicated, "Succeeded", { totalScore: 17029, earnedItemCaches: ["WorldItem:cache_evolvetier_vr_pickup_t02"] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const [earned] = earnScores(saved);
    assert.ok(earned.baseXPEarned > 0, "the score's XP, as EarnScore gives it");
    assert.equal(earned.restXPEarned, earned.baseXPEarned);
    assert.notEqual((await questState(backend, player)).state, "Active", "the won mission completes the quest");
    const { profile } = (await mcp(backend, player.accountId, player.token, "client", "QueryProfile")).body.profileChanges[0];
    assert.ok(Object.values(profile.items).some((item) => item.templateId.toLowerCase().startsWith("cardpack:cardpack_cache_materials_t02")), "the item cache's pack");

    // The timer's second send for the same game session gives nothing more.
    const level = profile.stats.attributes.level;
    const again = await failsafe(backend, player.accountId, dedicated, "Succeeded", { totalScore: 17029 });
    assert.equal(again.status, 200);
    assert.deepEqual(earnScores(again), []);
    const after = (await mcp(backend, player.accountId, player.token, "client", "QueryProfile")).body.profileChanges[0].profile;
    assert.deepEqual([after.stats.attributes.level, after.stats.attributes.xp], [level, profile.stats.attributes.xp]);
  } finally {
    await backend.close();
  }
});

test("FailsafeSaveMissionResults gives nothing twice after EndMatch saved the same game session, and takes a lost mission's progress back", async () => {
  const backend = await startBackend();
  try {
    const dedicated = await dedicatedServerToken(backend.port);
    const saved = await userLogin(backend.port, "FailsafeAfterEndMatch");
    const sessionId = "ended-session";
    const ended = await mcp(backend, saved.accountId, dedicated, "dedicated_server", "EndMatch", { playersAndMatchEndData: [entry(saved.accountId, { totalScore: 5000 })],
      matchmakingSessionId: sessionId, missionName: "MissionInfo_Fighting", missionStatus: "Succeeded", difficultyIncreaseTier: 0 });
    assert.equal(earnScores(ended).length, 1);
    const before = (await mcp(backend, saved.accountId, saved.token, "client", "QueryProfile")).body.profileChanges[0].profile.stats.attributes;
    const skipped = await failsafe(backend, saved.accountId, dedicated, "Succeeded", { totalScore: 5000 }, sessionId);
    assert.equal(skipped.status, 200);
    assert.deepEqual(earnScores(skipped), [], "EndMatch had saved them");
    const after = (await mcp(backend, saved.accountId, saved.token, "client", "QueryProfile")).body.profileChanges[0].profile.stats.attributes;
    assert.deepEqual([after.level, after.xp], [before.level, before.xp]);
    // Another game session's results are their own.
    assert.equal(earnScores(await failsafe(backend, saved.accountId, dedicated, "Succeeded", { totalScore: 5000 }, "another-session")).length, 1);

    const lost = await userLogin(backend.port, "FailsafeLost");
    await post(backend.port, `/admin/api/accounts/${lost.accountId}/grant`, undefined, { templateId: quest, quantity: 1 });
    await mcp(backend, lost.accountId, dedicated, "dedicated_server", "StartPrimaryMission", { advance: [], matchmakingSessionId: "lost-session", missionName: "m" });
    await mcp(backend, lost.accountId, dedicated, "dedicated_server", "UpdateQuests", { advance: [{ statName: "questcollect_survivoritemdata", count: 2 }] });
    const failed = await failsafe(backend, lost.accountId, dedicated, "Failed", {}, "lost-session");
    assert.deepEqual(earnScores(failed).map((notification) => notification.baseXPEarned), [0]);
    assert.deepEqual(await questState(backend, lost), { survivors: 0, state: "Active" });
  } finally {
    await backend.close();
  }
});

test("an EndMatch entry's world save is applied when the server filled it in", async () => {
  const backend = await startBackend();
  try {
    const dedicated = await dedicatedServerToken(backend.port);
    const player = await userLogin(backend.port, "EndMatchSave");
    const ended = await endMatch(backend, player.accountId, dedicated, "Succeeded", [entry(player.accountId, {
      theaterItemUpdate: { baseCommandRevision: 0, addRequests: [{ itemId: "7A6B3C2D-0000-0000-0000-000000000001", templateId: "WorldItem:wooditemdata", quantity: 30, attributes: {} }],
        removeRequests: [], changeQuantityRequests: [], changeAttributesRequests: [], changeStatRequests: [] } })]);
    assert.equal(ended.status, 200);
    const theater = (await mcp(backend, player.accountId, dedicated, "dedicated_server", "QueryProfile", {}, "theater0")).body.profileChanges[0].profile;
    assert.equal(theater.items["7A6B3C2D-0000-0000-0000-000000000001"]?.quantity, 30);
  } finally {
    await backend.close();
  }
});

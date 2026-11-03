import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { firecrackerTickets } from "../src/events/spring2018.js";
import { trackChanges } from "../src/profiles/changes.js";
import { defaultStats } from "../src/profiles/defaults.js";
import { addDifficultyIncreaseRewards, claimDifficultyIncreaseRewards, difficultyIncreaseMissionRewards, difficultyIncreaseTierGroup,
  firecrackersPerTier } from "../src/profiles/difficultyincrease.js";
import { dedicatedServerToken, get, post, startBackend, userLogin } from "./helpers.js";

const v30 = "3901517";
const certPack = "CardPack:zcp_mtx_boost50";
const missionRewards = { tierGroupName: "Mission_Select_T01", items: [
  { itemType: "CardPack:zcp_eventscaling_t01", quantity: 1 },
  { itemType: certPack, quantity: 1 }
] };

function memorySession() {
  const trackers = {};
  return {
    profile(profileId) {
      trackers[profileId] ??= trackChanges({ profileId, stats: { attributes: defaultStats(profileId) }, items: {} });
      return trackers[profileId];
    }
  };
}
const record = (session) => session.profile("profile0").profile.stats.attributes.difficulty_increase_rewards_record;

test("each of the pylon's five tiers gives that many of the mission's pack, and Firecracker Tickets while Spring It On! runs", () => {
  const tiers = difficultyIncreaseMissionRewards(missionRewards);
  assert.equal(tiers.length, 5);
  assert.deepEqual(tiers[2], { tierGroupName: difficultyIncreaseTierGroup, items: [{ itemType: certPack, quantity: 3 }] });

  const spring = inBuild(v30, () => difficultyIncreaseMissionRewards(missionRewards));
  assert.deepEqual(spring[4].items.find(({ itemType }) => itemType === firecrackerTickets), { itemType: firecrackerTickets, quantity: 5 * firecrackersPerTier });
});

test("a raised mission's tier waits in difficulty_increase_rewards_record and the claim grants it once", () => {
  const session = memorySession();
  assert.equal(addDifficultyIncreaseRewards(session, 0, missionRewards), undefined, "an unraised mission has none");
  assert.equal(addDifficultyIncreaseRewards(session, Number(undefined), missionRewards), undefined);
  addDifficultyIncreaseRewards(session, 2, missionRewards);
  addDifficultyIncreaseRewards(session, 9, missionRewards);
  assert.deepEqual(record(session).pendingRewards.map(({ difficultyIncreaseTier }) => difficultyIncreaseTier), [2, 5]);
  assert.deepEqual(record(session).pendingRewards[0].difficultyIncreaseMissionRewards.items,
    [{ itemType: certPack, itemGuid: "", itemProfile: "", quantity: 2 }]);

  const notifications = [];
  claimDifficultyIncreaseRewards(session, notifications);
  const [claimed] = notifications;
  assert.equal(claimed.type, "claimedDifficultyIncreaseReward");
  // zcp_mtx_boost50 opens to 50 V-Bucks: 2 + 5 packs.
  const vbucks = claimed.lootGranted.items.filter(({ itemType }) => itemType === "Currency:mtxgiveaway");
  assert.equal(vbucks.reduce((total, { quantity }) => total + quantity, 0), 7 * 50);
  assert.deepEqual(record(session).pendingRewards, []);

  claimDifficultyIncreaseRewards(session, notifications);
  assert.equal(notifications.length, 1, "nothing pending, nothing to report");
});

test("EndPrimaryMission's difficultyIncreaseTier queues the tier's rewards and ClaimDifficultyIncreaseRewards hands them out", async () => {
  const backend = await startBackend();
  try {
    const server = await userLogin(backend.port, "CoreServer1");
    const dedicated = await dedicatedServerToken(backend.port);
    const player = await userLogin(backend.port, "PylonPlayer");
    const route = (kind, name) => `/fortnite/api/game/v2/profile/${player.accountId}/${kind}/${name}?profileId=profile0&rvn=-1`;
    const info = (await get(backend.port, "/fortnite/api/game/v2/world/info", player.token)).body;
    const theater = info.missions.find(({ availableMissions }) => availableMissions.some(({ missionRewards: rewards }) => rewards.items.length));
    const mission = theater.availableMissions.find(({ missionRewards: rewards }) => rewards.items.length);
    const zone = { worldId: "", theaterId: theater.theaterId, theaterMissionId: mission.missionGuid, theaterMissionAlertId: "", zoneThemeClass: "" };
    const registered = await post(backend.port, "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "CoreServer1", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 4, maxPrivatePlayers: 0, buildUniqueId: "595160781",
      attributes: { ZONEINSTANCEID_s: JSON.stringify(zone), GAMEMODE_s: "FORTPVE" }
    });

    // The zone details list every tier's rewards.
    const validated = await post(backend.port, `/fortnite/api/game/v2/world/validate?sessionId=${registered.body.id}`, dedicated, zone);
    assert.equal(validated.body.difficultyIncreaseMissionRewards.length, 5);

    const end = (missionStatus, difficultyIncreaseTier) => post(backend.port, route("dedicated_server", "EndPrimaryMission"), dedicated,
      { matchmakingSessionId: registered.body.id, missionName: "m", missionStatus, advance: [], difficultyIncreaseTier });
    await end("Failed", 3);
    await end("Succeeded", 0);
    const pendingNow = async () => (await post(backend.port, route("client", "QueryProfile"), player.token, {}))
      .body.profileChanges[0].profile.stats.attributes.difficulty_increase_rewards_record?.pendingRewards ?? [];
    assert.deepEqual(await pendingNow(), [], "a lost or unraised mission gives none");

    await end("Succeeded", 3);
    const [entry] = await pendingNow();
    assert.equal(entry.difficultyIncreaseTier, 3);
    assert.deepEqual(entry.difficultyIncreaseMissionRewards.items.map(({ itemType, quantity }) => ({ itemType, quantity })),
      validated.body.difficultyIncreaseMissionRewards[2].items);

    const claimed = await post(backend.port, route("client", "ClaimDifficultyIncreaseRewards"), player.token, {});
    assert.equal(claimed.status, 200);
    const [notification] = claimed.body.notifications;
    assert.equal(notification.type, "claimedDifficultyIncreaseReward");
    assert.ok(notification.lootGranted.items.length > 0);
    assert.deepEqual(await pendingNow(), []);
  } finally {
    backend.close();
  }
});

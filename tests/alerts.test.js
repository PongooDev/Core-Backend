import { test } from "node:test";
import assert from "node:assert/strict";
import { missionAlertTier } from "../src/gamedata/world.js";
import { alertsRemaining, claimMissionAlertRewards, completeMissionAlert, emptyAlertRecord } from "../src/profiles/alerts.js";
import { trackChanges } from "../src/profiles/changes.js";
import { addMissingStats, defaultStats } from "../src/profiles/defaults.js";
import { worldInfo } from "../src/world/theaters.js";
import { dedicatedServerToken, get, post, startBackend, userLogin } from "./helpers.js";

function memorySession() {
  const trackers = {};
  return {
    profile(profileId) {
      trackers[profileId] ??= trackChanges({ profileId, stats: { attributes: defaultStats(profileId) }, items: {} });
      return trackers[profileId];
    }
  };
}

const now = new Date("2026-10-19T12:00:00Z");
const hours = (count) => new Date(now.getTime() + count * 60 * 60 * 1000);
const alert = (guid) => ({
  missionAlertGuid: guid,
  missionAlertRewards: { tierGroupName: "MissionAlert_Proto_01", items: [{ itemType: "CardPack:zcp_mtx_boost50", quantity: 1 }] }
});
const record = (session) => session.profile("profile0").profile.stats.attributes.mission_alert_redemption_record;

test("alerts sit on missions whose tile and difficulty allow one, a region each, with their tier's rewards", () => {
  const info = worldInfo(now);
  info.missionAlerts.forEach(({ theaterId, availableMissionAlerts }, index) => {
    const data = info.theaters[index];
    const missions = info.missions[index].availableMissions;
    const regions = availableMissionAlerts.map(({ tileIndex }) => data.regions.findIndex((region) => region.tileIndices.includes(tileIndex)));
    assert.equal(new Set(regions).size, regions.length, `${theaterId}: one alert per region`);
    for (const { tileIndex, missionAlertRewards, availableUntil } of availableMissionAlerts) {
      const mission = missions.find((candidate) => candidate.tileIndex === tileIndex);
      assert.ok(mission && data.tiles[tileIndex].canBeMissionAlert);
      assert.equal(missionAlertRewards.tierGroupName, missionAlertTier(mission.missionDifficultyInfo.rowName).lootTierGroup);
      assert.ok(missionAlertRewards.items.some(({ itemType }) => itemType.startsWith("CardPack:zcp_mtx_")));
      assert.equal(availableUntil, "2026-10-19T23:59:59.999Z");
    }
  });
  assert.ok(info.missionAlerts.some(({ availableMissionAlerts }) => availableMissionAlerts.length));
  assert.deepEqual(worldInfo(now).missionAlerts, info.missionAlerts, "the same all day");
});

test("three alerts a day: each takes the oldest claim time, a done alert doesn't count twice", () => {
  const session = memorySession();
  assert.equal(alertsRemaining(record(session), now), 3);
  assert.ok(completeMissionAlert(session, "theater", alert("a"), now));
  assert.equal(completeMissionAlert(session, "theater", alert("a"), now), false);
  assert.ok(completeMissionAlert(session, "theater", alert("b"), hours(1)));
  assert.ok(completeMissionAlert(session, "other", alert("c"), hours(2)));
  assert.equal(completeMissionAlert(session, "theater", alert("d"), hours(3)), false);
  assert.equal(alertsRemaining(record(session), hours(3)), 0);
  assert.equal(alertsRemaining(record(session), hours(24)), 1);

  assert.ok(completeMissionAlert(session, "theater", alert("d"), hours(24)));
  const { lastClaimTimes, oldestClaimIndex, lastClaimedGuidPerTheater, pendingMissionAlertRewards } = record(session);
  assert.deepEqual(lastClaimTimes, [hours(24), hours(1), hours(2)].map((date) => date.toISOString()));
  assert.equal(oldestClaimIndex, 1);
  assert.deepEqual(lastClaimedGuidPerTheater, [{ theaterGUID: "other", missionAlertGuid: "c" }, { theaterGUID: "theater", missionAlertGuid: "d" }]);
  assert.equal(pendingMissionAlertRewards.items.length, 4);
});

test("claiming opens the pending rewards and reports them", () => {
  const session = memorySession();
  completeMissionAlert(session, "theater", alert("a"), now);
  const notifications = [];
  claimMissionAlertRewards(session, notifications);
  const [complete] = notifications;
  assert.equal(complete.type, "missionAlertComplete");
  assert.deepEqual(complete.lootGranted.items.map(({ itemType, quantity, itemProfile }) => [itemType, quantity, itemProfile]),
    [["Currency:mtxgiveaway", 50, "profile0"]]);
  const vbucks = session.profile("profile0").profile.items[complete.lootGranted.items[0].itemGuid];
  assert.equal(vbucks.quantity, 50);
  assert.deepEqual(record(session).pendingMissionAlertRewards, { tierGroupName: "", items: [] });

  claimMissionAlertRewards(session, notifications);
  assert.equal(notifications.length, 1, "nothing pending, nothing to report");
});

test("records without quota slots get them", () => {
  const profile = { profileId: "profile0", stats: { attributes: { ...defaultStats("profile0"), mission_alert_redemption_record: { ...emptyAlertRecord(), lastClaimTimes: [] } } }, items: {} };
  assert.equal(addMissingStats(profile), true);
  assert.equal(alertsRemaining(profile.stats.attributes.mission_alert_redemption_record, now), 3);
});

test("a won alert mission queues the alert's rewards and ClaimMissionAlertRewards hands them out", async () => {
  const backend = await startBackend();
  try {
    const server = await userLogin(backend.port, "CoreServer1");
    const dedicated = await dedicatedServerToken(backend.port);
    const player = await userLogin(backend.port, "AlertPlayer");
    const route = (kind, name) => `/fortnite/api/game/v2/profile/${player.accountId}/${kind}/${name}?profileId=profile0&rvn=-1`;
    const info = (await get(backend.port, "/fortnite/api/game/v2/world/info", player.token)).body;
    const theater = info.missionAlerts.find(({ availableMissionAlerts }) => availableMissionAlerts.length);
    const [missionAlert] = theater.availableMissionAlerts;
    const mission = info.missions.find(({ theaterId }) => theaterId === theater.theaterId).availableMissions
      .find(({ tileIndex }) => tileIndex === missionAlert.tileIndex);

    const zone = { worldId: "", theaterId: theater.theaterId, theaterMissionId: mission.missionGuid, theaterMissionAlertId: missionAlert.missionAlertGuid, zoneThemeClass: "" };
    const registered = await post(backend.port, "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "CoreServer1", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 4, maxPrivatePlayers: 0, buildUniqueId: "595160781",
      attributes: { ZONEINSTANCEID_s: JSON.stringify(zone), GAMEMODE_s: "FORTPVE" }
    });
    await post(backend.port, route("dedicated_server", "EndPrimaryMission"), dedicated,
      { matchmakingSessionId: registered.body.id, missionName: "m", missionStatus: "Succeeded", advance: [] });

    const queried = await post(backend.port, route("client", "QueryProfile"), player.token, {});
    const pending = queried.body.profileChanges[0].profile.stats.attributes.mission_alert_redemption_record.pendingMissionAlertRewards;
    assert.deepEqual(pending.items.map(({ itemType }) => itemType), missionAlert.missionAlertRewards.items.map(({ itemType }) => itemType));

    const claimed = await post(backend.port, route("client", "ClaimMissionAlertRewards"), player.token, {});
    assert.equal(claimed.status, 200);
    const [complete] = claimed.body.notifications;
    assert.equal(complete.type, "missionAlertComplete");
    assert.ok(complete.lootGranted.items.some(({ itemType }) => itemType === "Currency:mtxgiveaway"));
  } finally {
    backend.close();
  }
});

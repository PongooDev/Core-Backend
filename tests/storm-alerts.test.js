import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { seasonalEvents } from "../src/events/events.js";
import { mutantStormsEventQuests, stormTickets } from "../src/events/mutantstorms.js";
import { getDifficulty, missionAlertTier } from "../src/gamedata/world.js";
import { alertsRemaining, completeMissionAlert, emptyAlertRecord, withQuotaSlots } from "../src/profiles/alerts.js";
import { trackChanges } from "../src/profiles/changes.js";
import { defaultStats } from "../src/profiles/defaults.js";
import { findMission, stormTicketsFor, worldInfo } from "../src/world/theaters.js";
import { clientToken, send, startBackend } from "./helpers.js";

// Core-Backend #129: 1.9.1's storm swirls (StormLowCategory and the Mutant Storms' StormCategory alerts), their
// modifiers, rewards and per-category claims.
const v191 = "3775276";
const at = (time) => new Date(`2026-10-30T${time}Z`);
const alertsOf = (info) => info.missionAlerts.flatMap(({ theaterId, availableMissionAlerts }) => availableMissionAlerts.map((alert) => ({ theaterId, ...alert })));
const withoutEvents = (run) => {
  let result;
  seasonalEvents(() => false)({}, {}, () => { result = run(); });
  return result;
};

function memorySession() {
  const trackers = {};
  return {
    profile(profileId) {
      trackers[profileId] ??= trackChanges({ profileId, stats: { attributes: defaultStats(profileId) }, items: {} });
      return trackers[profileId];
    }
  };
}
const record = (session) => session.profile("profile0").profile.stats.attributes.mission_alert_redemption_record;
const alert = (guid, categoryName) => ({
  categoryName, missionAlertGuid: guid,
  missionAlertRewards: { tierGroupName: "MissionAlert_Storm", items: [{ itemType: "CardPack:zcp_reagent_c_t01_high", quantity: 1 }] }
});

test("1.9.1 has storm swirls: StormLow alerts with the zone's reagents, Storm Tickets by difficulty and storm modifiers", () => {
  inBuild(v191, () => {
    const info = worldInfo(at("12:00:00"));
    const storms = alertsOf(info).filter(({ categoryName }) => categoryName === "StormLowCategory");
    assert.ok(storms.length >= 4, `${storms.length} StormLow alerts`);
    for (const storm of storms) {
      const index = info.missionAlerts.findIndex(({ theaterId }) => theaterId === storm.theaterId);
      const mission = info.missions[index].availableMissions.find(({ tileIndex }) => tileIndex === storm.tileIndex);
      const row = missionAlertTier(mission.missionDifficultyInfo.rowName, "StormLowCategory");
      assert.equal(storm.missionAlertRewards.tierGroupName, "MissionAlert_Storm");
      const [reagents, tickets] = storm.missionAlertRewards.items;
      assert.match(reagents.itemType, /^CardPack:zcp_reagent_c_t0[1-4]_high$/);
      assert.deepEqual(tickets, { itemType: stormTickets, quantity: getDifficulty(mission.missionDifficultyInfo.rowName).difficulty * 10 });
      assert.equal(storm.missionAlertModifiers.tierGroupName, row.modifierTierGroup);
      const count = { "STMZ.ZoneMods_Stonewood": 1, "STMZ.ZoneMods_Plankerton": 2, "STMZ.ZoneMods_CanneyValley": 2, "STMZ.ZoneMods_TwinePeaks": 3 }[row.modifierTierGroup];
      assert.equal(storm.missionAlertModifiers.items.length, count, row.modifierTierGroup);
      assert.ok(storm.missionAlertModifiers.items.every(({ itemType, quantity }) => itemType.startsWith("GameplayModifier:gm_") && quantity === 1));
      assert.equal(storm.spreadDataName, "");
    }
    // The same difficulty gives the same tickets everywhere (1.9.1's notes).
    assert.equal(stormTicketsFor("Theater_Normal_Zone1"), 120);
    // Without the event (the Seasonal Events switch off) the swirls stay, with reagents only.
    const quiet = withoutEvents(() => alertsOf(worldInfo(at("12:00:00"))));
    assert.ok(quiet.some(({ categoryName }) => categoryName === "StormLowCategory"));
    assert.ok(quiet.every(({ categoryName, missionAlertRewards }) => categoryName !== "StormCategory"
      && missionAlertRewards.items.every(({ itemType }) => itemType !== stormTickets)));
  });
});

test("1.9.1's Mutant Storms (EventFlag.Vindertech) spread through the day, the same for everyone", () => {
  inBuild(v191, () => {
    const early = worldInfo(at("00:00:01"));
    const late = worldInfo(at("23:00:00"));
    const mutant = (info) => alertsOf(info).filter(({ categoryName }) => categoryName === "StormCategory");
    const sources = mutant(early);
    assert.ok(sources.length >= 4, `${sources.length} Mutant Storms`);
    assert.ok(sources.every(({ spreadDataName, refreshSpreadAt }) => spreadDataName.endsWith("StormSpread") && refreshSpreadAt > "2026-10-30T00:00:01"));
    // Each theater's alerts are asked for again at the next spread.
    assert.ok(early.missionAlerts.some(({ nextRefresh }) => nextRefresh < "2026-10-30T23:59:59.999Z"));
    assert.ok(late.missionAlerts.every(({ nextRefresh }) => nextRefresh === "2026-10-30T23:59:59.999Z"));

    const spread = mutant(late).filter(({ spreadDataName }) => spreadDataName === "");
    assert.ok(spread.length > 0, "some storms spread");
    assert.deepEqual(mutant(late).filter(({ spreadDataName }) => spreadDataName).map(({ missionAlertGuid }) => missionAlertGuid),
      sources.map(({ missionAlertGuid }) => missionAlertGuid), "the storms that spread are the morning's");
    assert.deepEqual(worldInfo(at("23:00:00")).missionAlerts, late.missionAlerts, "deterministic");
    const tiles = alertsOf(late).map(({ theaterId, tileIndex }) => `${theaterId}:${tileIndex}`);
    assert.equal(new Set(tiles).size, tiles.length, "one alert a mission");
    // A spread storm is a mission's alert like any other, for the matchmaking zone and the gameserver.
    const [first] = spread;
    const missions = late.missions.find(({ theaterId }) => theaterId === first.theaterId).availableMissions;
    const mission = missions.find(({ tileIndex }) => tileIndex === first.tileIndex);
    assert.equal(findMission(mission.missionGuid, at("23:30:00"), first.missionAlertGuid).missionAlert.missionAlertGuid, first.missionAlertGuid);
    // A match that started before midnight still finds yesterday's spread storm.
    assert.equal(findMission(mission.missionGuid, new Date("2026-10-31T00:20:00Z"), first.missionAlertGuid)?.missionAlert?.missionAlertGuid, first.missionAlertGuid);

    assert.ok(mutantStormsEventQuests().includes("vindertechquest_completestorms_1"));
    assert.equal(withoutEvents(() => mutantStormsEventQuests()).length, 0);
  });
  // Before 1.9.1 no build runs the Mutant Storms; 1.7.2 to 1.9 keep their storm alerts.
  inBuild("3757339", () => {
    const alerts = alertsOf(worldInfo(at("23:00:00")));
    assert.ok(alerts.every(({ categoryName }) => categoryName !== "StormCategory"));
    assert.ok(alerts.some(({ missionAlertRewards }) => /^MissionAlert_Storm_T\d\d$/.test(missionAlertRewards.tierGroupName)));
  });
});

test("from 1.7.2 the claim record keeps each category's quota and alerts, as the client reads it", () => {
  inBuild(v191, () => {
    const session = memorySession();
    const now = at("12:00:00");
    const later = (hours) => new Date(now.getTime() + hours * 60 * 60 * 1000);
    const empty = emptyAlertRecord();
    assert.deepEqual(Object.fromEntries(Object.entries(empty.lastClaimTimesMap).map(([category, { lastClaimedTimes }]) => [category, lastClaimedTimes.length])),
      { General: 3, Storm: 10, StormLow: 4, Horde: 6, Halloween: 10 });
    assert.deepEqual(empty.oldestClaimIndexForCategory, [0, 0, 0, 0, 0]);

    for (const [index, guid] of ["a", "b", "c", "d"].entries()) assert.ok(completeMissionAlert(session, "t", alert(guid, "StormLowCategory"), later(index)));
    assert.equal(completeMissionAlert(session, "t", alert("e", "StormLowCategory"), later(5)), false, "StormLow's quota is 4");
    assert.equal(alertsRemaining(record(session), later(5), "StormLowCategory"), 0);
    assert.ok(completeMissionAlert(session, "t", alert("g", "GeneralCategory"), later(5)), "General has its own");
    assert.equal(completeMissionAlert(session, "t", alert("g", "GeneralCategory"), later(6)), false, "an alert once");
    assert.ok(completeMissionAlert(session, "t", alert("h", "HalloweenCategory"), later(6)));
    assert.ok(completeMissionAlert(session, "t", alert("h", "HalloweenCategory"), later(7)), "Halloween's are repeatable");

    const { lastClaimTimesMap, oldestClaimIndexForCategory, pendingMissionAlertRewards } = record(session);
    assert.deepEqual(lastClaimTimesMap.StormLow.missionAlertGUIDs, ["a", "b", "c", "d"]);
    assert.deepEqual(lastClaimTimesMap.General.missionAlertGUIDs, ["g", "", ""]);
    assert.deepEqual(oldestClaimIndexForCategory, [1, 0, 0, 0, 2]);
    assert.equal(pendingMissionAlertRewards.items.length, 7);

    // A day after the first claim, its slot frees up and is used next.
    assert.ok(completeMissionAlert(session, "t", alert("e", "StormLowCategory"), later(24)));
    assert.deepEqual(record(session).lastClaimTimesMap.StormLow.missionAlertGUIDs, ["e", "b", "c", "d"]);
  });
  // A record from Cert gains the categories on 1.9.1, keeping its own fields for Cert.
  const cert = emptyAlertRecord();
  assert.equal(cert.lastClaimTimesMap, undefined);
  const upgraded = inBuild(v191, () => withQuotaSlots(cert));
  assert.deepEqual(upgraded.lastClaimTimes, cert.lastClaimTimes);
  assert.equal(upgraded.lastClaimTimesMap.Storm.lastClaimedTimes.length, 10);
});

test("world/validate gives the gameserver the zone's alert: its rewards, its modifiers and its category", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    const agent = `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${v191}`;
    const call = (method, path, body) => send({ host: "127.0.0.1", port: backend.port, method, path,
      headers: { "User-Agent": agent, Authorization: `bearer ${token}`, ...(body && { "Content-Type": "application/json" }) } },
    body && JSON.stringify(body));
    const info = (await call("GET", "/fortnite/api/game/v2/world/info")).body;
    const storm = alertsOf(info).find(({ categoryName, missionAlertModifiers }) => categoryName === "StormLowCategory" && missionAlertModifiers.items.length);
    const mission = info.missions.find(({ theaterId }) => theaterId === storm.theaterId).availableMissions.find(({ tileIndex }) => tileIndex === storm.tileIndex);
    const zone = { worldId: "", theaterId: storm.theaterId, theaterMissionId: mission.missionGuid, theaterMissionAlertId: storm.missionAlertGuid, zoneThemeClass: "" };
    const details = (await call("POST", "/fortnite/api/game/v2/world/validate?sessionId=abc", zone)).body;
    assert.deepEqual(details.missionAlertRewards, storm.missionAlertRewards);
    assert.deepEqual(details.zoneModifiers, storm.missionAlertModifiers);
    assert.equal(details.missionAlertCategoryName, "StormLowCategory");
    assert.equal(details.theaterMissionAlertId, storm.missionAlertGuid);
  } finally {
    backend.close();
  }
});

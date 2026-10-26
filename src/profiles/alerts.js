import { rollContents } from "../cardpacks/contents.js";
import { dailyMissionAlertQuota } from "../gamedata/world.js";
import { lootEntry } from "./items.js";
import { grant } from "./progress.js";

// profile0's mission_alert_redemption_record (FFortMissionAlertRecord). The client shows the alerts a player has left
// today as the number of lastClaimTimes over 24 hours old (UFortFrontEndContext::GetMissionAlertQuotaRemaining), so
// the record keeps one time per DailyMissionAlertQuota (3), oldestClaimIndex pointing at the one to overwrite next.
// lastClaimedGuidPerTheater ([FFortTheaterMissionAlertTuple {theaterGUID, missionAlertGuid}]) is the last alert done
// in each theater, and pendingMissionAlertRewards what ClaimMissionAlertRewards hands out (HasPendingMissionAlertRewards
// is its items being non-empty).
const never = "0001-01-01T00:00:00.000Z";
const day = 24 * 60 * 60 * 1000;

export function emptyAlertRecord() {
  return {
    lastClaimedGuidPerTheater: [],
    lastClaimTimes: Array(dailyMissionAlertQuota()).fill(never),
    oldestClaimIndex: 0,
    pendingMissionAlertRewards: { tierGroupName: "", items: [] }
  };
}

// Records made before the quota slots existed have no claim times, which the client reads as no alerts left.
export function withQuotaSlots(record) {
  const times = Array.isArray(record?.lastClaimTimes) ? record.lastClaimTimes : [];
  if (times.length >= dailyMissionAlertQuota()) return record;
  return { ...emptyAlertRecord(), ...record, lastClaimTimes: [...times, ...Array(dailyMissionAlertQuota() - times.length).fill(never)] };
}

export function alertsRemaining(record, now = new Date()) {
  return (record.lastClaimTimes ?? []).filter((time) => Date.parse(time) <= now.getTime() - day).length;
}

// A won mission that carried an alert: its rewards wait in the record, as long as the player has an alert left today
// and hasn't already done this one. Returns whether they were added.
export function completeMissionAlert(session, theaterId, alert, now = new Date()) {
  const tracker = session.profile("profile0");
  const record = withQuotaSlots(tracker.profile.stats.attributes.mission_alert_redemption_record ?? emptyAlertRecord());
  const done = record.lastClaimedGuidPerTheater.some((tuple) => tuple.theaterGUID === theaterId && tuple.missionAlertGuid === alert.missionAlertGuid);
  if (done || alertsRemaining(record, now) === 0) return false;

  const times = [...record.lastClaimTimes];
  const slot = record.oldestClaimIndex % times.length;
  times[slot] = now.toISOString();
  const pending = record.pendingMissionAlertRewards ?? { tierGroupName: "", items: [] };
  tracker.setStat("mission_alert_redemption_record", {
    ...record,
    lastClaimedGuidPerTheater: [
      ...record.lastClaimedGuidPerTheater.filter((tuple) => tuple.theaterGUID !== theaterId),
      { theaterGUID: theaterId, missionAlertGuid: alert.missionAlertGuid }
    ],
    lastClaimTimes: times,
    oldestClaimIndex: (slot + 1) % times.length,
    pendingMissionAlertRewards: {
      tierGroupName: alert.missionAlertRewards.tierGroupName,
      items: [...(pending.items ?? []), ...alert.missionAlertRewards.items.map(({ itemType, quantity }) => ({ itemType, itemGuid: "", itemProfile: "", quantity }))]
    }
  });
  return true;
}

// ClaimMissionAlertRewards: the pending rewards, packs opened, reported as missionAlertComplete
// (FFortMissionAlertCompleteNotification {lootGranted}); the client looks each itemGuid up to show what came out.
export function claimMissionAlertRewards(session, notifications) {
  const tracker = session.profile("profile0");
  const record = tracker.profile.stats.attributes.mission_alert_redemption_record ?? emptyAlertRecord();
  const pending = record.pendingMissionAlertRewards ?? { tierGroupName: "", items: [] };
  if (!pending.items?.length) return;

  const items = [];
  for (const { itemType, quantity } of pending.items) {
    const contents = itemType.toLowerCase().startsWith("cardpack:")
      ? Array.from({ length: quantity }, () => rollContents(itemType)).flat()
      : [{ templateId: itemType, quantity }];
    for (const content of contents) items.push(...grant(session, content.templateId, content.quantity).map(lootEntry));
  }
  tracker.setStat("mission_alert_redemption_record", { ...withQuotaSlots(record), pendingMissionAlertRewards: { tierGroupName: "", items: [] } });
  notifications.push({ type: "missionAlertComplete", primary: true, lootGranted: { tierGroupName: pending.tierGroupName, items } });
}

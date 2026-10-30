import { rollContents } from "../cardpacks/contents.js";
import { dailyMissionAlertQuota, hasMissionAlertCategories, missionAlertCategories, missionAlertCategory } from "../gamedata/world.js";
import { lootEntry } from "./items.js";
import { grant } from "./progress.js";

// profile0's mission_alert_redemption_record (FFortMissionAlertRecord), in the requesting build's shape.
//
// Cert and 1.2: one quota for every alert. The client shows the alerts a player has left today as the number of
// lastClaimTimes over 24 hours old (UFortFrontEndContext::GetMissionAlertQuotaRemaining), so the record keeps one time
// per DailyMissionAlertQuota (3), oldestClaimIndex pointing at the one to overwrite next. lastClaimedGuidPerTheater
// ([FFortTheaterMissionAlertTuple {theaterGUID, missionAlertGuid}]) is the last alert done in each theater.
//
// From 1.7.2 (its exe, 1.8 to 1.9.1's SDKs) each EFortMissionAlertCategory has its own quota and claims:
// lastClaimTimesMap (TMap<EFortMissionAlertCategory, FFortMissionAlertClaimData {missionAlertGUIDs, lastClaimedTimes}>,
// keyed by the enum's name: General, Storm, Horde, StormLow, Halloween) and oldestClaimIndexForCategory (one index per
// enum value). 1.9.1's GetMissionAlertQuotaRemaining (0x2DF8880) looks up the tile's alert's category row
// (MissionAlertCategories), then that category's claim data: no entry is a claim left; an alert whose guid is among
// missionAlertGUIDs is done (the map shows it so); otherwise a claim is left while one of lastClaimedTimes is over
// 24 hours old. So the record keeps a guid and a time per slot of each category's Quota (MissionAlertCategories:
// General 3, Storm 10, StormLow 4, Horde 6, Halloween 10).
//
// pendingMissionAlertRewards is what ClaimMissionAlertRewards hands out (HasPendingMissionAlertRewards is its items
// being non-empty), the same in both. A profile played on both kinds of build keeps both shapes' fields; each client
// reads its own.
const never = "0001-01-01T00:00:00.000Z";
const day = 24 * 60 * 60 * 1000;
const emptyLoot = () => ({ tierGroupName: "", items: [] });

// EFortMissionAlertCategory (1.8.2, 1.9, 1.9.1 SDKs).
export const categoryOrder = ["General", "Storm", "Horde", "StormLow", "Halloween"];

const legacyFields = () => ({
  lastClaimedGuidPerTheater: [],
  lastClaimTimes: Array(dailyMissionAlertQuota()).fill(never),
  oldestClaimIndex: 0
});

function categoryFields() {
  const lastClaimTimesMap = {};
  for (const { category, quota } of Object.values(missionAlertCategories())) {
    lastClaimTimesMap[category] = { missionAlertGUIDs: Array(quota).fill(""), lastClaimedTimes: Array(quota).fill(never) };
  }
  return { lastClaimTimesMap, oldestClaimIndexForCategory: categoryOrder.map(() => 0) };
}

export function emptyAlertRecord() {
  return { ...legacyFields(), ...(hasMissionAlertCategories() ? categoryFields() : {}), pendingMissionAlertRewards: emptyLoot() };
}

// Fills in what the requesting build's shape needs: records made before the quota slots existed have no claim times
// (which the client reads as no alerts left), records from the other kind of build lack this one's fields, and a
// category's slots grow to its quota.
export function withQuotaSlots(record) {
  let result = record ?? {};
  const times = Array.isArray(result.lastClaimTimes) ? result.lastClaimTimes : [];
  if (times.length < dailyMissionAlertQuota() || !Array.isArray(result.lastClaimedGuidPerTheater)) {
    result = { ...legacyFields(), ...result, lastClaimTimes: [...times, ...Array(Math.max(dailyMissionAlertQuota() - times.length, 0)).fill(never)] };
  }
  if (hasMissionAlertCategories()) {
    const fresh = categoryFields();
    const map = result.lastClaimTimesMap ?? {};
    const short = Object.entries(fresh.lastClaimTimesMap).some(([category, { lastClaimedTimes }]) =>
      (map[category]?.lastClaimedTimes?.length ?? 0) < lastClaimedTimes.length);
    if (short || !Array.isArray(result.oldestClaimIndexForCategory)) {
      const lastClaimTimesMap = { ...map };
      for (const [category, slots] of Object.entries(fresh.lastClaimTimesMap)) {
        const held = map[category] ?? {};
        const guids = Array.isArray(held.missionAlertGUIDs) ? held.missionAlertGUIDs : [];
        const claimed = Array.isArray(held.lastClaimedTimes) ? held.lastClaimedTimes : [];
        lastClaimTimesMap[category] = {
          missionAlertGUIDs: [...guids, ...slots.missionAlertGUIDs.slice(guids.length)],
          lastClaimedTimes: [...claimed, ...slots.lastClaimedTimes.slice(claimed.length)]
        };
      }
      const indexes = Array.isArray(result.oldestClaimIndexForCategory) ? result.oldestClaimIndexForCategory : [];
      result = { ...result, lastClaimTimesMap, oldestClaimIndexForCategory: categoryOrder.map((_, index) => indexes[index] ?? 0) };
    }
  }
  if (!result.pendingMissionAlertRewards) result = { ...result, pendingMissionAlertRewards: emptyLoot() };
  return result === record ? record : result;
}

const overADayOld = (now) => (time) => Date.parse(time) <= now.getTime() - day;

// Alerts left today: Cert's single quota, or (from 1.7.2) a category's, by its MissionAlertCategories row or enum name.
export function alertsRemaining(record, now = new Date(), categoryName = "GeneralCategory") {
  if (!hasMissionAlertCategories()) return (record.lastClaimTimes ?? []).filter(overADayOld(now)).length;
  const category = missionAlertCategory(categoryName)?.category ?? categoryName;
  return (record.lastClaimTimesMap?.[category]?.lastClaimedTimes ?? []).filter(overADayOld(now)).length;
}

// A won mission that carried an alert: its rewards wait in the record, as long as the player has an alert of its
// category left today and hasn't already done this one (a repeatable category's, Horde and Halloween, can be done
// again). Returns whether they were added.
export function completeMissionAlert(session, theaterId, alert, now = new Date()) {
  const tracker = session.profile("profile0");
  const record = withQuotaSlots(tracker.profile.stats.attributes.mission_alert_redemption_record ?? emptyAlertRecord());
  const pending = record.pendingMissionAlertRewards ?? emptyLoot();
  const rewards = {
    tierGroupName: alert.missionAlertRewards.tierGroupName,
    items: [...(pending.items ?? []), ...alert.missionAlertRewards.items.map(({ itemType, quantity }) => ({ itemType, itemGuid: "", itemProfile: "", quantity }))]
  };

  if (!hasMissionAlertCategories()) {
    const done = record.lastClaimedGuidPerTheater.some((tuple) => tuple.theaterGUID === theaterId && tuple.missionAlertGuid === alert.missionAlertGuid);
    if (done || alertsRemaining(record, now) === 0) return false;
    const times = [...record.lastClaimTimes];
    const slot = record.oldestClaimIndex % times.length;
    times[slot] = now.toISOString();
    tracker.setStat("mission_alert_redemption_record", {
      ...record,
      lastClaimedGuidPerTheater: [
        ...record.lastClaimedGuidPerTheater.filter((tuple) => tuple.theaterGUID !== theaterId),
        { theaterGUID: theaterId, missionAlertGuid: alert.missionAlertGuid }
      ],
      lastClaimTimes: times,
      oldestClaimIndex: (slot + 1) % times.length,
      pendingMissionAlertRewards: rewards
    });
    return true;
  }

  const categoryRow = missionAlertCategory(alert.categoryName ?? "GeneralCategory") ?? missionAlertCategory("GeneralCategory");
  if (!categoryRow) return false;
  const { category, repeatable } = categoryRow;
  const claims = record.lastClaimTimesMap[category];
  if (!repeatable && claims.missionAlertGUIDs.includes(alert.missionAlertGuid)) return false;
  if (!claims.lastClaimedTimes.some(overADayOld(now))) return false;
  const enumIndex = Math.max(categoryOrder.indexOf(category), 0);
  const indexes = [...record.oldestClaimIndexForCategory];
  // The slot to use: the oldest index's when it is free again, else the first free one.
  let slot = (indexes[enumIndex] ?? 0) % claims.lastClaimedTimes.length;
  if (!overADayOld(now)(claims.lastClaimedTimes[slot])) slot = claims.lastClaimedTimes.findIndex(overADayOld(now));
  const missionAlertGUIDs = [...claims.missionAlertGUIDs];
  const lastClaimedTimes = [...claims.lastClaimedTimes];
  missionAlertGUIDs[slot] = alert.missionAlertGuid;
  lastClaimedTimes[slot] = now.toISOString();
  indexes[enumIndex] = (slot + 1) % lastClaimedTimes.length;
  tracker.setStat("mission_alert_redemption_record", {
    ...record,
    lastClaimTimesMap: { ...record.lastClaimTimesMap, [category]: { missionAlertGUIDs, lastClaimedTimes } },
    oldestClaimIndexForCategory: indexes,
    pendingMissionAlertRewards: rewards
  });
  return true;
}

// ClaimMissionAlertRewards: the pending rewards, packs opened, reported as missionAlertComplete
// (FFortMissionAlertCompleteNotification {lootGranted}); the client looks each itemGuid up to show what came out.
export function claimMissionAlertRewards(session, notifications) {
  const tracker = session.profile("profile0");
  const record = tracker.profile.stats.attributes.mission_alert_redemption_record ?? emptyAlertRecord();
  const pending = record.pendingMissionAlertRewards ?? emptyLoot();
  if (!pending.items?.length) return;

  const items = [];
  for (const { itemType, quantity } of pending.items) {
    const contents = itemType.toLowerCase().startsWith("cardpack:")
      ? Array.from({ length: quantity }, () => rollContents(itemType)).flat()
      : [{ templateId: itemType, quantity }];
    for (const content of contents) items.push(...grant(session, content.templateId, content.quantity).map(lootEntry));
  }
  tracker.setStat("mission_alert_redemption_record", { ...withQuotaSlots(record), pendingMissionAlertRewards: emptyLoot() });
  notifications.push({ type: "missionAlertComplete", primary: true, lootGranted: { tierGroupName: pending.tierGroupName, items } });
}

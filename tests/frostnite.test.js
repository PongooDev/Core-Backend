import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { rollContents } from "../src/cardpacks/contents.js";
import { configureEvents } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { clearEndedFrostniteRun, frostniteEventQuests, frostniteQuests, frostniteWeekQuest, frostniteWorldProfile, isFrostniteWaveBadge, noteFrostniteRunEnded,
  snowflakePerWave, winterLlama2018 } from "../src/events/frostnite2018.js";
import { eventQuestLine } from "../src/events/quests.js";
import { snowflakeTickets } from "../src/events/winter2017.js";
import { getQuest } from "../src/gamedata/quests.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { findOffer, storefronts } from "../src/store/catalog.js";
import { eventStoreEnds, eventStoreInstanceNow, eventStorefront } from "../src/store/eventstore.js";
import { findMission, worldInfo } from "../src/world/theaters.js";
import { frostniteGenerator, frostniteId, frostniteTag, frostniteZoneTheme } from "../src/world/frostnite.js";

// Frostnite (7.10, CL-4667333; CoreV2 #478): its theater, quests, Winter Llama, Event Store and rewards.
const v710 = "4667333";
const v700 = "4629139";
const v720 = "4727874";
// Season 7's replay from a fixed first day, so that a date is a day of the season (6 December 2018 is day 1).
const withSeason7 = (start, run) => {
  configureEvents({ mode: "auto", seasonStarts: { 7: start } });
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
// 2026-11-01 on a replay that began 2026-10-01 is the season's day 32, 6 January 2019: Slip Out's week.
const replayStart = "2026-10-01";
const onDay = (day) => new Date(Date.parse(`${replayStart}T12:00:00Z`) + (day - 1) * 86400000);
const slipOutDay = onDay(32);
const burnBrightDay = onDay(35);
const beforeWeeks = onDay(20);
const frostniteOf = (info) => {
  const index = info.theaters.findIndex((theater) => theater.uniqueId === frostniteId);
  return index < 0 ? undefined
    : { theater: info.theaters[index], missions: info.missions[index].availableMissions, alerts: info.missionAlerts[index].availableMissionAlerts };
};

test("Frostnite is on 7.10's map, and not on 7.00's", () => withSeason7(replayStart, () => {
  inBuild(v710, () => assert.ok(frostniteOf(worldInfo(beforeWeeks))));
  inBuild(v700, () => assert.equal(frostniteOf(worldInfo(beforeWeeks)), undefined));
}));

test("its theater: Stat.Theater.Endless, a zone a difficulty with its Frostnite mission, gated by the campaign", () => withSeason7(replayStart, () => inBuild(v710, () => {
  const { theater, missions, alerts } = frostniteOf(worldInfo(beforeWeeks));
  assert.equal(theater.displayName.en, "Frostnite");
  assert.deepEqual(theater.runtimeInfo.theaterTags.gameplayTags, [{ tagName: frostniteTag }]);
  assert.equal(theater.runtimeInfo.worldMapPinClass, "/Game/Environments/WorldMap/Blueprints/WM_PinHoliday.WM_PinHoliday_C");
  // Its own backpack: the gameserver's world profile is theater<theaterSlot>.
  assert.equal(theater.theaterSlot, 1);
  assert.ok(theater.tiles.every((tile) => tile.zoneTheme === frostniteZoneTheme));
  assert.deepEqual(missions.map((mission) => mission.missionDifficultyInfo.rowName), ["Theater_Endless_Start_Zone5", "Theater_Endless_Normal_Zone3",
    "Theater_Endless_Normal_Zone5", "Theater_Endless_Hard_Zone3", "Theater_Endless_Hard_Zone5", "Theater_Endless_Nightmare_Zone3",
    "Theater_Endless_Nightmare_Zone5"]);
  assert.ok(missions.every((mission) => mission.missionGenerator === frostniteGenerator));
  // Each its zone's Frostnite Rewards pack, ZCP_Endless_T01 to T07.
  assert.deepEqual(missions.map((mission) => mission.missionRewards.items.map(({ itemType }) => itemType).join()),
    [1, 2, 3, 4, 5, 6, 7].map((tier) => `CardPack:zcp_endless_t0${tier}`));
  const gates = theater.regions.map((region) => region.requirements.questDefinition ?? "");
  assert.equal(gates[0], "");
  assert.match(gates[1], /StonewoodQuest_LaunchRocket_D5/);
  assert.match(gates[4], /PlankertonQuest_LaunchRocket_D5/);
  assert.match(gates[6], /CannyValleyQuest_LaunchRocket_D5/);
  assert.equal(alerts.length, 0, "no mission alerts on Frostnite");
  // A mission is found again for its world/validate and its rewards.
  assert.equal(findMission(missions[2].missionGuid, beforeWeeks).theaterId, frostniteId);
})));

test("the weekly challenge: Slip Out from 30 December, Burn Bright from 8 January, each tagged with its week", () => withSeason7(replayStart, () => inBuild(v710, () => {
  const challenges = (now) => frostniteOf(worldInfo(now)).theater.regions.filter((region) => region.displayName.startsWith("Weekly"));
  assert.equal(challenges(beforeWeeks).length, 0);
  const slipOut = challenges(slipOutDay);
  assert.deepEqual(slipOut.map((region) => region.regionTags.gameplayTags[0].tagName), Array(4).fill(`${frostniteTag}.Week01`));
  assert.ok(slipOut.every((region) => region.displayName.includes("Slip Out")));
  const { missions } = frostniteOf(worldInfo(slipOutDay));
  assert.equal(missions.filter((mission) => mission.missionGenerator.includes("Challenge_SlipOut")).length, 4);
  assert.ok(challenges(burnBrightDay).every((region) => region.regionTags.gameplayTags[0].tagName === `${frostniteTag}.Week02`));
})));

test("its quests come at quest login while it runs, the week's challenge with them, and leave with it", () => withSeason7(replayStart, () => {
  inBuild(v710, () => {
    for (const questId of frostniteQuests) assert.ok(getQuest(questId), questId);
    assert.ok(!frostniteEventQuests(beforeWeeks).some((questId) => questId.includes("challenge")));
    assert.ok(frostniteEventQuests(slipOutDay).includes(frostniteWeekQuest(1)));
    assert.ok(frostniteEventQuests(burnBrightDay).includes(frostniteWeekQuest(2)));
    assert.ok(eventQuests().includes("winterquest_2018_frostnite_survive_15m"));
    // The quest line takes the hidden chain's quests and the weeks' majors too.
    const line = eventQuestLine("Frostnite2018");
    for (const questId of ["winterquest_2018_landmark_celebratenewyear", "winterquest_2018_frostnite_survive_challenge_week1_major"]) {
      assert.ok(line.has(questId), questId);
    }
  });
  inBuild(v700, () => assert.deepEqual(frostniteEventQuests(slipOutDay), []));
}));

test("the Winter Llama sells for Snowflake Tickets and holds a Medieval weapon or holiday hero", () => withSeason7(replayStart, () => {
  inBuild(v710, () => {
    const offer = findOffer("core_event_winter2018_llama");
    assert.ok(offer);
    assert.equal(offer.templateId, winterLlama2018);
    assert.equal(offer.currencySubType, snowflakeTickets);
    assert.equal(offer.price, 1000);
    const contents = rollContents(winterLlama2018);
    assert.ok(contents.some(({ templateId }) => /medieval|hid_commando_02[34]_/.test(templateId)), JSON.stringify(contents));
  });
  inBuild(v700, () => assert.equal(findOffer("core_event_winter2018_llama"), undefined));
}));

test("its Event Store sells Cloaked Shadow, counted by Winter2018's trackers", () => withSeason7(replayStart, () => inBuild(v710, () => {
  const event = storefronts(null, beforeWeeks).find((storefront) => storefront.name === eventStorefront).catalogEntries;
  const shadow = event.find((entry) => entry.itemGrants[0].templateId === "Hero:hid_ninja_020_sr_t01");
  assert.ok(shadow);
  assert.equal(shadow.prices[0].finalPrice, 2800);
  assert.equal(eventStoreInstanceNow(), "Winter2018.STWSpecialEventStoreFront");
  assert.ok(eventStoreEnds(beforeWeeks).stwEventStoreEnd);
})));

test("a Frostnite Rewards pack holds Snowflake Tickets, Gold, XP and a schematic; wave badges are tickets", () => inBuild(v710, () => {
  const contents = rollContents("CardPack:zcp_endless_t04");
  const of = (templateId) => contents.find((item) => item.templateId === templateId)?.quantity;
  assert.equal(of(snowflakeTickets), 200);
  assert.equal(of("AccountResource:eventcurrency_scaling"), 200);
  assert.ok(of("AccountResource:heroxp") > 0);
  assert.ok(contents.some(({ templateId }) => templateId.startsWith("Schematic:")), JSON.stringify(contents));
  assert.ok(isFrostniteWaveBadge("WorldItem:endlessmode_badge_wave_07"));
  assert.ok(!isFrostniteWaveBadge("WorldItem:endlesscombatscore_missionbadge_gold"));
  assert.equal(snowflakePerWave, 10);
}));

test("7.20 keeps Frostnite with its 128 zone (T08)", () => withSeason7(replayStart, () => inBuild(v720, () => {
  const found = frostniteOf(worldInfo(beforeWeeks));
  assert.ok(found);
  const endgame = found.missions.find((mission) => mission.missionDifficultyInfo.rowName === "Theater_Endless_Endgame_Zone5");
  assert.ok(endgame);
  assert.equal(endgame.missionRewards.items[0].itemType, "CardPack:zcp_endless_t08");
})));

test("a run's backpack (theater1) is emptied at the next run's registration, not at the run's own last save", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-frostnite-"));
  try {
    inBuild(v710, () => {
      const store = createProfileStore(dir);
      const fill = () => {
        const session = openSession(store, "frostnite-player");
        session.profile(frostniteWorldProfile).addItem("ammo-1", { templateId: "Ammo:ammodatabulletsmedium", attributes: {}, quantity: 120 });
        session.commit();
      };
      fill();
      // No run has ended: a reconnect keeps the backpack.
      let session = openSession(store, "frostnite-player");
      assert.equal(clearEndedFrostniteRun(session), 0);
      noteFrostniteRunEnded(session);
      session.commit();
      // The run's own last save after EndPrimaryMission doesn't clear it; the next registration does.
      fill();
      session = openSession(store, "frostnite-player");
      assert.equal(clearEndedFrostniteRun(session), 1);
      session.commit();
      session = openSession(store, "frostnite-player");
      assert.deepEqual(Object.keys(session.profile(frostniteWorldProfile).profile.items), []);
      assert.equal(clearEndedFrostniteRun(session), 0);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

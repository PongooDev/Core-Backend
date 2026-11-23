import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { eventSchedules, scheduleEventPatch } from "../src/admin/eventschedules.js";
import { activeEventFlags, configureEvents } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { eventQuestLine, isEndedEventQuest } from "../src/events/quests.js";
import { loveStormQuests, sanitizeSpring2019, spring2019EventQuests, spring2019Flag, spring2019Landmarks, spring2019Phase1, spring2019Phase2,
  springTickets, yarrrQuests } from "../src/events/spring2019.js";
import { getQuest } from "../src/gamedata/quests.js";
import { createSettingsStore } from "../src/settings/store.js";
import { worldInfo } from "../src/world/theaters.js";

// Core-Backend #408: Save the World's Spring 2019 (Love Storm on 8.00 and 8.20, Yarrr! on 8.20), events/spring2019.js.
const v740 = "5046157";
const v800 = "5203069";
const v820 = "5625478";
// Season 8's replay from a fixed first day: day 1 is 28 February 2019, day 28 is 27 March (Update v8.20).
const replayStart = "2026-10-01";
const onDay = (day) => new Date(Date.parse(`${replayStart}T12:00:00Z`) + (day - 1) * 86400000);
const beforeYarrr = onDay(10);
const yarrrDay = onDay(28);
const withConfig = (config, run) => {
  configureEvents({ mode: "auto", seasonStarts: { 8: replayStart }, ...config });
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const spring = (flags) => flags.filter((flag) => flag.startsWith("EventFlag.Spring2019"));
// The flags served now (the test mocks the clock to the replay's day).
const flagsOn = (build) => withConfig({}, () => inBuild(build, () => spring(activeEventFlags(build))));

test("Epic's dates: Love Storm all season on 8.00 and 8.20, Yarrr! from 27 March on 8.20, nothing on 7.40", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: beforeYarrr });
  assert.deepEqual(flagsOn(v820), [spring2019Flag, spring2019Phase1]);
  assert.deepEqual(flagsOn(v800), [spring2019Flag, spring2019Phase1]);
  t.mock.timers.setTime(yarrrDay.getTime());
  assert.deepEqual(flagsOn(v820), [spring2019Flag, spring2019Phase1, spring2019Phase2]);
  assert.deepEqual(flagsOn(v800), [spring2019Flag, spring2019Phase1], "8.00 never ran Yarrr!");
  assert.deepEqual(flagsOn(v740), []);
});

test("the admin's on and off, and the seasonal events switch", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: beforeYarrr });
  withConfig({ spring2019: "on" }, () => inBuild(v820, () => assert.deepEqual(spring(activeEventFlags(v820)), [spring2019Flag, spring2019Phase1, spring2019Phase2])));
  withConfig({ spring2019: "on" }, () => inBuild(v800, () => assert.deepEqual(spring(activeEventFlags(v800)), [spring2019Flag, spring2019Phase1])));
  withConfig({ spring2019: "off" }, () => inBuild(v820, () => assert.deepEqual(spring(activeEventFlags(v820)), [])));
  withConfig({ mode: "off", spring2019: "on" }, () => inBuild(v820, () => assert.deepEqual(activeEventFlags(v820), [])));
  assert.equal(sanitizeSpring2019("ON"), "on");
  assert.equal(sanitizeSpring2019("soon", "off"), "off");
  const store = createSettingsStore(null);
  assert.equal(store.get().events.spring2019, "dates");
  assert.equal(store.update({ events: { spring2019: "off" } }).events.spring2019, "off");
  assert.deepEqual(scheduleEventPatch({ event: "spring2019", mode: "on" }, {}, new Date()), { patch: { spring2019: "on" } });
  assert.ok(scheduleEventPatch({ event: "spring2019", mode: "custom" }, {}, new Date()).error);
  const card = eventSchedules({ now: new Date(), config: { mode: "auto" }, seasonalEvents: true }).find(({ id }) => id === "spring2019");
  assert.deepEqual([card.mode, card.modes], ["dates", ["dates", "on", "off"]]);
  assert.equal(card.state.tone, "dates");
});

test("each chapter's first quests come at quest login while its flag is served", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: beforeYarrr });
  withConfig({}, () => inBuild(v820, () => {
    for (const questId of [...loveStormQuests, ...yarrrQuests]) assert.ok(getQuest(questId), questId);
    assert.deepEqual(spring2019EventQuests(), loveStormQuests);
    assert.ok(eventQuests().includes("lovequest_2019_fetch_telescopes"));
    // Before Yarrr!'s day its line is an ended event's: an unfinished pirate quest leaves, and nothing grants one.
    assert.ok(isEndedEventQuest("piratequest_2019_fetch_bottles"));
    assert.ok(!isEndedEventQuest("lovequest_2019_fetch_vhs"));
  }));
  t.mock.timers.setTime(yarrrDay.getTime());
  withConfig({}, () => inBuild(v820, () => {
    assert.deepEqual(spring2019EventQuests(), [...loveStormQuests, ...yarrrQuests]);
    assert.ok(!isEndedEventQuest("piratequest_2019_fetch_bottles"));
  }));
  withConfig({}, () => inBuild(v800, () => assert.deepEqual(spring2019EventQuests(), loveStormQuests)));
});

test("the lines: 15 quests a chapter, each hidden reward the next, paying Spring Tickets", () => inBuild(v820, () => {
  const love = eventQuestLine(spring2019Phase1);
  const yarrr = eventQuestLine(spring2019Phase2);
  assert.equal([...love].filter((questId) => questId !== "lovequest_2019_hidden_watchvideo").length, 15);
  assert.equal([...yarrr].filter((questId) => questId !== "piratequest_2019_hidden_watchvideo").length, 15);
  for (const questId of ["piratequest_2019_landmark_island", "piratequest_2019_landmark_walktheplank", "piratequest_2019_fetch_bottles"]) assert.ok(yarrr.has(questId), questId);
  assert.ok(love.has("lovequest_2019_landmark_trebuchet"));
  assert.deepEqual(getQuest("piratequest_2019_fetch_seebots").rewards, [{ quantity: 250, templateId: springTickets }]);
  assert.deepEqual(getQuest("piratequest_2019_landmark_walktheplank").rewards, [{ quantity: 1, templateId: "Hero:hid_constructor_025_progressivepirateconstructor_sr_t01" }]);
}));

test("each landmark is on a random-mission tile of every campaign theater, for its quest's holder", () => withConfig({}, () => inBuild(v820, () => {
  const info = worldInfo(yarrrDay);
  const campaign = info.theaters.filter((theater) => theater.runtimeInfo.theaterType === "Standard"
    && theater.runtimeInfo.theaterTags.gameplayTags.some(({ tagName }) => /^Stat\.Theater\.PvE0[1-4]$/.test(tagName)));
  assert.equal(campaign.length, 4);
  for (const landmark of spring2019Landmarks) {
    for (const theater of campaign) {
      const index = theater.tiles.findIndex((tile) => tile.requirements?.activeQuestDefinition?.toLowerCase().endsWith(`.${landmark.questId}`));
      assert.ok(index >= 0, `${landmark.questId} in ${theater.uniqueId}`);
      const tile = theater.tiles[index];
      assert.equal(tile.zoneTheme, landmark.zoneTheme);
      assert.deepEqual(tile.missionWeightOverrides, [{ missionGenerator: landmark.missionGenerator, weight: 1 }]);
      const mission = info.missions[info.theaters.indexOf(theater)].availableMissions.find((candidate) => candidate.tileIndex === index);
      assert.equal(mission?.missionGenerator, landmark.missionGenerator);
    }
  }
  // Stonewood's onboarding missions keep their tiles.
  const stonewood = campaign.find((theater) => theater.runtimeInfo.theaterTags.gameplayTags.some(({ tagName }) => tagName === "Stat.Theater.PvE01"));
  assert.ok(stonewood.tiles.some((tile) => tile.missionWeightOverrides?.[0]?.missionGenerator.endsWith("MissionGen_LaunchTheBalloon_NoSecondary_C")));
})));

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { activeEventFlags, configureEvents, isEventActive, roadTrip2018 } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { eventQuestLine } from "../src/events/quests.js";
import { hordePoints, roadTripLlama, roadTripQuests, roadTripTickets } from "../src/events/roadtrip2018.js";
import { getQuest } from "../src/gamedata/quests.js";
import { storefronts } from "../src/store/catalog.js";
import { eventStoreEnds, eventStoreOffers, eventStorefront, roadTrip2018End, seasonalGold } from "../src/store/eventstore.js";
import { nextReplayOf } from "../src/store/itemshop.js";
import { hordeId, hordeZones } from "../src/world/horde.js";
import { worldInfo } from "../src/world/theaters.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #298: 5.0's Road Trip and Challenge the Horde.
const v500 = "4204761";
const v50 = "4214610";
const v45 = "4166199";
const now = new Date("2026-11-09T12:00:00Z");
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const horde = (changelist) => inBuild(changelist, () => {
  const info = worldInfo(now);
  const index = info.theaters.findIndex((theater) => theater.uniqueId === hordeId);
  return index < 0 ? null : { theater: info.theaters[index], missions: info.missions[index].availableMissions, alerts: info.missionAlerts[index].availableMissionAlerts };
});

test("5.0's quests have their rewards again: 5.0 moved them to Quests/QuestRewards (RewardsTable)", () => {
  inBuild(v50, () => {
    // Unchanged quests keep 4.5's rewards.
    assert.deepEqual(getQuest("blockbusterquest_2018_reactive_raysignal").selectableRewards,
      inBuild(v45, () => getQuest("blockbusterquest_2018_reactive_raysignal").selectableRewards));
    assert.deepEqual(getQuest("hordequest_hordeunlock").rewards, [{ quantity: 100, templateId: roadTripTickets }]);
    assert.deepEqual(getQuest("hordequest_hordeunlock").hiddenRewards, [{ quantity: 1, templateId: "Quest:hordequest_buildbase" }]);
    // "a choice of Epic and Legendary Wild West Heroes", "Horde Exclusive Banners", V-Bucks, PERK currencies.
    assert.equal(getQuest("hordequest_progression_plankerton_3").selectableRewards.length, 4);
    assert.ok(getQuest("hordequest_progression_canny_2").selectableRewards.flat().every(({ templateId }) => /_017_.*_sr_t01$/.test(templateId)));
    assert.ok(getQuest("hordequest_progression_stonewood_4").rewards.some(({ templateId }) => templateId === "CardPack:cardpack_horde_banner_2018_stonewood"));
    assert.ok(getQuest("hordequest_progression_stonewood_3").rewards.some(({ templateId }) => templateId === "Currency:mtxgiveaway"));
    assert.ok(getQuest("hordequest_progression_twine_2").rewards.some(({ templateId }) => templateId === "AccountResource:reagent_alteration_upgrade_sr"));
    // The zone gates need one of their two objectives.
    assert.equal(getQuest("hordequest_hidden_3").objectiveCompletionCount, 1);
  });
});

test("5.0 runs Road Trip: EventFlag.RoadTrip2018 and EventFlag.Horde, its quests and its quest line; 4.5 doesn't", () => {
  for (const build of [v500, v50]) {
    assert.ok(activeEventFlags(build).includes("EventFlag.RoadTrip2018") && activeEventFlags(build).includes("EventFlag.Horde"), build);
    assert.deepEqual(inBuild(build, eventQuests).filter((questId) => questId.startsWith("hordequest")), roadTripQuests);
  }
  assert.ok(!activeEventFlags(v45).includes("EventFlag.RoadTrip2018") && !activeEventFlags(v45).includes("EventFlag.Horde"));
  assert.ok(!inBuild(v45, eventQuests).some((questId) => questId.startsWith("hordequest")));
  const line = inBuild(v50, () => eventQuestLine(roadTrip2018));
  for (const questId of ["hordequest_buildbase", "hordequest_progression_stonewood_1", "hordequest_progression_twine_14",
    "hordequest_progression_canny_5_repeatable", "hordequest_hidden_7"]) assert.ok(line.has(questId), questId);
  assert.ok(!line.has("outpostquest_t1_l4"), "the gates' Storm Shield Defenses aren't the event's");
});

test("the admin panel switches RoadTrip2018 (quests, llama, store) and Horde (theater, alerts) apart", () => {
  withConfig({ mode: "auto", season4Flags: { overrides: { "EventFlag.RoadTrip2018": "off" } } }, () => {
    assert.ok(!isEventActive(roadTrip2018, v50));
    assert.deepEqual(inBuild(v50, eventQuests).filter((questId) => questId.startsWith("hordequest")), []);
    assert.deepEqual(inBuild(v50, () => eventStoreOffers(now))[eventStorefront], []);
    assert.ok(horde(v50), "the horde stays with its own flag");
  });
  withConfig({ mode: "auto", season4Flags: { overrides: { "EventFlag.Horde": "off" } } }, () => {
    assert.equal(horde(v50), null);
    assert.ok(isEventActive(roadTrip2018, v50));
  });
  withConfig({ mode: "auto", season4Flags: { overrides: { "EventFlag.RoadTrip2018": "on" } } }, () => {
    assert.ok(!activeEventFlags(v45).includes("EventFlag.RoadTrip2018"), "4.5's paks have no Road Trip");
  });
});

test("Challenge the Horde's theater: Fort Setup and nine zones from 9 to 76 power, each behind its gate, a mission each day", () => {
  assert.equal(horde(v45), null);
  const { theater, missions, alerts } = horde(v50);
  assert.equal(theater.displayName.en, "Challenge the Horde");
  assert.equal(theater.runtimeInfo.worldMapPinClass, "/Game/Environments/WorldMap/Blueprints/WM_PinHorde.WM_PinHorde_C");
  assert.equal(theater.runtimeInfo.requirements.questDefinition, "/Game/Quests/Outpost/OutpostQuest_T1_L3.OutpostQuest_T1_L3");
  assert.equal(theater.regions.length, 10);
  assert.equal(theater.regions[1].requirements.questDefinition, undefined, "the first zone is open");
  for (let index = 0; index < 8; index++) {
    assert.equal(theater.regions[index + 2].requirements.questDefinition,
      `/Game/Quests/Events/ChallengeTheHorde/HordeQuest_Hidden_${index}.HordeQuest_Hidden_${index}`);
  }
  assert.equal(missions.length, 10);
  assert.deepEqual(missions.slice(1).map((mission) => mission.missionDifficultyInfo.rowName), hordeZones.map((zone) => zone.rowName));
  assert.ok(missions.slice(1).every((mission) => mission.missionGenerator.endsWith("MissionGen_ChallengeTheHorde_C")));
  assert.ok(missions[0].missionGenerator.endsWith("MissionGen_BuildTheBase_C"));
  assert.deepEqual(missions[0].missionRewards.items, [], "building the fort is its quest's");
  assert.equal(new Set(missions.map((mission) => theater.tiles[mission.tileIndex].zoneTheme)).size, 10);
  // Its missions give their zone's Horde Points; from Plankerton a RE-PERK! pack too.
  assert.deepEqual(missions[1].missionRewards.items, [{ itemType: hordePoints(1), quantity: 1 }]);
  assert.deepEqual(missions[9].missionRewards.items.map(({ itemType }) => itemType), [hordePoints(4), "CardPack:zcp_reagent_alteration_generic_high"]);
  // A Horde alert on every zone: Road Trip Tickets, Horde Points and perk resources.
  assert.equal(alerts.length, 9);
  assert.ok(alerts.every((alert) => alert.categoryName === "HordeCategory" && alert.missionAlertRewards.tierGroupName === "HordeBash_MissionAlert"));
  const last = alerts.find((alert) => alert.tileIndex === missions[9].tileIndex).missionAlertRewards.items;
  assert.deepEqual(last, [{ itemType: roadTripTickets, quantity: 160 }, { itemType: hordePoints(4), quantity: 2 },
    { itemType: "AccountResource:reagent_alteration_generic", quantity: 200 }]);
  // The main theaters carry no Horde alert.
  const main = inBuild(v50, () => worldInfo(now)).missionAlerts.filter(({ theaterId }) => theaterId !== hordeId);
  assert.ok(main.every(({ availableMissionAlerts }) => availableMissionAlerts.every((alert) => alert.categoryName !== "HordeCategory")));
});

test("the Road Trip Llama sells for 500 Road Trip Tickets, and the Event Store opens with the Flintlock weapons", () => {
  const entries = inBuild(v50, () => storefronts(null, now)).flatMap((storefront) => storefront.catalogEntries);
  const llama = entries.find((entry) => entry.itemGrants?.[0]?.templateId === roadTripLlama);
  assert.ok(llama);
  assert.deepEqual([llama.prices[0].currencySubType, llama.prices[0].finalPrice], [roadTripTickets, 500]);
  assert.ok(!inBuild(v45, () => storefronts(null, now)).flatMap((storefront) => storefront.catalogEntries)
    .some((entry) => entry.itemGrants?.[0]?.templateId === roadTripLlama));

  const offers = inBuild(v50, () => eventStoreOffers(now))[eventStorefront];
  assert.deepEqual(offers.map(({ templateId }) => templateId), ["Schematic:sid_launcher_flintlock_sr_ore_t01", "Schematic:sid_assault_flintlock_sr_ore_t01",
    "Schematic:sid_sniper_flintlock_scope_sr_ore_t01", "Schematic:sid_blunt_hammer_flintlock_sr_ore_t01", "Schematic:sid_assault_autodrum_sr_ore_t01",
    "Worker:workerbasic_sr_t01"]);
  assert.ok(offers.every((offer) => offer.currencySubType === seasonalGold && offer.purchaseLimitingEventId === "RoadTrip2018.STWSpecialEventStoreFront"));
  assert.equal(inBuild(v50, () => eventStoreEnds(now)).stwEventStoreEnd.getTime(), inBuild(v50, () => nextReplayOf(roadTrip2018End, now)).getTime());
});

const agent = (changelist) => `game=FortniteGame, engine=UE4, build=++Fortnite+Release-5.0-CL-${changelist}`;
function mcp(port, { accountId, token }, name, body = {}) {
  const text = JSON.stringify(body);
  return send({
    host: "127.0.0.1", port, method: "POST", path: `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=campaign&rvn=-1`,
    headers: { "User-Agent": agent(v50), Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }
  }, text);
}
const fullProfile = (response) => response.body.profileChanges.find((change) => change.changeType === "fullProfileUpdate").profile;
const questsOf = (profile) => Object.fromEntries(Object.entries(profile.items)
  .filter(([, item]) => item.templateId.startsWith("Quest:")).map(([itemId, item]) => [item.templateId.slice(6).toLowerCase(), { itemId, state: item.attributes.quest_state }]));

test("5.0's quest login starts the Horde: the unlock completes with the Horde Skill Tree's first node, a gate with its defense", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Horde50");
    await mcp(backend.port, player, "ClientQuestLogin");
    let quests = questsOf(fullProfile(await mcp(backend.port, player, "QueryProfile")));
    for (const questId of roadTripQuests) assert.equal(quests[questId]?.state, "Active", questId);

    // The account holds the first node and has done Storm Shield Defense 4 (OutpostQuest_T1_L4, hidden_0's).
    const dir = path.join(backend.dataDir, "accounts", player.accountId, "profiles");
    const file = path.join(dir, fs.readdirSync(dir).includes("campaign.json") ? "campaign.json" : "profile0.json");
    const profile = JSON.parse(fs.readFileSync(file, "utf8"));
    profile.items.horde_node = { templateId: "HomebaseNode:t1_horde_99587fccd", attributes: {}, quantity: 1 };
    profile.items.ssd4 = { templateId: "Quest:outpostquest_t1_l4", attributes: { quest_state: "Claimed" }, quantity: 1 };
    fs.writeFileSync(file, JSON.stringify(profile));
    await mcp(backend.port, player, "ClientQuestLogin");
    quests = questsOf(fullProfile(await mcp(backend.port, player, "QueryProfile")));
    assert.notEqual(quests.hordequest_hidden_0.state, "Active", "one of its two objectives is enough");
    assert.equal(quests.hordequest_hidden_1.state, "Active");
    assert.equal(quests.hordequest_hordeunlock.state, "Completed");

    const claim = await mcp(backend.port, player, "ClaimQuestReward", { questId: quests.hordequest_hordeunlock.itemId, selectedRewardIndex: -1 });
    assert.equal(claim.status, 200);
    const after = fullProfile(await mcp(backend.port, player, "QueryProfile"));
    assert.equal(questsOf(after).hordequest_buildbase?.state, "Active", "the unlock's hidden reward");
    const tickets = Object.values(after.items).filter((item) => item.templateId.toLowerCase() === roadTripTickets.toLowerCase())
      .reduce((sum, item) => sum + item.quantity, 0);
    assert.equal(tickets, 100);
  } finally {
    await backend.close();
  }
});

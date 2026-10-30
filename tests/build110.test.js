import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { versionOf } from "../src/builds/detect.js";
import { activeEventFlags, hasEventEnded, isEventActive, mutantStorms } from "../src/events/events.js";
import { mutantStormsEventQuests, stormTickets } from "../src/events/mutantstorms.js";
import { athenaCosmetics } from "../src/gamedata/athena.js";
import { getCardPack, getItem } from "../src/gamedata/items.js";
import { getQuest, questIds } from "../src/gamedata/quests.js";
import { dataBuild } from "../src/gamedata/read.js";
import { missionAlertCategory, missionAlertTier } from "../src/gamedata/world.js";
import { storefronts } from "../src/store/catalog.js";
import { stormsSpread, worldInfo } from "../src/world/theaters.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Fortnite 1.10 (++Fortnite+Release-Cert-CL-3790078, UE 4.19): its own game data, version, event flag and patch notes.
const v110 = "3790078";
const v191 = "3775276";
const at = (time) => new Date(`2026-10-30T${time}Z`);
const alertsOf = (info) => info.missionAlerts.flatMap(({ theaterId, availableMissionAlerts }) => availableMissionAlerts.map((alert) => ({ theaterId, ...alert })));

test("1.10 is known by its version and plays on its own game data", () => {
  assert.equal(versionOf(v110), "1.10");
  assert.equal(dataBuild(v110), v110);
  inBuild(v110, () => {
    // Battle Royale's Winter Bus and 1.10's new heroes; the Athena heroes it retired are gone.
    assert.equal(athenaCosmetics()["AthenaBattleBus:bbid_winterbus"]?.name, "Winter Bus");
    assert.ok(getItem("Hero:hid_commando_013_r_t01"));
    assert.equal(getItem("Hero:hid_commando_athena_01"), undefined);
    // Unset hero conversions (1.10's retired Athena heroes) aren't kept as a "None" recipe.
    assert.equal(getItem("Hero:hid_001_athena_commando_f").conversions, undefined);
    assert.ok(getCardPack("CardPack:zcp_eventscaling_t01"));
  });
  inBuild(v191, () => assert.equal(athenaCosmetics()["AthenaBattleBus:bbid_winterbus"], undefined));
});

test("1.10's five daily discovery quests join the dailies", () => {
  const discovery = (changelist) => inBuild(changelist, () => questIds()
    .filter((id) => id.startsWith("daily_discovery_") && getQuest(id).type === "DailyQuest").sort());
  assert.deepEqual(discovery(v110), ["daily_discovery_industriallocations", "daily_discovery_rurallocations", "daily_discovery_shelters",
    "daily_discovery_suburbanlocations", "daily_discovery_urbanlocations"]);
  assert.deepEqual(discovery(v191), []);
});

test("the Mutant Storms run on 1.10 under EventFlag.ActiveStorms, the flag its storm rows require", () => {
  assert.deepEqual(activeEventFlags(v110), ["EventFlag.ActiveStorms"]);
  assert.ok(isEventActive(mutantStorms, v110));
  assert.ok(isEventActive("EventFlag.ActiveStorms", v110));
  assert.ok(!isEventActive("EventFlag.Vindertech", v110));
  assert.ok(isEventActive(mutantStorms, v191) && isEventActive("EventFlag.Vindertech", v191));
  assert.ok(!hasEventEnded(mutantStorms, v110));
  assert.ok(hasEventEnded(mutantStorms, "3807424"));
  inBuild(v110, () => {
    assert.equal(missionAlertTier("Theater_Normal_Zone1", "StormCategory")?.requiredEventFlag, "EventFlag.ActiveStorms");
    assert.equal(mutantStormsEventQuests().length, 15);
    // 1.10's data raises the StormLow quota to 10; the Mutant Storms' stays 10 a day.
    assert.equal(missionAlertCategory("StormLowCategory").quota, 10);
    assert.equal(missionAlertCategory("StormCategory").quota, 10);
  });
});

test("1.10's Mutant Storms don't spread: each zone has its fixed target of storms all day", () => {
  assert.ok(stormsSpread(v191));
  assert.ok(!stormsSpread(v110));
  inBuild(v110, () => {
    const early = worldInfo(at("00:00:01"));
    const late = worldInfo(at("23:00:00"));
    const mutant = (info) => alertsOf(info).filter(({ categoryName }) => categoryName === "StormCategory");
    assert.deepEqual(mutant(late).map(({ missionAlertGuid }) => missionAlertGuid).sort(), mutant(early).map(({ missionAlertGuid }) => missionAlertGuid).sort());
    assert.ok(early.missionAlerts.every(({ nextRefresh }) => nextRefresh === "2026-10-30T23:59:59.999Z"));
    const storms = mutant(early);
    assert.ok(storms.every(({ spreadDataName }) => spreadDataName === ""));
    assert.ok(storms.every(({ missionAlertRewards }) => missionAlertRewards.items.some(({ itemType }) => itemType === stormTickets)));
    // Per zone, by its row's modifier group: Stonewood 5, Plankerton, Canny Valley and Twine Peaks 15 each.
    const byZone = {};
    for (const storm of storms) byZone[storm.missionAlertModifiers.tierGroupName] = (byZone[storm.missionAlertModifiers.tierGroupName] ?? 0) + 1;
    assert.deepEqual(byZone, { "STMZ.ZoneMods_Stonewood": 5, "STMZ.ZoneMods_Plankerton": 15, "STMZ.ZoneMods_CanneyValley": 15, "STMZ.ZoneMods_TwinePeaks": 15 });
    // One alert a mission.
    assert.equal(new Set(alertsOf(early).map(({ theaterId, tileIndex }) => `${theaterId}:${tileIndex}`)).size, alertsOf(early).length);
  });
});

const agent = (changelist) => `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${changelist}`;
function as(changelist, port, method, urlPath, token, body) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": agent(changelist), Authorization: `bearer ${token}` };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
}
const mcp = (changelist, port, { accountId, token }, name, body = {}) =>
  as(changelist, port, "POST", `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`, token, body);
const profileOf = (response) => [response.body, ...(response.body.multiUpdate ?? [])].find((update) => update.profileId === "profile0")
  .profileChanges.find((change) => change.changeType === "fullProfileUpdate").profile;
const held = (profile, templateId) => Object.values(profile.items).filter((item) => item.templateId === templateId)
  .reduce((sum, item) => sum + item.quantity, 0);

test("1.10 sells ten Upgrade Llamas a quarter off, and the Vindertech Llama while the Mutant Storms run", async () => {
  const offers = (changelist) => inBuild(changelist, () => storefronts(null).find(({ name }) => name === "CardPackStore").catalogEntries);
  const tenPack = (changelist) => offers(changelist).find(({ offerId }) => offerId === "core_cardpack_bronze_x10");
  assert.deepEqual(tenPack(v110).itemGrants, [{ templateId: "CardPack:cardpack_bronze", quantity: 10 }]);
  assert.equal(tenPack(v110).prices[0].finalPrice, 375);
  assert.equal(tenPack(v191), undefined);
  assert.ok(offers(v110).some(({ offerId }) => offerId === "core_event_vindertech_llama"));

  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "TenLlamas");
    await mcp(v110, backend.port, player, "QueryProfile");
    const file = path.join(backend.dataDir, "accounts", player.accountId, "profiles", "profile0.json");
    const profile = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const [itemId, item] of Object.entries(profile.items)) if (item.templateId.startsWith("Currency:mtx")) delete profile.items[itemId];
    profile.items.core_test_vbucks = { templateId: "Currency:mtxpurchased", attributes: { platform: "EpicPC" }, quantity: 400 };
    fs.writeFileSync(file, JSON.stringify(profile));

    const purchase = { offerId: "core_cardpack_bronze_x10", purchaseQuantity: 1, currency: "MtxCurrency", currencySubType: "", expectedPrice: 375 };
    assert.equal((await mcp(v191, backend.port, player, "PurchaseCatalogEntry", purchase)).status, 400);
    const bought = await mcp(v110, backend.port, player, "PurchaseCatalogEntry", purchase);
    assert.equal(bought.status, 200, JSON.stringify(bought.body));
    const after = profileOf(await mcp(v110, backend.port, player, "QueryProfile"));
    assert.equal(held(after, "CardPack:cardpack_bronze"), 10);
    assert.equal(held(after, "Currency:mtxpurchased"), 25);
  } finally {
    backend.close();
  }
});

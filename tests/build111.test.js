import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { versionOf } from "../src/builds/detect.js";
import { activeEventFlags, hasEventEnded, isEventActive, lobbyWinterDecor, mutantStorms, passiveStorms, winter2017 } from "../src/events/events.js";
import { stormTickets } from "../src/events/mutantstorms.js";
import { stormLlama } from "../src/events/stormllamas.js";
import { holidayLlama, snowflakeTickets, winterEventQuests } from "../src/events/winter2017.js";
import { athenaCosmetics, getAthenaQuest } from "../src/gamedata/athena.js";
import { getCardPack, getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { dataBuild } from "../src/gamedata/read.js";
import { missionAlertCategory, missionAlertTier } from "../src/gamedata/world.js";
import { storefronts } from "../src/store/catalog.js";
import { worldInfo } from "../src/world/theaters.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Fortnite 1.11 (++Fortnite+Release-Cert-CL-3807424, UE 4.19): its own game data, version, events and patch notes.
const v111 = "3807424";
const v110 = "3790078";
const at = (time) => new Date(`2026-11-01T${time}Z`);
const alertsOf = (info) => info.missionAlerts.flatMap(({ theaterId, availableMissionAlerts }) => availableMissionAlerts.map((alert) => ({ theaterId, ...alert })));

test("1.11 is known by its version and plays on its own game data", () => {
  assert.equal(versionOf(v111), "1.11");
  assert.equal(dataBuild(v111), v111);
  inBuild(v111, () => {
    // Battle Royale's Season 2: its holiday outfits, emotes and Battle Pass quests.
    assert.equal(athenaCosmetics()["AthenaCharacter:cid_051_athena_commando_m_holidayelf"]?.name, "Codename E.L.F.");
    assert.equal(athenaCosmetics()["AthenaDance:eid_floss"]?.name, "Floss");
    assert.ok(getAthenaQuest("athena_battlepass_solo_top50"));
    // Save the World's: the Holiday Survival Llama, Daily Coins and the hero rarity upgrade token.
    assert.equal(getCardPack(holidayLlama).displayName, "Holiday Survival Llama");
    assert.equal(getItem("AccountResource:specialcurrency_daily").name, "Daily Coins");
    assert.ok(getItem("Token:upgraderarity_token"));
    // "Removed the following mission daily quests from the daily rotation": no longer daily quests.
    for (const questId of ["daily_alittlevanthatcould", "daily_gatecrasher", "daily_dataretrieval"]) assert.notEqual(getQuest(questId).type, "DailyQuest", questId);
    // Daily quests give Daily Coins.
    assert.ok(getQuest("daily_high_priority").rewards.some(({ templateId }) => templateId === "AccountResource:specialcurrency_daily"));
  });
  inBuild(v110, () => {
    assert.equal(athenaCosmetics()["AthenaCharacter:cid_051_athena_commando_m_holidayelf"], undefined);
    assert.equal(getCardPack(holidayLlama), undefined);
  });
});

test("1.11 runs Survive the Holidays under EventFlag.Winter2017, ends the Mutant Storms and keeps storms without tickets", () => {
  assert.deepEqual(activeEventFlags(v111), ["EventFlag.BR.Allow50v50", winter2017, passiveStorms, lobbyWinterDecor]);
  assert.ok(isEventActive(winter2017, v111) && isEventActive(passiveStorms, v111));
  assert.ok(!isEventActive(mutantStorms, v111) && !isEventActive("EventFlag.ActiveStorms", v111));
  assert.ok(hasEventEnded(mutantStorms, v111));
  assert.ok(!isEventActive(winter2017, v110));
  inBuild(v111, () => {
    assert.equal(missionAlertTier("Theater_Normal_Zone1", "MiniBossCategory")?.requiredEventFlag, winter2017);
    assert.equal(missionAlertTier("Theater_Normal_Zone1", "StormLowCategory")?.requiredEventFlag, passiveStorms);
    assert.equal(missionAlertTier("Theater_Normal_Zone1", "StormCategory"), undefined);
    // "up to 10 can be completed each day"; "You can now complete up to four Mutant Storms per day".
    assert.equal(missionAlertCategory("MiniBossCategory").quota, 10);
    assert.equal(missionAlertCategory("StormLowCategory").quota, 4);
    assert.equal(winterEventQuests().length, 10);
    assert.ok(winterEventQuests().includes("winterquest_2017_reactive_fetch_radios"));
  });
  inBuild(v110, () => assert.deepEqual(winterEventQuests(), []));
});

test("1.11's map has Mini-Boss alerts that give Snowflake Tickets, and storms that give none", () => inBuild(v111, () => {
  const alerts = alertsOf(worldInfo(at("12:00:00")));
  const of = (category) => alerts.filter(({ categoryName }) => categoryName === category);
  const rewards = (alert) => alert.missionAlertRewards.items.map(({ itemType }) => itemType);
  assert.ok(of("MiniBossCategory").length > 0);
  for (const alert of of("MiniBossCategory")) {
    assert.ok(rewards(alert).includes(snowflakeTickets));
    assert.deepEqual(alert.missionAlertModifiers.items, [{ itemType: "GameplayModifier:minibossenableprimarymissionitem", quantity: 1 }]);
  }
  assert.ok(of("StormLowCategory").length > 0);
  for (const alert of of("StormLowCategory")) {
    assert.ok(!rewards(alert).includes(stormTickets) && !rewards(alert).includes(snowflakeTickets));
    assert.equal(rewards(alert).length, 1);
  }
  assert.deepEqual(of("StormCategory"), []);
  assert.equal(new Set(alerts.map(({ theaterId, tileIndex }) => `${theaterId}:${tileIndex}`)).size, alerts.length);
}));

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

test("1.11 sells the Holiday Survival Llama for 1000 Snowflake Tickets, and no longer the Vindertech Llama", () => {
  const offers = (changelist) => inBuild(changelist, () => storefronts(null).find(({ name }) => name === "CardPackStore").catalogEntries);
  const winterLlama = (changelist) => offers(changelist).find(({ offerId }) => offerId === "core_event_winter_llama");
  assert.deepEqual(winterLlama(v111).itemGrants, [{ templateId: holidayLlama, quantity: 1 }]);
  assert.deepEqual([winterLlama(v111).prices[0].currencySubType, winterLlama(v111).prices[0].finalPrice], [snowflakeTickets, 1000]);
  assert.equal(winterLlama(v110), undefined);
  assert.ok(!offers(v111).some(({ offerId }) => offerId === "core_event_vindertech_llama"));
});

test("on 1.11 every 1,000 unspent Storm Tickets become a Vindertech Llama; 1.10 keeps them", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "StormLlamas");
    await mcp(v110, backend.port, player, "QueryProfile");
    const file = path.join(backend.dataDir, "accounts", player.accountId, "profiles", "profile0.json");
    const profile = JSON.parse(fs.readFileSync(file, "utf8"));
    profile.items.core_test_tickets = { templateId: stormTickets, attributes: {}, quantity: 2500 };
    fs.writeFileSync(file, JSON.stringify(profile));

    const before = profileOf(await mcp(v110, backend.port, player, "QueryProfile"));
    assert.deepEqual([held(before, stormTickets), held(before, stormLlama)], [2500, 0]);
    const after = profileOf(await mcp(v111, backend.port, player, "QueryProfile"));
    assert.deepEqual([held(after, stormTickets), held(after, stormLlama)], [500, 2]);
  } finally {
    backend.close();
  }
});

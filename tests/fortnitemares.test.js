import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { rollContents } from "../src/cardpacks/contents.js";
import { activeEventFlags } from "../src/events/events.js";
import { getCardPack, itemIds } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { atDifficulty, findMission, worldInfo } from "../src/world/theaters.js";
import { hexsylvaniaId } from "../src/world/hexsylvania.js";
import { dedicatedServerToken, send, startBackend, userLogin } from "./helpers.js";

const builds = { cert: "3532353", "1.7.2": "3700114", "1.8": "3724489", "1.8.2": "3741772" };
const agent = (changelist) => `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${changelist}`;
const candy = "AccountResource:eventcurrency_candy";
const llama = "CardPack:cardpack_event_2017_halloween";

// A request as a client (or the gameserver) of the given build.
function as(changelist, port, method, urlPath, token, body) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": agent(changelist), Authorization: `bearer ${token}` };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
}
const mcp = (changelist, port, { accountId, token }, name, body = {}, kind = "client") =>
  as(changelist, port, "POST", `/fortnite/api/game/v2/profile/${accountId}/${kind}/${name}?profileId=profile0&rvn=-1`, token, body);
const profileOf = (response) => [response.body, ...(response.body.multiUpdate ?? [])].find((update) => update.profileId === "profile0")
  .profileChanges.find((change) => change.changeType === "fullProfileUpdate").profile;
const held = (profile, templateId) => Object.values(profile.items).filter((item) => item.templateId === templateId)
  .reduce((sum, item) => sum + item.quantity, 0);

function editProfile(backend, accountId, edit) {
  const file = path.join(backend.dataDir, "accounts", accountId, "profiles", "profile0.json");
  const profile = JSON.parse(fs.readFileSync(file, "utf8"));
  edit(profile);
  fs.writeFileSync(file, JSON.stringify(profile));
}

test("Fortnitemares runs on 1.8 to 1.8.2 only, and 1.8's own data has its content", () => {
  assert.deepEqual(activeEventFlags(builds["1.8"]), ["EventFlag.Fortnitemares"]);
  assert.deepEqual(activeEventFlags("3729133"), ["EventFlag.Fortnitemares"]);
  assert.deepEqual(activeEventFlags(builds["1.8.2"]), ["EventFlag.Fortnitemares"]);
  for (const other of [builds.cert, "3541083", builds["1.7.2"], "3790078", "unknown", undefined]) assert.deepEqual(activeEventFlags(other), [], other);

  inBuild(builds["1.8"], () => {
    assert.equal(getQuest("halloweenquest_2017_opener").rewards[0].templateId, candy);
    assert.equal(getCardPack(llama).displayName, "Fortnitemares Llama");
    assert.ok(itemIds().includes(candy));
  });
  assert.equal(inBuild(builds["1.7.2"], () => getQuest("halloweenquest_2017_opener")), undefined);
});

test("1.8 learns the event flag from ClientQuestLogin and RequestEventFlags, and gets the event's quests; 1.7.2 doesn't", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Mares18");
    const login = await mcp(builds["1.8"], backend.port, player, "ClientQuestLogin");
    assert.equal(login.status, 200);
    const [flags] = login.body.notifications;
    assert.deepEqual([flags.type, flags.primary, flags.eventFlags], ["eventFlags", true, ["EventFlag.Fortnitemares"]]);
    assert.ok(Date.parse(flags.refreshTime) > Date.now());
    const asked = await mcp(builds["1.8"], backend.port, player, "RequestEventFlags");
    assert.deepEqual(asked.body.notifications[0].eventFlags, ["EventFlag.Fortnitemares"]);

    const profile = profileOf(await mcp(builds["1.8"], backend.port, player, "QueryProfile"));
    for (const questId of ["halloweenquest_2017_opener", "halloweenquest_2017_hidden_watchvideo", "halloweenquest_2017_epicheroes",
      "halloweenquest_2017_legendaryheroes", "halloweenquest_2017_completemissions_1"]) {
      const [quest] = Object.values(profile.items).filter((item) => item.templateId === `Quest:${questId}`);
      assert.equal(quest?.attributes.quest_state, "Active", questId);
    }
    assert.equal(held(profile, "Quest:halloweenquest_2017_completemissions_2"), 0, "one Vlad World variant");

    // 1.7.2 runs no event: no flags, no notification in its quest login, no Halloween quests (and 1.8's aren't sent).
    const other = await userLogin(backend.port, "Mares172");
    const login172 = await mcp(builds["1.7.2"], backend.port, other, "ClientQuestLogin");
    assert.equal(login172.body.notifications, undefined);
    assert.deepEqual((await mcp(builds["1.7.2"], backend.port, other, "RequestEventFlags")).body.notifications[0].eventFlags, []);
    const profile172 = profileOf(await mcp(builds["1.7.2"], backend.port, other, "QueryProfile"));
    assert.ok(!Object.values(profile172.items).some((item) => /halloween/.test(item.templateId)));
    const shared172 = profileOf(await mcp(builds["1.7.2"], backend.port, player, "QueryProfile"));
    assert.ok(!Object.values(shared172.items).some((item) => item.templateId.startsWith("Quest:halloweenquest_2017")));

    // The gameserver's quest login for a 1.8 player carries the flags too.
    const dedicated = await dedicatedServerToken(backend.port);
    const server = await mcp(builds["1.8"], backend.port, { accountId: player.accountId, token: dedicated }, "ServerQuestLogin",
      { matchmakingSessionId: "abc" }, "dedicated_server");
    assert.deepEqual(server.body.notifications.find((entry) => entry.type === "eventFlags").eventFlags, ["EventFlag.Fortnitemares"]);
  } finally {
    backend.close();
  }
});

test("1.8's calendar has Fortnitemares active; 1.7.2's has nothing", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Calendar18");
    const timeline = (changelist) => as(changelist, backend.port, "GET", "/fortnite/api/calendar/v1/timeline?rvn=2&leanResponse=true", token);
    const [state] = (await timeline(builds["1.8"])).body.channels["client-events"].states;
    assert.deepEqual(state.activeEvents.map((event) => event.eventName), ["EventFlag.Fortnitemares"]);
    assert.ok(Date.parse(state.activeEvents[0].activeUntil) > Date.now());
    assert.deepEqual((await timeline(builds["1.7.2"])).body.channels["client-events"].states[0].activeEvents, []);
  } finally {
    backend.close();
  }
});

test("the llama store sells the Fortnitemares Llama for 1,000 Candy on 1.8, and buying it spends the Candy", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Llama18");
    const catalog = async (changelist) => (await as(changelist, backend.port, "GET", "/fortnite/api/storefront/v2/catalog", player.token)).body
      .storefronts.find((front) => front.name === "CardPackStore").catalogEntries;
    const offer = (await catalog(builds["1.8"])).find((entry) => entry.offerId === "core_event_fortnitemares_llama");
    assert.deepEqual(offer.prices.map(({ currencyType, currencySubType, finalPrice }) => [currencyType, currencySubType, finalPrice]),
      [["GameItem", candy, 1000]]);
    assert.deepEqual(offer.itemGrants, [{ templateId: llama, quantity: 1 }]);
    assert.equal(offer.metaAssetInfo.payload.packDefinition, "/Game/Items/CardPacks/Events/Release/CardPack_Event_2017_Halloween.CardPack_Event_2017_Halloween");
    for (const changelist of [builds.cert, builds["1.7.2"]]) {
      assert.ok(!(await catalog(changelist)).some((entry) => entry.offerId === "core_event_fortnitemares_llama"), changelist);
    }

    const purchase = { offerId: "core_event_fortnitemares_llama", purchaseQuantity: 1, currency: "GameItem", currencySubType: candy, expectedPrice: 1000 };
    await mcp(builds["1.8"], backend.port, player, "QueryProfile");
    const poor = await mcp(builds["1.8"], backend.port, player, "PurchaseCatalogEntry", purchase);
    assert.equal(poor.body.errorCode, "errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed");

    editProfile(backend, player.accountId, (profile) => {
      profile.items["candy-stack"] = { templateId: candy, attributes: { level: 1, item_seen: 0 }, quantity: 1500 };
    });
    const bought = await mcp(builds["1.8"], backend.port, player, "PurchaseCatalogEntry", purchase);
    assert.equal(bought.status, 200);
    assert.deepEqual(bought.body.notifications[0].lootResult.items.map((item) => item.itemType), [llama]);
    const profile = profileOf(await mcp(builds["1.8"], backend.port, player, "QueryProfile"));
    assert.equal(held(profile, candy), 500);
    assert.equal(held(profile, llama), 1);

    // Not for sale where the event doesn't run.
    const elsewhere = await mcp(builds["1.7.2"], backend.port, player, "PurchaseCatalogEntry", purchase);
    assert.equal(elsewhere.body.errorCode, "errors.com.epicgames.modules.gamesubcatalog.catalog_out_of_date");
  } finally {
    backend.close();
  }
});

test("the Fortnitemares Llama holds an Upgrade Llama's items and an Epic or Legendary Fortnitemares survivor or hero", () => {
  inBuild(builds["1.8"], () => {
    for (let roll = 0; roll < 40; roll += 1) {
      const contents = rollContents(llama);
      const event = contents.filter(({ templateId }) => /^Worker:worker_?halloween_|^Hero:hid_\w+hw_(vr|sr)_/.test(templateId));
      assert.ok(event.length >= 1, JSON.stringify(contents));
      assert.ok(event.some(({ templateId }) => /_(vr|sr)_t\d\d$/.test(templateId)), JSON.stringify(event));
    }
    for (let roll = 0; roll < 20; roll += 1) {
      const [cosplayer] = rollContents("CardPack:cardpack_halloweenworker_veryrare");
      assert.match(cosplayer.templateId, /^Worker:worker_?halloween_(\w+_)?vr_t\d\d$/);
    }
  });
});

test("1.8's world info adds Hexsylvania: the Transylvania theater, its missions giving Candy, the Opener's tile", () => {
  const info = inBuild(builds["1.8"], () => worldInfo());
  const theater = info.theaters.find((entry) => entry.uniqueId === hexsylvaniaId);
  assert.deepEqual(theater.runtimeInfo.theaterTags.gameplayTags, [{ tagName: "Stat.Theater.Transylvania" }]);
  assert.equal(theater.displayName.en, "Hexsylvania");
  assert.equal(theater.runtimeInfo.worldMapPinClass, "/Game/Environments/WorldMap/Blueprints/WM_PinHalloween.WM_PinHalloween_C");
  assert.ok(theater.tiles.every((tile) => tile.zoneTheme.includes("/Spooky/BP_ZT_TRV_HF")));

  // Explore the Mist (the Opener's landmark) and the first Trap the Storm are always up and linked to their quests.
  const linked = theater.tiles.filter((tile) => tile.linkedQuests.length).map((tile) => [tile.tileType,
    tile.missionWeightOverrides[0].missionGenerator.split(".").pop(), tile.linkedQuests.map((quest) => quest.questDefinition.split(".").pop())]);
  assert.deepEqual(linked, [["AlwaysActive", "MissionGen_TRV_Landmark_C", ["HalloweenQuest_2017_Opener"]],
    ["AlwaysActive", "MissionGen_1stTrapTheStorm_C", ["HalloweenQuest_2017_TtS_Intro"]]]);

  // Each main theater's zone rows, the later regions opening with their theater.
  assert.deepEqual(theater.regions.slice(0, 4).map((region) => [region.missionData.difficultyWeights.map((row) => row.difficultyInfo.rowName).join(","),
    region.requirements.questDefinition?.split(".").pop() ?? ""]), [
    ["Theater_Start_Zone3,Theater_Start_Zone4,Theater_Start_Zone5", ""],
    ["Theater_Normal_Zone1,Theater_Normal_Zone2,Theater_Normal_Zone3,Theater_Normal_Zone4,Theater_Normal_Zone5", "StonewoodQuest_LaunchRocket_D5"],
    ["Theater_Hard_Zone1,Theater_Hard_Zone2,Theater_Hard_Zone3,Theater_Hard_Zone4,Theater_Hard_Zone5", "PlankertonQuest_LaunchRocket_D5"],
    ["Theater_Nightmare_Zone1,Theater_Nightmare_Zone2,Theater_Nightmare_Zone3,Theater_Nightmare_Zone4,Theater_Nightmare_Zone5", "CannyValleyQuest_LaunchRocket_D5"]
  ]);

  const missions = info.missions.find((entry) => entry.theaterId === hexsylvaniaId).availableMissions;
  assert.ok(missions.length >= 30);
  for (const mission of missions) {
    const candyReward = mission.missionRewards.items.filter((item) => item.itemType === candy);
    assert.equal(candyReward.length, 1, mission.missionGenerator);
    assert.ok(candyReward[0].quantity >= 15);
  }
  const alerts = info.missionAlerts.find((entry) => entry.theaterId === hexsylvaniaId).availableMissionAlerts;
  assert.ok(alerts.length);
  for (const alert of alerts) assert.deepEqual(alert.missionAlertRewards, { tierGroupName: "Halloween2017_MissionAlert", items: [{ itemType: candy, quantity: 100 }] });

  // A Hexsylvania mission is found (the gameserver's zone and EndPrimaryMission) and keeps its Candy at another row.
  inBuild(builds["1.8"], () => {
    const found = findMission(missions[2].missionGuid);
    assert.equal(found.theaterId, hexsylvaniaId);
    const harder = atDifficulty(found, "Theater_Nightmare_Zone5");
    assert.deepEqual(harder.missionRewards.items.filter((item) => item.itemType === candy), [{ itemType: candy, quantity: 50 }]);
  });

  // No other build has it, and the main theaters' missions give no Candy.
  for (const changelist of [builds.cert, builds["1.7.2"]]) {
    assert.ok(!inBuild(changelist, () => worldInfo()).theaters.some((entry) => entry.uniqueId === hexsylvaniaId), changelist);
  }
  const main = info.missions.filter((entry) => entry.theaterId !== hexsylvaniaId).flatMap((entry) => entry.availableMissions);
  assert.ok(!main.some((mission) => mission.missionRewards.items.some((item) => item.itemType === candy)));
});

test("a won Hexsylvania mission gives its Candy", async () => {
  const backend = await startBackend();
  try {
    const server = await userLogin(backend.port, "CoreServer1");
    const dedicated = await dedicatedServerToken(backend.port);
    const player = await userLogin(backend.port, "Hexer18");
    const info = (await as(builds["1.8"], backend.port, "GET", "/fortnite/api/game/v2/world/info", server.token)).body;
    const mission = info.missions.find((entry) => entry.theaterId === hexsylvaniaId).availableMissions[0];
    const zone = { worldId: "", theaterId: hexsylvaniaId, theaterMissionId: mission.missionGuid, theaterMissionAlertId: "", zoneThemeClass: "" };
    const registered = await as(builds["1.8"], backend.port, "POST", "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "CoreServer1", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 4, maxPrivatePlayers: 0, buildUniqueId: "595160781",
      attributes: { ZONEINSTANCEID_s: JSON.stringify(zone), GAMEMODE_s: "FORTPVE" }
    });
    const ended = await mcp(builds["1.8"], backend.port, { accountId: player.accountId, token: dedicated }, "EndPrimaryMission",
      { matchmakingSessionId: registered.body.id, missionName: "m", missionStatus: "Succeeded", advance: [], numMissionPoints: 0 }, "dedicated_server");
    assert.equal(ended.status, 200);
    const [{ quantity }] = mission.missionRewards.items.filter((item) => item.itemType === candy);
    const profile = profileOf(await mcp(builds["1.8"], backend.port, player, "QueryProfile"));
    assert.equal(held(profile, candy), quantity);
  } finally {
    backend.close();
  }
});

test("1.8's collection book has the Fortnitemares pages, and their heroes and survivors slot; 1.7.2's book doesn't (#75)", async () => {
  const backend = await startBackend();
  try {
    const route = ({ accountId }, command, profileId) => `/fortnite/api/game/v2/profile/${accountId}/client/${command}?profileId=${profileId}&rvn=-1`;
    const query = async (changelist, player, profileId) => {
      const response = await as(changelist, backend.port, "POST", route(player, "QueryProfile", profileId), player.token, {});
      return response.body.profileChanges[0].profile;
    };
    const pages = (profile) => Object.values(profile.items).filter((item) => item.templateId.startsWith("CollectionBookPage:"))
      .map((item) => item.templateId);
    const halloween = ["CollectionBookPage:PageSpecial_Halloween2017_Heroes", "CollectionBookPage:PageSpecial_Halloween2017_Workers"];

    const player = await userLogin(backend.port, "MaresBook");
    assert.deepEqual(pages(await query(builds["1.8"], player, "collection_book_people0")), halloween);
    assert.deepEqual(pages(await query(builds["1.8"], player, "collection_book_schematics0")), []);
    assert.deepEqual(profileOf(await mcp(builds["1.8"], backend.port, player, "QueryProfile")).stats.attributes.collection_book.pages,
      ["PageSpecial_Halloween2017_Heroes", "PageSpecial_Halloween2017_Workers"]);
    // Loading the book again adds nothing.
    assert.deepEqual(pages(await query(builds["1.8"], player, "collection_book_people0")), halloween);

    // Skull Trooper Jonesy and a Monster 'Cosplayer' troll go in their pages' slots.
    editProfile(backend, player.accountId, (profile) => {
      profile.items.jonesy = { templateId: "Hero:hid_commando_gunheadshothw_vr_t01", attributes: { level: 1, squad_id: "", squad_slot_idx: -1 }, quantity: 1 };
      profile.items.troll = { templateId: "Worker:worker_halloween_troll_sr_t01", attributes: { level: 1, squad_id: "", squad_slot_idx: -1 }, quantity: 1 };
    });
    for (const itemId of ["jonesy", "troll"]) {
      const slotted = await as(builds["1.8"], backend.port, "POST", route(player, "SlotItemInCollectionBook", "profile0"), player.token, { itemId });
      assert.equal(slotted.status, 200, itemId);
    }
    const book = await query(builds["1.8"], player, "collection_book_people0");
    assert.equal(book.items.jonesy.templateId, "Hero:hid_commando_gunheadshothw_vr_t01");
    assert.equal(book.items.troll.templateId, "Worker:worker_halloween_troll_sr_t01");

    // 1.7.2 runs no event: its book gets no event page.
    const other = await userLogin(backend.port, "MaresBook172");
    assert.deepEqual(pages(await query(builds["1.7.2"], other, "collection_book_people0")), []);
  } finally {
    backend.close();
  }
});

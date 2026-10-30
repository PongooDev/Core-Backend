import { test } from "node:test";
import assert from "node:assert/strict";
import { dedicatedServerToken, get, post, startBackend, userLogin } from "./helpers.js";

// CoreV2 #156: after the first storm shield defense, "Loot Llamas" (HomebaseOnboardingAfterOutpost) locks the front end
// to the Loot tab, which then shows only the Mini Reward Llama offer, and only to a holder of Voucher_BasicPack.
const route = (kind, accountId, name) => `/fortnite/api/game/v2/profile/${accountId}/${kind}/${name}?profileId=profile0&rvn=-1`;
const stats = (...names) => names.map((statName) => ({ statName, count: 1 }));
const onboarding = stats("hbonboarding_completezone", "hbonboarding_watchsatellitecine", "hbonboarding_namehomebase");
const firstLeg = stats("custom_supplydropreceived", "custom_deployoutpost", "complete_outpost_1_1");
const voucher = "AccountResource:voucher_basicpack";

async function player(backend, name) {
  const { token, accountId } = await userLogin(backend.port, name);
  const dedicated = await dedicatedServerToken(backend.port);
  const client = (command, body = {}) => post(backend.port, route("client", accountId, command), token, body);
  const gameserver = (command, body) => post(backend.port, route("dedicated_server", accountId, command), dedicated, body);
  const items = async () => Object.entries((await client("QueryProfile")).body.profileChanges[0].profile.items);
  const held = async (templateId) => (await items()).filter(([, item]) => item.templateId === templateId)
    .reduce((total, [, item]) => total + item.quantity, 0);
  const quest = async () => (await items()).find(([, item]) => item.templateId === "Quest:homebaseonboardingafteroutpost")?.[1];
  // The client claims the defense's quest (its shotgun and V-Bucks), whose hidden reward is Loot Llamas.
  const claimDefense = async () => {
    const [questId] = (await items()).find(([, item]) => item.templateId === "Quest:outpostquest_t1_l1");
    assert.equal((await client("ClaimQuestReward", { questId, selectedRewardIndex: -1 })).status, 200);
  };
  return { token, accountId, client, gameserver, items, held, quest, claimDefense };
}

test("a defense won without its rewards still leaves the Loot Llamas step a Mini Reward Llama to redeem and open", async () => {
  const backend = await startBackend();
  try {
    const p = await player(backend, "LootLlamas");
    assert.equal(await p.held(voucher), 0);
    await p.gameserver("UpdateQuests", { advance: onboarding });
    // No game session, so no mission and no rewards: the voucher Epic's defense gave never comes.
    await p.gameserver("EndPrimaryMission", { matchmakingSessionId: "", missionName: "m", missionStatus: "Succeeded", advance: firstLeg });
    await p.claimDefense();

    const quest = await p.quest();
    assert.equal(quest.attributes.quest_state, "Active");
    assert.equal(quest.attributes.completion_open_card_pack, 0);
    assert.equal(await p.held(voucher), 1);
    assert.equal(await p.held(voucher), 1, "given once");

    const offers = (await get(backend.port, "/fortnite/api/storefront/v2/catalog", p.token)).body.storefronts
      .find((storefront) => storefront.name === "CardPackStore").catalogEntries;
    const mini = offers.find((offer) => offer.prices[0].currencySubType === voucher);
    const bought = await p.client("PurchaseCatalogEntry", { offerId: mini.offerId, purchaseQuantity: 1, currency: "GameItem",
      currencySubType: voucher, expectedPrice: 1 });
    assert.equal(bought.status, 200);
    const [{ itemGuid }] = bought.body.notifications[0].lootResult.items;
    // Bought but not opened yet: the llama is the way to finish, so no second voucher.
    assert.equal(await p.held(voucher), 0);

    assert.equal((await p.client("OpenCardPack", { cardPackItemId: itemGuid, selectionIdx: 0 })).status, 200);
    assert.equal((await p.quest()).attributes.completion_open_card_pack, 1);
    assert.equal(await p.held(voucher), 0, "the step is done: nothing more is given");
  } finally {
    backend.close();
  }
});

test("a defense won with its rewards gives the one voucher, through the rewards screen", async () => {
  const backend = await startBackend();
  try {
    const server = await userLogin(backend.port, "LootLlamaServer");
    const p = await player(backend, "LootLlamasWon");
    const info = (await get(backend.port, "/fortnite/api/game/v2/world/info", p.token)).body;
    const stonewood = info.missions.find(({ availableMissions }) => availableMissions.some(({ missionGenerator }) => /TheOutpost_PvE_01/.test(missionGenerator)));
    const mission = stonewood.availableMissions.find(({ missionGenerator }) => /TheOutpost_PvE_01/.test(missionGenerator));
    assert.ok(mission.missionRewards.items.some(({ itemType }) => itemType === "CardPack:zcp_voucher_basicpack"));
    const zone = { worldId: "", theaterId: stonewood.theaterId, theaterMissionId: mission.missionGuid, theaterMissionAlertId: "", zoneThemeClass: "" };
    const registered = await post(backend.port, "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "LootLlamaServer", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 4, maxPrivatePlayers: 0, buildUniqueId: "595160781",
      attributes: { ZONEINSTANCEID_s: JSON.stringify(zone), GAMEMODE_s: "FORTPVE" }
    });

    await p.gameserver("UpdateQuests", { advance: onboarding });
    await p.gameserver("EndPrimaryMission", { matchmakingSessionId: registered.body.id, missionName: "m", missionStatus: "Succeeded", advance: firstLeg });
    await p.claimDefense();
    assert.equal((await p.quest()).attributes.quest_state, "Active");
    // The mission's voucher pack is on its way to the rewards screen: no voucher of Core's as well.
    assert.equal(await p.held(voucher), 0);
    const packs = (await p.items()).filter(([, item]) => item.templateId.startsWith("CardPack:zcp_")).map(([itemId]) => itemId);
    assert.equal((await p.client("OpenCardPackBatch", { cardPackItemIds: packs })).status, 200);
    assert.equal(await p.held(voucher), 1);
  } finally {
    backend.close();
  }
});

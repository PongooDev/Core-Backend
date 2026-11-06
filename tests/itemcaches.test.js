import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheMaterialsCount, rollContents } from "../src/cardpacks/contents.js";
import { inBuild } from "../src/builds/context.js";
import { getCardPack, getItem } from "../src/gamedata/items.js";
import { maxItemCaches } from "../src/profiles/itemcaches.js";
import { dedicatedServerToken, send, startBackend, userLogin } from "./helpers.js";

// 4.0's Save the World item caches (CoreV2 #290): a Mini-Boss drops one (Cache_EvolveTier_VR_Pickup_T01-T04,
// Cache_Schematic_R/VR/SR_Pickup), the gameserver reports the caches each player picked up in EndPrimaryMission's
// earnedItemCaches, and each gives its CardPackReward as an "ItemCache" pack the frontend opens with OpenCardPack.
const v40 = "4039451";
const v41 = "4053532";
const agent40 = "Fortnite/4.20.0-4039451+++Fortnite+Release-4.0 Windows/10.0.17134.1.256.64bit";
const caches = {
  "WorldItem:cache_evolvetier_vr_pickup_t01": "CardPack:cardpack_cache_materials_t01",
  "WorldItem:cache_evolvetier_vr_pickup_t02": "CardPack:cardpack_cache_materials_t02",
  "WorldItem:cache_evolvetier_vr_pickup_t03": "CardPack:cardpack_cache_materials_t03",
  "WorldItem:cache_evolvetier_vr_pickup_t04": "CardPack:cardpack_cache_materials_t04",
  "WorldItem:cache_schematic_r_pickup": "CardPack:cardpack_cache_schematic_r",
  "WorldItem:cache_schematic_vr_pickup": "CardPack:cardpack_cache_schematic_vr",
  "WorldItem:cache_schematic_sr_pickup": "CardPack:cardpack_cache_schematic_sr"
};

const mcp = (backend, accountId, token, kind, command, body = {}) => {
  const text = JSON.stringify(body);
  return send({ host: "127.0.0.1", port: backend.port, method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/${kind}/${command}?profileId=campaign&rvn=-1`,
    headers: { "User-Agent": agent40, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
};
const packsOf = (profile) => Object.entries(profile.items).filter(([, item]) => item.templateId.toLowerCase().startsWith("cardpack:cardpack_cache_"));

test("4.0's and 4.1's item cache definitions carry the card pack they open into", () => {
  for (const build of [v40, v41]) {
    inBuild(build, () => {
      for (const [cache, pack] of Object.entries(caches)) {
        const item = getItem(cache);
        assert.equal(item?.class, "FortItemCacheItemDefinition", `${build} ${cache}`);
        assert.equal(item.cardPackReward, pack, `${build} ${cache}`);
        assert.ok(getCardPack(pack), `${build} ${pack}`);
      }
    });
  }
  assert.equal(inBuild("4019403", () => getItem("WorldItem:cache_schematic_r_pickup")), undefined, "3.6 has no item caches");
});

test("an Evolution Materials Cache holds its tier's evolution material and XP; a schematic cache one schematic of its rarity", () => {
  inBuild(v40, () => {
    const reagents = ["reagent_c_t01", "reagent_c_t02", "reagent_c_t03", "reagent_c_t04"];
    const xp = [100, 200, 400, 700];
    reagents.forEach((reagent, index) => {
      assert.deepEqual(rollContents(`CardPack:cardpack_cache_materials_t0${index + 1}`), [
        { templateId: `AccountResource:${reagent}`, quantity: cacheMaterialsCount },
        { templateId: "AccountResource:heroxp", quantity: xp[index] },
        { templateId: "AccountResource:personnelxp", quantity: xp[index] },
        { templateId: "AccountResource:schematicxp", quantity: xp[index] }
      ]);
    });
    for (const [rarity, name] of [["Rare", "r"], ["Epic", "vr"], ["Legendary", "sr"]]) {
      const contents = rollContents(`CardPack:cardpack_cache_schematic_${name}`);
      assert.equal(contents.length, 1, rarity);
      assert.equal(contents[0].quantity, 1);
      assert.match(contents[0].templateId, /^Schematic:/);
      assert.ok(contents[0].templateId.toLowerCase().includes(`_${name}_`), `${rarity}: ${contents[0].templateId}`);
    }
  });
});

test("EndPrimaryMission grants each earned item cache's card pack as an ItemCache pack, which OpenCardPack opens", async () => {
  const backend = await startBackend();
  try {
    const dedicated = await dedicatedServerToken(backend.port);
    const player = await userLogin(backend.port, "CachePlayer");
    // GetPersistentName's lower case and any other case are matched; non-caches, unknown names and non-strings give
    // nothing. The caches are kept although the mission failed.
    const ended = await mcp(backend, player.accountId, dedicated, "dedicated_server", "EndPrimaryMission", {
      matchmakingSessionId: "no-session", missionName: "m", missionStatus: "Failed", advance: [], earnedBadgeData: [],
      earnedItemCaches: ["WorldItem:cache_evolvetier_vr_pickup_t02", "WorldItem:Cache_Schematic_VR_Pickup", "WorldItem:cache_evolvetier_vr_pickup_t02",
        "WorldItem:missionbadge_survivor_bronze", "WorldItem:no_such_cache", 7, null],
      difficultyIncreaseTier: 0, numMissionPoints: 0, bCriticalMatchBonus: false });
    assert.equal(ended.status, 200);

    const queried = await mcp(backend, player.accountId, player.token, "client", "QueryProfile");
    const packs = packsOf(queried.body.profileChanges[0].profile);
    assert.deepEqual(packs.map(([, item]) => item.templateId).sort(),
      ["CardPack:cardpack_cache_materials_t02", "CardPack:cardpack_cache_materials_t02", "CardPack:cardpack_cache_schematic_vr"]);
    assert.ok(packs.every(([, item]) => item.attributes.pack_source === "ItemCache"));

    // ClaimItemCacheReward (UFortMcpContext, 0xDED0E0) sends OpenCardPack for the pack, selection 0.
    const [materialsId] = packs.find(([, item]) => item.templateId === "CardPack:cardpack_cache_materials_t02");
    const opened = await mcp(backend, player.accountId, player.token, "client", "OpenCardPack", { cardPackItemId: materialsId, selectionIdx: 0 });
    assert.equal(opened.status, 200);
    const result = opened.body.notifications.find((entry) => entry.type === "cardPackResult");
    assert.equal(result.lootGranted.tierGroupName, "CacheRoll_Materials");
    assert.deepEqual(result.lootGranted.items.map((item) => item.itemType).sort(),
      ["AccountResource:heroxp", "AccountResource:personnelxp", "AccountResource:reagent_c_t02", "AccountResource:schematicxp"]);
    const after = await mcp(backend, player.accountId, player.token, "client", "QueryProfile");
    assert.equal(packsOf(after.body.profileChanges[0].profile).length, 2);
  } finally {
    await backend.close();
  }
});

test("EndPrimaryMission grants at most maxItemCaches caches, and none without earnedItemCaches", async () => {
  const backend = await startBackend();
  try {
    const dedicated = await dedicatedServerToken(backend.port);
    const player = await userLogin(backend.port, "CacheHoarder");
    const end = (earnedItemCaches) => mcp(backend, player.accountId, dedicated, "dedicated_server", "EndPrimaryMission", {
      matchmakingSessionId: "no-session", missionName: "m", missionStatus: "Failed", advance: [], earnedBadgeData: [],
      ...(earnedItemCaches ? { earnedItemCaches } : {}), numMissionPoints: 0, bCriticalMatchBonus: false });
    assert.equal((await end(undefined)).status, 200);
    let profile = (await mcp(backend, player.accountId, player.token, "client", "QueryProfile")).body.profileChanges[0].profile;
    assert.equal(packsOf(profile).length, 0);

    assert.equal((await end(Array(maxItemCaches + 5).fill("WorldItem:cache_schematic_r_pickup"))).status, 200);
    profile = (await mcp(backend, player.accountId, player.token, "client", "QueryProfile")).body.profileChanges[0].profile;
    assert.equal(packsOf(profile).reduce((sum, [, item]) => sum + item.quantity, 0), maxItemCaches);
  } finally {
    await backend.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { rollContents } from "../src/cardpacks/contents.js";
import { getItem } from "../src/gamedata/items.js";
import { maxBadgeCount } from "../src/profiles/badges.js";
import { dedicatedServerToken, post, startBackend, userLogin } from "./helpers.js";

const route = (kind, accountId, name, profileId = "profile0") =>
  `/fortnite/api/game/v2/profile/${accountId}/${kind}/${name}?profileId=${profileId}&rvn=-1`;
const profileOf = (response) => response.body.profileChanges[0].profile;
const byTemplate = (profile, templateId) => Object.entries(profile.items).filter(([, item]) => item.templateId === templateId);

async function setup(backend) {
  const dedicated = await dedicatedServerToken(backend.port);
  const player = await userLogin(backend.port, "BadgePlayer");
  const send = (name, body) => post(backend.port, route("dedicated_server", player.accountId, name), dedicated, body);
  const run = (name, body) => post(backend.port, route("client", player.accountId, name), player.token, body);
  const profile = async () => profileOf(await run("QueryProfile", {}));
  return { player, send, run, profile };
}

const endMission = (send, earnedBadgeData, missionStatus = "Failed") =>
  send("EndPrimaryMission", { matchmakingSessionId: "no-session", missionName: "m", missionStatus, advance: [], earnedBadgeData,
    numMissionPoints: 0, bCriticalMatchBonus: false });

test("the extracted badges carry their template's card pack and item rewards", () => {
  assert.equal(getItem("WorldItem:missionbadge_survivor_bronze").cardPackReward, "CardPack:zcp_rescued");
  assert.equal(getItem("WorldItem:missionbadge_survivor_gold_t20").cardPackReward, "CardPack:zcp_rescued_t20");
  assert.deepEqual(getItem("WorldItem:reactivequest_distresscallbadge").itemRewards, [{ quantity: 0, templateId: "Quest:reactivequest_distresscalls" }]);
  assert.equal(getItem("WorldItem:combatscore_missionbadge_gold").cardPackReward, undefined);
});

test("a Rescued Survivor pack holds People, more at higher tiers", () => {
  assert.deepEqual(rollContents("CardPack:zcp_rescued"), [{ templateId: "AccountResource:peopleresource", quantity: 1 }]);
  assert.deepEqual(rollContents("CardPack:zcp_rescued_t05"), [{ templateId: "AccountResource:peopleresource", quantity: 6 }]);
  assert.deepEqual(rollContents("CardPack:zcp_rescued_t20"), [{ templateId: "AccountResource:peopleresource", quantity: 21 }]);
});

test("EndPrimaryMission grants each earned badge's reward pack as a Mission pack, which the rewards screen opens into People", async () => {
  const backend = await startBackend();
  try {
    const { send, run, profile } = await setup(backend);
    // The server's names (GetPersistentName) are lower case; Core matches any case. Badges without rewards, unknown
    // templates, non-badges and bad counts give nothing.
    const ended = await endMission(send, [
      { templateId: "WorldItem:missionbadge_survivor_silver_t05", count: 2 },
      { templateId: "WorldItem:MissionBadge_Survivor_Gold", count: 1 },
      { templateId: "WorldItem:combatscore_missionbadge_gold", count: 1 },
      { templateId: "WorldItem:no_such_badge", count: 1 },
      { templateId: "CardPack:zcp_rescued", count: 1 },
      { templateId: "WorldItem:missionbadge_survivor_bronze", count: 0 },
      { templateId: "WorldItem:missionbadge_survivor_bronze", count: 1.5 },
      { templateId: "WorldItem:missionbadge_survivor_bronze", count: "2" },
      { count: 1 }
    ]);
    assert.equal(ended.status, 200);
    assert.deepEqual(ended.body.notifications.map((entry) => entry.type), ["earnScore"]);

    const packs = Object.entries((await profile()).items).filter(([, item]) => item.templateId.startsWith("CardPack:"));
    assert.deepEqual(packs.map(([, item]) => item.templateId).sort(), ["CardPack:zcp_rescued", "CardPack:zcp_rescued_t05", "CardPack:zcp_rescued_t05"]);
    for (const [, item] of packs) assert.equal(item.attributes.pack_source, "Mission");

    const opened = await run("OpenCardPackBatch", { cardPackItemIds: packs.map(([itemId]) => itemId) });
    const [result] = opened.body.notifications.filter((entry) => entry.type === "cardPackResult");
    assert.deepEqual(result.lootGranted.items.map((entry) => `${entry.itemType} x${entry.quantity}`).sort(),
      ["AccountResource:peopleresource x1", "AccountResource:peopleresource x6", "AccountResource:peopleresource x6"]);
    const after = await profile();
    assert.equal(byTemplate(after, "AccountResource:peopleresource")[0][1].quantity, 13);
    assert.equal(Object.values(after.items).filter((item) => item.templateId.startsWith("CardPack:")).length, 0);
  } finally {
    backend.close();
  }
});

test("badge rewards come with a won mission too, item rewards are granted, and counts are capped", async () => {
  const backend = await startBackend();
  try {
    const { send, profile } = await setup(backend);
    await endMission(send, [{ templateId: "WorldItem:reactivequest_distresscallbadge", count: 1 }], "Succeeded");
    assert.equal(byTemplate(await profile(), "Quest:reactivequest_distresscalls").length, 1);
    // Earning it again doesn't add a second copy of the quest.
    await endMission(send, [{ templateId: "WorldItem:reactivequest_distresscallbadge", count: 2 }]);
    assert.equal(byTemplate(await profile(), "Quest:reactivequest_distresscalls").length, 1);

    await endMission(send, [{ templateId: "WorldItem:missionbadge_survivor_bronze_t01", count: maxBadgeCount + 50 }]);
    assert.equal(byTemplate(await profile(), "CardPack:zcp_rescued_t01").length, maxBadgeCount);
  } finally {
    backend.close();
  }
});

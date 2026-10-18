import { test } from "node:test";
import assert from "node:assert/strict";
import { getQuest } from "../src/gamedata/quests.js";
import { post, startBackend, userLogin } from "./helpers.js";

const command = (accountId, name, profileId = "profile0", rvn = -1) =>
  `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=${rvn}`;

async function freshAccount(backend) {
  const login = await userLogin(backend.port, "CoreTest");
  await post(backend.port, command(login.accountId, "ClientQuestLogin"), login.token, {});
  return login;
}

async function profileItems(backend, { token, accountId }, profileId = "profile0") {
  const query = await post(backend.port, command(accountId, "QueryProfile", profileId), token, {});
  return query.body.profileChanges[0].profile;
}

const byTemplate = (profile, templateId) => Object.values(profile.items).filter((item) => item.templateId === templateId);

test("SkipTutorial completes the onboarding chain and grants its rewards where they belong", async () => {
  const backend = await startBackend();
  try {
    const login = await freshAccount(backend);
    const skip = await post(backend.port, command(login.accountId, "SkipTutorial", "profile0", 2), login.token, {});
    assert.equal(skip.status, 200);
    assert.equal(skip.body.profileChangesBaseRevision, 2);
    assert.equal(skip.body.profileRevision, 3);
    assert.ok(skip.body.profileChanges.length > 0);
    assert.ok(skip.body.profileChanges.every((change) => change.changeType !== "fullProfileUpdate"));

    const [theater] = skip.body.multiUpdate;
    assert.equal(theater.profileId, "theater0");
    assert.equal(theater.profileRevision, theater.profileChangesBaseRevision + 1);
    assert.deepEqual(theater.profileChanges.map((change) => change.item.templateId), ["Weapon:wid_shotgun_standard_uc_ore_t01"]);

    const profile = await profileItems(backend, login);
    for (const questId of ["homebaseonboarding", "homebaseonboardinggrantschematics", "outpostquest_t1_l1", "homebaseonboardingafteroutpost"]) {
      const [quest] = byTemplate(profile, `Quest:${questId}`);
      assert.equal(quest.attributes.quest_state, "Claimed", questId);
      for (const objective of getQuest(questId).objectives) assert.equal(quest.attributes[`completion_${objective.name}`], objective.count);
    }
    assert.equal(byTemplate(profile, "Quest:heroquest_constructorleadership")[0].attributes.quest_state, "Active");

    const [hero] = byTemplate(profile, "Hero:hid_constructor_rushbase_uc_t01");
    assert.deepEqual({ quantity: hero.quantity, level: hero.attributes.level, seen: hero.attributes.item_seen }, { quantity: 1, level: 1, seen: 0 });
    assert.equal(byTemplate(profile, "Currency:mtxgiveaway")[0].quantity, 100);
    assert.equal(byTemplate(profile, "AccountResource:heroxp")[0].quantity, 150);
    for (const schematic of ["ingredient_blastpowder", "ingredient_duct_tape", "ammo_energycell"]) {
      assert.equal(byTemplate(profile, `Schematic:${schematic}`).length, 1, schematic);
    }
    assert.ok(profile.stats.attributes.collection_book.pages.includes("pageheroes_commando"));

    const again = await post(backend.port, command(login.accountId, "SkipTutorial", "profile0", 3), login.token, {});
    assert.deepEqual(again.body.profileChanges, []);
    assert.equal(again.body.multiUpdate, undefined);
  } finally {
    backend.close();
  }
});

test("UpdateQuestClientObjectives advances objectives and completing a quest grants what it rewards", async () => {
  const backend = await startBackend();
  try {
    const login = await freshAccount(backend);
    const advance = (statName, count = 1) =>
      post(backend.port, command(login.accountId, "UpdateQuestClientObjectives"), login.token, { advance: [{ statName, count }] });

    await advance("hbonboarding_watchsatellitecine", 5);
    let [quest] = byTemplate(await profileItems(backend, login), "Quest:homebaseonboarding");
    assert.equal(quest.attributes.completion_hbonboarding_watchsatellitecine, 1);
    assert.equal(quest.attributes.quest_state, "Active");

    await advance("hbonboarding_namehomebase");
    await advance("hbonboarding_completezone");
    const profile = await profileItems(backend, login);
    [quest] = byTemplate(profile, "Quest:homebaseonboarding");
    assert.equal(quest.attributes.quest_state, "Claimed");
    assert.equal(byTemplate(profile, "Quest:outpostquest_t1_l1")[0].attributes.quest_state, "Active");
    assert.equal(byTemplate(profile, "Quest:homebaseonboardinggrantschematics")[0].attributes.quest_state, "Active");
  } finally {
    backend.close();
  }
});

test("MarkItemSeen marks granted items as seen", async () => {
  const backend = await startBackend();
  try {
    const login = await freshAccount(backend);
    await post(backend.port, command(login.accountId, "SkipTutorial"), login.token, {});
    const [heroId] = Object.entries((await profileItems(backend, login)).items)
      .find(([, item]) => item.templateId.startsWith("Hero:"));

    const seen = await post(backend.port, command(login.accountId, "MarkItemSeen", "profile0", 3), login.token, { itemIds: [heroId, "missing"] });
    assert.deepEqual(seen.body.profileChanges, [{ changeType: "itemAttrChanged", itemId: heroId, attributeName: "item_seen", attributeValue: 1 }]);
  } finally {
    backend.close();
  }
});

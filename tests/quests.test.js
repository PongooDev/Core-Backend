import { test } from "node:test";
import assert from "node:assert/strict";
import { getQuest, startingQuests } from "../src/gamedata/quests.js";
import { post, startBackend, userLogin } from "./helpers.js";

const command = (accountId, name, rvn = -1) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=${rvn}`;

test("the starting quests are the onboarding quests nothing else grants", () => {
  assert.deepEqual(startingQuests, ["homebaseonboarding"]);
  assert.equal(getQuest("HomebaseOnboarding").type, "Onboarding");
});

test("ClientQuestLogin grants the starting quest once, active with zeroed objectives", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    await post(backend.port, command(accountId, "QueryProfile"), token, {});

    const login = await post(backend.port, command(accountId, "ClientQuestLogin", 1), token, {});
    assert.equal(login.status, 200);
    assert.equal(login.body.profileRevision, 2);
    const [added] = login.body.profileChanges;
    assert.equal(added.changeType, "itemAdded");
    assert.match(added.itemId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(added.item.templateId, "Quest:homebaseonboarding");
    assert.equal(added.item.quantity, 1);
    assert.equal(added.item.attributes.quest_state, "Active");
    assert.equal(added.item.attributes.sent_new_notification, false);
    for (const objective of getQuest("homebaseonboarding").objectives) {
      assert.equal(added.item.attributes[`completion_${objective.name}`], 0);
    }

    const again = await post(backend.port, command(accountId, "ClientQuestLogin", 2), token, {});
    assert.deepEqual(again.body.profileChanges, []);

    const query = await post(backend.port, command(accountId, "QueryProfile"), token, {});
    const items = Object.values(query.body.profileChanges[0].profile.items);
    assert.deepEqual(items.map((item) => item.templateId), ["Quest:homebaseonboarding"]);
  } finally {
    backend.close();
  }
});

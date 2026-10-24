import { test } from "node:test";
import assert from "node:assert/strict";
import { getQuest, startingQuests } from "../src/gamedata/quests.js";
import { post, startBackend, userLogin } from "./helpers.js";

const command = (accountId, name, rvn = -1) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=${rvn}`;

test("the starting quests are the onboarding quests nothing else grants", () => {
  assert.deepEqual(startingQuests, ["homebaseonboarding"]);
  assert.equal(getQuest("HomebaseOnboarding").type, "Onboarding");
});

test("a new profile holds the starting quest once, active with zeroed objectives, and ClientQuestLogin adds no other", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    const first = await post(backend.port, command(accountId, "QueryProfile"), token, {});
    // The founder's pack quest (profiles/founders.js) is the only other one.
    const quests = (body) => Object.entries(body.profileChanges[0].profile.items)
      .filter(([, item]) => item.templateId.startsWith("Quest:") && item.templateId !== "Quest:foundersquest_getrewards_0_1");
    const [[itemId, quest], ...others] = quests(first.body);
    assert.equal(others.length, 0);
    assert.match(itemId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(quest.templateId, "Quest:homebaseonboarding");
    assert.equal(quest.quantity, 1);
    assert.equal(quest.attributes.quest_state, "Active");
    assert.equal(quest.attributes.sent_new_notification, false);
    for (const objective of getQuest("homebaseonboarding").objectives) {
      assert.equal(quest.attributes[`completion_${objective.name}`], 0);
    }

    const login = await post(backend.port, command(accountId, "ClientQuestLogin", first.body.profileRevision), token, {});
    assert.equal(login.status, 200);
    assert.deepEqual(login.body.profileChanges, []);

    const query = await post(backend.port, command(accountId, "QueryProfile"), token, {});
    assert.deepEqual(quests(query.body).map(([id, item]) => [id, item.templateId]), [[itemId, "Quest:homebaseonboarding"]]);
  } finally {
    backend.close();
  }
});

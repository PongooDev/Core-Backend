import { test } from "node:test";
import assert from "node:assert/strict";
import { getQuest } from "../src/gamedata/quests.js";
import { trackChanges } from "../src/profiles/changes.js";
import { defaultStats } from "../src/profiles/defaults.js";
import { refreshDailyQuests } from "../src/profiles/dailies.js";
import { grantQuest, questIdOf } from "../src/profiles/quests.js";
import { post, startBackend, userLogin } from "./helpers.js";

function memorySession() {
  const tracker = trackChanges({ profileId: "profile0", stats: { attributes: defaultStats("profile0") }, items: {} });
  return { tracker, profile: () => tracker };
}

const dailies = (tracker) => Object.entries(tracker.profile.items).filter(([, item]) => getQuest(questIdOf(item) ?? "")?.type === "DailyQuest");

test("dailies start with the daily trigger: one a day up to three open, claimed ones cleared, reroll restored", () => {
  const session = memorySession();
  const { tracker } = session;
  refreshDailyQuests(session, new Date("2026-10-19T10:00:00Z"));
  assert.equal(dailies(tracker).length, 0, "nothing before Quest:dailyquesttrigger");

  grantQuest(tracker, "dailyquesttrigger");
  refreshDailyQuests(session, new Date("2026-10-19T10:00:00Z"));
  refreshDailyQuests(session, new Date("2026-10-19T23:00:00Z"));
  assert.equal(dailies(tracker).length, 1, "one per day");
  assert.deepEqual(tracker.profile.stats.attributes.quest_manager, { dailyLoginInterval: "2026-10-19T10:00:00.000Z", dailyQuestRerolls: 1 });

  for (const day of ["20", "21", "22"]) refreshDailyQuests(session, new Date(`2026-10-${day}T10:00:00Z`));
  assert.equal(dailies(tracker).length, 3, "no more than three open");

  const [claimedId] = dailies(tracker)[0];
  tracker.setItemAttribute(claimedId, "quest_state", "Claimed");
  refreshDailyQuests(session, new Date("2026-10-23T10:00:00Z"));
  assert.equal(tracker.profile.items[claimedId], undefined);
  assert.equal(dailies(tracker).length, 3);
  assert.equal(new Set(dailies(tracker).map(([, item]) => item.templateId)).size, 3, "never the same daily twice");
});

test("FortRerollDailyQuest swaps an open daily once a day and names the new one", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "DailyTest");
    const command = (name) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`;
    await post(backend.port, `/admin/api/accounts/${accountId}/grant`, undefined, { templateId: "Quest:dailyquesttrigger", quantity: 1 });
    const login = await post(backend.port, command("ClientQuestLogin"), token, {});
    const [[dailyId, daily]] = Object.entries(login.body.profileChanges[0].profile.items)
      .filter(([, item]) => getQuest(questIdOf(item) ?? "")?.type === "DailyQuest");

    const reroll = await post(backend.port, command("FortRerollDailyQuest"), token, { questId: dailyId });
    assert.equal(reroll.status, 200);
    const [notification] = reroll.body.notifications;
    assert.equal(notification.type, "dailyQuestReroll");
    const items = reroll.body.profileChanges[0].profile.items;
    assert.equal(items[dailyId], undefined);
    assert.notEqual(items[notification.newQuestId].templateId, daily.templateId);
    assert.equal(reroll.body.profileChanges[0].profile.stats.attributes.quest_manager.dailyQuestRerolls, 0);

    const again = await post(backend.port, command("FortRerollDailyQuest"), token, { questId: notification.newQuestId });
    assert.equal(again.status, 400);
  } finally {
    backend.close();
  }
});

import { getQuest } from "../../../gamedata/quests.js";
import { McpError } from "../../../errors.js";
import { lootEntry } from "../../../profiles/items.js";
import { chooseHeroBundle, noteHeroBundleChoice } from "../../../profiles/founders.js";
import { claimQuest } from "../../../profiles/progress.js";
import { questIdOf } from "../../../profiles/quests.js";

// questId is the quest item's id. The rewards screen sends this for Completed quests and builds its cards from loot.
// Battle Royale's challenges (athena) are claimed as they are completed (profiles/athena.js), so a claim there has
// nothing more to give.
export function claimQuestReward({ req, session, notifications, profileId }) {
  const tracker = session.profile(profileId === "athena" ? "athena" : "profile0");
  const questId = String(req.body?.questId ?? "");
  const item = tracker.profile.items[questId];
  if (!item || !questIdOf(item)) throw new McpError("errors.com.epicgames.fortnite.item_not_found", `No quest ${questId}`);

  const result = (items) => notifications.push({ type: "questClaim", primary: true, questId, loot: { tierGroupName: "", items } });
  if (item.attributes.quest_state === "Claimed" || profileId === "athena") return result([]);
  if (item.attributes.quest_state !== "Completed") {
    throw new McpError("errors.com.epicgames.fortnite.quest_not_completed", `Quest ${questId} is ${item.attributes.quest_state}`);
  }

  const quest = getQuest(questIdOf(item));
  let selected = -1;
  if (quest.selectableRewards?.length) {
    selected = req.body?.selectedRewardIndex;
    if (!Number.isInteger(selected) || selected < 0 || selected >= quest.selectableRewards.length) {
      throw new McpError("errors.com.epicgames.fortnite.invalid_parameter", `Reward choice ${selected} is out of range`);
    }
  }
  result(claimQuest(session, questId, selected).map(lootEntry));
  // The Limited Edition's hero bundle choice decides the Ultimate Edition's bundles (profiles/founders.js).
  if (questIdOf(item) === chooseHeroBundle) noteHeroBundleChoice(tracker.profile, selected);
}

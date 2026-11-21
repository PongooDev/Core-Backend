// 8.00's Party Assist (CL-5203069): UFortMcpProfileAthena::SetPartyAssistQuest {questToPinAsPartyAssist} pins the
// challenge this player's party helps with. The party's clients read athena's party_assist_quest (the attribute the 8.00
// exe names); an empty string clears it. The client sends the athena quest item's id (its key in the profile's items),
// not the "Quest:<template>" templateId: 8.00 resolves the attribute through its item lookup and keeps the result only
// when it is a UFortQuestItem (stat callback sub_DBDDA0 at 0xDBDDA0, registered for the attribute at 0xDB7D60), and a
// real profile's pin is an item UUID whose templateId is "Quest:...". The pin is that item's own id, stored as sent once
// it is one of the player's athena quests (🟡 Core's refusal, item_not_found as ClaimQuestReward's: the client would
// drop any other id anyway, and the profile keeps no arbitrary text).
import { McpError } from "../../../errors.js";
import { questIdOf } from "../../../profiles/quests.js";

export function setPartyAssistQuest({ req, profile, tracker, profileId }) {
  if (profileId !== "athena") return;
  const quest = req.body?.questToPinAsPartyAssist;
  if (typeof quest !== "string") return;
  const item = quest && Object.hasOwn(profile.items, quest) ? profile.items[quest] : null;
  if (quest && !(typeof item?.templateId === "string" && questIdOf(item))) {
    throw new McpError("errors.com.epicgames.fortnite.item_not_found", `No quest ${quest}`, [quest]);
  }
  if ((profile.stats.attributes.party_assist_quest ?? "") !== quest) tracker.setStat("party_assist_quest", quest);
}

// 8.00's Party Assist (CL-5203069): UFortMcpProfileAthena::SetPartyAssistQuest {questToPinAsPartyAssist} pins the
// challenge this player's party helps with. The party's clients read athena's party_assist_quest (the attribute the 8.00
// exe names); an empty string clears it. The client sends a quest template id, and the pin is its own, so no quest
// lookup is needed.
export function setPartyAssistQuest({ req, profile, tracker, profileId }) {
  if (profileId !== "athena") return;
  const quest = req.body?.questToPinAsPartyAssist;
  if (typeof quest !== "string") return;
  if ((profile.stats.attributes.party_assist_quest ?? "") !== quest) tracker.setStat("party_assist_quest", quest);
}

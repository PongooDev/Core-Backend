// 8.00's Party Assist (CL-5203069): UFortMcpProfileAthena::SetPartyAssistQuest {questToPinAsPartyAssist} pins the
// challenge this player's party helps with. The party's clients read athena's party_assist_quest (the attribute the 8.00
// exe names); an empty string clears it. The client sends the athena quest item's id (its key in the profile's items),
// not the "Quest:<template>" templateId: 8.00 resolves the attribute through its item lookup and keeps the result only
// when it is a UFortQuestItem (stat callback sub_DBDDA0 at 0xDBDDA0, registered for the attribute at 0xDB7D60), and a
// real profile's pin is an item UUID whose templateId is "Quest:...". The pin is that item's own id, so no quest
// lookup is needed here; the value is stored as sent.
export function setPartyAssistQuest({ req, profile, tracker, profileId }) {
  if (profileId !== "athena") return;
  const quest = req.body?.questToPinAsPartyAssist;
  if (typeof quest !== "string") return;
  if ((profile.stats.attributes.party_assist_quest ?? "") !== quest) tracker.setStat("party_assist_quest", quest);
}

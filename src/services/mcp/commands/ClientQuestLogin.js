import { activeEventFlags } from "../../../events/events.js";
import { eventQuests } from "../../../events/fortnitemares.js";
import { startingQuests } from "../../../gamedata/quests.js";
import { refreshDailyQuests } from "../../../profiles/dailies.js";
import { grant, refreshHeldItems } from "../../../profiles/progress.js";
import { eventFlagsNotification } from "./RequestEventFlags.js";

// The client may send this several times a session and logs out after 5 failed retries, so it must always succeed.
// Objectives about what the account holds are re-counted, so quests already active catch up with it (e.g. a collection
// book levelled before Core credited collectionbook_levelup).
//
// 1.8 learns the event flags here: its quest manager sends ClientQuestLogin (sub_87EF70 → sub_86AFE0) with sub_87F0E0
// as the completion, which reads the response's primary notification as FFortEventFlagsNotification (sub_87F710:
// JsonObjectToUStruct, then ActiveEventFlags +0x1C0 and OnActiveEventFlagsChanged) and only then schedules
// RequestEventFlags (sub_88C060, the command's only sender) for refreshTime. Without it the client never asks for the
// flags, so a build that runs an event gets them in this response; the others' responses are as before.
export function clientQuestLogin({ session, notifications }) {
  for (const questId of [...startingQuests(), ...eventQuests()]) grant(session, `Quest:${questId}`, 1);
  refreshDailyQuests(session);
  refreshHeldItems(session);
  if (activeEventFlags().length) notifications.push(eventFlagsNotification());
}

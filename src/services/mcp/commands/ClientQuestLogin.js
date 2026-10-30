import { activeEventFlags } from "../../../events/events.js";
import { convertLeftoverCandy } from "../../../events/candyllamas.js";
import { eventQuests } from "../../../events/fortnitemares.js";
import { eventQuestsToRestore, removeEndedEventQuests } from "../../../events/quests.js";
import { startingQuests } from "../../../gamedata/quests.js";
import { athenaQuestLogin } from "../../../profiles/athena.js";
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
//
// An ended event's unfinished quests leave the quest log here and in QueryProfile (events/quests.js, Core-Backend #127),
// and one that runs again gives back the quests it took. Past Fortnitemares, unspent Candy becomes Fortnitemares Llamas
// (events/candyllamas.js, #129).
//
// On athena (1.8's Battle Royale quest log), its daily challenges (profiles/athena.js), with the event flags all the
// same in case that quest manager is the one asking.
export function clientQuestLogin({ session, notifications, profileId }) {
  if (profileId === "athena") athenaQuestLogin(session);
  else {
    removeEndedEventQuests(session);
    convertLeftoverCandy(session);
    for (const questId of [...startingQuests(), ...eventQuests()]) grant(session, `Quest:${questId}`, 1);
    for (const questId of eventQuestsToRestore(session.profile("profile0").profile)) grant(session, `Quest:${questId}`, 1);
    refreshDailyQuests(session);
    refreshHeldItems(session);
  }
  if (activeEventFlags().length) notifications.push(eventFlagsNotification());
}

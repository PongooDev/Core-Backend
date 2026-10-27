import { activeEventFlags } from "../../../events/events.js";

// RequestEventFlags (1.7.2's UFortMcpProfileAccount, 1.8's UFortMcpProfileQuest): the primary notification is
// FFortEventFlagsNotification {eventFlags, refreshTime}, which the client keeps as UFortQuestManager::ActiveEventFlags
// and asks for again at refreshTime. The flags turn event content on: in 1.7.2's paks, theaters' and mission alert rows'
// RequiredEventFlag and a skill tree page name only EventFlag.FirstStorm (the storm category mission alerts) and
// EventFlag.Horde (the horde alerts and page), which Core doesn't run (🟡); 1.8 adds EventFlag.Fortnitemares, which
// Core runs on the builds that shipped it (events/events.js). The type string isn't compared.
export const eventFlagsRefreshHours = 24;

export function eventFlagsNotification() {
  const refreshTime = new Date(Date.now() + eventFlagsRefreshHours * 3600000).toISOString();
  return { type: "eventFlags", primary: true, eventFlags: activeEventFlags(), refreshTime };
}

export function requestEventFlags({ notifications }) {
  notifications.push(eventFlagsNotification());
}

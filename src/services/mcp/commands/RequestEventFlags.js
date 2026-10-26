// RequestEventFlags (1.7.2's UFortMcpProfileAccount): the primary notification is FFortEventFlagsNotification
// {eventFlags, refreshTime}, which the client keeps as UFortQuestManager::ActiveEventFlags and asks for again at
// refreshTime. The flags turn event content on: in 1.7.2's paks, theaters' and mission alert rows' RequiredEventFlag
// and a skill tree page name only EventFlag.FirstStorm (the storm category mission alerts) and EventFlag.Horde (the
// horde alerts and page). Core runs no events (🟡), so none is active. The type string isn't compared.
export const eventFlagsRefreshHours = 24;

export function requestEventFlags({ notifications }) {
  const refreshTime = new Date(Date.now() + eventFlagsRefreshHours * 3600000).toISOString();
  notifications.push({ type: "eventFlags", primary: true, eventFlags: [], refreshTime });
}

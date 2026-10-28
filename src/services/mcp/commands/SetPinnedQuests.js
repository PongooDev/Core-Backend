import { questIdOf } from "../../../profiles/quests.js";

// The client sends its whole pinned list (quest item ids) after every pin, unpin or prune. Pins are profile0's
// client_settings; another quest profile's (athena) has none to keep them in.
export function setPinnedQuests({ req, session, profileId }) {
  if (profileId !== "profile0") return;
  const tracker = session.profile("profile0");
  const ids = Array.isArray(req.body?.pinnedQuestIds) ? req.body.pinnedQuestIds : [];
  const pinned = [...new Set(ids.filter((id) => typeof id === "string" && tracker.profile.items[id] && questIdOf(tracker.profile.items[id])))];
  const settings = tracker.profile.stats.attributes.client_settings;
  if (JSON.stringify(settings.pinnedQuestInstances) !== JSON.stringify(pinned)) {
    tracker.setStat("client_settings", { ...settings, pinnedQuestInstances: pinned });
  }
}

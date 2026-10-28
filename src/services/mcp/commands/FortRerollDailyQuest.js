import { rerollAthenaDaily } from "../../../profiles/athena.js";
import { rerollDailyQuest } from "../../../profiles/dailies.js";

export function fortRerollDailyQuest({ req, session, notifications, profileId }) {
  if (profileId === "athena") return rerollAthenaDaily(session, req.body?.questId, notifications);
  rerollDailyQuest(session, req.body?.questId, notifications);
}

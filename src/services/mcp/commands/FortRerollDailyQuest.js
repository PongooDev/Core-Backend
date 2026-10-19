import { rerollDailyQuest } from "../../../profiles/dailies.js";

export function fortRerollDailyQuest({ req, session, notifications }) {
  rerollDailyQuest(session, req.body?.questId, notifications);
}

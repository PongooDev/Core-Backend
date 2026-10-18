import { advanceObjective } from "../../../profiles/progress.js";

export function updateQuestClientObjectives({ req, session }) {
  for (const { statName, count } of req.body?.advance ?? []) {
    if (typeof statName === "string" && Number.isInteger(count) && count > 0) advanceObjective(session, statName, count);
  }
}

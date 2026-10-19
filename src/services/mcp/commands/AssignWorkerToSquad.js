import { refreshAssignments } from "../../../profiles/progress.js";
import { assignToSquad } from "../../../profiles/squads.js";

export function assignWorkerToSquad({ req, session }) {
  assignToSquad(session, String(req.body?.characterId ?? ""), String(req.body?.squadId ?? ""), req.body?.slotIndex ?? 0);
  refreshAssignments(session);
}

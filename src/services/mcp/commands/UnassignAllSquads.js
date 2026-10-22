import { refreshHeldItems } from "../../../profiles/progress.js";
import { characterType, unassign } from "../../../profiles/squads.js";

// Registered in this build but nothing in the client sends it.
export function unassignAllSquads({ req, session }) {
  const tracker = session.profile("profile0");
  const squads = new Set((req.body?.squadIds ?? []).map((id) => String(id).toLowerCase()));
  for (const [itemId, item] of Object.entries(tracker.profile.items)) {
    if (characterType(item) && squads.has((item.attributes.squad_id ?? "").toLowerCase())) unassign(tracker, itemId);
  }
  refreshHeldItems(session);
}

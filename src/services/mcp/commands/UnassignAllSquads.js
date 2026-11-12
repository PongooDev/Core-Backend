import { refreshHeldItems } from "../../../profiles/progress.js";
import { characterType, unassign } from "../../../profiles/squads.js";

// UnassignAllSquads {squadIds}. 1.1 registers it and nothing in its client sends it (no wrapper, to 3.0); from 3.3 at the
// latest the exe has the wrapper and one caller of it (6.02, CL-4461277: 0x14C5C50, called from 0x2FE6DE0).
export function unassignAllSquads({ req, session }) {
  const tracker = session.profile("profile0");
  const squads = new Set((req.body?.squadIds ?? []).map((id) => String(id).toLowerCase()));
  for (const [itemId, item] of Object.entries(tracker.profile.items)) {
    if (characterType(item) && squads.has((item.attributes.squad_id ?? "").toLowerCase())) unassign(tracker, itemId);
  }
  refreshHeldItems(session);
}

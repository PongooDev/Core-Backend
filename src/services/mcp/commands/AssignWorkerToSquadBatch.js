import { McpError } from "../../../errors.js";
import { refreshAssignments } from "../../../profiles/progress.js";
import { assignToSquad } from "../../../profiles/squads.js";

// Registered in this build but nothing in the client sends it.
export function assignWorkerToSquadBatch({ req, session }) {
  const { characterIds = [], squadIds = [], slotIndices = [] } = req.body ?? {};
  if (characterIds.length !== squadIds.length || characterIds.length !== slotIndices.length) {
    throw new McpError("errors.com.epicgames.fortnite.invalid_parameter", "characterIds, squadIds and slotIndices must be the same length");
  }
  characterIds.forEach((characterId, i) => assignToSquad(session, String(characterId), String(squadIds[i]), slotIndices[i]));
  refreshAssignments(session);
}

import { McpError } from "../../../errors.js";
import { getSquad } from "../../../gamedata/homebase.js";

// Registered in this build but nothing in the client sends it.
export function setDefaultHeroSquad({ req, session }) {
  const squad = getSquad(req.body?.defaultHeroSquadId ?? "");
  if (squad?.type !== "CombatSquad") throw new McpError("errors.com.epicgames.fortnite.invalid_parameter", "Not a hero squad");
  const tracker = session.profile("profile0");
  if (tracker.profile.stats.attributes.default_hero_squad_id !== squad.id) tracker.setStat("default_hero_squad_id", squad.id);
}

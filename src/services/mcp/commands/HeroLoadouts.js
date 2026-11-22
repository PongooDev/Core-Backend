// 8.00's Hero Loadout commands (CL-5203069, UFortMcpProfileCampaign, 8.00 SDK FortniteGame_parameters):
// AssignHeroToLoadout {heroId, loadoutId, slotName}, AssignGadgetToLoadout {gadgetId, loadoutId, slotIndex},
// AssignTeamPerkToLoadout {teamPerkId, loadoutId}, SetActiveHeroLoadout {selectedLoadout}, ClearHeroLoadout {loadoutId}
// and SetLoadoutName {loadoutName, loadoutId}. They change the campaign profile's CampaignHeroLoadout items and its
// selected_hero_loadout stat, which the Command screen reads (profiles/heroloadouts.js, Core-Backend #399).
// 7.30 and 7.40 have the commands but not the screen (bEnableHeroLoadoutSystem unset), and no code there sends them:
// they are still told "Unknown command" there, as before.
import { McpError } from "../../../errors.js";
import {
  assignGadgetToLoadout, assignHeroToLoadout, assignTeamPerkToLoadout, clearHeroLoadout, hasHeroLoadouts, setActiveHeroLoadout,
  setLoadoutName
} from "../../../profiles/heroloadouts.js";

const loadoutCommand = (name, change) => ({ req, session, profileId }) => {
  if (!hasHeroLoadouts()) throw new McpError("errors.com.epicgames.fortnite.operation_not_found", `Unknown command ${name}`);
  if (profileId !== "profile0") return;
  change(session.profile("profile0"), req.body ?? {});
};

export const assignHeroToLoadoutCommand = loadoutCommand("AssignHeroToLoadout", assignHeroToLoadout);
export const assignGadgetToLoadoutCommand = loadoutCommand("AssignGadgetToLoadout", assignGadgetToLoadout);
export const assignTeamPerkToLoadoutCommand = loadoutCommand("AssignTeamPerkToLoadout", assignTeamPerkToLoadout);
export const setActiveHeroLoadoutCommand = loadoutCommand("SetActiveHeroLoadout", setActiveHeroLoadout);
export const clearHeroLoadoutCommand = loadoutCommand("ClearHeroLoadout", clearHeroLoadout);
export const setLoadoutNameCommand = loadoutCommand("SetLoadoutName", setLoadoutName);

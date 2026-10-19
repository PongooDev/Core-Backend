import { McpError } from "../../../errors.js";

// Gadget loadouts, FFortSavedModeLoadout {loadoutName, selectedGadgets}: the account's in the profile0 stat
// mode_loadouts, a hero's in its mode_loadouts attribute (UFortHero). A loadout replaces the one of the same name.
function loadout(value) {
  if (!value || typeof value.loadoutName !== "string") return null;
  const gadgets = Array.isArray(value.selectedGadgets) ? value.selectedGadgets.filter((id) => typeof id === "string") : [];
  return { loadoutName: value.loadoutName, selectedGadgets: gadgets };
}

const withLoadout = (list, entry) => [...(Array.isArray(list) ? list : []).filter((other) => other.loadoutName !== entry.loadoutName), entry];

function setHeroLoadout(tracker, heroId, value) {
  const entry = loadout(value);
  if (!entry || !heroId) return;
  const hero = tracker.profile.items[heroId];
  if (!hero || !hero.templateId.toLowerCase().startsWith("hero:")) throw new McpError("errors.com.epicgames.fortnite.item_not_found", `Hero ${heroId} not found`);
  tracker.setItemAttribute(heroId, "mode_loadouts", withLoadout(hero.attributes.mode_loadouts, entry));
}

export function setModeLoadout({ req, session }) {
  const tracker = session.profile("profile0");
  const entry = loadout(req.body?.modeLoadout);
  if (entry) tracker.setStat("mode_loadouts", withLoadout(tracker.profile.stats.attributes.mode_loadouts, entry));
  setHeroLoadout(tracker, req.body?.heroId, req.body?.heroModeLoadout);
}

export function setHeroModeLoadout({ req, session }) {
  setHeroLoadout(session.profile("profile0"), req.body?.heroId, req.body?.modeLoadout);
}

import { McpError } from "../../../errors.js";
import { convertLegacy, hasAlterationData, respec, upgrade } from "../../../profiles/alterations.js";
import { itemChanged } from "../../../profiles/progress.js";
import { pay } from "../../../profiles/upgrades.js";

// 4.2's (CL 4072250) Perk Recombobulator (Core-Backend #270; Update v4.20: "Using the Perk Recombobulator, players can
// choose their schematic perks, as well as upgrade their strength"), three UFortMcpProfileCampaign commands on the
// campaign profile (profile0 here). Their bodies are the functions' parameters (4.2 SDK):
//   ConvertLegacyAlterations {targetItemId}                          UFortAlterationModOptinScreenBase::ConvertItemAlterations
//   RespecAlteration {targetItemId, alterationSlot, alterationId}    replace slot alterationSlot's perk with alterationId
//   UpgradeAlteration {targetItemId, alterationSlot}                 raise that perk a rarity
// The screens wait only for the command's success (ConvertItemAlterations' callback, sub_2A61010, reads bSuccess and
// shows the error otherwise) and read the schematic's new `alterations` from the profile changes: no notification.
// What each allows and costs is profiles/alterations.js. 🟡 Epic's service isn't in the client: the error codes are
// Core's. Builds before 4.2 have no perk tables and refuse them, as they never send them.
function perkData() {
  if (!hasAlterationData()) throw new McpError("errors.com.epicgames.modules.profiles.invalid_command", "This build has no Perk Recombobulator");
}

const slotOf = (value) => (typeof value === "number" ? value : Number.parseInt(value, 10));

export function convertLegacyAlterations({ req, session }) {
  perkData();
  convertLegacy(session.profile("profile0"), req.body?.targetItemId);
}

export function respecAlteration({ req, session }) {
  perkData();
  const tracker = session.profile("profile0");
  const item = respec(tracker, req.body?.targetItemId, slotOf(req.body?.alterationSlot), String(req.body?.alterationId ?? ""),
    (costs) => pay(tracker, costs));
  itemChanged(session, "AlterationRespec", item);
}

export function upgradeAlteration({ req, session }) {
  perkData();
  const tracker = session.profile("profile0");
  const item = upgrade(tracker, req.body?.targetItemId, slotOf(req.body?.alterationSlot), (costs) => pay(tracker, costs));
  itemChanged(session, "AlterationUpgrade", item);
}

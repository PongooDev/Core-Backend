import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { stormShields } from "../../settings/store.js";

// Core's: a Storm Shield's structure limit (Core-Backend #115), the admin panel's Settings. A Storm Shield refuses a
// build piece once its game state's TotalPlayerStructures reaches MaxPlayerStructures (traps count toward it but never
// ask, CoreV2 #128). The game starts that at 3000 (AFortGameStateOutpost's constructor, 1.8 0x5AEAF0) and
// AFortGameModeOutpost::ApplyStructureLimit (0x57C440, from its HandleMatchHasStarted 0x58AF90) replaces it with the
// owner's homebase FortHomebaseSet.Manor_StructureCap when that is above 0. Nothing the backend serves sets that
// number: it is the sum of game data effects with fixed magnitudes (GE_Outpost_Static_Core_1's +3000, which no
// OutpostCore_PvE_0N's StaticGameplayEffectsByLevel names), and it is the owner's account's, the same in every Storm
// Shield. So CoreV2's gameserver sets MaxPlayerStructures itself: when a Storm Shield zone loads it asks here with its
// zone theme's CloudSaveItemDefinition (Outpost:outpostcore_pve_01..04) and keeps the game state at the answer.
//   GET /fortnite/api/game/v2/world/structurelimit?templateId=Outpost:outpostcore_pve_03
//   -> {templateId, stormShield: "cannyValley", maxStructures: 6000}
// maxStructures is the Storm Shield's own limit, else every Storm Shield's, else null: the game keeps its own.
export function structureLimitFor(settings, templateId) {
  const id = String(templateId ?? "").toLowerCase();
  const stormShield = Object.keys(stormShields).find((name) => stormShields[name].toLowerCase() === id) ?? null;
  const maxStructures = (stormShield && settings?.structureLimits?.[stormShield]) ?? settings?.structureLimit ?? null;
  return { stormShield, maxStructures };
}

export function structureLimitRoutes({ tokens, settings }) {
  const router = express.Router();

  router.get("/fortnite/api/game/v2/world/structurelimit", requireAuth(tokens), (req, res) => {
    const templateId = String(req.query.templateId ?? "");
    res.json({ templateId, ...structureLimitFor(settings?.get?.(), templateId) });
  });

  return router;
}

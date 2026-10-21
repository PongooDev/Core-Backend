import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { sendError } from "../../errors.js";
import { zoneOutpost } from "../../gamedata/world.js";
import { log } from "../../log.js";
import { outpostDifficulty } from "../../profiles/outposts.js";
import { openSession } from "../../profiles/session.js";
import { sessionMission } from "../mcp/commands/server.js";
import { findMission, worldInfo } from "../../world/theaters.js";

export function worldRoutes({ tokens, sessions, profiles }) {
  const router = express.Router();

  router.get("/fortnite/api/game/v2/world/info", requireAuth(tokens), (req, res) => {
    res.json(worldInfo());
  });

  // The gameserver's zone lookup (AFortWorldManager RetrievingZoneInformation, sub_6A7E90, FortMcpWorlds.cpp): it posts
  // the zone it is to host, its CurrentZoneInstanceId as FFortZoneInstanceInfo {worldId, theaterId, theaterMissionId,
  // theaterMissionAlertId, zoneThemeClass}, and reads back FFortZoneInstanceDetails (that info plus missionGenerator,
  // zoneDifficultyInfo, missionRewards, zoneModifiers, tileIndex) from a 200-206 reply. Any other status fails the zone.
  // The worldId is echoed: a storm shield posts its Outpost core item's id, other missions "". A non-empty one loads
  // that world record from the owner's user cloud storage (LoadingWorldRecord, sub_591A30) and the game state's
  // CurrentWUID, which the storm shield core is found by, is its id; an empty one makes a brand-new world record. The
  // difficulty it replies with is the one the session's zone starts at (sessions.setZoneDifficulty).
  router.post("/fortnite/api/game/v2/world/validate", requireAuth(tokens), (req, res) => {
    log("World", `validate for session ${req.query.sessionId ?? "(none)"}: ${JSON.stringify(req.body ?? {})}`);
    const mission = findMission(req.body?.theaterMissionId) ?? sessionMission(sessions, String(req.query.sessionId ?? ""));
    if (!mission) {
      log("World", `validate: no mission ${req.body?.theaterMissionId ?? "(none)"} for session ${req.query.sessionId}`);
      return sendError(res, 404, "errors.com.epicgames.fortnite.mission_not_found", "That mission isn't available");
    }
    // A storm shield plays its owner's next defense: the owner is the first account that asked for this session's key.
    let zoneDifficultyInfo = mission.missionDifficultyInfo;
    const outpost = zoneOutpost(mission.zoneTheme);
    const session = sessions.get(String(req.query.sessionId ?? ""));
    const owner = session && [...Object.keys(session.keys ?? {}), ...(session.publicPlayers ?? []), ...(session.privatePlayers ?? [])][0];
    if (outpost && owner) zoneDifficultyInfo = outpostDifficulty(openSession(profiles, owner).profile("profile0").profile, outpost, zoneDifficultyInfo);
    sessions.setZoneDifficulty(String(req.query.sessionId ?? ""), zoneDifficultyInfo.rowName);
    const info = req.body ?? {};
    res.json({
      worldId: String(info.worldId ?? ""),
      theaterId: String(info.theaterId ?? mission.theaterId ?? ""),
      theaterMissionId: String(info.theaterMissionId ?? mission.missionGuid ?? ""),
      theaterMissionAlertId: String(info.theaterMissionAlertId ?? ""),
      zoneThemeClass: String(info.zoneThemeClass ?? mission.zoneTheme ?? ""),
      missionGenerator: mission.missionGenerator,
      zoneDifficultyInfo,
      missionRewards: mission.missionRewards,
      zoneModifiers: mission.missionModifiers,
      tileIndex: mission.tileIndex
    });
  });

  return router;
}

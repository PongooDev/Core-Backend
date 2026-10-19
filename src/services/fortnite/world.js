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

  // The gameserver's zone lookup (FortWorldManager RetrievingZoneInformation, FortMcpWorlds.cpp): it posts the zone
  // it is to host, FFortZoneInstanceInfo {worldId, theaterId, theaterMissionId, ...}, and reads back
  // FFortZoneInstanceDetails. A missionGenerator makes it load that mission; a failure fails the zone.
  router.post("/fortnite/api/game/v2/world/validate", requireAuth(tokens), (req, res) => {
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
    res.json({
      missionGenerator: mission.missionGenerator,
      zoneDifficultyInfo,
      missionRewards: mission.missionRewards,
      zoneModifiers: mission.missionModifiers,
      tileIndex: mission.tileIndex
    });
  });

  return router;
}

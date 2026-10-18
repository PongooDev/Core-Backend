import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";
import { getBuild } from "../../builds/detect.js";
import { buildHasProfile } from "../../builds/data.js";
import { sendError } from "../../errors.js";
import { recordUnknown } from "../../log.js";
import { fullProfile, trackChanges } from "../../profiles/changes.js";
import { clientCommands } from "./commands/index.js";

export function profileRoutes({ tokens, profiles, dataDir }) {
  const router = express.Router();

  router.post("/fortnite/api/game/v2/profile/:accountId/client/:command", requireAuth(tokens), requireOwnAccount, (req, res) => {
    const profileId = String(req.query.profileId ?? "");
    const build = getBuild(req);

    if (!buildHasProfile(build, profileId)) {
      return sendError(res, 400, "errors.com.epicgames.modules.profiles.invalid_profile_id", `Unknown profile ${profileId}`);
    }

    const command = clientCommands[req.params.command];
    if (!command) {
      recordUnknown(dataDir, req, "mcp");
      return sendError(res, 400, "errors.com.epicgames.fortnite.operation_not_found", `Unknown command ${req.params.command}`);
    }

    const profile = profiles.load(req.params.accountId, profileId);
    const baseRevision = profile.rvn;
    const tracker = trackChanges(profile);

    command({ req, profile, tracker, profiles });

    if (tracker.changes.length) {
      profile.rvn += 1;
      profile.commandRevision += 1;
      profiles.save(profile);
    }

    const clientRevision = Number(req.query.rvn ?? -1);
    const profileChanges = clientRevision === baseRevision
      ? tracker.changes
      : [{ changeType: "fullProfileUpdate", profile: fullProfile(profile) }];

    res.json({
      profileRevision: profile.rvn,
      profileId,
      profileChangesBaseRevision: baseRevision,
      profileChanges,
      profileCommandRevision: profile.commandRevision,
      serverTime: new Date().toISOString()
    });
  });

  return router;
}

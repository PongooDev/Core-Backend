import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";
import { requireLoopback } from "../../admin/local.js";
import { sendError } from "../../errors.js";
import { recordUnknown } from "../../log.js";
import { isKnownProfile } from "../../profiles/ids.js";
import { openSession } from "../../profiles/session.js";
import { adminCommands, clientCommands } from "./commands/index.js";

function runCommand(commands, { profiles, dataDir }) {
  return (req, res) => {
    const profileId = String(req.params.profileId ?? req.query.profileId ?? "");

    if (!isKnownProfile(profileId)) {
      recordUnknown(dataDir, req, "profile");
      return sendError(res, 400, "errors.com.epicgames.modules.profiles.invalid_profile_id", `Unknown profile ${profileId}`);
    }

    const command = commands[req.params.command];
    if (!command) {
      recordUnknown(dataDir, req, "mcp");
      return sendError(res, 400, "errors.com.epicgames.fortnite.operation_not_found", `Unknown command ${req.params.command}`);
    }

    const session = openSession(profiles, req.params.accountId);
    const tracker = session.profile(profileId);
    const notifications = [];

    command({ req, profile: tracker.profile, tracker, session, notifications });
    session.commit();

    res.json(session.response(profileId, Number(req.query.rvn ?? -1), notifications));
  };
}

export function profileRoutes(context) {
  const router = express.Router();

  router.post("/fortnite/api/game/v2/profile/:accountId/client/:command",
    requireAuth(context.tokens), requireOwnAccount, runCommand(clientCommands, context));

  // The client's DevSkipTutorial cheat posts here.
  router.post("/fortnite/api/admin/account/:accountId/:profileId/command/:command",
    requireLoopback, requireAuth(context.tokens), requireOwnAccount, runCommand(adminCommands, context));

  return router;
}

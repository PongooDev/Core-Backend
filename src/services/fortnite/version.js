import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { isServerAccountName } from "../../accounts/password.js";
import { allowsBuild, buildName } from "../../builds/allowed.js";
import { currentBuild } from "../../builds/context.js";
import { log } from "../../log.js";

// The client's patch check (UUpdateManager), at start-up with its client token: FOnlineIdentityMcp::GetUserPrivilege
// asks /fortnite/api/versioncheck?version=++Fortnite+Release-Cert-CL-3532353-Windows (every build Core knows, 1.1 to
// 2.1; Epic's later builds ask /fortnite/api/v2/versioncheck/<platform>). It reads "type": NO_UPDATE and NOT_ENABLED
// pass, SOFT_UPDATE and HARD_UPDATE both mean a required patch (Cert 0x37AA680), and the update manager shows "Update
// Required: You have required updates pending." (0x6E7390). So a build the admin panel doesn't allow (Core-Backend
// #164, builds/allowed.js) is told HARD_UPDATE; its login is refused too (services/account/oauth.js). Gameservers are
// exempt, as everywhere.
export function versionRoutes({ tokens, accounts, settings }) {
  const router = express.Router();

  const isServer = (session) => isDedicatedServerToken(session)
    || Boolean(session.accountId && isServerAccountName(accounts?.get?.(session.accountId)?.displayName));

  const versionCheck = (req, res) => {
    const changelist = /^\d+$/.test(currentBuild() ?? "") ? currentBuild() : /CL-(\d+)/.exec(String(req.query.version ?? ""))?.[1];
    const allowedBuilds = settings?.get?.().allowedBuilds ?? null;
    if (isServer(req.session) || allowsBuild(allowedBuilds, changelist)) return res.json({ type: "NO_UPDATE" });
    log("Core", `Told Fortnite ${buildName(changelist)} to update: not an allowed build (admin panel, Settings)`);
    res.json({ type: "HARD_UPDATE" });
  };

  router.get("/fortnite/api/versioncheck", requireAuth(tokens), versionCheck);
  router.get("/fortnite/api/v2/versioncheck/:platform", requireAuth(tokens), versionCheck);

  return router;
}

import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { sendError } from "../../errors.js";

// The links service (OnlineSubsystemMcp.OnlineLinksServiceMcp: ServiceName "links", Namespace fn, Prod's
// links-public-service-live.ol.epicgames.com; 7.00's DefaultEngine.ini), new in 7.00 (CL-4629139) for Creative: its exe
// names /api/`namespace/mnemonic/`mnemonic (QueryLinkByMnemonicUrl, an island code), /api/`namespace/author/`accountid
// (QueryLinksByAccountUrl, a player's published islands) and /api/`namespace/author/`accountid/mnemonic/`mnemonic
// (CreateLinkUrl, publishing one), each under the service's /links (LogOnlineLinks: "Querying links AccountId=%s"). Core
// publishes no island yet (profiles/ids.js keeps the creative profile empty), so no code leads anywhere: a code is
// Epic's "not found", a player has no links, and publishing is refused. 6.31's exe names none of them.
export function linksRoutes({ tokens }) {
  const router = express.Router();
  router.get("/links/api/:namespace/mnemonic/:mnemonic", requireAuth(tokens), (req, res) => {
    sendError(res, 404, "errors.com.epicgames.links.no_active_version", `Sorry, the link ${req.params.mnemonic} could not be found`, [req.params.mnemonic]);
  });
  router.get("/links/api/:namespace/author/:accountId", requireAuth(tokens), (req, res) => res.json([]));
  router.all("/links/api/:namespace/author/:accountId/mnemonic/:mnemonic", requireAuth(tokens), (req, res) => {
    sendError(res, 403, "errors.com.epicgames.links.creation_disabled", "Publishing islands isn't available on this server");
  });
  return router;
}

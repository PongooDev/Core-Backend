import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { sendError } from "../../errors.js";

// The links service (OnlineSubsystemMcp.OnlineLinksServiceMcp: ServiceName "links", Namespace fn, Prod's
// links-public-service-live.ol.epicgames.com; 7.00's DefaultEngine.ini), new in 7.00 (CL-4629139) for Creative: its exe
// names /api/`namespace/mnemonic/`mnemonic (QueryLinkByMnemonicUrl, an island code), /api/`namespace/author/`accountid
// (QueryLinksByAccountUrl, a player's published islands) and /api/`namespace/author/`accountid/mnemonic/`mnemonic
// (CreateLinkUrl, publishing one), each under the service's /links (LogOnlineLinks: "Querying links AccountId=%s"). 7.00
// gave no player's island a code (a player's islands are their creative profile's, profiles/creative.js, visited on its
// owner's server; codes were Epic's featured islands', whose content Core doesn't have), so no code leads anywhere: a
// code is Epic's "not found", a player has no links, and publishing is refused. 6.31's exe names none of them.
export function linksRoutes({ tokens }) {
  const router = express.Router();
  router.get("/links/api/:namespace/mnemonic/:mnemonic", requireAuth(tokens), (req, res) => {
    sendError(res, 404, "errors.com.epicgames.links.no_active_version", `Sorry, the link ${req.params.mnemonic} could not be found`, [req.params.mnemonic]);
  });
  router.get("/links/api/:namespace/author/:accountId", requireAuth(tokens), (req, res) => res.json([]));
  router.all("/links/api/:namespace/author/:accountId/mnemonic/:mnemonic", requireAuth(tokens), (req, res) => {
    sendError(res, 403, "errors.com.epicgames.links.creation_disabled", "Publishing islands isn't available on this server");
  });

  // 7.10's (CL-4667333) island favorites, the featured rift's island code screen's (UFortCreativeIslandLinkScreen: "Get
  // Favorites failed: %s"). Its shipped DefaultGame.ini adds FortMcpUtils' IslandFavoritesUrl="/api/game/v2/creative/favorites"
  // (7.00's has none), on the fortnite service; its exe (IDA 13338) sends:
  // - GET <url>/<accountId>?limit=<n> (0x11CC010, "%s/%s?limit=%d"), read as an object (0x11A98D0: "Error listing island
  //   favorites: %s" otherwise) of {results: [{linkData: the link's object, sortDate}], hasMore} (the serializers 0x11DC6E0,
  //   0x11DC9B0);
  // - PUT <url>/<accountId>/<mnemonic> (0x11AFD90, "%s/%s/%s"), a code made a favorite.
  // No code leads to a link here (above), so a player has no favorites: the list is empty, a code can't be added (the links
  // service's "not found" for it), and taking one off finds nothing to take. Only the account itself, or a game server, asks.
  const favorites = "/fortnite/api/game/v2/creative/favorites/:accountId";
  const own = (req, res) => {
    if (req.session.accountId === req.params.accountId || isDedicatedServerToken(req.session)) return true;
    sendError(res, 403, "errors.com.epicgames.common.missing_permission", `Can't read ${req.params.accountId}'s favorites`);
    return false;
  };
  router.get(favorites, requireAuth(tokens), (req, res) => {
    if (own(req, res)) res.json({ results: [], hasMore: false });
  });
  router.put(`${favorites}/:mnemonic`, requireAuth(tokens), (req, res) => {
    if (!own(req, res)) return;
    sendError(res, 404, "errors.com.epicgames.links.no_active_version", `Sorry, the link ${req.params.mnemonic} could not be found`, [req.params.mnemonic]);
  });
  router.delete(`${favorites}/:mnemonic`, requireAuth(tokens), (req, res) => {
    if (own(req, res)) res.status(204).end();
  });
  return router;
}

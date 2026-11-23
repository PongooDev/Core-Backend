import fs from "node:fs";
import path from "node:path";
import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { sendError } from "../../errors.js";
import { log } from "../../log.js";
import { plotItem } from "../../profiles/creative.js";
import { enabledCreators } from "../../store/creators.js";
import { readIslandSave } from "../dss/dss.js";
import { islandLinkType, linkJson, maxTagline, maxTitle, normalizeMnemonic } from "./islands.js";

// The links service (OnlineSubsystemMcp.OnlineLinksServiceMcp: ServiceName "links", Namespace fn, Prod's
// links-public-service-live.ol.epicgames.com; 7.00's DefaultEngine.ini), new in 7.00 (CL-4629139) for Creative: its exe
// names /api/`namespace/mnemonic/`mnemonic (QueryLinkByMnemonicUrl, an island code), /api/`namespace/author/`accountid
// (QueryLinksByAccountUrl, a player's published islands; CreateLinkUrl, publishing one, a POST) and
// /api/`namespace/author/`accountid/mnemonic/`mnemonic (UpdateLinkUrl, a PUT: "UpdateLink Mnemonic=%s Type=%s"), each
// under the service's /links (LogOnlineLinks: "Querying links AccountId=%s"; 7.10 CL-4667333's defaults, 0x481C60).
// 6.31's exe names none of them.
//
// From 7.10 (PongooDev/CoreV2#488) the links are published islands (services/links/islands.js): a code answers its link,
// an author their active links, and CreateLink publishes an island, which only an enabled Support-A-Creator creator may
// (Epic's errors.com.epicgames.links.creator_name_required, which 7.10's CreateLink answer turns into "no_creator_name",
// 0x4A0390). 7.10's client never creates a link itself: its publish is the server's RPC (PublishMyCurrentCreativePlot),
// whose stripped half Core's gameserver restores, sending CreateLink for the player with the DedicatedServer client.
// The body is Epic's link (linkType, metadata title/tagline/locale/islandType); 🟡 Core's server adds metadata
// _sourcePath, the player's island file on the DSS (islands/personal/<owner>/<plot>.island), whose last save becomes the
// published copy here, as the game's own publish uploaded the island to its public path.

// Who may publish: an enabled creator with an account, their creator code the link's creatorName.
export const publisherOf = (accountId, settingsValue) => enabledCreators(settingsValue).find((creator) => creator.accountId === accountId) ?? null;

const sourcePattern = /^islands\/personal\/([0-9a-f]{32})\/([A-Za-z0-9-]{1,64})\.island$/i;

export function linksRoutes({ tokens, settings, profiles, islandLinks, dataDir }) {
  const router = express.Router();
  const settingsValue = () => settings?.get?.();
  const noLink = (res, mnemonic) => sendError(res, 404, "errors.com.epicgames.links.no_active_version", `Sorry, the link ${mnemonic} could not be found`, [String(mnemonic)]);
  const activeLink = (mnemonic) => {
    const link = islandLinks?.get(mnemonic);
    return link && link.active !== false && fs.existsSync(islandLinks.fileOf(link)) ? link : null;
  };
  const self = (req, res, accountId) => {
    if (req.session.accountId === accountId || isDedicatedServerToken(req.session)) return true;
    sendError(res, 403, "errors.com.epicgames.common.missing_permission", `This token can't act for ${accountId}`);
    return false;
  };

  router.get("/links/api/:namespace/mnemonic/:mnemonic", requireAuth(tokens), (req, res) => {
    const link = activeLink(req.params.mnemonic);
    if (!link) return noLink(res, req.params.mnemonic);
    res.json(linkJson(link));
  });

  router.get("/links/api/:namespace/author/:accountId", requireAuth(tokens), (req, res) => {
    res.json((islandLinks?.byAuthor(req.params.accountId) ?? []).filter((link) => activeLink(link.mnemonic)).map(linkJson));
  });

  // CreateLink: the server's publish of the player's island.
  router.post("/links/api/:namespace/author/:accountId", requireAuth(tokens), (req, res) => {
    const { accountId } = req.params;
    if (!self(req, res, accountId)) return;
    const publisher = publisherOf(accountId, settingsValue());
    if (!publisher) {
      return sendError(res, 403, "errors.com.epicgames.links.creator_name_required", "Publishing an island needs a Support-A-Creator code");
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
    if ((body.linkType ?? islandLinkType) !== islandLinkType) {
      return sendError(res, 400, "errors.com.epicgames.links.invalid_link_type", `Only ${islandLinkType} links can be made`);
    }
    const source = sourcePattern.exec(String(metadata._sourcePath ?? ""));
    const owner = source?.[1]?.toLowerCase();
    const plot = owner === accountId && profiles?.exists?.(owner, "creative") ? plotItem(profiles.load(owner, "creative"), source[2]) : null;
    if (!plot) return sendError(res, 400, "errors.com.epicgames.links.invalid_source", "The island to publish isn't one of the author's");
    const contents = readIslandSave(dataDir, { owner, plotItemId: source[2] });
    if (!contents) return sendError(res, 404, "errors.com.epicgames.links.island_not_saved", "The island has no save to publish yet");
    const title = String(metadata.title ?? "").trim();
    if (title.length < 3 || title.length > maxTitle) {
      return sendError(res, 400, "errors.com.epicgames.validation.validation_failed", `An island's title is 3 to ${maxTitle} characters`);
    }
    const link = islandLinks.publish({
      accountId, creatorName: publisher.code, plotItemId: source[2], islandType: String(metadata.islandType || plot.templateId),
      title, tagline: String(metadata.tagline ?? "").slice(0, maxTagline), locale: String(metadata.locale ?? ""), contents
    });
    res.json(linkJson(link));
  });

  // UpdateLink: the author's (or the server's) new title or tagline for a published island.
  router.put("/links/api/:namespace/author/:accountId/mnemonic/:mnemonic", requireAuth(tokens), (req, res) => {
    const { accountId } = req.params;
    if (!self(req, res, accountId)) return;
    const link = islandLinks?.get(req.params.mnemonic);
    if (!link || link.accountId !== accountId) return noLink(res, req.params.mnemonic);
    const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};
    res.json(linkJson(islandLinks.update(link.mnemonic, { title: metadata.title, tagline: metadata.tagline })));
  });
  router.all("/links/api/:namespace/author/:accountId/mnemonic/:mnemonic", requireAuth(tokens), (req, res) => {
    sendError(res, 405, "errors.com.epicgames.common.method_not_allowed", `${req.method} isn't a links service operation`);
  });

  // 🟡 Core's own: whether the account may publish, which the gameserver asks as a player comes into a Creative match
  // (AFortPlayerControllerAthena::bIsAllowedToPublish, which 7.10's island menu shows Publish Island for, with
  // UFortRuntimeOptions' PublishingEnabledForWhitelistedAccounts, 0x308BA3B; the server code that set it is stripped).
  router.get("/core/api/creative/publishing/:accountId", requireAuth(tokens), (req, res) => {
    if (!self(req, res, req.params.accountId)) return;
    const publisher = publisherOf(req.params.accountId, settingsValue());
    res.json({ accountId: req.params.accountId, allowed: Boolean(publisher), creatorName: publisher?.code ?? null });
  });

  // 🟡 Core's own: the featured codes in rift order (the hotfix's CuratedLinkCodes), which Core's gameserver asks for as
  // it starts. A 7.10 server reads the array as the hub's island spaces begin play (UFortLevelSaveComponent's BeginPlay,
  // 0xF5E610), which on Core's servers is before their hotfix arrives (a headless 7.10 Creative server: the featured
  // spaces' "Attempting to load playset plot for restricted plot" a second before it asked for
  // DefaultRuntimeOptions.ini), so the gameserver sets the array itself (PongooDev/CoreV2#488).
  router.get("/core/api/creative/featured", requireAuth(tokens), (req, res) => {
    res.json({ codes: islandLinks?.activeFeatured?.() ?? [] });
  });

  // 7.10's (CL-4667333) island favorites, the featured rift's island code screen's (UFortCreativeIslandLinkScreen: "Get
  // Favorites failed: %s"). Its shipped DefaultGame.ini adds FortMcpUtils' IslandFavoritesUrl="/api/game/v2/creative/favorites"
  // (7.00's has none), on the fortnite service; its exe (IDA 13338) sends:
  // - GET <url>/<accountId>?limit=<n> (0x11CC010, "%s/%s?limit=%d"), read as an object (0x11A98D0: "Error listing island
  //   favorites: %s" otherwise) of {results: [{linkData: the link's object, sortDate}], hasMore} (the serializers 0x11DC6E0,
  //   0x11DC9B0);
  // - PUT <url>/<accountId>/<mnemonic> (0x11AFD90, "%s/%s/%s"), a code made a favorite.
  // A favorite is a published island's code (#488), kept per account, newest first; one that is no longer published drops
  // out of the list. Only the account itself, or a game server, asks.
  const favorites = "/fortnite/api/game/v2/creative/favorites/:accountId";
  const favoritesFile = (accountId) => path.join(dataDir, "accounts", accountId, "creative", "favorites.json");
  const readFavorites = (accountId) => {
    try {
      const list = JSON.parse(fs.readFileSync(favoritesFile(accountId), "utf8"));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const writeFavorites = (accountId, list) => {
    fs.mkdirSync(path.dirname(favoritesFile(accountId)), { recursive: true });
    fs.writeFileSync(favoritesFile(accountId), JSON.stringify(list.slice(0, 100)));
  };
  const accountIdPattern = /^[0-9a-f]{32}$/i;
  router.get(favorites, requireAuth(tokens), (req, res) => {
    if (!self(req, res, req.params.accountId) || !accountIdPattern.test(req.params.accountId)) return res.headersSent || res.json({ results: [], hasMore: false });
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 100));
    // The week's suggested island leads the list (#488: Epic's code screen featured an island; 7.10's screen lists only
    // what this answer holds, so the suggestion comes as its first entry), then the player's own favorites.
    const week = islandLinks?.suggested?.();
    const entries = readFavorites(req.params.accountId);
    if (week?.suggested) entries.unshift({ mnemonic: week.suggested, sortDate: week.periodStart });
    const seen = new Set();
    const results = entries.filter((entry) => !seen.has(entry.mnemonic) && seen.add(entry.mnemonic))
      .map((entry) => ({ link: activeLink(entry.mnemonic), sortDate: entry.sortDate }))
      .filter((entry) => entry.link).map((entry) => ({ linkData: linkJson(entry.link), sortDate: entry.sortDate }));
    res.json({ results: results.slice(0, limit), hasMore: results.length > limit });
  });
  router.put(`${favorites}/:mnemonic`, requireAuth(tokens), (req, res) => {
    if (!self(req, res, req.params.accountId)) return;
    const link = activeLink(req.params.mnemonic);
    if (!link || !accountIdPattern.test(req.params.accountId)) return noLink(res, req.params.mnemonic);
    const list = readFavorites(req.params.accountId).filter((entry) => entry.mnemonic !== link.mnemonic);
    writeFavorites(req.params.accountId, [{ mnemonic: link.mnemonic, sortDate: new Date().toISOString() }, ...list]);
    log("Creative", `${req.params.accountId} favorited the island ${link.mnemonic}`);
    res.status(204).end();
  });
  router.delete(`${favorites}/:mnemonic`, requireAuth(tokens), (req, res) => {
    if (!self(req, res, req.params.accountId)) return;
    const code = normalizeMnemonic(req.params.mnemonic);
    if (accountIdPattern.test(req.params.accountId)) {
      writeFavorites(req.params.accountId, readFavorites(req.params.accountId).filter((entry) => entry.mnemonic !== code));
    }
    res.status(204).end();
  });
  // 8.20's island history (FortMcpUtils' creative history url, "/api/game/v2/creative/history"): GET <url>/<accountId>?limit=<n>,
  // answered like the favorites ({results: [{linkData, sortDate}], hasMore}), the islands the player played last. Core
  // doesn't record the islands a player joins, so the list is empty (a missing route made the client log an error).
  router.get("/fortnite/api/game/v2/creative/history/:accountId", requireAuth(tokens), (req, res) => {
    if (!self(req, res, req.params.accountId)) return;
    res.json({ results: [], hasMore: false });
  });
  return router;
}

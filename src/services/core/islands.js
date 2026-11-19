import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { sendError } from "../../errors.js";
import { exportIsland, importIsland, IslandTransferError, listIslands, maxIslandFileBytes } from "../dss/transfer.js";
import { notifyProfiles } from "../mcp/profile.js";

// 🟡 Core's own: a player's Creative islands as files (Core-Launcher #21, services/dss/transfer.js), for Core-Launcher's
// Islands page. The launcher signs in as the player (the password grant, as it checks a login before Play) and sends the
// player's token; each route acts only for that token's own account. ?build=<changelist> is the player's game, whose
// island types and build range apply.
// - GET  /core/api/creative/islands?build=           the account's islands and free slots
// - GET  /core/api/creative/islands/:plotItemId/export   one island as a .coreisland file
// - POST /core/api/creative/islands/import?build=    a .coreisland file (the body as is) made a new island of the account
export const islandImportPath = "/core/api/creative/islands/import";

export function coreIslandRoutes(context) {
  const { tokens, accounts } = context;
  const router = express.Router();
  const base = "/core/api/creative/islands";
  router.use(base, requireAuth(tokens));

  // The token's own account, or an answer sent (a client or server token has none).
  const playerOf = (req, res) => {
    const account = req.session.accountId ? accounts.get(req.session.accountId) : null;
    if (!account) {
      sendError(res, 403, "errors.com.epicgames.common.missing_permission", "Sign in as a player to manage your islands");
      return null;
    }
    return account;
  };
  const failed = (res, error) => {
    if (!(error instanceof IslandTransferError)) throw error;
    sendError(res, error.status, error.errorCode, error.message);
  };
  const buildOf = (req) => (typeof req.query.build === "string" ? req.query.build : null);

  router.get(base, (req, res) => {
    const account = playerOf(req, res);
    if (account) res.json(listIslands(context, account, buildOf(req)));
  });

  router.get(`${base}/:plotItemId/export`, (req, res) => {
    const account = playerOf(req, res);
    if (!account) return;
    try {
      const { fileName, contents } = exportIsland(context, account, req.params.plotItemId);
      res.attachment(fileName).type("application/json").send(contents);
    } catch (error) {
      failed(res, error);
    }
  });

  // The body is read whole before any refusal, so the answer never cuts off an upload in progress.
  router.post(islandImportPath, express.raw({ type: () => true, limit: maxIslandFileBytes }), (req, res) => {
    const account = playerOf(req, res);
    if (!account) return;
    try {
      const island = importIsland(context, account, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        { build: buildOf(req), notify: (session) => notifyProfiles(context, session) });
      res.json({ imported: island, ...listIslands(context, account, buildOf(req)) });
    } catch (error) {
      failed(res, error);
    }
  });

  // An upload past the limit (express.raw's 413).
  router.use(base, (error, req, res, next) => {
    if (error?.type === "entity.too.large") {
      return sendError(res, 413, "errors.com.epicgames.creative.island_file_too_large", `An island file can't be more than ${Math.floor(maxIslandFileBytes / 1048576)} MB`);
    }
    next(error);
  });

  return router;
}

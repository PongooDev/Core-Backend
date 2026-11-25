import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { createUnvaultingStore, sanitizeUnvaultedItem, unvaultedItemNow, unvaultingLapNow } from "../../events/unvaulting.js";
import { currentBuild } from "../../builds/context.js";
import { log } from "../../log.js";

// 8.51's Unvaulting's winner (PongooDev/CoreV2#647, events/unvaulting.js), Core's own routes for its gameserver:
//   GET  /fortnite/api/game/v2/unvaulting       -> {item, source, eventAt, after}: what a match starting now has unvaulted
//   POST /fortnite/api/game/v2/unvaulting {item} -> {accepted, item, eventAt}: a match's vote ended (the first of the lap is kept)
// Both take the DedicatedServer client's token, as the gameserver's other reports do. CoreV2's own requests (WinHTTP, user
// agent "Core V2") name no build, so they say it: ?build=<CL> on the GET, build in the POST's body.
const buildOf = (req, value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : currentBuild());
export function unvaultingRoutes(context) {
  const { tokens } = context;
  const store = context.unvaulting ?? createUnvaultingStore(context.dataDir);
  const router = express.Router();
  const auth = requireAuth(tokens);

  router.get("/fortnite/api/game/v2/unvaulting", auth, (req, res) => {
    res.json(unvaultedItemNow(store, new Date(), buildOf(req, req.query?.build)));
  });

  router.post("/fortnite/api/game/v2/unvaulting", auth, (req, res) => {
    if (!isDedicatedServerToken(req.session)) return res.status(403).json({ errorMessage: "Only a game server reports the Unvaulting's vote" });
    const item = sanitizeUnvaultedItem(req.body?.item);
    const lap = unvaultingLapNow(new Date(), buildOf(req, req.body?.build));
    if (!item || !lap) return res.status(400).json({ errorMessage: item ? "The Unvaulting isn't scheduled on this build" : "item must be one of the pillars' names" });
    const accepted = store.report(item, lap.eventAt);
    log("Unvaulting", accepted ? `A match's vote unvaulted ${item} (the event of ${lap.eventAt})` : `A match's vote for ${item} came after the first (${store.get()?.item}), kept that`);
    res.json({ accepted, item: store.get()?.item ?? item, eventAt: lap.eventAt });
  });

  return router;
}

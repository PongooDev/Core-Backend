import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { log } from "../../log.js";

// What a Battle Royale gameserver (1.7.2) asks the backend about its match's players.
// - winners: POST {playlistId, accountIds} when the match is assigned, answered {playlistId, winners: [...]}
//   (OnQueryAthenaWinnersComplete 0x722560, serializer 0x732ED0: "Invalid response" without it). Core keeps no wins
//   yet, so nobody has won before.
// - recordwin: the winners at the end of the match (OnRecordWinnerComplete, 0x3F4950, request 0x72E130); taken and
//   logged only.
export function battleRoyaleRoutes({ tokens }) {
  const router = express.Router();

  router.post("/fortnite/api/game/v2/battleroyale/winners", requireAuth(tokens), (req, res) => {
    res.json({ playlistId: Number(req.body?.playlistId ?? 0), winners: [] });
  });

  router.post("/fortnite/api/game/v2/battleroyale/recordwin", requireAuth(tokens), (req, res) => {
    log("Battle Royale", `Win recorded: ${JSON.stringify(req.body ?? {})}`);
    res.status(204).end();
  });

  return router;
}

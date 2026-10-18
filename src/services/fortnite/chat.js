import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";

export function chatRoutes({ tokens }) {
  const router = express.Router();

  router.post("/fortnite/api/game/v2/chat/:accountId/recommendGeneralChatRooms/:platform", requireAuth(tokens), requireOwnAccount, (req, res) => {
    res.json({ elderChatRooms: [], founderChatRooms: [] });
  });

  return router;
}

import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";

// General chat (UFortOnlineAccount, sub_692330): with bShouldJoinGlobalChat (DefaultGame.ini) the client joins one of
// elderChatRooms as its "Global" tab, and with bShouldJoinFounderChat plus bHasFounderChat one of founderChatRooms
// as "Founder". It tries each room in turn and joins it as an XMPP room on muc.<domain>.
export const generalChatRooms = { global: "Global", founders: "Founders" };
const maxMembersCount = 1000;

export function chatRoutes({ tokens, xmpp }) {
  const router = express.Router();
  const room = (roomName) => ({ roomName, currentMembersCount: xmpp.roomOccupants(roomName), maxMembersCount });

  // Everyone who played this build was a founder (it was paid early access), so everyone gets the founders room too.
  router.post("/fortnite/api/game/v2/chat/:accountId/recommendGeneralChatRooms/:platform", requireAuth(tokens), requireOwnAccount, (req, res) => {
    res.json({
      elderChatRooms: [room(generalChatRooms.global)],
      founderChatRooms: [room(generalChatRooms.founders)],
      bIsElder: false,
      bHasFounderChat: true
    });
  });

  return router;
}

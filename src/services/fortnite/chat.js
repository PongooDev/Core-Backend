import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";

// General chat (UFortOnlineAccount, sub_692330): with bShouldJoinGlobalChat (DefaultGame.ini) the client joins one of
// elderChatRooms as its "Global" tab, and with bShouldJoinFounderChat plus bHasFounderChat one of founderChatRooms
// as "Founder". It tries each room in turn and joins it as an XMPP room on muc.<domain>.
export const generalChatRooms = { global: "Global", founders: "Founders", athena: "GlobalBattleRoyale" };
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

  // 1.7.2 asks per sub game (/recommendGeneralChatRooms/{Campaign|Athena}/{platform}) and reads a new
  // FGeneralChatRecommendations: globalChatRooms (was elderChatRooms) and founderChatRooms, each room with a
  // publicFacingShardName, and the flags bNeedsPaidAccessForGlobalChat, bNeedsPaidAccessForFounderChat,
  // bIsGlobalChatDisabled, bIsFounderChatDisabled and bIsSubGameGlobalChatDisabled. Battle Royale gets a global room of
  // its own (🟡 Core's rooms) and the same Founders room as Save the World: the client asks again for each sub game it
  // enters (sub_7191F0) and its handler (sub_7147B0) treats an empty founderChatRooms with bIsFounderChatDisabled as
  // "founder chat is currently disabled in the backend", which the Founders tab shows as "Currently unavailable."
  // (Core-Backend #62: it only worked once Save the World had joined the Founders room).
  router.post("/fortnite/api/game/v2/chat/:accountId/recommendGeneralChatRooms/:subGame/:platform", requireAuth(tokens), requireOwnAccount, (req, res) => {
    const athena = req.params.subGame.toLowerCase() === "athena";
    const shard = (roomName) => ({ ...room(roomName), publicFacingShardName: "" });
    res.json({
      globalChatRooms: [shard(athena ? generalChatRooms.athena : generalChatRooms.global)],
      founderChatRooms: [shard(generalChatRooms.founders)],
      bNeedsPaidAccessForGlobalChat: false,
      bNeedsPaidAccessForFounderChat: false,
      bIsGlobalChatDisabled: false,
      bIsFounderChatDisabled: false,
      bIsSubGameGlobalChatDisabled: false
    });
  });

  return router;
}

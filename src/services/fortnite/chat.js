import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";

// General chat (UFortOnlineAccount, sub_692330): with bShouldJoinGlobalChat (DefaultGame.ini) the client joins one of
// elderChatRooms as its "Global" tab, and with bShouldJoinFounderChat plus bHasFounderChat one of founderChatRooms
// as "Founder". It tries each room in turn and joins it as an XMPP room on muc.<domain>.
export const generalChatRooms = { global: "Global", founders: "Founders", athena: "GlobalBattleRoyale" };
const maxMembersCount = 1000;

// Core-Backend #198: asking for rooms, the client first leaves its Global tab's room, and asks in the same frame
// (2.5's sub_D1B9D0: sub_D1DF80 sends the leave, then sub_D29410 the request). On the answer it joins the recommended
// room only if that leave has completed: sub_D1D4C0 skips the Global tab while it's still in a room, and the tab's
// join (sub_74E210) refuses "while already in ... a room". Nothing tries again, so an answer handled before the leave's
// result leaves Global on "Joining general chat" for good: switching from Battle Royale's lobby to Save the World
// (GlobalBattleRoyale -> Global) and back. Epic's chat service answered over the internet; here the answer can win.
// So it waits for the leave (which the client sends with the request), then a moment longer for the client to handle
// it, before answering. The Founders room is the same in both sub games and isn't left.
// Core-Backend #225: the leave and the request travel separately (3.1: sub_D2FE90 -> sub_D36AB0 sends the leave with
// sub_D390B0, then the request with sub_D457A0), so the leave can also arrive first. The client still has to handle
// its result, and an answer sent at once could beat it just the same (sub_D388D0 then skips the Global tab silently).
// So the moment after the leave counts from the leave itself, whether it came before or after the request.
const leftRoomsTimeoutMs = 3000;
const afterLeaveMs = 1000;

async function afterGlobalRoomLeft(xmpp, accountId) {
  const globalRooms = [generalChatRooms.global, generalChatRooms.athena];
  await xmpp.leftRooms(accountId, globalRooms, leftRoomsTimeoutMs);
  const wait = xmpp.lastLeftRoom(accountId, globalRooms) + afterLeaveMs - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

export function chatRoutes({ tokens, xmpp }) {
  const router = express.Router();
  const room = (roomName) => ({ roomName, currentMembersCount: xmpp.roomOccupants(roomName), maxMembersCount });

  // Everyone who played this build was a founder (it was paid early access), so everyone gets the founders room too.
  router.post("/fortnite/api/game/v2/chat/:accountId/recommendGeneralChatRooms/:platform", requireAuth(tokens), requireOwnAccount, async (req, res) => {
    await afterGlobalRoomLeft(xmpp, req.params.accountId);
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
  router.post("/fortnite/api/game/v2/chat/:accountId/recommendGeneralChatRooms/:subGame/:platform", requireAuth(tokens), requireOwnAccount, async (req, res) => {
    await afterGlobalRoomLeft(xmpp, req.params.accountId);
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

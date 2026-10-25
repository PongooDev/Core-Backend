import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";

// UFortMcpContext::QueryUnredeemedFriendCodes (sub_6633D0, after every IssueFriendCode round): GET with codeBackend
// "epic" (UFortMcpUtils sub_68C590). The body is a JSON array read as FIssuedFriendCode {CodeId, CodeType, DateCreated}
// (JsonArrayToUStruct sub_671950); each becomes an FFriendCode {Code, CodeType} in CachedFriendCodes, which the party
// bar counts on its invite codes button and ShowFriendCodesSelection lists (friendcodes/store.js).
export function friendCodeRoutes({ tokens, friendCodes }) {
  const router = express.Router();

  router.get("/fortnite/api/game/v2/friendcodes/:accountId/:codeBackend", requireAuth(tokens), requireOwnAccount, (req, res) => {
    res.json(friendCodes.unredeemed(req.params.accountId, req.params.codeBackend));
  });

  return router;
}

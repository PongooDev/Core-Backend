import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";
import { sendError } from "../../errors.js";

const apiObjects = "com.epicgames.friends.core.apiobjects";

// The friends service (OnlineSubsystemMcp's FOnlineFriendsMcp). The client reads accountId, status and direction
// from each friend (ReadFriendsList, sub_378D970); requests and answers are both POST .../friends/{id}/{friend}
// (SendInvite, AcceptInvite), removals and rejections DELETE it. Each change is also pushed to both accounts over XMPP
// as Friend {accountId, status, direction} or FriendRemoval {accountId, reason} (sub_37665A0), so the other player's
// game updates without asking, and the two start or stop seeing each other's presence.
export function friendsRoutes({ accounts, tokens, friends, xmpp }) {
  const router = express.Router();
  const base = "/friends/api/public";

  function findOther(param) {
    return (req, res, next) => {
      req.other = accounts.get(req.params[param]);
      if (!req.other) {
        return sendError(res, 404, "errors.com.epicgames.account.account_not_found",
          `Sorry, we couldn't find an account for ${req.params[param]}`);
      }
      if (req.other.id === req.params.accountId) {
        return sendError(res, 400, "errors.com.epicgames.friends.self_friendship", "You can't do that with yourself");
      }
      next();
    };
  }

  // Tells both accounts how things stand between them now. `before` is a's entry for b before the change.
  function announce(a, b, before) {
    const reason = before?.status === "PENDING" ? "REJECTED" : "DELETED";
    for (const [owner, other] of [[a, b], [b, a]]) {
      const entry = friends.get(owner, other);
      if (entry) xmpp.notify(owner, `${apiObjects}.Friend`, { accountId: other, status: entry.status, direction: entry.direction });
      else xmpp.notify(owner, `${apiObjects}.FriendRemoval`, { accountId: other, reason });
    }
    const wasFriend = before?.status === "ACCEPTED";
    const isFriend = friends.get(a, b)?.status === "ACCEPTED";
    if (wasFriend !== isFriend) xmpp.contactsChanged(a, b, isFriend);
  }

  const friendJson = ({ accountId, status, direction }) => ({ accountId, status, direction });

  router.get(`${base}/friends/:accountId`, requireAuth(tokens), requireOwnAccount, (req, res) => {
    const all = friends.list(req.params.accountId);
    const shown = req.query.includePending === "true" ? all : all.filter((entry) => entry.status === "ACCEPTED");
    res.json(shown.map(friendJson));
  });

  router.delete(`${base}/friends/:accountId`, requireAuth(tokens), requireOwnAccount, (req, res) => {
    for (const { accountId } of friends.list(req.params.accountId)) {
      announce(req.params.accountId, accountId, friends.remove(req.params.accountId, accountId));
    }
    res.status(204).end();
  });

  router.post(`${base}/friends/:accountId/:friendId`, requireAuth(tokens), requireOwnAccount, findOther("friendId"), (req, res) => {
    const me = req.params.accountId;
    const other = req.other.id;
    if (friends.isBlocked(me, other) || friends.isBlocked(other, me)) {
      return sendError(res, 403, "errors.com.epicgames.friends.blocked", "One of you has blocked the other");
    }
    const before = friends.get(me, other);
    if (friends.request(me, other)) announce(me, other, before);
    res.status(204).end();
  });

  router.delete(`${base}/friends/:accountId/:friendId`, requireAuth(tokens), requireOwnAccount, findOther("friendId"), (req, res) => {
    const entry = friends.remove(req.params.accountId, req.other.id);
    if (!entry) return sendError(res, 404, "errors.com.epicgames.friends.friendship_not_found", "You aren't friends");
    announce(req.params.accountId, req.other.id, entry);
    res.status(204).end();
  });

  router.get(`${base}/blocklist/:accountId`, requireAuth(tokens), requireOwnAccount, (req, res) => {
    res.json({ blockedUsers: friends.blocked(req.params.accountId) });
  });

  router.post(`${base}/blocklist/:accountId/:blockId`, requireAuth(tokens), requireOwnAccount, findOther("blockId"), (req, res) => {
    const entry = friends.block(req.params.accountId, req.other.id);
    xmpp.notify(req.params.accountId, `${apiObjects}.BlockListEntryAdded`, { accountId: req.other.id });
    if (entry) announce(req.params.accountId, req.other.id, entry);
    res.status(204).end();
  });

  router.delete(`${base}/blocklist/:accountId/:blockId`, requireAuth(tokens), requireOwnAccount, findOther("blockId"), (req, res) => {
    if (friends.unblock(req.params.accountId, req.other.id)) {
      xmpp.notify(req.params.accountId, `${apiObjects}.BlockListEntryRemoved`, { accountId: req.other.id });
    }
    res.status(204).end();
  });

  router.get(`${base}/list/:namespace/:accountId/recentPlayers`, requireAuth(tokens), requireOwnAccount, (req, res) => {
    res.json([]);
  });

  return router;
}

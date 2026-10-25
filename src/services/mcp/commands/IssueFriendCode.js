import { issueFriendCode as issue } from "../../../profiles/friendcodes.js";

// IssueFriendCode {codeTokenType}: one of the player's code tokens becomes a friend code (profiles/friendcodes.js).
export function issueFriendCode({ req, session, notifications, context }) {
  notifications.push(issue(session, context.friendCodes, req.body?.codeTokenType));
}

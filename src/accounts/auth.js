import { sendError } from "../errors.js";

export function requireAuth(tokens) {
  return (req, res, next) => {
    const [scheme, token] = (req.get("authorization") ?? "").split(" ");
    const session = scheme?.toLowerCase() === "bearer" ? tokens.find(token) : null;
    if (!session) {
      return sendError(res, 401, "errors.com.epicgames.common.oauth.invalid_token", "Invalid or expired access token");
    }
    req.session = session;
    next();
  };
}

export function requireOwnAccount(req, res, next) {
  if (req.session.accountId !== req.params.accountId) {
    return sendError(res, 403, "errors.com.epicgames.common.missing_permission",
      "This token cannot act for that account");
  }
  next();
}

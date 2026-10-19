import { sendError } from "../errors.js";
import { dedicatedServerClient, isDedicatedServerToken } from "./clients.js";

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

// Profile commands a gameserver sends for its players: only with a DedicatedServer client token (Epic's MCP likewise
// served dedicated_server commands to its server client), so a player's own token can't award itself mission results.
export function requireDedicatedServer(req, res, next) {
  if (!isDedicatedServerToken(req.session)) {
    return sendError(res, 403, "errors.com.epicgames.common.missing_permission",
      `dedicated_server commands need a client_credentials token of the DedicatedServer client ${dedicatedServerClient.id}`);
  }
  next();
}

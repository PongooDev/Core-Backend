import { sendError } from "../errors.js";

const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const localHostnames = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function requireLoopback(req, res, next) {
  if (!loopbackAddresses.has(req.socket.remoteAddress)) {
    return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "Admin is only available on this machine");
  }
  next();
}

// The panel also checks Host (against DNS rebinding) and only accepts JSON writes, which another site can't send
// without a CORS preflight that this server never approves.
export function requirePanelRequest(req, res, next) {
  if (!localHostnames.has(req.hostname?.toLowerCase())) {
    return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "Open the admin panel through localhost");
  }
  if (req.method !== "GET" && req.method !== "DELETE" && !req.is("application/json")) {
    return sendError(res, 415, "errors.com.epicgames.common.unsupported_media_type", "Admin writes must be JSON");
  }
  next();
}

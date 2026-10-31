import { sendError } from "../errors.js";
import { isValidIp } from "./auth.js";

export const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
export const localHostnames = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

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
  const hasSafeHeader = req.is("application/json") || Boolean(req.headers?.authorization);
  if (req.method !== "GET" && req.method !== "DELETE" && !hasSafeHeader) {
    return sendError(res, 415, "errors.com.epicgames.common.unsupported_media_type", "Admin writes must be JSON");
  }
  next();
}

// Dynamic network gate that allows loopback OR any authorized remote device configured in admin credentials.
export function createAdminNetworkGate(adminAuth) {
  return function requireAdminNetwork(req, res, next) {
    const remoteIp = req.socket.remoteAddress;
    if (loopbackAddresses.has(remoteIp)) {
      return next();
    }
    if (adminAuth && typeof adminAuth.isIpPermitted === "function" && adminAuth.isIpPermitted(remoteIp)) {
      return next();
    }
    return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "Admin is only available on this machine or authorized admin devices");
  };
}

// Dynamic panel gate allowing local hostnames or authorized remote clients accessing the admin console,
// while strictly guarding against DNS rebinding attacks from non-local hostnames.
export function createPanelRequestGate(adminAuth) {
  return function requirePanelRequestGate(req, res, next) {
    const host = req.hostname?.toLowerCase();
    const isLocalHost = localHostnames.has(host);
    const remoteIp = req.socket.remoteAddress;
    const isLoopback = loopbackAddresses.has(remoteIp);

    if (isLoopback) {
      if (!isLocalHost) {
        return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "Open the admin panel through localhost");
      }
    } else {
      const isIpHost = isValidIp(host);
      const isRemotePermitted = adminAuth && typeof adminAuth.isIpPermitted === "function" && adminAuth.isIpPermitted(remoteIp);
      if ((!isLocalHost && !isIpHost) || !isRemotePermitted) {
        return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "Open the admin panel through localhost or an authorized device");
      }
    }

    const hasSafeHeader = req.is("application/json") || Boolean(req.headers?.authorization);
    if (req.method !== "GET" && req.method !== "DELETE" && !hasSafeHeader) {
      return sendError(res, 415, "errors.com.epicgames.common.unsupported_media_type", "Admin writes must be JSON");
    }
    next();
  };
}

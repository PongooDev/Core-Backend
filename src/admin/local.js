import { sendError } from "../errors.js";
import { extractAdminToken, clearSessionCookie, isValidIp } from "./auth.js";

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
  if (!writeIsSafe(req)) {
    return sendError(res, 415, "errors.com.epicgames.common.unsupported_media_type", "Admin writes must be JSON");
  }
  next();
}

// A JSON body or an Authorization header: neither can come from another site without a CORS preflight.
function writeIsSafe(req) {
  return req.method === "GET" || req.method === "HEAD" || req.method === "DELETE" || Boolean(req.is("application/json"))
    || Boolean(req.headers?.authorization);
}

// A browser names the page a write came from; it must be the panel itself (same host and port), not another site.
function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin || req.method === "GET" || req.method === "HEAD") return true;
  try {
    return new URL(origin).host.toLowerCase() === String(req.headers.host ?? "").toLowerCase();
  } catch {
    return false;
  }
}

// What another device may reach before signing in: the panel page (to show its login screen) and the sign-in API.
const signInPaths = new Set(["GET /admin", "POST /admin/api/auth/login", "GET /admin/api/auth/me", "POST /admin/api/auth/logout"]);

function requestKey(req) {
  const method = req.method === "HEAD" ? "GET" : req.method;
  const path = `${req.baseUrl}${req.path}`.toLowerCase().replace(/\/+$/, "");
  return `${method} ${path || "/"}`;
}

// The admin's one gate (Core-Backend #134), in front of every /admin route. This PC is always the admin, as before
// the PR: no sign-in, Host must be a local name. Another device gets in only when the owner has switched remote admin
// on (settings remoteAdmin, off by default) with at least one admin credential, from an address a credential allows,
// and then only with a signed-in session for everything but the sign-in itself.
export function createAdminGate({ adminAuth, settings }) {
  return function requireAdmin(req, res, next) {
    const remoteIp = req.socket.remoteAddress;
    const local = loopbackAddresses.has(remoteIp);
    const host = req.hostname?.toLowerCase() ?? "";

    if (local) {
      if (!localHostnames.has(host)) {
        return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "Open the admin panel through localhost");
      }
    } else {
      const remoteOn = settings?.get?.().remoteAdmin === true && Boolean(adminAuth?.hasUsers());
      const ipHost = isValidIp(host.replace(/^\[|\]$/g, ""));
      if (!remoteOn || !adminAuth.isIpPermitted(remoteIp) || (!localHostnames.has(host) && !ipHost)) {
        return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "Admin is only available on this machine");
      }
    }

    if (!sameOrigin(req)) {
      return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "Admin writes must come from the admin panel");
    }
    if (!writeIsSafe(req)) {
      return sendError(res, 415, "errors.com.epicgames.common.unsupported_media_type", "Admin writes must be JSON");
    }

    const token = extractAdminToken(req);
    const validated = token && adminAuth ? adminAuth.validateSession(token, remoteIp) : null;
    if (validated) {
      req.adminUser = validated.user;
      req.adminSession = validated.session;
    } else if (token) {
      // Sessions live in memory: after a restart the browser's cookie is stale. Drop it.
      res.append("Set-Cookie", clearSessionCookie());
    }

    if (local) {
      req.adminUser ??= { id: "local", username: "Local", isLocal: true };
      req.adminLocal = true;
      return next();
    }
    if (validated || signInPaths.has(requestKey(req))) return next();
    return sendError(res, 401, "errors.com.epicgames.common.authentication.authentication_failed",
      token ? "Admin session expired or revoked" : "Admin authentication required");
  };
}

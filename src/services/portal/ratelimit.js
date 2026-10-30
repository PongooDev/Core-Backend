import { isLoopbackAddress } from "../../accounts/password.js";
import { sendError } from "../../errors.js";

// The address a limit counts: the connection's own. X-Forwarded-For is believed only from this PC (a tunnel or proxy
// running here); from anyone else it is theirs to write, and "127.0.0.1" in it would exempt them from every limit
// (Core-Backend #126 review).
export function getClientIp(req) {
  const peer = req.socket?.remoteAddress || req.ip || "";
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && isLoopbackAddress(peer)) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return peer;
}

/**
 * Creates an in-memory sliding window rate limiter for Express routes.
 * Loopback/localhost addresses are completely exempt from rate limiting.
 */
export function createRateLimiter({
  windowMs = 60 * 1000,
  max = 30,
  message = "Too many requests from this IP address. Please wait a few minutes before trying again.",
  errorCode = "errors.com.epicgames.common.throttled"
} = {}) {
  const store = new Map();

  // Periodic sweep of expired buckets every 5 minutes (unref so it doesn't prevent Node exit)
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of store.entries()) {
      if (now >= entry.resetAt) {
        store.delete(ip);
      }
    }
  }, 5 * 60 * 1000);
  timer.unref?.();

  return function rateLimitMiddleware(req, res, next) {
    const ip = getClientIp(req);
    if (isLoopbackAddress(ip)) {
      return next();
    }

    const now = Date.now();
    let record = store.get(ip);
    if (!record || now >= record.resetAt) {
      record = { count: 1, resetAt: now + windowMs };
      store.set(ip, record);
      return next();
    }

    record.count += 1;
    if (record.count > max) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      return sendError(res, 429, errorCode, message);
    }

    next();
  };
}

/**
 * In-memory failed attempt tracker for authentication routes.
 * Loops back addresses are exempt.
 */
export function createFailureTracker({ windowMs = 5 * 60 * 1000, maxFailures = 10 } = {}) {
  const store = new Map();

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of store.entries()) {
      if (now >= entry.resetAt) {
        store.delete(ip);
      }
    }
  }, 5 * 60 * 1000);
  timer.unref?.();

  return {
    isBlocked(req) {
      const ip = getClientIp(req);
      if (isLoopbackAddress(ip)) return false;
      const record = store.get(ip);
      if (!record) return false;
      if (Date.now() >= record.resetAt) {
        store.delete(ip);
        return false;
      }
      return record.failures >= maxFailures;
    },

    recordFailure(req) {
      const ip = getClientIp(req);
      if (isLoopbackAddress(ip)) return;
      const now = Date.now();
      let record = store.get(ip);
      if (!record || now >= record.resetAt) {
        record = { failures: 1, resetAt: now + windowMs };
        store.set(ip, record);
      } else {
        record.failures += 1;
      }
    },

    clear(req) {
      const ip = getClientIp(req);
      store.delete(ip);
    }
  };
}

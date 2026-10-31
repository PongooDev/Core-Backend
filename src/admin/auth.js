import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";
import { hashPassword, isLoopbackAddress, validatePassword, validateUsername, verifyPassword } from "../accounts/password.js";
import { log } from "../log.js";

export const ADMIN_COOKIE_NAME = "core_admin_session";
export const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_FAILED_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// Pre-computed dummy salt & hash so unknown usernames incur the exact same scrypt cost,
// neutralizing timing-based username enumeration.
const DUMMY_SALT = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const DUMMY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function normalizeIp(ip) {
  if (!ip || typeof ip !== "string") return "";
  let trimmed = ip.trim().toLowerCase();
  if (trimmed.startsWith("::ffff:") && net.isIPv4(trimmed.slice(7))) trimmed = trimmed.slice(7);
  if (trimmed === "::1" || trimmed === "localhost") return "127.0.0.1";
  // One spelling per IPv6 address (fe80:0:0::1 and FE80::1 are the same device), so a binding matches however it was typed.
  if (net.isIPv6(trimmed)) {
    try {
      return new URL(`http://[${trimmed}]/`).hostname.slice(1, -1);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export function isValidIp(ip) {
  if (!ip || typeof ip !== "string") return false;
  const normalized = normalizeIp(ip);
  return net.isIP(normalized) !== 0;
}

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== "string") return cookies;
  for (const pair of cookieHeader.split(";")) {
    const idx = pair.indexOf("=");
    if (idx !== -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

export function extractAdminToken(req) {
  if (!req) return null;
  const authHeader = req.headers?.authorization;
  if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookies = parseCookies(req.headers?.cookie);
  if (cookies[ADMIN_COOKIE_NAME]) {
    return cookies[ADMIN_COOKIE_NAME];
  }
  return null;
}

export function createSessionCookie(token, maxAgeSeconds = 86400) {
  return `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return `${ADMIN_COOKIE_NAME}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function createAdminAuthStore(dataDir) {
  const file = dataDir ? path.join(dataDir, "admin-users.json") : null;
  let cachedUsers = null;

  // In-memory rate limiting map: key -> { count, resetAt, lockedUntil }
  const rateLimits = new Map();

  // In-memory sessions: token -> { token, userId, username, allowedIp, loginIp, createdAt, expiresAt }
  const sessions = new Map();

  function loadUsers() {
    if (cachedUsers !== null) return cachedUsers;
    if (file && fs.existsSync(file)) {
      try {
        const data = readJson(file);
        if (data && Array.isArray(data.users)) {
          cachedUsers = data.users;
          return cachedUsers;
        }
      } catch {
        // Fallback to empty list on corrupt file
      }
    }
    cachedUsers = [];
    return cachedUsers;
  }

  function saveUsers() {
    if (file && cachedUsers !== null) {
      writeJson(file, { users: cachedUsers });
    }
  }

  function safeUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      allowedIp: user.allowedIp ?? null,
      created: user.created,
      lastLogin: user.lastLogin ?? null,
      lastIp: user.lastIp ?? null
    };
  }

  function checkRateLimit(clientIp, username) {
    const now = Date.now();
    const normIp = normalizeIp(clientIp);
    const userKey = username ? username.trim().toLowerCase() : "";
    const keys = [normIp, `${normIp}:${userKey}`];

    for (const key of keys) {
      if (!key) continue;
      const record = rateLimits.get(key);
      if (record && record.lockedUntil && record.lockedUntil > now) {
        const retryAfter = Math.ceil((record.lockedUntil - now) / 1000);
        return { locked: true, retryAfter };
      }
    }
    return { locked: false, retryAfter: 0 };
  }

  function recordFailedAttempt(clientIp, username) {
    const now = Date.now();
    const normIp = normalizeIp(clientIp);
    const userKey = username ? username.trim().toLowerCase() : "";
    const keys = [normIp, `${normIp}:${userKey}`];
    if (rateLimits.size > 1000) sweepRateLimits(now);

    for (const key of keys) {
      if (!key) continue;
      let record = rateLimits.get(key);
      if (!record || record.resetAt <= now) {
        record = { count: 1, resetAt: now + ATTEMPT_WINDOW_MS, lockedUntil: null };
      } else {
        record.count += 1;
      }
      if (record.count >= MAX_FAILED_ATTEMPTS) {
        record.lockedUntil = now + LOCKOUT_DURATION_MS;
      }
      rateLimits.set(key, record);
    }
  }

  // Forget finished windows and lockouts, so failed logins from many addresses can't grow the map without end.
  function sweepRateLimits(now) {
    for (const [key, record] of rateLimits.entries()) {
      if (record.resetAt <= now && !(record.lockedUntil > now)) rateLimits.delete(key);
    }
  }

  function recordSuccessfulLogin(clientIp, username) {
    const normIp = normalizeIp(clientIp);
    const userKey = username ? username.trim().toLowerCase() : "";
    rateLimits.delete(normIp);
    if (userKey) {
      rateLimits.delete(`${normIp}:${userKey}`);
    }
  }

  function cleanupSessions() {
    const now = Date.now();
    for (const [token, sess] of sessions.entries()) {
      if (sess.expiresAt <= now) {
        sessions.delete(token);
      }
    }
  }

  return {
    hasUsers() {
      return loadUsers().length > 0;
    },

    listUsers() {
      return loadUsers().map(safeUser);
    },

    getUserById(id) {
      return loadUsers().find((u) => u.id === id) ?? null;
    },

    getUserByUsername(username) {
      if (typeof username !== "string") return null;
      const target = username.trim().toLowerCase();
      return loadUsers().find((u) => u.username.toLowerCase() === target) ?? null;
    },

    async addUser({ username, password, allowedIp = null }) {
      const uErr = validateUsername(username);
      if (uErr) throw new Error(uErr);

      const trimmedName = username.trim();
      const existing = this.getUserByUsername(trimmedName);
      if (existing) throw new Error("An admin account with that username already exists");

      const pErr = validatePassword(password);
      if (pErr) throw new Error(pErr);

      let cleanIp = null;
      if (allowedIp && typeof allowedIp === "string" && allowedIp.trim()) {
        cleanIp = normalizeIp(allowedIp.trim());
        if (!isValidIp(cleanIp)) throw new Error("Invalid IP address format");
      }

      const { salt, hash } = await hashPassword(password);
      const newUser = {
        id: crypto.randomUUID(),
        username: trimmedName,
        salt,
        hash,
        allowedIp: cleanIp,
        created: new Date().toISOString(),
        lastLogin: null,
        lastIp: null
      };

      const users = loadUsers();
      users.push(newUser);
      saveUsers();
      log("AdminAuth", `Created admin credential for '${trimmedName}' (IP restriction: ${cleanIp || "none"})`);
      return safeUser(newUser);
    },

    async updatePassword(id, newPassword) {
      const users = loadUsers();
      const user = users.find((u) => u.id === id);
      if (!user) throw new Error("Admin user not found");

      const pErr = validatePassword(newPassword);
      if (pErr) throw new Error(pErr);

      const { salt, hash } = await hashPassword(newPassword);
      user.salt = salt;
      user.hash = hash;
      saveUsers();

      // Revoke all active sessions for this user on password change
      this.revokeUserSessions(id);
      log("AdminAuth", `Password changed and active sessions revoked for '${user.username}'`);
      return { success: true };
    },

    updateAllowedIp(id, allowedIp) {
      const users = loadUsers();
      const user = users.find((u) => u.id === id);
      if (!user) throw new Error("Admin user not found");

      let cleanIp = null;
      if (allowedIp && typeof allowedIp === "string" && allowedIp.trim()) {
        cleanIp = normalizeIp(allowedIp.trim());
        if (!isValidIp(cleanIp)) throw new Error("Invalid IP address format");
      }

      user.allowedIp = cleanIp;
      saveUsers();
      // Revoke sessions if they no longer match the new IP
      for (const [token, sess] of sessions.entries()) {
        if (sess.userId === id && cleanIp && normalizeIp(sess.loginIp) !== cleanIp) {
          sessions.delete(token);
        }
      }
      log("AdminAuth", `Updated IP restriction for '${user.username}' to ${cleanIp || "none"}`);
      return safeUser(user);
    },

    deleteUser(id) {
      const users = loadUsers();
      const index = users.findIndex((u) => u.id === id);
      if (index === -1) throw new Error("Admin user not found");

      if (users.length <= 1) {
        throw new Error("Cannot delete the only remaining admin credential");
      }

      const deleted = users.splice(index, 1)[0];
      saveUsers();
      this.revokeUserSessions(id);
      log("AdminAuth", `Deleted admin credential '${deleted.username}'`);
      return { success: true, deleted: safeUser(deleted) };
    },

    async verifyCredentials(username, password, clientIp) {
      if (typeof username !== "string" || typeof password !== "string") {
        return { success: false, error: "Invalid username or password" };
      }
      const rateCheck = checkRateLimit(clientIp, username);
      if (rateCheck.locked) {
        log("AdminAuth", `Rate limit lockout for attempt from ${normalizeIp(clientIp)}`);
        return {
          success: false,
          error: `Too many failed attempts. Please wait ${rateCheck.retryAfter} seconds before trying again.`,
          lockedOut: true,
          retryAfter: rateCheck.retryAfter
        };
      }

      const user = this.getUserByUsername(username);

      if (!user) {
        // Perform dummy scrypt calculation to resist timing attack
        await verifyPassword(password, { salt: DUMMY_SALT, hash: DUMMY_HASH });
        recordFailedAttempt(clientIp, username);
        log("AdminAuth", `Failed login attempt: unknown username from ${normalizeIp(clientIp)}`);
        return { success: false, error: "Invalid username or password" };
      }

      const validPassword = await verifyPassword(password, user);
      if (!validPassword) {
        recordFailedAttempt(clientIp, username);
        log("AdminAuth", `Failed login attempt: incorrect password for '${user.username}' from ${normalizeIp(clientIp)}`);
        return { success: false, error: "Invalid username or password" };
      }

      // Check per-credential IP restriction
      if (user.allowedIp) {
        const normClient = normalizeIp(clientIp);
        const normAllowed = normalizeIp(user.allowedIp);
        if (normClient !== normAllowed) {
          recordFailedAttempt(clientIp, username);
          log("AdminAuth", `Failed login attempt: IP restriction mismatch for '${user.username}' (expected: ${normAllowed}, got: ${normClient})`);
          return {
            success: false,
            error: "Access denied from this IP address for this credential",
            ipMismatch: true
          };
        }
      }

      // Login successful!
      recordSuccessfulLogin(clientIp, username);
      user.lastLogin = new Date().toISOString();
      user.lastIp = normalizeIp(clientIp);
      saveUsers();
      log("AdminAuth", `Successful login for '${user.username}' from ${normalizeIp(clientIp)}`);

      return { success: true, user: safeUser(user) };
    },

    issueSession(user, clientIp) {
      cleanupSessions();
      const token = crypto.randomBytes(32).toString("hex");
      const now = Date.now();
      const session = {
        token,
        userId: user.id,
        username: user.username,
        allowedIp: user.allowedIp ?? null,
        loginIp: normalizeIp(clientIp),
        createdAt: now,
        expiresAt: now + SESSION_DURATION_MS
      };
      sessions.set(token, session);
      return { token, session, cookie: createSessionCookie(token) };
    },

    validateSession(token, clientIp) {
      if (!token || typeof token !== "string") return null;
      cleanupSessions();
      const session = sessions.get(token);
      if (!session) return null;

      if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return null;
      }

      const user = this.getUserById(session.userId);
      if (!user) {
        sessions.delete(token);
        return null;
      }

      // Strict per-request IP validation if credential has IP binding
      if (user.allowedIp) {
        const normClient = normalizeIp(clientIp);
        const normAllowed = normalizeIp(user.allowedIp);
        if (normClient !== normAllowed) {
          log("AdminAuth", `Rejected session for '${user.username}': request IP ${normClient} does not match allowed IP ${normAllowed}`);
          return null;
        }
      }

      return { session, user: safeUser(user) };
    },

    revokeSession(token) {
      if (token && sessions.has(token)) {
        sessions.delete(token);
        return true;
      }
      return false;
    },

    revokeUserSessions(userId) {
      let count = 0;
      for (const [token, sess] of sessions.entries()) {
        if (sess.userId === userId) {
          sessions.delete(token);
          count++;
        }
      }
      return count;
    },

    // Whether some credential may sign in from this address. Only consulted once remote admin is switched on (the
    // remoteAdmin setting, local.js createAdminGate): a credential alone never opens the admin to other devices.
    isIpPermitted(clientIp) {
      const normClient = normalizeIp(clientIp);
      if (!normClient) return false;
      if (isLoopbackAddress(normClient) || normClient === "127.0.0.1") return true;

      const users = loadUsers();
      if (users.length === 0) return false;

      // If any user has no IP restriction (allowed from any IP), connection is permitted
      if (users.some((u) => !u.allowedIp)) return true;

      // If any user's allowedIp matches clientIp, connection is permitted
      return users.some((u) => normalizeIp(u.allowedIp) === normClient);
    },

    // For test resets or inspection
    _resetRateLimits() {
      rateLimits.clear();
    },
    _sessions: sessions
  };
}

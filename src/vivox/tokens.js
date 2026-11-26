import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";

// Vivox access tokens, in Vivox's documented format, signed with a key only this backend (and the Core gameservers it
// hands it to, D:\CoreWork\vivox\contract.md) knows. Fortnite's Vivox plugin (FVivox, LogVivoxVoiceChat; 7.00's
// SDK is vivoxsdk_x64.dll 4.9.0002.30406) never reads a token: it passes it to the SDK, which sends it to the account web
// API (viv_signin.php, vivox/web.js) and the SIP server (vivox/sip-server.js), both Core's here.
//
//   token = "e30." + base64url(payload JSON) + "." + base64url(HMAC-SHA256(key, "e30." + base64url(payload JSON)))
//
// "e30" is base64url("{}"), the empty header. Base64url has no "=" padding. The key is the UTF-8 bytes of the string kept
// in <data>/vivox.json. The payload:
//   iss  the issuer (this backend's, "core" by default)
//   exp  expiry, Unix seconds
//   vxa  the action: "login" or "join" (Vivox also has join_muted, kick, mute; Fortnite asks for login and join only)
//   vxi  a number unique to the token
//   f    the user's SIP URI: "sip:" + the Vivox account name + "@" + domain. Fortnite's account name is ".<accountId>."
//        (the server's L".%s." at 7.00 0xEE07B2, the frontend's at 0x13EE907)
//   t    for join, the channel's SIP URI, by FVivox's own rule (7.00 0x999620): a name that starts with "sip:" as it is,
//        else "sip:" + name + "@" + domain
//
// The domain is the [Vivox] Domain the hotfix gives 5.10+ clients (services/fortnite/cloudstorage.js): a name that never
// resolves (RFC 2606 .invalid), as every SIP request goes to the emulator's address (the prelogin's DefaultSIPProxy), not
// to the domain. vivox.json can change any of the three.

export const defaultIssuer = "core";
export const defaultDomain = "core.vivox.invalid";
export const tokenLifetimeSeconds = 300;
export const clockSkewSeconds = 60;
const emptyHeader = "e30";
export const tokenPattern = /e30\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

const hmac = (key, text) => crypto.createHmac("sha256", Buffer.from(String(key), "utf8")).update(text).digest();

export function signToken(key, payload) {
  const signed = `${emptyHeader}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  return `${signed}.${hmac(key, signed).toString("base64url")}`;
}

// The payload of a token, unverified (for the logs), or null when it isn't one.
export function decodeToken(token) {
  const parts = String(token ?? "").trim().split(".");
  if (parts.length !== 3 || parts[0] !== emptyHeader) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

// A token for the logs: its payload, with the signature cut short so the line can't be used to sign in.
export function describeToken(token) {
  const text = String(token ?? "");
  const payload = decodeToken(text);
  const signature = text.split(".")[2] ?? "";
  return payload ? `${text.split(".").slice(0, 2).join(".")}.${signature.slice(0, 6)}... ${JSON.stringify(payload)}` : `(not a Vivox token: ${text.slice(0, 40)})`;
}

// The user part of a SIP URI or a bare name, without the dots Vivox puts around it: "sip:.abc.@d" -> "abc", ".abc." ->
// "abc". The SDK's account URI, the signin's userid and the token's f are compared this way, whatever form each takes.
export function userOf(uriOrName) {
  let text = String(uriOrName ?? "").trim().replace(/^<|>$/g, "");
  text = text.replace(/^sips?:/i, "").split(";")[0];
  const at = text.lastIndexOf("@");
  if (at >= 0) text = text.slice(0, at);
  return text.replace(/^\.+|\.+$/g, "");
}

// The Vivox account name Fortnite logs in as, ".<accountId>.", from either form.
export const accountName = (playerOrAccountId) => `.${userOf(playerOrAccountId)}.`;
export const accountUri = (player, domain) => `sip:${accountName(player)}@${domain}`;
export const channelUri = (channel, domain) => (/^sip:/i.test(String(channel)) ? String(channel) : `sip:${channel}@${domain}`);
// The lobby party's channel, as 7.00's frontend names it (the string confctl-g-Party-%s, file offset 0x3E300C8, beside
// AFortPlayerControllerFrontEnd::VoiceChatJoinTokenReturned's log lines; read statically, not traced).
export const partyChannel = (partyId) => `confctl-g-Party-${partyId}`;

// Checks a token: { ok, reason, payload }. expect: { vxa, user (compared with f by userOf), to (the channel URI) }.
export function verifyToken(key, token, { issuer = defaultIssuer, vxa, user, to, now = Date.now() } = {}) {
  const text = String(token ?? "").trim();
  const parts = text.split(".");
  const payload = decodeToken(text);
  if (!payload) return { ok: false, reason: "not a Vivox token (e30.<payload>.<signature>)", payload: null };
  const expected = hmac(key, `${parts[0]}.${parts[1]}`);
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: "bad signature (another key?)", payload };
  if (payload.iss !== issuer) return { ok: false, reason: `issuer ${payload.iss}, expected ${issuer}`, payload };
  if (!(Number(payload.exp) * 1000 + clockSkewSeconds * 1000 > now)) return { ok: false, reason: `expired at ${new Date(Number(payload.exp) * 1000).toISOString()}`, payload };
  if (vxa && payload.vxa !== vxa) return { ok: false, reason: `action ${payload.vxa}, expected ${vxa}`, payload };
  if (user !== undefined && user !== null && user !== "" && userOf(payload.f) !== userOf(user)) {
    return { ok: false, reason: `for ${payload.f}, not ${user}`, payload };
  }
  if (to && payload.t !== undefined && String(payload.t).toLowerCase() !== String(to).toLowerCase()) {
    return { ok: false, reason: `for channel ${payload.t}, not ${to}`, payload };
  }
  return { ok: true, reason: "ok", payload };
}

// The backend's Vivox identity: <data>/vivox.json, made on first use and never committed (data/ is git-ignored).
export function createVivoxKeys(dataDir) {
  const file = dataDir ? path.join(dataDir, "vivox.json") : null;
  let saved = {};
  if (file && fs.existsSync(file)) {
    try {
      saved = readJson(file);
    } catch {
      saved = {};
    }
  }
  const identity = {
    issuer: typeof saved.issuer === "string" && saved.issuer ? saved.issuer : defaultIssuer,
    domain: typeof saved.domain === "string" && saved.domain ? saved.domain : defaultDomain,
    key: typeof saved.key === "string" && saved.key.length >= 16 ? saved.key : crypto.randomBytes(32).toString("base64url")
  };
  if (file && (saved.key !== identity.key || saved.issuer !== identity.issuer || saved.domain !== identity.domain)) {
    writeJson(file, { ...saved, ...identity, created: saved.created ?? new Date().toISOString() });
  }

  let lastVxi = 0;
  const nextVxi = () => (lastVxi = Math.max(Date.now() * 1000, lastVxi + 1));

  return {
    issuer: identity.issuer,
    domain: identity.domain,
    key: identity.key,
    // A login token for a player (".<accountId>." or the account id), or a join token for it and a channel name or URI.
    mint({ action = "login", player, channel, now = Date.now(), lifetime = tokenLifetimeSeconds }) {
      const payload = { iss: identity.issuer, exp: Math.floor(now / 1000) + lifetime, vxa: action, vxi: nextVxi(), f: accountUri(player, identity.domain) };
      if (action !== "login" && channel !== undefined) payload.t = channelUri(channel, identity.domain);
      return signToken(identity.key, payload);
    },
    verify: (token, expect = {}) => verifyToken(identity.key, token, { issuer: identity.issuer, ...expect }),
    // The SIP credentials a signin hands out (vivox/web.js): a password the key derives, so it is the same each time.
    sipPassword: (player) => hmac(identity.key, `sip-password:${userOf(player)}`).toString("hex").slice(0, 24)
  };
}

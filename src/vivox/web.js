import crypto from "node:crypto";
import express from "express";
import { requestAddress } from "../network.js";
import { describeToken, tokenPattern, userOf } from "./tokens.js";

// Vivox's account web API, as the SDK (vivoxsdk_x64.dll 4.9, VivoxWeb::WebClient) asks it: ServerUrl + the file name, by
// WinINet. The shapes follow what the SDK reads (its XPath strings) and OpenSimulator's FreeSwitchVoiceModule, which
// answered the same files for Second Life's Vivox client:
// - viv_get_prelogin.php: <VCConfiguration> with the SIP proxy (DefaultSIPProxy), realm, STUN off, the codec mask
//   (PermittedCodecs) and the telemetry the SDK would post (Watson, Dyson, Eureka) pointed here with sample rates of 0.
// - viv_signin.php: the access token checked (tokens.js) and the SIP credentials (sip_uri, sip_password, sip_ha1), media
//   encryption and SIP compression off (enableSRTP, enableDeflate), in <response><level0><body>.
// - anything else under /api2/ (viv_signout.php, viv_client_events.php, viv_call_stats.php ...): logged and answered OK.
// Each request is logged in full (method, path, query, headers, the User-Agent that names the SDK, the body), with
// tokens' signatures cut short.

const xmlEscape = (value) => String(value ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const xmlns = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const element = (name, value) => `<${name}>${xmlEscape(value)}</${name}>`;

export function preloginXml({ realm, sipProxy, host, serverUrl, permittedCodecs = "", timeout = 5000 }) {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', "<VCConfiguration>",
    element("DefaultRealm", realm),
    element("DefaultSIPProxy", sipProxy),
    element("DefaultAttemptUseSTUN", "false"),
    element("DefaultEchoServer", host),
    element("DefaultEchoPort", "0"),
    element("DefaultWellKnownIP", host),
    element("DefaultTimeout", timeout),
    ...(permittedCodecs !== "" ? [element("PermittedCodecs", permittedCodecs)] : []),
    element("ServerPresenceEnabled", "false"),
    element("DefaultWatson", serverUrl),
    element("WatsonSampleRate", "0"),
    element("DefaultDyson", serverUrl),
    element("DysonSampleRate", "0"),
    element("DefaultEureka", serverUrl),
    element("EurekaSampleRate", "0"),
    "<UrlEulaNotice/>",
    "</VCConfiguration>"];
  return `${lines.join("\r\n")}\r\n`;
}

export function signinXml({ userid, displayname, accountId, sipUri, sipPassword, sipHa1, authToken }) {
  return ['<?xml version="1.0" encoding="utf-8"?>', `<response ${xmlns} xsi:schemaLocation="/xsd/signin.xsd">`, "<level0>",
    element("status", "OK"), "<body>",
    element("code", 200),
    element("cookie_name", "lib_session"),
    element("cookie", `${userid}:${accountId}:0::`),
    element("auth_token", authToken),
    element("primary", 1),
    element("account_id", accountId),
    element("displayname", displayname),
    element("sip_uri", sipUri),
    element("sip_password", sipPassword),
    element("sip_ha1", sipHa1),
    element("enableSRTP", 0),
    element("enableDeflate", 0),
    element("enableCompactHeaders", 0),
    element("msg", "auth successful"),
    "</body>", "</level0>", "</response>", ""].join("\r\n");
}

export function errorXml(code, message) {
  return ['<?xml version="1.0" encoding="utf-8"?>', `<response ${xmlns} xsi:schemaLocation="/xsd/error.xsd">`, "<level0>",
    element("status", "ERR"), "<body>", element("code", code), element("msg", message), "</body>", "</level0>", "</response>", ""].join("\r\n");
}

const okXml = () => ['<?xml version="1.0" encoding="utf-8"?>', `<response ${xmlns}>`, "<level0>", element("status", "OK"), "<body>",
  element("code", 200), element("msg", "ok"), "</body>", "</level0>", "</response>", ""].join("\r\n");

// A Vivox account number from Core's account id: the SDK keeps it as account_id; any stable number does.
const numericId = (user) => crypto.createHash("sha256").update(user).digest().readUIntBE(0, 6);

// The fields a request carries, its query's and its form body's (the SDK posts application/x-www-form-urlencoded).
function fieldsOf(req, body) {
  const fields = {};
  for (const [key, value] of Object.entries(req.query ?? {})) fields[key] = Array.isArray(value) ? String(value[0]) : String(value);
  if (body && /=/.test(body) && !/^\s*[<{]/.test(body)) for (const [key, value] of new URLSearchParams(body)) fields[key] = value;
  return fields;
}

export function vivoxWebRoutes({ vivox, network }) {
  const router = express.Router();
  const raw = express.raw({ type: () => true, limit: "256kb" });

  router.use("/api2", raw, (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const name = req.path.replace(/^\/+/, "").toLowerCase();
    const from = requestAddress(req);
    vivox.raw(`HTTP ${req.method} ${req.originalUrl} from ${from} (User-Agent: ${req.get("user-agent") ?? "none"})`, [
      ...Object.entries(req.headers).map(([key, value]) => `${key}: ${value}`),
      "",
      `query: ${JSON.stringify(req.query ?? {})}`,
      `body (${Buffer.byteLength(body)} bytes): ${body}`].join("\n"));
    const fields = fieldsOf(req, body);
    const send = (status, xml) => {
      vivox.raw(`HTTP ${status} answer to ${req.method} /api2/${name}`, xml);
      res.status(status).set({ "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-cache, no-transform" }).send(xml);
    };
    const serverUrl = `${req.protocol}://${req.get("host")}/api2/`;

    if (name === "viv_get_prelogin.php") {
      const host = network.reachableAddress(req);
      vivox.advertise(from, host);
      if (vivox.sipPort() === null) vivox.say(`prelogin: the SIP server isn't running (vivoxSipPort 0, or its port was taken): the client will find nobody at ${vivox.sipProxy(host)}`);
      return send(200, preloginXml({ realm: vivox.keys.domain, sipProxy: vivox.sipProxy(host), host, serverUrl, permittedCodecs: vivox.permittedCodecs() }));
    }

    if (name === "viv_signin.php") {
      // The token is access_token in Vivox's token mode; any field holding one is taken, in case this SDK names it otherwise.
      const tokenField = fields.access_token !== undefined ? "access_token" : Object.keys(fields).find((key) => tokenPattern.test(fields[key]));
      const token = tokenField ? (tokenPattern.exec(fields[tokenField])?.[0] ?? fields[tokenField]) : null;
      const claimed = fields.userid ?? fields.username ?? fields.user ?? "";
      if (!token) {
        vivox.say(`signin REJECTED: no access token among the fields ${Object.keys(fields).join(", ") || "(none)"}`);
        return send(403, errorXml(403, "Access token required"));
      }
      const check = vivox.keys.verify(token, { vxa: "login", user: claimed || undefined });
      vivox.say(`signin of ${claimed || "(no userid)"}: token (${tokenField}) ${check.ok ? "OK" : `REJECTED (${check.reason})`} ${describeToken(token)}`);
      if (!check.ok) return send(403, errorXml(403, `Access token rejected: ${check.reason}`));
      const user = userOf(check.payload.f);
      const account = vivox.accounts?.get?.(user);
      const player = `.${user}.`;
      const password = vivox.keys.sipPassword(player);
      const realm = vivox.keys.domain;
      return send(200, signinXml({
        userid: claimed || player,
        displayname: fields.displayname || account?.displayName || player,
        accountId: numericId(user),
        sipUri: `sip:${player}@${vivox.keys.domain}`,
        sipPassword: password,
        sipHa1: crypto.createHash("md5").update(`${player}:${realm}:${password}`).digest("hex"),
        authToken: crypto.createHmac("sha256", vivox.keys.key).update(`auth:${user}:${check.payload.vxi}`).digest("hex").slice(0, 32)
      }));
    }

    vivox.say(`${name || "(no file)"}: not emulated, answered OK`);
    return send(200, okXml());
  });

  return router;
}

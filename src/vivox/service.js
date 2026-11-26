import fs from "node:fs";
import path from "node:path";
import { httpsProxied, sentToHost } from "../network.js";
import { log } from "../log.js";
import { iniQuoted } from "../services/fortnite/purchase.js";
import { parsePortRange } from "./media.js";
import { startSipServer } from "./sip-server.js";
import { createVivoxKeys, tokenPattern } from "./tokens.js";

// Core's Vivox emulator (phase 1): what Fortnite's own Vivox voice chat (the "Vivox" plugin, FVivox over the Vivox SDK)
// talks to instead of Epic's Vivox servers, so voice works through the game's own code.
//
// The client's side, 7.00 (CL-4629139) unless another build is named:
// - FVivox::Connect (0x999130) reads [Vivox] ServerUrl and Domain from the game ini on every connect ("[Vivox] ServerUrl
//   or Domain is not set" otherwise); the pak has ServerUrl="https://fnwp.www.vivox.com/api2/", Domain="fnwp.vivox.com".
//   5.10 (CL-4225813) is the first build that reads them; 1.7.2 to 5.0 have them in the exe. From 5.10 the backend's
//   DefaultGame.ini hotfix (services/fortnite/cloudstorage.js, vivoxGameSection) points them here; older builds keep
//   theirs, as does every build while the admin panel's "Voice chat (Vivox)" switch is off.
// - The SDK asks ServerUrl + viv_get_prelogin.php for its configuration (the SIP proxy, realm, codecs) and signs in at
//   viv_signin.php with the access token (vivox/web.js), then speaks SIP to the proxy (vivox/sip-server.js) and RTP to
//   the ports the SIP answers name (vivox/media.js).
// - The tokens: the lobby's party voice asks this backend (services/fortnite/voice.js: /fortnite/api/game/v2/voice/...),
//   the match's come from the gameserver's "VoiceChatToken" modular feature, which CoreV2 signs with this backend's key
//   (services/core/vivox.js, D:\CoreWork\vivox\contract.md).
//
// Everything the emulator sees and says is logged under [Vivox], and kept in <data>/logs/vivox.log.

export const vivoxIniBuild = 4225813;
// 8.20 (CL-5625478) to 8.51 replaced FVivox with UE 4.23's VivoxVoiceChat and VoiceChatManager plugins (8.30 CL-5793395):
// - FVivoxVoiceChat::Initialize (8.30 0xBCDCE0) reads [VoiceChat.Vivox] ServerUrl, Domain, Issuer and Namespace from the
//   ENGINE ini once, right after the start-up hotfix is applied ("[VoiceChat.Vivox] ServerUrl, Domain, or Issuer is not
//   set" otherwise; 8.00 still has FVivox's [Vivox]). Namespace, or Issuer when unset, goes into its names: the account
//   ".<namespace>.<accountId>." and channels sip:confctl-<g|d|e>-<namespace>.<channel>@<domain>.
// - The client asks for its own login and party join tokens: POST {MCP}/api/game/v2/voice/{accountId}/createLoginToken
//   and createJoinToken (8.30 0xBC1C90, 0xBC0B90; the join's body {"channelType": "echo"|"direct"|"party"|"group",
//   "channelName"}), answered {"token"} (0xBC2810). The match's join tokens still come from the gameserver's
//   VoiceChatToken feature (ServerVoiceChatRequestJoinToken).
export const vivoxVoiceChatBuild = 5625478;
export const defaultSipPort = 5060;
export const defaultRtpPorts = "5062-5199";
const maxAdvertised = 256;

// Tokens in a log line, with their signatures cut short (tokens.js describeToken): the line shows what was sent without
// being a login.
export const redactTokens = (text) => String(text).replace(new RegExp(tokenPattern.source, "g"), (token) => {
  const [head, payload, signature] = token.split(".");
  return signature.length > 8 ? `${head}.${payload}.${signature.slice(0, 6)}...` : token;
});

export function createVivoxService({ dataDir, network, settings, config = {}, accounts = null, quiet = false } = {}) {
  const keys = createVivoxKeys(dataDir);
  const file = dataDir ? path.join(dataDir, "logs", "vivox.log") : null;
  const advertised = new Map();
  let sip = null;

  function say(message) {
    const text = redactTokens(message);
    if (!quiet) log("Vivox", text);
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `[${new Date().toISOString()}] ${text}\n`);
    } catch {
      // The log file is a convenience; the console has the same lines.
    }
  }

  const service = {
    keys,
    accounts,
    say,
    // A message as it came or went, every line of it.
    raw: (title, text) => say(`${title}\n${String(text).replace(/\r/g, "").replace(/\n+$/, "").split("\n").map((line) => `    ${line}`).join("\n")}`),
    enabled: () => settings?.get?.()?.vivoxVoice !== false,
    // Whether a build's client is pointed at the emulator: 5.10 and later, while the switch is on.
    servesBuild: (build) => service.enabled() && Number(build) >= vivoxIniBuild,
    sipPort: () => sip?.port ?? null,
    // config.vivoxSipProxy: the prelogin's DefaultSIPProxy, "{host}:{port}" as OpenSimulator's FreeSwitchVoiceModule
    // gives Second Life's Vivox client; "sip:{host}:{port}" if the SDK wants a URI there.
    sipProxy: (host) => String(config.vivoxSipProxy ?? "{host}:{port}").replace("{host}", host).replace("{port}", String(sip?.port ?? defaultSipPort)),
    // config.vivoxPermittedCodecs: the prelogin's PermittedCodecs, the SDK's codec mask; "1" asks for PCMU only (🟡 the
    // mask's bits are Vivox's vx_codec values as documented for its later SDKs, not read from 4.9). "" leaves it out.
    permittedCodecs: () => (config.vivoxPermittedCodecs === undefined ? "1" : String(config.vivoxPermittedCodecs)),
    // The SIP host the prelogin told a client (by its IP), which the SIP server's SDP answers use for media.
    advertise(clientAddress, host) {
      advertised.delete(clientAddress);
      advertised.set(clientAddress, host);
      if (advertised.size > maxAdvertised) advertised.delete(advertised.keys().next().value);
    },
    hostFor: (address) => advertised.get(address) ?? null,

    // [VoiceChat.Vivox] for 8.20 and later's DefaultEngine.ini hotfix: the same ServerUrl and Domain, and the issuer as
    // Issuer and Namespace, so the names the client builds are the ones this backend's and the gameserver's tokens sign.
    engineSection(req, build) {
      if (!service.servesBuild(build) || Number(build) < vivoxVoiceChatBuild) return "";
      return ["[VoiceChat.Vivox]", `ServerUrl=${iniQuoted(service.serverUrl(req))}`, `Domain=${keys.domain}`, `Issuer=${keys.issuer}`,
        `Namespace=${keys.issuer}`, ""].join("\r\n");
    },
    // The emulator's /api2/ by the address the game sent the request to.
    serverUrl(req) {
      const proxied = httpsProxied(req);
      const base = proxied ? `https://${proxied.host}` : `${req.socket?.encrypted ? "https" : "http"}://${sentToHost(req) ?? network.directHost(req)}`;
      return `${base}/api2/`;
    },

    // [Vivox] for a build's DefaultGame.ini hotfix: ServerUrl at this backend's /api2/, by the address the game sent the
    // request to (as Support-A-Creator's page, network.js sentToHost: the SDK's own HTTP, WinINet, reaches it from the
    // player's PC without the game's -httpproxy), quoted so the hotfix merge keeps the "//" (fbb2301, #349); and Domain.
    gameSection(req, build) {
      if (!service.servesBuild(build) || Number(build) >= vivoxVoiceChatBuild) return "";
      return ["[Vivox]", `ServerUrl=${iniQuoted(service.serverUrl(req))}`, `Domain=${keys.domain}`, ""].join("\r\n");
    },

    // The SIP server (UDP and TCP on port) and its RTP ports; resolves with { port } (null when the port was taken).
    async start(port = config.vivoxSipPort ?? defaultSipPort) {
      if (sip) return sip;
      const rtpPorts = parsePortRange(config.vivoxRtpPorts ?? defaultRtpPorts);
      sip = await startSipServer({ network, keys, port, media: { range: rtpPorts, echo: config.vivoxEcho === true }, hostFor: service.hostFor, say, raw: service.raw });
      if (sip.port !== null) {
        say(`SIP server on UDP and TCP port ${sip.port}, RTP on UDP ports ${rtpPorts.min}-${rtpPorts.max}${config.vivoxEcho === true ? ", echo on (a player alone in a channel hears themselves)" : ""}; ` +
          `issuer ${keys.issuer}, domain ${keys.domain}; clients from 5.10 are pointed here while the admin panel's Voice chat (Vivox) is on (now ${service.enabled() ? "on" : "off"})`);
      }
      return sip;
    },
    status: () => ({ enabled: service.enabled(), sipPort: service.sipPort(), issuer: keys.issuer, domain: keys.domain,
      calls: sip?.calls?.() ?? [], channels: sip?.channels?.() ?? [], registrations: sip?.registrations?.() ?? [] }),
    close() {
      sip?.close?.();
      sip = null;
    }
  };
  return service;
}

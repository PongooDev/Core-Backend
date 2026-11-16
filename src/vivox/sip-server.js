import dgram from "node:dgram";
import net from "node:net";
import { isLoopback, lanAddresses, normalizeAddress } from "../network.js";
import { createMedia } from "./media.js";
import { buildResponse, buildSdpAnswer, chooseCodec, header, hostPortOf, newTag, param, parseSdp, parseSip, splitStream, uriOf } from "./sip.js";
import { describeToken, tokenPattern, userOf } from "./tokens.js";

// The emulator's SIP server: the address the prelogin names as the SDK's DefaultSIPProxy (vivox/web.js), on UDP and TCP
// (the SDK's default is UDP; VIVOX_FORCE_TCP switches it). It takes what a Vivox client sends:
//   REGISTER   the account's login (200, no digest challenge: the signin already checked the token)
//   INVITE     joining a channel (the request URI, sip:<channel>@<domain>): 100, then 200 with an SDP answer on a port of
//              the call's own (media.js), retransmitted until the ACK, as RFC 3261's timer G says for UDP
//   ACK, BYE, CANCEL, OPTIONS; SUBSCRIBE, NOTIFY, PUBLISH, MESSAGE, INFO, UPDATE and PRACK get a 200 and are only logged
// Every message is logged as it came and as answered. Tokens found in a request (the SDK's access token header,
// VivoxClient::Header::AddAccessToken, whose name isn't known yet) are checked and logged; phase 1 refuses nothing over
// them. Who may connect follows the backend's network settings (only this PC unless remote access is on).

const retransmitStartMs = 500;
const retransmitMaxMs = 4000;
const ackTimeoutMs = 32000;
const allow = "INVITE, ACK, CANCEL, BYE, OPTIONS, REGISTER, SUBSCRIBE, NOTIFY, MESSAGE, INFO, UPDATE, PRACK, PUBLISH";

export async function startSipServer({ network, keys, port, media: mediaOptions = {}, hostFor = () => null, say = () => {}, raw = () => {} }) {
  let host;
  let udp = null;
  let tcp = null;
  const connections = new Set();
  const registrations = new Map();
  const calls = new Map();
  // RTP binds where the backend listens when the call starts (this PC only while remote access is off).
  const media = createMedia({ ...mediaOptions, host: () => (net.isIPv4(network.bindAddress() ?? "") ? network.bindAddress() : undefined),
    allows: (address) => network.allows(address), say });

  // The address the SDP answer gives for media: what the prelogin told this client (by its IP), else the address the
  // Route header names (the proxy the client was given), else this PC's for this PC, else its public or LAN address.
  function mediaAddress(source, request) {
    const told = hostFor(source.address);
    if (told && net.isIPv4(told)) return told;
    const route = hostPortOf(uriOf(header(request, "route") ?? "")).host;
    if (route && net.isIPv4(route) && route !== "0.0.0.0") return route;
    if (isLoopback(source.address)) return "127.0.0.1";
    return network.publicIp?.() ?? lanAddresses()[0] ?? "127.0.0.1";
  }

  function tokensIn(request) {
    const found = [];
    for (const entry of request.headers) {
      const match = tokenPattern.exec(entry.value);
      if (match) found.push({ where: entry.name, token: match[0] });
    }
    const inBody = tokenPattern.exec(request.body);
    if (inBody) found.push({ where: "body", token: inBody[0] });
    return found;
  }

  function checkTokens(request, label) {
    const user = userOf(uriOf(header(request, "from")));
    for (const { where, token } of tokensIn(request)) {
      const check = keys.verify(token, { user });
      say(`${label}: token in ${where}: ${check.ok ? "OK" : `REJECTED (${check.reason})`} ${describeToken(token)}`);
      if (request.method === "INVITE" && check.payload?.t) {
        const uri = request.uri.split(";")[0];
        say(`${label}: token channel ${check.payload.t} ${String(check.payload.t).toLowerCase() === uri.toLowerCase() ? "matches" : "DIFFERS FROM"} the INVITE's ${uri}`);
      }
    }
  }

  function handle(request, source, reply) {
    const label = `${request.method} from ${source.address}:${source.port}/${source.transport}`;
    const respond = (status, reason, options = {}) => {
      const text = buildResponse(request, status, reason, { source, ...options });
      raw(`SIP out to ${source.address}:${source.port}/${source.transport}`, text);
      reply(text);
      return text;
    };
    const callId = header(request, "call-id") ?? "";
    switch (request.method) {
      case "REGISTER": {
        checkTokens(request, label);
        const aor = uriOf(header(request, "to"));
        const contact = header(request, "contact");
        const expires = Number(param(contact, "expires") ?? header(request, "expires") ?? 3600);
        if (expires === 0 || contact === "*") registrations.delete(aor);
        else registrations.set(aor, { contact, source, at: Date.now(), expires });
        say(`${label}: ${expires === 0 ? "unregistered" : "registered"} ${aor} (contact ${contact ?? "none"}, expires ${expires})`);
        return respond(200, "OK", { toTag: newTag(), extra: [...(contact && contact !== "*" ? [["Contact", `${contact.replace(/;expires=\d+/i, "")};expires=${expires}`]] : []), ["Expires", String(expires)], ["Date", new Date().toUTCString()]] });
      }
      case "INVITE":
        return invite(request, source, label, respond, callId);
      case "ACK": {
        const call = calls.get(callId);
        if (call) {
          clearTimeout(call.retransmit);
          clearTimeout(call.giveUp);
          if (!call.acked) say(`${label}: call ${callId} to ${call.channel} established`);
          call.acked = true;
        }
        return null;
      }
      case "BYE": {
        const call = calls.get(callId);
        respond(200, "OK", { toTag: call?.toTag });
        endCall(callId, "left (BYE)");
        return null;
      }
      case "CANCEL": {
        respond(200, "OK", { toTag: calls.get(callId)?.toTag });
        if (calls.get(callId) && !calls.get(callId).acked) endCall(callId, "cancelled");
        return null;
      }
      case "OPTIONS":
        return respond(200, "OK", { toTag: newTag(), extra: [["Allow", allow], ["Accept", "application/sdp"], ["Supported", ""]] });
      case "SUBSCRIBE":
        checkTokens(request, label);
        say(`${label}: subscription to ${request.uri} (Event: ${header(request, "event") ?? "none"}) accepted, nothing is notified yet`);
        return respond(200, "OK", { toTag: newTag(), extra: [["Expires", String(Number(header(request, "expires") ?? 3600))], ["Contact", `<sip:vivox@${mediaAddress(source, request)}:${port}>`]] });
      case "NOTIFY": case "PUBLISH": case "MESSAGE": case "INFO": case "UPDATE": case "PRACK":
        checkTokens(request, label);
        return respond(200, "OK", { toTag: calls.get(callId)?.toTag ?? newTag() });
      default:
        say(`${label}: ${request.method} isn't handled`);
        return respond(501, "Not Implemented", { toTag: newTag(), extra: [["Allow", allow]] });
    }
  }

  async function invite(request, source, label, respond, callId) {
    checkTokens(request, label);
    const offer = parseSdp(request.body);
    const existing = calls.get(callId);
    const cseq = header(request, "cseq") ?? "";
    if (existing && existing.cseq === cseq) {
      // The client sending the same INVITE again (UDP, before our answer reached it): the answer again.
      say(`${label}: ${callId} sent again, answered again`);
      if (existing.ok) source.resend(existing.ok);
      else respond(100, "Trying");
      return null;
    }
    if (existing) {
      // A re-INVITE (hold, a new address): the same answer, a newer version.
      const audio = offer.media.find((media) => media.type === "audio");
      if (audio) media.update(callId, { address: audio.connection, port: audio.port });
      if (!existing.answer) return respond(491, "Request Pending", { toTag: existing.toTag });
      existing.version++;
      existing.cseq = cseq;
      existing.ok = respond(200, "OK", { toTag: existing.toTag, extra: existing.extra, body: buildSdpAnswer({ ...existing.answer, version: existing.version }) });
      return null;
    }
    const codec = chooseCodec(offer);
    const channel = request.uri.replace(/^sips?:/i, "").split(";")[0].split("@")[0];
    const offered = offer.media.filter((media) => media.type === "audio")
      .map((media) => media.formats.map((pt) => `${pt}${media.rtpmap[pt] ? ` ${media.rtpmap[pt]}` : ""}${media.fmtp[pt] ? ` (${media.fmtp[pt]})` : ""}`).join(", ")).join("; ");
    say(`${label}: join ${channel} by ${uriOf(header(request, "from"))}, offered ${offered || "no audio"}${codec ? `; answering ${codec.rtpmap ?? codec.name}` : ""}`);
    const toTag = newTag();
    if (!codec) {
      respond(488, "Not Acceptable Here", { toTag });
      return null;
    }
    respond(100, "Trying");
    const call = { channel, toTag, cseq, acked: false, version: 1, source, retransmit: null, giveUp: null, ok: null };
    calls.set(callId, call);
    let joined;
    try {
      joined = await media.join({ callId, channel, label: uriOf(header(request, "from")) || source.address, codec,
        remote: { address: codec.audio.connection && codec.audio.connection !== "0.0.0.0" ? codec.audio.connection : source.address, port: codec.audio.port } });
    } catch (error) {
      calls.delete(callId);
      say(`${label}: no RTP port for ${channel} (${error.message})`);
      respond(503, "Service Unavailable", { toTag });
      return null;
    }
    const address = mediaAddress(source, request);
    call.answer = { address, port: joined.port, codec, sessionId: Date.now() };
    call.extra = [["Contact", `<sip:${channel}@${address}:${port}${source.transport === "tcp" ? ";transport=tcp" : ""}>`], ["Allow", allow]];
    const ok = respond(200, "OK", { toTag, extra: call.extra, body: buildSdpAnswer(call.answer) });
    call.ok = ok;
    if (source.transport === "udp") {
      let wait = retransmitStartMs;
      const again = () => {
        if (call.acked || !calls.has(callId)) return;
        source.resend(ok);
        wait = Math.min(wait * 2, retransmitMaxMs);
        call.retransmit = setTimeout(again, wait);
      };
      call.retransmit = setTimeout(again, wait);
      call.giveUp = setTimeout(() => {
        clearTimeout(call.retransmit);
        if (!call.acked) say(`${label}: no ACK for ${callId} in ${ackTimeoutMs / 1000} s; the call stays up until a BYE`);
      }, ackTimeoutMs);
    }
    return null;
  }

  function endCall(callId, why) {
    const call = calls.get(callId);
    if (!call) return;
    clearTimeout(call.retransmit);
    clearTimeout(call.giveUp);
    calls.delete(callId);
    media.leave(callId, why);
  }

  function receive(text, source, reply) {
    if (!network.allows(source.address)) return;
    const message = parseSip(text);
    if (!message) return;
    raw(`SIP in from ${source.address}:${source.port}/${source.transport}`, message.raw);
    if (message.kind === "response") {
      say(`Response ${message.status} ${message.reason} from ${source.address}:${source.port} (for ${header(message, "cseq") ?? "?"})`);
      return;
    }
    Promise.resolve(handle(message, source, reply)).catch((error) => say(`${message.method} from ${source.address}: ${error.stack ?? error.message}`));
  }

  async function bind() {
    host = network.bindAddress();
    const nextUdp = dgram.createSocket(host && net.isIPv6(host) ? "udp6" : "udp4");
    nextUdp.on("message", (packet, from) => {
      const source = { address: normalizeAddress(from.address), port: from.port, transport: "udp" };
      const send = (text) => nextUdp.send(Buffer.from(text, "utf8"), from.port, from.address);
      source.resend = send;
      receive(packet, source, send);
    });
    const nextTcp = net.createServer((socket) => {
      const address = normalizeAddress(socket.remoteAddress);
      if (!network.allows(address)) return socket.destroy();
      connections.add(socket);
      let buffered = Buffer.alloc(0);
      const source = { address, port: socket.remotePort, transport: "tcp", resend: (text) => socket.write(text) };
      socket.on("data", (chunk) => {
        const { messages, rest } = splitStream(Buffer.concat([buffered, chunk]));
        buffered = rest;
        if (buffered.length > 65536) return socket.destroy();
        for (const text of messages) receive(text, source, (answer) => socket.write(answer));
      });
      socket.on("error", () => {});
      socket.on("close", () => connections.delete(socket));
    });
    try {
      await new Promise((resolve, reject) => {
        nextUdp.once("error", reject);
        nextUdp.bind(port, host, () => {
          nextUdp.off("error", reject);
          resolve();
        });
      });
      const udpPort = nextUdp.address().port;
      await new Promise((resolve, reject) => {
        nextTcp.once("error", reject);
        nextTcp.listen(udpPort, host, () => {
          nextTcp.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      nextUdp.close();
      nextTcp.close();
      say(`SIP server: couldn't use port ${port} (${error.code ?? error.message}); Vivox voice chat can't connect (config vivoxSipPort picks another)`);
      return null;
    }
    nextUdp.on("error", (error) => say(`SIP UDP: ${error.message}`));
    nextTcp.on("error", (error) => say(`SIP TCP: ${error.message}`));
    udp = nextUdp;
    tcp = nextTcp;
    return udp.address().port;
  }

  const bound = await bind();
  if (bound !== null) port = bound;
  let moving = Promise.resolve();
  const stop = network.onChange?.((settings) => {
    if (!settings.remoteAccess) {
      for (const socket of connections) if (!isLoopback(socket.remoteAddress)) socket.destroy();
    }
    moving = moving.then(async () => {
      if (network.bindAddress() === host) return;
      udp?.close();
      tcp?.close();
      udp = tcp = null;
      await bind();
    });
  });

  return {
    port: bound,
    calls: () => [...calls.entries()].map(([callId, call]) => ({ callId, channel: call.channel, acked: call.acked })),
    channels: () => media.channels(),
    registrations: () => [...registrations.entries()].map(([aor, entry]) => ({ aor, contact: entry.contact, address: entry.source.address })),
    close() {
      stop?.();
      for (const callId of [...calls.keys()]) endCall(callId, "dropped (backend closing)");
      for (const socket of connections) socket.destroy();
      udp?.close();
      tcp?.close();
      udp = tcp = null;
    }
  };
}

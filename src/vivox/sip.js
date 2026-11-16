import crypto from "node:crypto";

// SIP (RFC 3261) and SDP (RFC 4566) as far as the Vivox emulator needs them: parsing what the Vivox SDK sends, and the
// responses the emulator's SIP server (sip-server.js) sends back. The SDK speaks SIP over UDP (TCP with VIVOX_FORCE_TCP),
// with Vivox's extras (x-vivox- headers, Vx-Roster-Update, confctl- channel URIs, its access token header) that the
// emulator only logs. Its strings (vivoxsdk_x64.dll 4.9.0002.30406) carry the compact header forms too.

const compactForms = {
  v: "via", f: "from", t: "to", i: "call-id", m: "contact", l: "content-length", c: "content-type", k: "supported", s: "subject",
  e: "content-encoding", o: "event", u: "allow-events", r: "refer-to", b: "referred-by", x: "session-expires", a: "accept-contact",
  j: "reject-contact", d: "request-disposition", y: "identity"
};
export const headerKey = (name) => {
  const lower = String(name).trim().toLowerCase();
  return compactForms[lower] ?? lower;
};

// One message: { kind: "request" | "response", method, uri, status, reason, headers: [{ name, key, value }], body, raw }.
// Null for anything that isn't SIP (keep-alive CRLFs, junk).
export function parseSip(input) {
  const raw = Buffer.isBuffer(input) ? input.toString("utf8") : String(input ?? "");
  const text = raw.replace(/^(\r?\n)+/, "");
  if (!text.trim()) return null;
  const split = text.search(/\r?\n\r?\n/);
  const head = split >= 0 ? text.slice(0, split) : text;
  const body = split >= 0 ? text.slice(split).replace(/^\r?\n\r?\n/, "") : "";
  const lines = head.split(/\r?\n/);
  const start = lines.shift() ?? "";
  const message = { raw: text, headers: [], body };
  let match;
  if ((match = /^SIP\/2\.0\s+(\d{3})\s*(.*)$/i.exec(start))) {
    Object.assign(message, { kind: "response", status: Number(match[1]), reason: match[2] });
  } else if ((match = /^([A-Za-z]+)\s+(\S+)\s+SIP\/2\.0$/i.exec(start.trim()))) {
    Object.assign(message, { kind: "request", method: match[1].toUpperCase(), uri: match[2] });
  } else {
    return null;
  }
  for (const line of lines) {
    if (/^[ \t]/.test(line) && message.headers.length) {
      message.headers.at(-1).value += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim();
    message.headers.push({ name, key: headerKey(name), value: line.slice(colon + 1).trim() });
  }
  const length = Number(header(message, "content-length"));
  if (Number.isInteger(length) && length >= 0 && Buffer.byteLength(message.body, "utf8") > length) {
    message.body = Buffer.from(message.body, "utf8").subarray(0, length).toString("utf8");
  }
  return message;
}

export const header = (message, name) => message?.headers?.find((entry) => entry.key === headerKey(name))?.value;
export const headers = (message, name) => (message?.headers ?? []).filter((entry) => entry.key === headerKey(name)).map((entry) => entry.value);

// Splits a TCP stream into messages by Content-Length: { messages: [text], rest: Buffer }. Keep-alive CRLFs are dropped.
export function splitStream(buffer) {
  const messages = [];
  let rest = buffer;
  for (;;) {
    let skip = 0;
    while (skip < rest.length && (rest[skip] === 0x0d || rest[skip] === 0x0a)) skip++;
    rest = rest.subarray(skip);
    const end = rest.indexOf("\r\n\r\n");
    if (end < 0) break;
    const head = rest.subarray(0, end).toString("utf8");
    const lengthLine = /^(?:content-length|l)[ \t]*:[ \t]*(\d+)/im.exec(head);
    const total = end + 4 + (lengthLine ? Number(lengthLine[1]) : 0);
    if (rest.length < total) break;
    messages.push(rest.subarray(0, total).toString("utf8"));
    rest = rest.subarray(total);
  }
  return { messages, rest: Buffer.from(rest) };
}

// A header's parameter (";tag=abc" -> "abc"), or undefined; "" for a flag parameter (";rport").
export function param(value, name) {
  for (const part of String(value ?? "").split(";").slice(1)) {
    const [key, ...rest] = part.split("=");
    if (key.trim().toLowerCase() === name.toLowerCase()) return rest.join("=").trim();
  }
  return undefined;
}

// The URI inside a From/To/Contact value: "\"Name\" <sip:a@b>;tag=x" -> "sip:a@b".
export function uriOf(value) {
  const text = String(value ?? "").trim();
  const angled = /<([^>]*)>/.exec(text);
  return (angled ? angled[1] : text.split(";")[0]).trim();
}

// The host and port of a SIP URI ("sip:user@host:port;params" or "sip:host:port").
export function hostPortOf(uri) {
  const text = String(uri ?? "").replace(/^<|>$/g, "").replace(/^sips?:/i, "").split(";")[0];
  const hostPart = text.includes("@") ? text.slice(text.lastIndexOf("@") + 1) : text;
  const match = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(hostPart);
  return match ? { host: match[1], port: match[2] ? Number(match[2]) : null } : { host: hostPart, port: null };
}

export const newTag = () => crypto.randomBytes(6).toString("hex");

// A response to a request: its Via lines (the top one with received/rport, RFC 3581, as the answer goes back to where the
// request came from), From, To (with the tag the dialog has, added when the request had none), Call-ID and CSeq, then
// the given headers and body.
export function buildResponse(request, status, reason, { source, toTag, extra = [], body = "", contentType } = {}) {
  const lines = [`SIP/2.0 ${status} ${reason}`];
  headers(request, "via").forEach((via, index) => {
    if (index === 0 && source) {
      let top = via;
      if (param(top, "rport") === "") top = top.replace(/;rport(?=;|$)/i, `;rport=${source.port}`);
      if (param(top, "received") === undefined) top += `;received=${source.address}`;
      lines.push(`Via: ${top}`);
    } else {
      lines.push(`Via: ${via}`);
    }
  });
  lines.push(`From: ${header(request, "from") ?? ""}`);
  const to = header(request, "to") ?? "";
  lines.push(`To: ${toTag && param(to, "tag") === undefined && status > 100 ? `${to};tag=${toTag}` : to}`);
  lines.push(`Call-ID: ${header(request, "call-id") ?? ""}`);
  lines.push(`CSeq: ${header(request, "cseq") ?? ""}`);
  for (const [name, value] of extra) lines.push(`${name}: ${value}`);
  lines.push("Server: Core-Backend Vivox emulator");
  if (body) lines.push(`Content-Type: ${contentType ?? "application/sdp"}`);
  lines.push(`Content-Length: ${Buffer.byteLength(body, "utf8")}`);
  return `${lines.join("\r\n")}\r\n\r\n${body}`;
}

// SDP: { origin, connection (the session's or the first audio's c= address), media: [{ type, port, proto, formats,
// connection, rtpmap: { pt: "PCMU/8000" }, fmtp: { pt: "..." }, attributes: [] }] }.
export function parseSdp(text) {
  const sdp = { connection: null, origin: null, media: [] };
  let current = null;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = /^([a-z])=(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, type, value] = match;
    if (type === "m") {
      const [kind, port, proto, ...formats] = value.trim().split(/\s+/);
      current = { type: kind, port: Number(port), proto, formats, connection: null, rtpmap: {}, fmtp: {}, attributes: [] };
      sdp.media.push(current);
    } else if (type === "c") {
      const address = value.trim().split(/\s+/)[2]?.split("/")[0] ?? null;
      if (current) current.connection = address;
      else sdp.connection = address;
    } else if (type === "o") {
      sdp.origin = value.trim();
    } else if (type === "a" && current) {
      current.attributes.push(value);
      const map = /^rtpmap:(\d+)\s+(.+)$/i.exec(value);
      if (map) current.rtpmap[map[1]] = map[2].trim();
      const fmtp = /^fmtp:(\d+)\s+(.+)$/i.exec(value);
      if (fmtp) current.fmtp[fmtp[1]] = fmtp[2].trim();
    }
  }
  for (const media of sdp.media) media.connection ??= sdp.connection;
  return sdp;
}

// What the emulator answers an offer's audio with: PCMU (payload 0, or any payload its rtpmap names PCMU/8000), which
// the mixer (media.js) can decode and mix; else the offer's first format (not telephone-event) taken as it is, which
// is only forwarded between the channel's members. Null when the offer has no audio.
export function chooseCodec(sdp) {
  const audio = sdp?.media?.find((media) => media.type === "audio" && media.port > 0);
  if (!audio) return null;
  const nameOf = (pt) => audio.rtpmap[pt] ?? (pt === "0" ? "PCMU/8000" : pt === "8" ? "PCMA/8000" : null);
  const pcmu = audio.formats.find((pt) => /^PCMU\/8000/i.test(nameOf(pt) ?? ""));
  if (pcmu !== undefined) return { audio, pt: Number(pcmu), name: "PCMU", rate: 8000, rtpmap: "PCMU/8000", fmtp: null, mixable: true };
  const first = audio.formats.find((pt) => !/^telephone-event/i.test(nameOf(pt) ?? ""));
  if (first === undefined) return null;
  const rtpmap = nameOf(first);
  const [name, rate] = String(rtpmap ?? `pt${first}/8000`).split("/");
  return { audio, pt: Number(first), name, rate: Number(rate) || 8000, rtpmap, fmtp: audio.fmtp[first] ?? null, mixable: false };
}

export function buildSdpAnswer({ address, port, codec, sessionId = Date.now(), version = 1 }) {
  const lines = ["v=0", `o=CoreVivox ${sessionId} ${version} IN IP4 ${address}`, "s=Core Vivox", `c=IN IP4 ${address}`, "t=0 0",
    `m=audio ${port} RTP/AVP ${codec.pt}`];
  if (codec.rtpmap) lines.push(`a=rtpmap:${codec.pt} ${codec.rtpmap}`);
  if (codec.fmtp) lines.push(`a=fmtp:${codec.pt} ${codec.fmtp}`);
  if (codec.mixable) lines.push("a=ptime:20");
  lines.push("a=sendrecv");
  return `${lines.join("\r\n")}\r\n`;
}

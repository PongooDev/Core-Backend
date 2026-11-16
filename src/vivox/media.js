import crypto from "node:crypto";
import dgram from "node:dgram";

// The emulator's media: one RTP port (and its RTCP port, +1) per call, and per channel a mixer, as Vivox's servers mix
// (the SDK expects server-side mixing: one stream in, one stream out). Each member's RTP comes in on its own port, so
// whichever address it comes from (a player behind NAT) is the member's, and the mix goes back there (symmetric RTP).
//
// PCMU (G.711 mu-law, 8 kHz, 20 ms = 160 samples a packet) is decoded and mixed: every 20 ms each member gets the sum of
// the others' latest frame, in a stream of its own (its own SSRC, sequence and timestamps). A channel with a codec Core
// can't decode (the SDK's Opus or Siren, when it offers no PCMU) forwards each packet to the others as it is, which is
// right for two members and garbled for more. With echo on (config vivoxEcho), a member alone hears itself, for testing
// with one client.

// G.711 mu-law (ITU-T G.711, as in every softphone).
const BIAS = 0x84;
const CLIP = 32635;
const decodeTable = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  const t = (((u & 0x0f) << 3) + BIAS) << ((u & 0x70) >> 4);
  decodeTable[i] = u & 0x80 ? BIAS - t : t - BIAS;
}
export const ulawDecode = (byte) => decodeTable[byte & 0xff];
export function ulawEncode(sample) {
  let s = Math.max(-CLIP, Math.min(CLIP, sample | 0));
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

// RTP (RFC 3550): { version, padding, marker, payloadType, sequence, timestamp, ssrc, payload } or null.
export function parseRtp(packet) {
  if (packet.length < 12 || packet[0] >> 6 !== 2) return null;
  const csrcs = packet[0] & 0x0f;
  let offset = 12 + csrcs * 4;
  if (packet[0] & 0x10) {
    if (packet.length < offset + 4) return null;
    offset += 4 + packet.readUInt16BE(offset + 2) * 4;
  }
  let end = packet.length;
  if (packet[0] & 0x20) end -= packet[packet.length - 1];
  if (end < offset) return null;
  return { version: 2, marker: (packet[1] & 0x80) !== 0, payloadType: packet[1] & 0x7f, sequence: packet.readUInt16BE(2),
    timestamp: packet.readUInt32BE(4), ssrc: packet.readUInt32BE(8), payload: packet.subarray(offset, end) };
}

export function buildRtp({ payloadType, sequence, timestamp, ssrc, marker = false, payload }) {
  const head = Buffer.alloc(12);
  head[0] = 0x80;
  head[1] = (marker ? 0x80 : 0) | (payloadType & 0x7f);
  head.writeUInt16BE(sequence & 0xffff, 2);
  head.writeUInt32BE(timestamp >>> 0, 4);
  head.writeUInt32BE(ssrc >>> 0, 8);
  return Buffer.concat([head, payload]);
}

export const frameSamples = 160;
const frameMs = 20;
const maxQueuedFrames = 6;

// The RTP ports calls get: even ports of the range (RTP) with the next odd one (RTCP). A port already taken is skipped;
// with the range used up, the system picks (fine on this PC and the LAN, not through a router's forwarded range).
export function parsePortRange(value, fallback = { min: 5062, max: 5199 }) {
  const match = /^\s*(\d{1,5})\s*-\s*(\d{1,5})\s*$/.exec(String(value ?? ""));
  if (!match) return fallback;
  const [min, max] = [Number(match[1]), Number(match[2])];
  return min >= 1024 && max <= 65535 && min < max ? { min, max } : fallback;
}

function bindUdp(port, host) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", (error) => {
      socket.close();
      reject(error);
    });
    socket.bind(port, host, () => {
      socket.removeAllListeners("error");
      resolve(socket);
    });
  });
}

export function createMedia({ range = { min: 5062, max: 5199 }, host, echo = false, allows = () => true, say = () => {} } = {}) {
  const used = new Set();
  const channels = new Map();
  const calls = new Map();

  async function allocate() {
    const address = typeof host === "function" ? host() : host;
    const first = range.min % 2 ? range.min + 1 : range.min;
    for (let port = first; port + 1 <= range.max; port += 2) {
      if (used.has(port)) continue;
      let rtp = null;
      try {
        rtp = await bindUdp(port, address);
        const rtcp = await bindUdp(port + 1, address);
        used.add(port);
        return { rtp, rtcp, port };
      } catch {
        rtp?.close();
      }
    }
    const rtp = await bindUdp(0, address);
    const rtcp = await bindUdp(0, address);
    say(`RTP ports ${range.min}-${range.max} are all taken: this call uses port ${rtp.address().port}, which a router won't forward`);
    return { rtp, rtcp, port: rtp.address().port };
  }

  // The mixer's clock: while a channel has a PCMU member, every 20 ms of real time is one frame. Node's timers on Windows
  // fire late and in bursts (the system timer's 15.6 ms), so each tick makes as many frames as are due since the start,
  // keeping the streams at 50 packets a second.
  function startClock(channel) {
    if (channel.clock) return;
    channel.started = performance.now();
    channel.frames = 0;
    channel.clock = setInterval(() => {
      const due = Math.floor((performance.now() - channel.started) / frameMs) - channel.frames;
      for (let i = 0; i < Math.min(due, 10); i++) mixFrame(channel);
      channel.frames += due;
    }, 10);
  }
  function stopClock(channel) {
    clearInterval(channel.clock);
    channel.clock = null;
  }

  function mixFrame(channel) {
    const members = [...channel.members.values()].filter((member) => member.codec.mixable);
    const frames = new Map();
    for (const member of members) {
      if (member.primed && member.queue.length) frames.set(member, member.queue.shift());
      else if (member.queue.length >= 2) member.primed = true;
      if (!member.queue.length && !frames.has(member)) member.primed = false;
    }
    for (const receiver of members) {
      if (!receiver.remote) continue;
      const alone = members.length === 1;
      const sources = [...frames].filter(([member]) => member !== receiver || (alone && echo));
      if (!sources.length) {
        receiver.out.timestamp += frameSamples;
        receiver.out.silent = true;
        continue;
      }
      const payload = Buffer.alloc(frameSamples);
      for (let i = 0; i < frameSamples; i++) {
        let sum = 0;
        for (const [, frame] of sources) sum += frame[i];
        payload[i] = ulawEncode(sum);
      }
      send(receiver, buildRtp({ payloadType: receiver.codec.pt, sequence: receiver.out.sequence++, timestamp: receiver.out.timestamp,
        ssrc: receiver.out.ssrc, marker: receiver.out.silent, payload }));
      receiver.out.timestamp += frameSamples;
      receiver.out.silent = false;
    }
  }

  function send(member, packet) {
    member.rtp.send(packet, member.remote.port, member.remote.address);
    member.stats.sent++;
  }

  function onRtp(member, packet, from) {
    if (!allows(from.address)) return;
    const rtp = parseRtp(packet);
    if (!rtp) return;
    member.stats.received++;
    if (!member.remote || member.remote.address !== from.address || member.remote.port !== from.port) {
      say(`RTP: ${member.label} sends from ${from.address}:${from.port}${member.remote ? ` (was ${member.remote.address}:${member.remote.port})` : ""}, payload type ${rtp.payloadType}, ${rtp.payload.length} bytes`);
      member.remote = { address: from.address, port: from.port };
    }
    if (member.stats.received === 1) say(`RTP: first packet from ${member.label} on port ${member.port} (payload type ${rtp.payloadType}, ssrc ${rtp.ssrc}, ${rtp.payload.length} bytes)`);
    const channel = channels.get(member.channel);
    if (!channel) return;
    if (member.codec.mixable && rtp.payloadType === member.codec.pt) {
      for (let at = 0; at + frameSamples <= rtp.payload.length; at += frameSamples) {
        const frame = new Int16Array(frameSamples);
        for (let i = 0; i < frameSamples; i++) frame[i] = ulawDecode(rtp.payload[at + i]);
        member.queue.push(frame);
      }
      while (member.queue.length > maxQueuedFrames) member.queue.shift();
      return;
    }
    // Not decodable here (another codec, or a payload type the call didn't agree on): forwarded as it is.
    for (const other of channel.members.values()) {
      if ((other === member && !(echo && channel.members.size === 1)) || !other.remote) continue;
      send(other, packet);
    }
  }

  return {
    // A call joining a channel: binds its ports and returns { port } for the SDP answer. remote: the SDP's address and
    // port, used until the member's first packet says where it really is.
    async join({ callId, channel, label, codec, remote }) {
      const { rtp, rtcp, port } = await allocate();
      const member = { callId, channel, label, codec, port, rtp, rtcp, remote: remote?.port ? remote : null, queue: [], primed: false,
        out: { ssrc: crypto.randomBytes(4).readUInt32BE(0), sequence: crypto.randomBytes(2).readUInt16BE(0), timestamp: crypto.randomBytes(4).readUInt32BE(0), silent: true },
        stats: { received: 0, sent: 0, rtcp: 0, joined: Date.now() } };
      rtp.on("message", (packet, from) => onRtp(member, packet, from));
      rtp.on("error", (error) => say(`RTP port ${port}: ${error.message}`));
      rtcp.on("message", (packet, from) => {
        if (allows(from.address)) member.stats.rtcp++;
      });
      rtcp.on("error", () => {});
      if (!channels.has(channel)) channels.set(channel, { name: channel, members: new Map(), clock: null });
      const room = channels.get(channel);
      room.members.set(callId, member);
      calls.set(callId, member);
      if (codec.mixable) startClock(room);
      const others = [...room.members.values()].filter((other) => other !== member);
      const mixed = others.filter((other) => other.codec.mixable === codec.mixable && other.codec.name === codec.name).length;
      say(`Channel ${channel}: ${label} joined on RTP port ${port} (${codec.name}/${codec.rate}, ${codec.mixable ? "mixed" : "forwarded as is"}); ` +
        `${room.members.size} in the channel${others.length > mixed ? `, ${others.length - mixed} of them on another codec (they won't hear each other)` : ""}`);
      return { port };
    },

    // A re-INVITE's new address for the call.
    update(callId, remote) {
      const member = calls.get(callId);
      if (member && remote?.port && !member.stats.received) member.remote = remote;
    },

    leave(callId, why = "left") {
      const member = calls.get(callId);
      if (!member) return null;
      calls.delete(callId);
      used.delete(member.port);
      member.rtp.close();
      member.rtcp.close();
      const room = channels.get(member.channel);
      room?.members.delete(callId);
      if (room && ![...room.members.values()].some((other) => other.codec.mixable)) stopClock(room);
      if (room && room.members.size === 0) channels.delete(member.channel);
      const seconds = ((Date.now() - member.stats.joined) / 1000).toFixed(1);
      say(`Channel ${member.channel}: ${member.label} ${why} after ${seconds} s (RTP in ${member.stats.received}, out ${member.stats.sent}, RTCP in ${member.stats.rtcp}); ${room?.members.size ?? 0} left in the channel`);
      return member;
    },

    has: (callId) => calls.has(callId),
    channels: () => [...channels.values()].map((room) => ({ name: room.name, members: [...room.members.values()].map((member) => ({ label: member.label, codec: member.codec.name, port: member.port, ...member.stats })) })),

    close() {
      for (const callId of [...calls.keys()]) this.leave(callId, "dropped (backend closing)");
    }
  };
}

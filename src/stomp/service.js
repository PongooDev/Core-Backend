import crypto from "node:crypto";
import { log } from "../log.js";
import { acceptWebSocket } from "./websocket.js";

// STOMP notifications over a WebSocket: UE's Stomp module (subprotocols v10/v11/v12.stomp; CONNECT with
// accept-version 1.0,1.1,1.2 and heart-beat) driven by OnlineSubsystemMcp's StompClientMcp, which adds login and a
// passcode (taken to be the access token, as on Epic's service) and subscribes to topics such as
// /topic/fn/profile/<accountId>/<app>. The client reaches it on the backend port through the system hotfix
// ([OnlineSubsystemMcp.StompServiceMcp] in cloudstorage.js).

const protocols = ["v12.stomp", "v11.stomp", "v10.stomp"];
const versions = ["1.2", "1.1", "1.0"];

// STOMP 1.1+ header escaping (CONNECT and CONNECTED frames are never escaped).
const escape = (value) => String(value).replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/:/g, "\\c");
const unescape = (value) => value.replace(/\\([\\rnc])/g, (match, char) => ({ "\\": "\\", r: "\r", n: "\n", c: ":" })[char]);

export function encodeFrame(command, headers = {}, body = "") {
  const raw = command === "CONNECTED" || command === "CONNECT";
  const lines = Object.entries(headers).filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${raw ? key : escape(key)}:${raw ? value : escape(value)}`);
  return `${[command, ...lines].join("\n")}\n\n${body}\0`;
}

// Splits a byte stream into frames; EOLs between frames are heart-beats.
export function createFrameParser(onFrame) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      let start = 0;
      while (start < buffer.length && (buffer[start] === 0x0a || buffer[start] === 0x0d)) start++;
      buffer = buffer.subarray(start);
      const headerEnd = buffer.indexOf("\n\n");
      const crlfEnd = buffer.indexOf("\r\n\r\n");
      const end = crlfEnd !== -1 && (headerEnd === -1 || crlfEnd < headerEnd) ? { at: crlfEnd, size: 4 } : { at: headerEnd, size: 2 };
      if (end.at === -1) return;
      const [command, ...lines] = buffer.subarray(0, end.at).toString("utf8").split(/\r?\n/);
      const headers = {};
      for (const line of lines) {
        const colon = line.indexOf(":");
        if (colon === -1) continue;
        const key = command === "CONNECT" || command === "STOMP" ? line.slice(0, colon) : unescape(line.slice(0, colon));
        // The first occurrence of a repeated header wins.
        if (!(key in headers)) headers[key] = command === "CONNECT" || command === "STOMP" ? line.slice(colon + 1) : unescape(line.slice(colon + 1));
      }
      const bodyStart = end.at + end.size;
      const length = headers["content-length"] !== undefined ? Number(headers["content-length"]) : -1;
      const bodyEnd = length >= 0 ? bodyStart + length : buffer.indexOf(0, bodyStart);
      if (bodyEnd === -1 || buffer.length <= bodyEnd) return;
      const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.subarray(bodyEnd + 1);
      onFrame({ command, headers, body });
    }
  };
}

export function createStompService({ tokens, quiet = false }) {
  const say = quiet ? () => {} : (message) => log("STOMP", message);
  const connections = new Set();

  function handleUpgrade(req, socket, head) {
    const ws = acceptWebSocket(req, socket, head, { protocols });
    if (!ws) return;
    const connection = { ws, session: null, subscriptions: new Map() };
    connections.add(connection);
    const send = (command, headers, body) => ws.send(encodeFrame(command, headers, body));
    const fail = (message) => {
      send("ERROR", { message });
      ws.close();
    };

    const parse = createFrameParser(({ command, headers }) => {
      if (!connection.session) {
        if (command !== "CONNECT" && command !== "STOMP") return fail("Not connected");
        const session = tokens.find(headers.passcode ?? "");
        if (!session) {
          say(`Connection refused for ${headers.login || "(no login)"}: unknown or expired token`);
          return fail("Invalid or expired access token");
        }
        const offered = (headers["accept-version"] ?? "1.0").split(",");
        connection.session = session;
        connection.who = session.accountId ?? session.clientId;
        // No heart-beats either way: the backend never times a client out, and the client then expects none.
        send("CONNECTED", { version: versions.find((version) => offered.includes(version)) ?? "1.0", "heart-beat": "0,0",
          session: crypto.randomUUID(), server: "Core-Backend" });
        say(`${connection.who} connected`);
        return;
      }
      if (command === "SUBSCRIBE") {
        if (!headers.id || !headers.destination) return fail("SUBSCRIBE needs id and destination");
        connection.subscriptions.set(headers.id, headers.destination);
      } else if (command === "UNSUBSCRIBE") {
        connection.subscriptions.delete(headers.id);
      } else if (command === "DISCONNECT") {
        if (headers.receipt) send("RECEIPT", { "receipt-id": headers.receipt });
        return ws.close();
      } else if (command !== "SEND" && command !== "ACK" && command !== "NACK") {
        return fail(`Unknown command ${command}`);
      }
      if (headers.receipt) send("RECEIPT", { "receipt-id": headers.receipt });
    });

    ws.on("message", (message) => {
      try {
        parse(message);
      } catch {
        fail("Malformed frame");
      }
    });
    ws.on("close", () => {
      connections.delete(connection);
      if (connection.session) say(`${connection.who} disconnected`);
    });
  }

  return {
    handleUpgrade,

    // Sends body (an object becomes JSON) to everyone subscribed to destination.
    publish(destination, body) {
      const text = typeof body === "string" ? body : JSON.stringify(body);
      for (const { ws, session, subscriptions } of connections) {
        if (!session) continue;
        for (const [id, subscribed] of subscriptions) {
          if (subscribed !== destination) continue;
          ws.send(encodeFrame("MESSAGE", { subscription: id, "message-id": crypto.randomUUID(), destination,
            "content-type": "application/json", "content-length": Buffer.byteLength(text) }, text));
        }
      }
    },

    closeAll() {
      for (const { ws } of connections) ws.close(1001);
    }
  };
}

// WebSocket upgrades on the backend port are STOMP connections.
export function enableStomp(server, stomp) {
  server.on("upgrade", (req, socket, head) => stomp.handleUpgrade(req, socket, head));
  const closeAllConnections = server.closeAllConnections.bind(server);
  server.closeAllConnections = () => {
    stomp.closeAll();
    closeAllConnections();
  };
}

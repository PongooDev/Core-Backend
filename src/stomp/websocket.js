import crypto from "node:crypto";
import { EventEmitter } from "node:events";

// A WebSocket server connection (RFC 6455), just what the client's libwebsockets needs: the opening handshake with
// a subprotocol, text and binary messages (fragmented or not), ping/pong and close.
const handshakeGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const opcodes = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa };

function encodeFrame(opcode, payload) {
  const length = payload.length;
  const header = length < 126 ? Buffer.alloc(2) : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  if (length < 126) {
    header[1] = length;
  } else if (length < 65536) {
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

// Upgrades an HTTP request ('upgrade' event) to a WebSocket. Returns an emitter of "message" (Buffer) and "close",
// with send(textOrBuffer) and close(), or null after refusing a bad handshake.
export function acceptWebSocket(req, socket, head, { protocols = [], maxMessage = 1024 * 1024 } = {}) {
  const key = req.headers["sec-websocket-key"];
  if (!key || (req.headers.upgrade ?? "").toLowerCase() !== "websocket") {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return null;
  }
  const offered = (req.headers["sec-websocket-protocol"] ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  const protocol = protocols.find((name) => offered.includes(name));
  const accept = crypto.createHash("sha1").update(key + handshakeGuid).digest("base64");
  socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`,
    ...(protocol ? [`Sec-WebSocket-Protocol: ${protocol}`] : []), "", ""].join("\r\n"));
  socket.setNoDelay(true);

  const ws = new EventEmitter();
  let buffer = head?.length ? Buffer.from(head) : Buffer.alloc(0);
  let fragments = [];
  let closed = false;

  const write = (opcode, payload) => {
    if (!closed && socket.writable) socket.write(encodeFrame(opcode, payload));
  };

  ws.protocol = protocol;
  ws.send = (data) => write(typeof data === "string" ? opcodes.text : opcodes.binary, Buffer.isBuffer(data) ? data : Buffer.from(data));
  ws.close = (code = 1000) => {
    if (closed) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code);
    write(opcodes.close, payload);
    closed = true;
    socket.end();
    setTimeout(() => socket.destroy(), 1000).unref();
  };

  function parse() {
    while (buffer.length >= 2) {
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (length > maxMessage) return ws.close(1009);
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      if (masked) offset += 4;
      if (buffer.length < offset + length) return;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      buffer = buffer.subarray(offset + length);

      if (opcode === opcodes.close) {
        ws.close(payload.length >= 2 ? payload.readUInt16BE(0) : 1000);
        return;
      }
      if (opcode === opcodes.ping) {
        write(opcodes.pong, payload);
        continue;
      }
      if (opcode === opcodes.pong) continue;
      fragments.push(payload);
      if (fragments.reduce((sum, part) => sum + part.length, 0) > maxMessage) return ws.close(1009);
      if (fin) {
        const message = Buffer.concat(fragments);
        fragments = [];
        ws.emit("message", message);
      }
    }
  }

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    parse();
  });
  socket.on("error", () => socket.destroy());
  socket.on("close", () => {
    closed = true;
    ws.emit("close");
  });
  if (buffer.length) setImmediate(parse);
  return ws;
}

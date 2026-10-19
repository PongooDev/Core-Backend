import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { createFrameParser, createStompService, encodeFrame, enableStomp } from "../src/stomp/service.js";
import { startBackend, userLogin } from "./helpers.js";

// A STOMP client like UE's Stomp module: WebSocket subprotocols v10-v12.stomp, frames in WebSocket messages.
async function stompClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/stomp`, ["v10.stomp", "v11.stomp", "v12.stomp"]);
  ws.binaryType = "arraybuffer";
  const frames = [];
  const waiters = [];
  const parse = createFrameParser((frame) => {
    const waiter = waiters.shift();
    if (waiter) waiter(frame);
    else frames.push(frame);
  });
  ws.addEventListener("message", (event) => parse(Buffer.from(typeof event.data === "string" ? event.data : new Uint8Array(event.data))));
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return {
    ws,
    send: (command, headers, body) => ws.send(encodeFrame(command, headers, body)),
    next: () => (frames.length ? Promise.resolve(frames.shift()) : new Promise((resolve) => waiters.push(resolve))),
    closed: new Promise((resolve) => ws.addEventListener("close", resolve, { once: true }))
  };
}

test("frames split across reads, with heart-beat EOLs and escaped headers, parse whole", () => {
  const frames = [];
  const parse = createFrameParser((frame) => frames.push(frame));
  const text = `\n\r\n${encodeFrame("SEND", { destination: "/a:b", note: "x\ny" }, "hi")}\n${encodeFrame("SEND", { "content-length": 3 }, "a\0b")}`;
  for (const byte of Buffer.from(text)) parse(Buffer.from([byte]));
  assert.deepEqual(frames.map(({ command, headers, body }) => [command, headers, body]), [
    ["SEND", { destination: "/a:b", note: "x\ny" }, "hi"],
    ["SEND", { "content-length": "3" }, "a\0b"]
  ]);
});

test("the client's STOMP connection works on the backend port: CONNECT with its token, then subscriptions", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "StompPlayer");
    const client = await stompClient(backend.port);
    assert.equal(client.ws.protocol, "v12.stomp");
    client.send("CONNECT", { "accept-version": "1.0,1.1,1.2", "heart-beat": "30000,0", login: accountId, passcode: token });
    const connected = await client.next();
    assert.equal(connected.command, "CONNECTED");
    assert.deepEqual([connected.headers.version, connected.headers["heart-beat"]], ["1.2", "0,0"]);

    client.send("SUBSCRIBE", { id: "sub-0", destination: `/topic/fn/profile/${accountId}/Fortnite`, receipt: "r-1" });
    assert.deepEqual(await client.next(), { command: "RECEIPT", headers: { "receipt-id": "r-1" }, body: "" });
    client.send("DISCONNECT", { receipt: "r-2" });
    assert.equal((await client.next()).headers["receipt-id"], "r-2");
    await client.closed;

    const refused = await stompClient(backend.port);
    refused.send("CONNECT", { "accept-version": "1.2", login: accountId, passcode: "0".repeat(32) });
    assert.equal((await refused.next()).command, "ERROR");
    await refused.closed;
  } finally {
    backend.close();
  }
});

test("published notifications reach the subscribers of their destination", async () => {
  const stomp = createStompService({ tokens: { find: (token) => (token === "good" ? { accountId: "a" } : null) }, quiet: true });
  const server = http.createServer();
  enableStomp(server, stomp);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const client = await stompClient(server.address().port);
    client.send("CONNECT", { "accept-version": "1.2", passcode: "good" });
    await client.next();
    client.send("SUBSCRIBE", { id: "sub-0", destination: "/topic/fn/profile/a/Fortnite", receipt: "r" });
    await client.next();
    stomp.publish("/topic/fn/other", { ignored: true });
    stomp.publish("/topic/fn/profile/a/Fortnite", { type: "test", "é": "ok" });
    const message = await client.next();
    assert.equal(message.command, "MESSAGE");
    assert.deepEqual([message.headers.subscription, message.headers.destination], ["sub-0", "/topic/fn/profile/a/Fortnite"]);
    assert.deepEqual(JSON.parse(message.body), { type: "test", "é": "ok" });
    client.ws.close();
    await client.closed;
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

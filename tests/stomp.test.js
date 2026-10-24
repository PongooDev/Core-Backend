import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { createFrameParser, createStompService, encodeFrame, enableStomp } from "../src/stomp/service.js";
import { dedicatedServerToken, post, startBackend, userLogin } from "./helpers.js";

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

test("what the gameserver changes reaches the player's client as MCP profile notifications, and nobody else's", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "StompQuests");
    const other = await userLogin(backend.port, "StompOther");
    const quest = "Quest:stonewoodquest_filler_1_d2";
    await post(backend.port, `/admin/api/accounts/${player.accountId}/grant`, undefined, { templateId: quest, quantity: 1 });
    const connect = async ({ accountId, token }) => {
      const client = await stompClient(backend.port);
      client.send("CONNECT", { "accept-version": "1.2", login: accountId, passcode: token });
      await client.next();
      client.send("SUBSCRIBE", { id: "mcp-0-nil", destination: `/topic/fn/profile/${player.accountId}/fortnite`, receipt: "r" });
      await client.next();
      return client;
    };
    const own = await connect(player);
    const snooper = await connect(other);
    const dedicated = await dedicatedServerToken(backend.port);
    const route = `/fortnite/api/game/v2/profile/${player.accountId}/dedicated_server/UpdateQuests?profileId=profile0&rvn=-1`;
    const response = await post(backend.port, route, dedicated, { advance: [{ statName: "questcollect_survivoritemdata", count: 2 }] });

    const message = await own.next();
    assert.equal(message.headers.destination, `/topic/fn/profile/${player.accountId}/fortnite`);
    const notification = JSON.parse(message.body);
    assert.equal(notification.type, "profile/profile0/update");
    assert.equal(notification.revision, response.body.profileRevision);
    assert.equal(notification.commandRevision, response.body.profileCommandRevision);
    assert.deepEqual(notification.changes.map(({ changeType, attributeName, attributeValue }) => [changeType, attributeName, attributeValue]),
      [["itemAttrChanged", "completion_questcollect_survivoritemdata", 2]]);

    // Nothing changed, nothing sent; and the other account's subscription to the player's topic gets nothing.
    await post(backend.port, route, dedicated, { advance: [] });
    snooper.send("DISCONNECT", { receipt: "bye" });
    assert.equal((await snooper.next()).command, "RECEIPT");
    own.send("DISCONNECT", { receipt: "bye" });
    assert.equal((await own.next()).command, "RECEIPT");
  } finally {
    backend.close();
  }
});

test("an admin panel change reaches the player's client as an MCP profile notification (Core-Backend #32)", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "StompAdmin");
    const query = await post(backend.port, `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=profile0&rvn=-1`, player.token, {});
    const client = await stompClient(backend.port);
    client.send("CONNECT", { "accept-version": "1.2", login: player.accountId, passcode: player.token });
    await client.next();
    client.send("SUBSCRIBE", { id: "mcp-0-nil", destination: `/topic/fn/profile/${player.accountId}/fortnite`, receipt: "r" });
    await client.next();

    const upgraded = await post(backend.port, `/admin/api/accounts/${player.accountId}/founders`, undefined, { edition: 2 });
    assert.equal(upgraded.status, 200);
    const notification = JSON.parse((await client.next()).body);
    assert.equal(notification.type, "profile/profile0/update");
    assert.equal(notification.revision, query.body.profileRevision + 1, "the revision after the client's, so it applies the delta");
    assert.deepEqual(notification.changes.filter(({ changeType }) => changeType === "itemAdded").map(({ item }) => item.templateId),
      ["Token:founderspack_2", "Quest:foundersquest_getrewards_1_2"]);

    // A refused change sends nothing.
    assert.equal((await post(backend.port, `/admin/api/accounts/${player.accountId}/founders`, undefined, { edition: 1 })).status, 400);
    client.send("DISCONNECT", { receipt: "bye" });
    assert.equal((await client.next()).command, "RECEIPT");
  } finally {
    backend.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";
import { clientToken, del, get, post, request, startBackend, userLogin } from "./helpers.js";
import { login as xmppLogin } from "./xmpp-client.js";

// GET /core/api/presence (CoreV2 #467): what the launcher's Discord Rich Presence shows.

const base = "/fortnite/api/matchmaking/session";
const server = {
  ownerId: "", ownerName: "CoreServer1", serverName: "CoreServer1", maxPublicPlayers: 4, maxPrivatePlayers: 0,
  isDedicated: true, buildUniqueId: "595160781", serverPort: 7777,
  attributes: { GAMEMODE_s: "FORTEMPTY", REGION_s: "NA", MATCHMAKINGPOOL_s: "Any", BEACONPORT_i: 15000 }
};
const presence = (port, username, after) =>
  get(port, `/core/api/presence?username=${encodeURIComponent(username)}${after ? `&after=${after}` : ""}`);
const pending = async (promise) => (await Promise.race([promise.then(() => "answered"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 150))]));

test("a player is offline, in the lobby once their game logs in to XMPP, and in a match while a server has them", async () => {
  const backend = await startBackend();
  const clients = [];
  try {
    assert.deepEqual((await presence(backend.port, "Nobody")).body, { state: "offline" }, "no account, no name");

    const player = await userLogin(backend.port, "MrPodge6");
    assert.deepEqual((await presence(backend.port, "mrpodge6")).body, { displayName: "MrPodge6", state: "offline" });

    const { client } = await xmppLogin(backend.port, player.accountId, player.token);
    clients.push(client);
    assert.deepEqual((await presence(backend.port, "MrPodge6")).body, { displayName: "MrPodge6", state: "lobby" });

    const host = await clientToken(backend.port);
    const { body: session } = await post(backend.port, base, host, server);
    await post(backend.port, `${base}/${session.id}/players`, host, { publicPlayers: [player.accountId], privatePlayers: [] });
    assert.equal((await presence(backend.port, "MrPodge6")).body.state, "match");

    await request(backend.port, "DELETE", `${base}/${session.id}/players`, host, [player.accountId]);
    assert.equal((await presence(backend.port, "MrPodge6")).body.state, "lobby", "UnregisterPlayers takes them back to the lobby");

    await post(backend.port, `${base}/${session.id}/players`, host, { publicPlayers: [], privatePlayers: [player.accountId] });
    assert.equal((await presence(backend.port, "MrPodge6")).body.state, "match");
    await del(backend.port, `${base}/${session.id}`, host);
    assert.equal((await presence(backend.port, "MrPodge6")).body.state, "lobby", "so does the session ending");

    client.close();
    await once(client.socket, "close");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await presence(backend.port, "MrPodge6")).body.state, "offline");
  } finally {
    for (const client of clients) client.close();
    backend.close();
  }
});

test("with after= it answers once the state changes: the XMPP login, a server registering the player, the session ending", async () => {
  const backend = await startBackend({ presenceWaitMs: 10_000 });
  const clients = [];
  try {
    const player = await userLogin(backend.port, "MrPodge6");
    assert.equal((await presence(backend.port, "MrPodge6", "lobby")).body.state, "offline", "a different state is answered at once");

    let waiting = presence(backend.port, "MrPodge6", "offline");
    assert.equal(await pending(waiting), "waiting");
    const { client } = await xmppLogin(backend.port, player.accountId, player.token);
    clients.push(client);
    assert.deepEqual((await waiting).body, { displayName: "MrPodge6", state: "lobby" });

    const host = await clientToken(backend.port);
    const { body: session } = await post(backend.port, base, host, server);
    waiting = presence(backend.port, "MrPodge6", "lobby");
    assert.equal(await pending(waiting), "waiting", "another session's change doesn't answer it");
    await post(backend.port, `${base}/${session.id}/players`, host, { publicPlayers: [player.accountId], privatePlayers: [] });
    assert.equal((await waiting).body.state, "match");

    waiting = presence(backend.port, "MrPodge6", "match");
    assert.equal(await pending(waiting), "waiting");
    await del(backend.port, `${base}/${session.id}`, host);
    assert.equal((await waiting).body.state, "lobby");

    waiting = presence(backend.port, "MrPodge6", "lobby");
    assert.equal(await pending(waiting), "waiting");
    client.close();
    assert.equal((await waiting).body.state, "offline");
  } finally {
    for (const client of clients) client.close();
    backend.close();
  }
});

test("with nothing changing it answers the same state once presenceWaitMs has passed", async () => {
  const backend = await startBackend({ presenceWaitMs: 200 });
  try {
    await userLogin(backend.port, "MrPodge6");
    const started = Date.now();
    assert.deepEqual((await presence(backend.port, "MrPodge6", "offline")).body, { displayName: "MrPodge6", state: "offline" });
    assert.ok(Date.now() - started >= 150, "it waited");
  } finally {
    backend.close();
  }
});

// A backend with remote access on whose connections come from `from.address`, as if made from that machine, except the
// ones pinned (by the client's port) to an address of their own: the game's XMPP connection stays where it was made.
async function startRemoteBackend() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-"));
  const backend = await createServer({ dataDir, requestLog: false, emptyServerWaitMs: 0, earnScoreWaitMs: 0, remoteAccess: true });
  const from = { address: "127.0.0.1" };
  const pinned = new Map();
  backend.prependListener("connection", (socket) => {
    const port = socket.remotePort;
    Object.defineProperty(socket, "remoteAddress", { get: () => pinned.get(port) ?? from.address, configurable: true });
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  return {
    port: backend.address().port,
    from,
    pin: (client, address) => pinned.set(client.socket.localPort, address),
    close() {
      backend.closeAllConnections();
      backend.close();
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
}

test("another PC is answered only about an account that plays from it; anyone else hears offline and no name", async () => {
  const backend = await startRemoteBackend();
  const clients = [];
  try {
    backend.from.address = "203.0.113.7";
    const player = await userLogin(backend.port, "MrPodge6");
    assert.deepEqual((await presence(backend.port, "MrPodge6")).body, { state: "offline" }, "not playing from there yet");

    const { client } = await xmppLogin(backend.port, player.accountId, player.token);
    clients.push(client);
    backend.pin(client, "203.0.113.7");
    assert.deepEqual((await presence(backend.port, "MrPodge6")).body, { displayName: "MrPodge6", state: "lobby" });

    backend.from.address = "198.51.100.9";
    assert.deepEqual((await presence(backend.port, "MrPodge6")).body, { state: "offline" });

    backend.from.address = "127.0.0.1";
    assert.deepEqual((await presence(backend.port, "MrPodge6")).body, { displayName: "MrPodge6", state: "lobby" }, "this PC is always told");
  } finally {
    for (const client of clients) client.close();
    backend.close();
  }
});

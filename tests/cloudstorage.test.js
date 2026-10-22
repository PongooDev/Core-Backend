import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { certUserAgent, clientToken, dedicatedServerToken, del, get, openTunnel, post, request, send, startBackend, userLogin } from "./helpers.js";

function raw(port, method, path, token, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      method,
      path,
      headers: { "User-Agent": certUserAgent, Authorization: `bearer ${token}`, "Content-Type": "application/octet-stream" }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("user files can be written, listed with their SHA-1, read back and deleted", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    const base = `/fortnite/api/cloudstorage/user/${accountId}`;

    assert.deepEqual((await get(backend.port, base, token)).body, []);

    const settings = crypto.randomBytes(3000);
    assert.equal((await raw(backend.port, "PUT", `${base}/ClientSettings.Sav`, token, settings)).status, 204);

    const listed = await get(backend.port, base, token);
    assert.deepEqual(listed.body, [{
      filename: "ClientSettings.Sav",
      hash: crypto.createHash("sha1").update(settings).digest("hex"),
      length: settings.length
    }]);

    const read = await raw(backend.port, "GET", `${base}/ClientSettings.Sav`, token);
    assert.equal(read.status, 200);
    assert.ok(read.body.equals(settings));

    assert.equal((await del(backend.port, `${base}/ClientSettings.Sav`, token)).status, 204);
    assert.deepEqual((await get(backend.port, base, token)).body, []);
  } finally {
    backend.close();
  }
});

test("user files stay private and file names cannot leave the folder", async () => {
  const backend = await startBackend();
  try {
    const me = await userLogin(backend.port, "CoreTest");
    const other = await userLogin(backend.port, "Other");

    assert.equal((await get(backend.port, `/fortnite/api/cloudstorage/user/${other.accountId}`, me.token)).status, 403);

    const escape = await raw(backend.port, "PUT", `/fortnite/api/cloudstorage/user/${me.accountId}/..%2Faccount.json`, me.token, Buffer.from("x"));
    assert.equal(escape.status, 400);
  } finally {
    backend.close();
  }
});

test("a gameserver's own account lists, reads and writes the storm shield saves of the players on its session, and is refused with a 404", async () => {
  const backend = await startBackend();
  try {
    const server = await userLogin(backend.port, "CoreServer1");
    const owner = await userLogin(backend.port, "StormShieldOwner");
    const stranger = await userLogin(backend.port, "Stranger");
    const ownerFiles = `/fortnite/api/cloudstorage/user/${owner.accountId}`;
    const save = `${ownerFiles}/5c6eb5b4-57ea-4e91-89aa-8ded5db40785_r0_a0.sav`;

    // Not yet hosting: a server account is a plain player.
    assert.equal((await get(backend.port, ownerFiles, server.token)).status, 403);

    // The Cert server's create body leaves ownerId empty; the session is the server account's all the same.
    const { body: session } = await post(backend.port, "/fortnite/api/matchmaking/session", server.token,
      { ownerId: "", ownerName: "CoreServer1", serverName: "CoreServer1", maxPublicPlayers: 4, buildUniqueId: "595160781" });
    assert.equal(session.hostAccountId, undefined);
    const refused = await raw(backend.port, "PUT", save, server.token, Buffer.from("x"));
    assert.equal(refused.status, 404, "a refused gameserver gets no 403, which the Cert OSS answers by shutting down");
    assert.equal(JSON.parse(refused.body).errorCode, "errors.com.epicgames.cloudstorage.user_not_found");

    // The owner joins: the server fetches the connection key for them and registers them.
    await get(backend.port, `/fortnite/api/game/v2/matchmaking/account/${owner.accountId}/session/${session.id}`, server.token);
    await post(backend.port, `/fortnite/api/matchmaking/session/${session.id}/players`, server.token, { publicPlayers: [owner.accountId] });

    const build = crypto.randomBytes(25656);
    assert.equal((await raw(backend.port, "PUT", save, server.token, build)).status, 204);
    assert.deepEqual((await get(backend.port, ownerFiles, server.token)).body,
      [{ filename: "5c6eb5b4-57ea-4e91-89aa-8ded5db40785_r0_a0.sav", hash: crypto.createHash("sha1").update(build).digest("hex"), length: build.length }]);
    assert.ok((await raw(backend.port, "GET", save, server.token)).body.equals(build));
    assert.ok((await raw(backend.port, "GET", save, owner.token)).body.equals(build));

    // A save after they unregister still reaches their files.
    await request(backend.port, "DELETE", `/fortnite/api/matchmaking/session/${session.id}/players`, server.token, [owner.accountId]);
    assert.equal((await raw(backend.port, "PUT", save, server.token, build)).status, 204);

    // Only for the players on its sessions, never deleting, and only its own tokens.
    assert.equal((await get(backend.port, `/fortnite/api/cloudstorage/user/${stranger.accountId}`, server.token)).status, 404);
    assert.equal((await get(backend.port, `/fortnite/api/cloudstorage/user/${"0".repeat(32)}`, server.token)).status, 404);
    assert.equal((await raw(backend.port, "PUT", `/fortnite/api/cloudstorage/user/..%2F../x.sav`, server.token, Buffer.from("x"))).status, 404);
    assert.equal((await del(backend.port, save, server.token)).status, 403);
    assert.equal((await get(backend.port, ownerFiles, stranger.token)).status, 403);
    assert.equal((await get(backend.port, ownerFiles, await clientToken(backend.port))).status, 403);

    // The DedicatedServer client's token reaches any existing player's files.
    const dedicated = await dedicatedServerToken(backend.port);
    assert.equal((await get(backend.port, `/fortnite/api/cloudstorage/user/${stranger.accountId}`, dedicated)).status, 200);
    assert.equal((await get(backend.port, `/fortnite/api/cloudstorage/user/${"0".repeat(32)}`, dedicated)).status, 404);
  } finally {
    backend.close();
  }
});

test("the system hotfix points the client's XMPP at the address and port it reached the backend on", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    const list = await get(backend.port, "/fortnite/api/cloudstorage/system", token);
    assert.equal(list.status, 200);
    const [file] = list.body;
    assert.deepEqual(Object.keys(file).sort(), ["filename", "hash", "hash256", "length", "uniqueFilename"]);
    assert.equal(file.filename, "DefaultEngine.ini");

    const download = await raw(backend.port, "GET", `/fortnite/api/cloudstorage/system/${file.uniqueFilename}`, token);
    assert.equal(download.status, 200);
    assert.equal(download.body.length, file.length);
    assert.equal(crypto.createHash("sha1").update(download.body).digest("hex"), file.hash);
    assert.equal(crypto.createHash("sha256").update(download.body).digest("hex"), file.hash256);
    assert.deepEqual(download.body.toString("utf8").split("\r\n"),
      ["[OnlineSubsystemMcp.XMPP]", "ServerAddr=127.0.0.1", `ServerPort=${backend.port}`, "bUseSSL=false", "",
        "[OnlineSubsystemMcp.StompServiceMcp]", "Protocol=ws", `Domain=127.0.0.1:${backend.port}`, ""]);

    // The same through the HTTPS proxy tunnel the Cert client uses with -httpproxy.
    const host = "fortnite-public-service-prod11.ol.epicgames.com";
    const tunnel = await openTunnel(backend.port, host);
    const tunnelled = await send({ createConnection: () => tunnel, path: "/fortnite/api/cloudstorage/system",
      headers: { Host: host, "User-Agent": certUserAgent, Authorization: `bearer ${token}` } });
    assert.deepEqual(tunnelled.body, list.body);

    const missing = await get(backend.port, "/fortnite/api/cloudstorage/system/DefaultGame.ini", token);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.errorCode, "errors.com.epicgames.cloudstorage.file_not_found");
  } finally {
    backend.close();
  }
});

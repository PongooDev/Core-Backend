import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { certUserAgent, clientToken, dedicatedServerToken, del, get, openTunnel, send, startBackend, userLogin } from "./helpers.js";

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

test("a gameserver's DedicatedServer token lists, reads and writes an existing player's files for a storm shield's world record", async () => {
  const backend = await startBackend();
  try {
    const owner = await userLogin(backend.port, "StormShieldOwner");
    const dedicated = await dedicatedServerToken(backend.port);
    const base = `/fortnite/api/cloudstorage/user/${owner.accountId}`;

    const record = crypto.randomBytes(2000);
    assert.equal((await raw(backend.port, "PUT", `${base}/WorldRecord.sav`, dedicated, record)).status, 204);
    assert.deepEqual((await get(backend.port, base, dedicated)).body,
      [{ filename: "WorldRecord.sav", hash: crypto.createHash("sha1").update(record).digest("hex"), length: record.length }]);
    assert.ok((await raw(backend.port, "GET", `${base}/WorldRecord.sav`, dedicated)).body.equals(record));
    assert.ok((await raw(backend.port, "GET", `${base}/WorldRecord.sav`, owner.token)).body.equals(record));

    assert.equal((await del(backend.port, `${base}/WorldRecord.sav`, dedicated)).status, 403);
    const unknown = await get(backend.port, `/fortnite/api/cloudstorage/user/${"0".repeat(32)}`, dedicated);
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.errorCode, "errors.com.epicgames.account.account_not_found");
    const escape = await raw(backend.port, "PUT", "/fortnite/api/cloudstorage/user/..%2F../x.sav", dedicated, Buffer.from("x"));
    assert.deepEqual([escape.status, JSON.parse(escape.body).errorCode], [404, "errors.com.epicgames.account.account_not_found"]);
    // Another game client token is still kept out.
    assert.equal((await get(backend.port, base, await clientToken(backend.port))).status, 403);
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

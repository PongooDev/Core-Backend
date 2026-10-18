import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { certUserAgent, del, get, startBackend, userLogin } from "./helpers.js";

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

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";
import { get, requestToken, startBackend, userLogin } from "./helpers.js";

test("verify describes a live token and refuses an unknown one the way the client refreshes on", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    const verify = await get(backend.port, "/account/api/oauth/verify?includePerms=true", token);
    assert.equal(verify.status, 200);
    assert.match(verify.headers["content-type"], /^application\/json/);
    assert.equal(verify.body.account_id, accountId);
    assert.equal(verify.body.client_id, "ec684b8c687f479fadea3cb2ad83f5c6");
    assert.match(verify.body.expires_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.ok(verify.body.expires_in > 8 * 60 * 60 - 10 && verify.body.expires_in <= 8 * 60 * 60);

    const unknown = await get(backend.port, "/account/api/oauth/verify?includePerms=true", "0".repeat(32));
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.errorCode, "errors.com.epicgames.common.oauth.invalid_token");
  } finally {
    backend.close();
  }
});

test("tokens survive a backend restart, so a running game stays logged in", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-"));
  const start = async () => {
    const server = await createServer({ dataDir, requestLog: false });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server;
  };
  const stop = (server) => {
    server.closeAllConnections();
    server.close();
  };

  try {
    let server = await start();
    const login = await requestToken(server.address().port, { grant_type: "password", username: "CoreTest", password: "x" });
    stop(server);

    server = await start();
    const { port } = server.address();
    assert.equal((await get(port, "/account/api/oauth/verify", login.body.access_token)).status, 200);
    const refreshed = await requestToken(port, { grant_type: "refresh_token", refresh_token: login.body.refresh_token });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.account_id, login.body.account_id);
    stop(server);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

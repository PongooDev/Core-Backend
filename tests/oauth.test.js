import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { certClient, requestToken, send, startBackend } from "./helpers.js";

function assertUsableToken(response) {
  assert.equal(response.status, 200);
  assert.ok(response.headers.date);
  assert.ok(response.body.access_token.length > 0);
  assert.ok(Date.parse(response.body.expires_at) > Date.now());
}

test("client credentials give a client token without an account", async () => {
  const backend = await startBackend();
  try {
    const response = await requestToken(backend.port, { grant_type: "client_credentials", token_type: "eg1" });
    assertUsableToken(response);
    assert.equal(response.body.client_id, certClient);
    assert.equal(response.body.account_id, undefined);
  } finally {
    backend.close();
  }
});

test("password login creates the account once and accepts any password", async () => {
  const backend = await startBackend();
  try {
    const first = await requestToken(backend.port, { grant_type: "password", username: "CoreTest", password: "a" });
    assertUsableToken(first);
    const accountId = first.body.account_id;
    assert.match(accountId, /^[0-9a-f]{32}$/);
    assert.ok(Date.parse(first.body.refresh_expires_at) > Date.now());

    const account = JSON.parse(fs.readFileSync(path.join(backend.dataDir, "accounts", accountId, "account.json"), "utf8"));
    assert.equal(account.displayName, "CoreTest");

    const again = await requestToken(backend.port, { grant_type: "password", username: "coretest@example.com", password: "b" });
    assert.equal(again.body.account_id, accountId);

    const other = await requestToken(backend.port, { grant_type: "password", username: "Other", password: "a" });
    assert.notEqual(other.body.account_id, accountId);
  } finally {
    backend.close();
  }
});

test("a refresh token can be used once", async () => {
  const backend = await startBackend();
  try {
    const login = await requestToken(backend.port, { grant_type: "password", username: "CoreTest", password: "a" });
    const refreshed = await requestToken(backend.port, { grant_type: "refresh_token", refresh_token: login.body.refresh_token });
    assertUsableToken(refreshed);
    assert.equal(refreshed.body.account_id, login.body.account_id);

    const reused = await requestToken(backend.port, { grant_type: "refresh_token", refresh_token: login.body.refresh_token });
    assert.equal(reused.status, 400);
  } finally {
    backend.close();
  }
});

test("token requests without client credentials are rejected", async () => {
  const backend = await startBackend();
  try {
    const response = await send({
      host: "127.0.0.1",
      port: backend.port,
      method: "POST",
      path: "/account/api/oauth/token",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    }, "grant_type=client_credentials");
    assert.equal(response.status, 401);
    assert.ok(response.body.errorCode);
  } finally {
    backend.close();
  }
});

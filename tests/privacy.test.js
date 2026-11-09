import { test } from "node:test";
import assert from "node:assert/strict";
import { send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #303: 4.5's privacy settings query and update.
const userAgent = "game=Fortnite, engine=UE4, build=++Fortnite+Release-4.5-CL-4166199";

const privacy = (port, accountId, token, method = "GET", body) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": userAgent, Authorization: `bearer ${token}` };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: `/fortnite/api/game/v2/privacy/account/${accountId}`, headers }, text);
};

test("the privacy settings default to opted in, are set per account and are kept", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "PrivacyPlayer");
    const other = await userLogin(backend.port, "PrivacyOther");

    let response = await privacy(backend.port, player.accountId, player.token);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { accountId: player.accountId, optOutOfPublicLeaderboards: false });

    response = await privacy(backend.port, player.accountId, player.token, "POST", { accountId: player.accountId, optOutOfPublicLeaderboards: true });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { accountId: player.accountId, optOutOfPublicLeaderboards: true });

    assert.equal((await privacy(backend.port, player.accountId, player.token)).body.optOutOfPublicLeaderboards, true);
    assert.equal((await privacy(backend.port, other.accountId, other.token)).body.optOutOfPublicLeaderboards, false);

    assert.equal((await privacy(backend.port, other.accountId, player.token, "POST", { optOutOfPublicLeaderboards: false })).status, 403);
    assert.equal((await privacy(backend.port, player.accountId, player.token, "POST", { optOutOfPublicLeaderboards: "yes" })).status, 400);
    assert.equal((await privacy(backend.port, player.accountId, player.token, "POST", {})).body.optOutOfPublicLeaderboards, true);
  } finally {
    backend.close();
  }
});

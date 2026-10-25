import { test } from "node:test";
import assert from "node:assert/strict";
import { dedicatedServerToken, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #39: 1.2's Twitch account info query.
const userAgent = "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3541083";

const twitch = (port, accountId, token) =>
  send({ host: "127.0.0.1", port, path: `/fortnite/api/game/v2/twitch/${accountId}`, headers: { "User-Agent": userAgent, Authorization: `bearer ${token}` } });

test("1.2's Twitch account info query is answered with an object holding no Twitch info", async () => {
  const backend = await startBackend();
  try {
    const login = await userLogin(backend.port, "TwitchViewer");
    const response = await twitch(backend.port, login.accountId, login.token);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {});

    const server = await twitch(backend.port, login.accountId, await dedicatedServerToken(backend.port));
    assert.equal(server.status, 200);
  } finally {
    backend.close();
  }
});

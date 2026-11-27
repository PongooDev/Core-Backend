import { test } from "node:test";
import assert from "node:assert/strict";
import { send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #444: 9.20+'s FOnlineContentControlsServiceMcp::DownloadUser, GET /content-controls/{accountId}.
const userAgent = "game=Fortnite, engine=UE4, build=++Fortnite+Release-9.21-CL-6922310";

const downloadUser = (port, accountId, token) => {
  const headers = { "User-Agent": userAgent };
  if (token) headers.Authorization = `bearer ${token}`;
  return send({ host: "127.0.0.1", port, method: "GET", path: `/content-controls/${accountId}`, headers });
};

test("content-controls answers the user with no parental controls set", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "ContentControlsPlayer");

    const response = await downloadUser(backend.port, player.accountId, player.token);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      data: { principalId: player.accountId, ageGate: 0, contentControlsEnabled: false, pinGatedPurchasingEnabled: false },
    });

    assert.equal((await downloadUser(backend.port, player.accountId)).status, 401);
  } finally {
    backend.close();
  }
});

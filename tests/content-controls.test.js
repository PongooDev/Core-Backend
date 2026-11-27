import { test } from "node:test";
import assert from "node:assert/strict";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

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

test("content-controls: create the user with a PIN, verify it, save and serve the rules, and the admin clears it", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "ContentControlsParent");
    const id = player.accountId;
    const rulesPath = `/content-controls/${id}/rules/namespaces/fn`;

    assert.equal((await post(backend.port, "/content-controls", player.token, { principalId: id, pin: "1234", pinConfirm: "4321" })).status, 400);
    const created = await post(backend.port, "/content-controls", player.token, { principalId: id, pin: "1234", pinConfirm: "1234" });
    assert.equal(created.status, 200);
    assert.equal(created.body.data.contentControlsEnabled, true);
    assert.equal((await post(backend.port, "/content-controls", player.token, { principalId: id, pin: "5555", pinConfirm: "5555" })).status, 409);

    const user = await downloadUser(backend.port, id, player.token);
    assert.deepEqual(user.body.data, { principalId: id, ageGate: 0, contentControlsEnabled: true, pinGatedPurchasingEnabled: true });

    assert.equal((await post(backend.port, `/content-controls/${id}/verify-pin`, player.token, { pin: "1234" })).status, 204);
    const wrong = await post(backend.port, `/content-controls/${id}/verify-pin`, player.token, { pin: "0000" });
    assert.equal(wrong.status, 403);
    assert.match(wrong.body.errorCode, /onlinecontentcontrolsservicemcp/);

    assert.equal((await post(backend.port, rulesPath, player.token, { pin: "0000", canUseVoiceChat: false })).status, 403);
    const updated = await post(backend.port, rulesPath, player.token, { pin: "1234", canUseVoiceChat: false, playtimeReportingFrequency: "weekly", bogus: 1 });
    assert.equal(updated.status, 200);
    const rules = (await get(backend.port, rulesPath, player.token)).body.data.result;
    assert.equal(rules.canUseVoiceChat, false);
    assert.equal(rules.playtimeReportingFrequency, "weekly");
    assert.equal(rules.allowedToMakePurchases, true);
    assert.equal("bogus" in rules, false);

    const other = await userLogin(backend.port, "ContentControlsOther");
    assert.equal((await post(backend.port, `/content-controls/${id}/verify-pin`, other.token, { pin: "1234" })).status, 403);

    const admin = await post(backend.port, `/admin/api/accounts/${id}/content-controls/clear`, undefined, {});
    assert.equal(admin.status, 200);
    assert.equal(admin.body.contentControls, null);
    assert.equal((await downloadUser(backend.port, id, player.token)).body.data.contentControlsEnabled, false);
    assert.equal((await get(backend.port, rulesPath, player.token)).body.data.result.canUseVoiceChat, true);
  } finally {
    backend.close();
  }
});

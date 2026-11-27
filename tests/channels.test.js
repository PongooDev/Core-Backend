import { test } from "node:test";
import assert from "node:assert/strict";
import { send, startBackend, userLogin } from "./helpers.js";

const userAgent = "Fortnite/++Fortnite+Release-9.20-CL-6822798 Windows/10.0.26200.1.256.64bit";
const querySettings = (port, token, body) => send({
  host: "127.0.0.1", port, method: "POST", path: "/api/v1/user/setting",
  headers: { "User-Agent": userAgent, "Content-Type": "application/x-www-form-urlencoded", ...(token ? { Authorization: `bearer ${token}` } : {}) }
}, body);

test("9.20's avatar query gets the accounts' saved settings: none, as no Core account used the Party Hub", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    const friend = await userLogin(backend.port, "CoreFriend");
    const keys = "settingKey=avatar&settingKey=avatarBackground&settingKey=appInstalled";

    for (const body of [`accountId=${accountId}&${keys}`, `accountId=${accountId}&accountId=${friend.accountId}&${keys}`]) {
      const answer = await querySettings(backend.port, token, body);
      assert.equal(answer.status, 200);
      assert.deepEqual(answer.body, []);
    }

    assert.equal((await querySettings(backend.port, undefined, `accountId=${accountId}&${keys}`)).status, 401);
  } finally {
    backend.close();
  }
});

test("9.21's Play button tells the channels service the player is active: 204, no body", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    const notify = (auth) => send({
      host: "127.0.0.1", port: backend.port, method: "POST", path: `/api/v1/user/${accountId}/notifyActive`,
      headers: { "User-Agent": userAgent, "Content-Type": "application/json", ...(auth ? { Authorization: `bearer ${auth}` } : {}) }
    });
    assert.equal((await notify(token)).status, 204);
    assert.equal((await notify(undefined)).status, 401);
  } finally {
    backend.close();
  }
});

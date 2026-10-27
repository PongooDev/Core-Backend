import { test } from "node:test";
import assert from "node:assert/strict";
import { del, get, startBackend, userLogin } from "./helpers.js";

test("account info has the id, displayName and lastLogin the client stores", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");

    const info = await get(backend.port, `/account/api/public/account/${accountId}`, token);
    assert.equal(info.status, 200);
    assert.equal(info.body.id, accountId);
    assert.equal(info.body.displayName, "CoreTest");
    assert.ok(Date.parse(info.body.lastLogin) <= Date.now());
    assert.equal(info.body.headless, false);
    assert.equal(info.body.email, "CoreTest@core.com");
    const other = await userLogin(backend.port, "Core Other");
    const otherInfo = await get(backend.port, `/account/api/public/account/${other.accountId}`, token);
    assert.equal(otherInfo.body.email, undefined);
    assert.equal((await get(backend.port, `/account/api/public/account/${other.accountId}`, other.token)).body.email, "CoreOther@core.com");

    const externalAuths = await get(backend.port, `/account/api/public/account/${accountId}/externalAuths`, token);
    assert.deepEqual(externalAuths.body, []);

    const missing = await get(backend.port, "/account/api/public/account/0123456789abcdef0123456789abcdef", token);
    assert.equal(missing.status, 404);
  } finally {
    backend.close();
  }
});

test("killing other sessions logs out older logins of the same account", async () => {
  const backend = await startBackend();
  try {
    const first = await userLogin(backend.port, "CoreTest");
    const second = await userLogin(backend.port, "CoreTest");
    const other = await userLogin(backend.port, "SomeoneElse");

    const kill = await del(backend.port, "/account/api/oauth/sessions/kill?killType=OTHERS_ACCOUNT_CLIENT_SERVICE", second.token);
    assert.equal(kill.status, 204);
    assert.equal(kill.body, null);

    const path = (id) => `/account/api/public/account/${id}`;
    assert.equal((await get(backend.port, path(first.accountId), first.token)).status, 401);
    assert.equal((await get(backend.port, path(second.accountId), second.token)).status, 200);
    assert.equal((await get(backend.port, path(other.accountId), other.token)).status, 200);
  } finally {
    backend.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowedBuildList, allowsBuild } from "../src/builds/allowed.js";
import { createSettingsStore } from "../src/settings/store.js";
import { certClient, get, post, send, startBackend } from "./helpers.js";

// Core-Backend #164: the admin panel's allowed builds.
const agent = (changelist) => (changelist ? `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${changelist}` : "Core-Launcher");
const dedicatedServer = { id: "313dfed3ec3023e52d3be9dda178bdfa", secret: "111aa434a6780d54f5cf759149639f20" };

function as(changelist, port, method, path, token, body) {
  const headers = { "User-Agent": agent(changelist) };
  if (token) headers.Authorization = `bearer ${token}`;
  return send({ host: "127.0.0.1", port, method, path, headers }, body);
}

function tokenAs(changelist, port, form, client = { id: certClient, secret: "secret" }) {
  return send({
    host: "127.0.0.1", port, method: "POST", path: "/account/api/oauth/token",
    headers: {
      Authorization: `basic ${Buffer.from(`${client.id}:${client.secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": agent(changelist)
    }
  }, new URLSearchParams(form).toString());
}

const versionCheck = async (changelist, port, token) => (await as(changelist, port, "GET", "/fortnite/api/versioncheck?version=%2B%2BFortnite%2BRelease-Cert-CL-3532353-Windows", token)).body;
const ticket = (changelist, port, { accountId, token }) =>
  as(changelist, port, "GET", `/fortnite/api/game/v2/matchmakingservice/ticket/player/${accountId}?bucketId=858118782:0:NA:2`, token);
const login = async (changelist, port, username) => {
  const response = await tokenAs(changelist, port, { grant_type: "password", username, password: "test" });
  return { response, token: response.body.access_token, accountId: response.body.account_id, refresh: response.body.refresh_token };
};

test("every build may play until the admin panel says otherwise", async () => {
  const backend = await startBackend();
  try {
    const settings = (await get(backend.port, "/admin/api/settings")).body;
    assert.equal(settings.allowedBuilds, null);
    assert.deepEqual(settings.knownBuilds.at(-1), { changelist: "other", version: null });
    assert.deepEqual(settings.knownBuilds.find((build) => build.version === "1.8"), { changelist: "3724489", version: "1.8" });

    for (const changelist of ["3532353", "3724489", "3825894", "3900000"]) {
      const client = (await tokenAs(changelist, backend.port, { grant_type: "client_credentials" })).body.access_token;
      assert.deepEqual(await versionCheck(changelist, backend.port, client), { type: "NO_UPDATE" });
      const player = await login(changelist, backend.port, `Player${changelist}`);
      assert.equal(player.response.status, 200);
      assert.equal((await ticket(changelist, backend.port, player)).status, 200);
    }
  } finally {
    backend.close();
  }
});

test("a build that isn't allowed is told to update, and its logins and tickets are refused", async () => {
  const backend = await startBackend();
  try {
    const before = await login("3532353", backend.port, "StillIn");
    const saved = await post(backend.port, "/admin/api/settings", undefined, { allowedBuilds: ["1.8", "3825894"] });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.allowedBuilds, ["3724489", "3825894"]);

    // The start-up version check, with the client token every build is still given: HARD_UPDATE makes the client show
    // "Update Required"; an allowed build passes. The v2 path answers the same.
    const certClientToken = (await tokenAs("3532353", backend.port, { grant_type: "client_credentials" })).body.access_token;
    assert.ok(certClientToken);
    assert.deepEqual(await versionCheck("3532353", backend.port, certClientToken), { type: "HARD_UPDATE" });
    assert.deepEqual(await versionCheck("3724489", backend.port, certClientToken), { type: "NO_UPDATE" });
    assert.deepEqual((await as("3532353", backend.port, "GET", "/fortnite/api/v2/versioncheck/Windows?version=x", certClientToken)).body, { type: "HARD_UPDATE" });
    // Without a changelist in the User-Agent, the query's version names the build.
    assert.deepEqual(await versionCheck(null, backend.port, certClientToken), { type: "HARD_UPDATE" });

    // The login: an error the client shows as "Unable to login to Fortnite servers", not as wrong credentials or a lock.
    const refused = await login("3532353", backend.port, "CertPlayer");
    assert.equal(refused.response.status, 403);
    assert.equal(refused.response.body.errorCode, "errors.com.epicgames.common.version_not_allowed");
    assert.equal(refused.response.body.errorMessage, "Fortnite 1.1 (CL-3532353) isn't allowed on this backend. Allowed: 1.8, 2.1.");
    assert.doesNotMatch(refused.response.body.errorMessage, /account credentials|account has been locked/i);
    const allowed = await login("3724489", backend.port, "LivePlayer");
    assert.equal(allowed.response.status, 200);
    // Core Launcher's sign-in has no build in its User-Agent and is never refused.
    assert.equal((await login(null, backend.port, "LauncherUser")).response.status, 200);

    // A player who logged in before: their refresh and their tickets are refused.
    const refresh = await tokenAs("3532353", backend.port, { grant_type: "refresh_token", refresh_token: before.refresh });
    assert.equal(refresh.status, 403);
    assert.equal(refresh.body.errorCode, "errors.com.epicgames.common.version_not_allowed");
    const refusedTicket = await ticket("3532353", backend.port, before);
    assert.equal(refusedTicket.status, 403);
    assert.equal(refusedTicket.body.errorCode, "errors.com.epicgames.common.version_not_allowed");
    assert.equal((await ticket("3724489", backend.port, allowed)).status, 200);

    // Gameservers host on any build: their accounts, the DedicatedServer client, their version check.
    const server = await login("3532353", backend.port, "CoreServer1");
    assert.equal(server.response.status, 200);
    assert.deepEqual(await versionCheck("3532353", backend.port, server.token), { type: "NO_UPDATE" });
    const serverRefresh = await tokenAs("3532353", backend.port, { grant_type: "refresh_token", refresh_token: server.refresh });
    assert.equal(serverRefresh.status, 200);
    const dedicated = await tokenAs("3532353", backend.port, { grant_type: "client_credentials" }, dedicatedServer);
    assert.equal(dedicated.status, 200);
    assert.deepEqual(await versionCheck("3532353", backend.port, dedicated.body.access_token), { type: "NO_UPDATE" });
  } finally {
    backend.close();
  }
});

test("builds Core doesn't know follow the Other builds choice", async () => {
  const backend = await startBackend({ allowedBuilds: ["1.11"] });
  try {
    assert.deepEqual((await get(backend.port, "/admin/api/settings")).body.allowedBuilds, ["3807424"]);
    assert.equal((await login("3900000", backend.port, "Later")).response.status, 403);
    await post(backend.port, "/admin/api/settings", undefined, { allowedBuilds: ["1.11", "other"] });
    assert.equal((await login("3900000", backend.port, "Later")).response.status, 200);
    assert.equal((await login("3825894", backend.port, "Known")).response.status, 403);
  } finally {
    backend.close();
  }
});

test("the admin panel's allowed builds take only builds Core knows", async () => {
  const backend = await startBackend();
  try {
    for (const allowedBuilds of [[], ["9.99"], "1.8", [{}]]) {
      const response = await post(backend.port, "/admin/api/settings", undefined, { allowedBuilds });
      assert.equal(response.status, 400, JSON.stringify(allowedBuilds));
    }
    assert.equal((await get(backend.port, "/admin/api/settings")).body.allowedBuilds, null);

    // Every build ticked is every build, so ones Core learns later are allowed too.
    const knownBuilds = (await get(backend.port, "/admin/api/settings")).body.knownBuilds.map((build) => build.changelist);
    assert.equal((await post(backend.port, "/admin/api/settings", undefined, { allowedBuilds: knownBuilds })).body.allowedBuilds, null);
    await post(backend.port, "/admin/api/settings", undefined, { allowedBuilds: ["CL-3724489", 3807424] });
    assert.deepEqual((await get(backend.port, "/admin/api/settings")).body.allowedBuilds, ["3724489", "3807424"]);
    assert.equal((await post(backend.port, "/admin/api/settings", undefined, { allowedBuilds: null })).body.allowedBuilds, null);
  } finally {
    backend.close();
  }
});

test("allowed builds are kept in settings.json", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-"));
  try {
    const first = createSettingsStore(dataDir);
    assert.equal(first.get().allowedBuilds, null);
    assert.deepEqual(first.update({ allowedBuilds: ["1.2", "other"] }).allowedBuilds, ["3541083", "other"]);
    assert.deepEqual(createSettingsStore(dataDir).get().allowedBuilds, ["3541083", "other"]);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(allowedBuildList("all"), null);
  assert.equal(allowsBuild(["3724489"], "unknown"), true, "no changelist: not a game build");
  assert.equal(allowsBuild(["3724489"], "3532353"), false);
  assert.equal(allowsBuild(null, "3532353"), true);
});

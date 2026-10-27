import { test } from "node:test";
import assert from "node:assert/strict";
import { getBuild } from "../src/builds/detect.js";
import { clientToken, get, startBackend } from "./helpers.js";

test("start-up checks answer the way the Cert client parses them", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);

    const lightswitch = await get(backend.port, "/lightswitch/api/service/bulk/status?serviceId=Fortnite", token);
    assert.equal(lightswitch.status, 200);
    assert.deepEqual(lightswitch.body, [{ serviceInstanceId: "Fortnite", status: "UP" }]);

    const version = await get(backend.port, "/fortnite/api/versioncheck?version=%2B%2BFortnite%2BRelease-Cert-CL-3532353-Windows", token);
    assert.deepEqual(version.body, { type: "NO_UPDATE" });

    const files = await get(backend.port, "/fortnite/api/cloudstorage/system", token);
    assert.deepEqual(files.body.map((file) => file.filename), ["DefaultEngine.ini"]);

    // Fetched before login, without a token.
    const page = await get(backend.port, "/content/api/pages/fortnite-game");
    assert.equal(page.status, 200);
    assert.ok(!Number.isNaN(Date.parse(page.body.lastModified)));
    assert.deepEqual(page.body._images_, []);
    // Battle Royale's lobby news box (Core-Backend #61).
    assert.deepEqual(page.body.battleRoyaleNews.news.message, { title: "Battle Royale - 1.7.2", body: "Welcome to Battle Royale on Core!" });
  } finally {
    backend.close();
  }
});

test("a missing or unknown token gets the invalid_token error the client re-authenticates on", async () => {
  const backend = await startBackend();
  try {
    for (const token of [undefined, "0123456789abcdef0123456789abcdef"]) {
      const response = await get(backend.port, "/fortnite/api/versioncheck", token);
      assert.equal(response.status, 401);
      assert.equal(response.body.errorCode, "errors.com.epicgames.common.oauth.invalid_token");
    }
  } finally {
    backend.close();
  }
});

test("the build is read from both User-Agent formats the Cert client uses", () => {
  const agent = (value) => ({ get: () => value });
  assert.equal(getBuild(agent("game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3532353")), "3532353");
  assert.equal(getBuild(agent("game=FortniteGame, engine=UE4, version=4.16.0-3532353+++Fortnite+Release-Cert, platform=Windows")), "3532353");
  assert.equal(getBuild(agent(undefined)), "unknown");
});

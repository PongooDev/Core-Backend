import { test } from "node:test";
import assert from "node:assert/strict";
import { getBuild } from "../src/builds/detect.js";
import { clientToken, get, send, startBackend } from "./helpers.js";

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
    assert.deepEqual(files.body.map((file) => file.filename), ["DefaultEngine.ini", "DefaultGame.ini"]);

    // Fetched before login, without a token.
    const page = await get(backend.port, "/content/api/pages/fortnite-game");
    assert.equal(page.status, 200);
    assert.ok(!Number.isNaN(Date.parse(page.body.lastModified)));
    assert.deepEqual(page.body._images_, []);
    // Battle Royale's lobby news box (Core-Backend #61) and the login screen's message box name the build asking (#68):
    // the helpers ask as Cert (1.1).
    assert.deepEqual(page.body.battleRoyaleNews.news.message, { title: "Battle Royale - 1.1", body: "Welcome to Battle Royale on Core!" });
    assert.deepEqual(page.body.loginmessage.loginmessage.message, { title: "v1.1", body: "Welcome to Fortnite on Core!" });
    const pageFor = (changelist) => send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/content/api/pages/fortnite-game",
      headers: { "User-Agent": `game=Fortnite, engine=UE4, version=4.16.0-${changelist}+++Fortnite+Release-Cert` } });
    for (const [changelist, version] of [["3700114", "1.7.2"], ["3724489", "1.8"]]) {
      const built = (await pageFor(changelist)).body;
      assert.equal(built.battleRoyaleNews.news.message.title, `Battle Royale - ${version}`);
      assert.equal(built.loginmessage.loginmessage.message.title, `v${version}`);
    }
    assert.equal((await pageFor("3757339")).body.loginmessage.loginmessage.message.title, "CL-3757339");
    // The mode select screen's descriptions (#63).
    assert.equal(page.body.subgameselectdata.battleRoyale.message.title, "100 Player PvP");
    assert.equal(page.body.subgameselectdata.saveTheWorld.message.title, "Co-op PvE");
    // 1.8's tag shows Save the World's sale (#93).
    for (const changelist of ["3724489"]) {
      const selectData = (await pageFor(changelist)).body.subgameselectdata;
      assert.equal(selectData.saveTheWorld.message.title, "ON SALE NOW - LIMITED TIME!");
      assert.equal(selectData.saveTheWorld.message.body, "Cooperative PvE storm-fighting adventure!");
    }
    // 1.8.1 gets exactly 1.8's data: its tag is blue because its widget is, not because of the page (#103).
    // 1.8.1 has its own tags (#110).
    const select181 = (await pageFor("3729133")).body.subgameselectdata;
    assert.equal(select181.saveTheWorld.message.title, "40% OFF - LIMITED TIME!");
    assert.equal(select181.saveTheWorldUnowned.message.title, "40% OFF - LIMITED TIME!");
    assert.equal(select181.battleRoyale.message.title, "New PVP!");
    assert.equal((await pageFor("3724489")).body.subgameselectdata.battleRoyale.message.title, "100 Player PvP");
    // 1.8.2: the sale is over, Battle Royale is still new (#111).
    const select182 = (await pageFor("3741772")).body.subgameselectdata;
    assert.deepEqual([select182.saveTheWorld.message.title, select182.battleRoyale.message.title], ["Co-op PvE", "New PVP!"]);
    assert.equal((await pageFor("3700114")).body.subgameselectdata.saveTheWorld.message.title, "Co-op PvE");
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

test("the login's waiting room has no queue (a PS4 client asks for it, #65)", async () => {
  const backend = await startBackend();
  try {
    const room = await get(backend.port, "/waitingroom/api/waitingroom");
    assert.equal(room.status, 204);
  } finally {
    backend.close();
  }
});

test("a mode select text set in the panel keeps the build's own text for a field left blank (#113)", async () => {
  const { subgameSelectFor } = await import("../src/services/content/pages.js");
  const select = subgameSelectFor("3729133", { saveTheWorld: { title: "Custom", body: "" }, battleRoyale: null });
  assert.equal(select.saveTheWorld.message.title, "Custom");
  assert.equal(select.saveTheWorld.message.body, "Cooperative PvE storm-fighting adventure!");
  assert.equal(select.battleRoyale.message.title, "New PVP!");
});

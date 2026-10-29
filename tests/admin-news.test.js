import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { get, post, send, startBackend } from "./helpers.js";

const admin = (backend, path, body) => (body === undefined
  ? get(backend.port, `/admin/api${path}`)
  : post(backend.port, `/admin/api${path}`, undefined, body));

const pageFor = (port, changelist) => send({
  host: "127.0.0.1",
  port,
  method: "GET",
  path: "/content/api/pages/fortnite-game",
  headers: { "User-Agent": `Fortnite/++Fortnite+Release-Live-CL-${changelist} Windows/10.0.19045.1.768.64bit` }
});

test("the admin news API views, updates, and resets in-game news, login messages, and mode select text dynamically", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-news-test-"));
  const backend = await startBackend({ dataDir });

  try {
    // 1. Initial GET /admin/api/news returns custom as null (blank text boxes) and reference defaults
    const initial = await admin(backend, "/news");
    assert.equal(initial.status, 200);
    assert.equal(initial.body.loginMessageEnabled, true);
    assert.equal(initial.body.defaults.loginMessageEnabled, true);
    assert.equal(initial.body.custom.battleRoyaleNews, null);
    assert.equal(initial.body.custom.loginMessage, null);
    assert.equal(initial.body.custom.subgameSelect.saveTheWorld, null);
    assert.equal(initial.body.custom.subgameSelect.battleRoyale, null);

    assert.equal(initial.body.defaults.battleRoyaleNews.title, "Battle Royale - {version}");
    assert.equal(initial.body.defaults.loginMessage.title, "v{version}");
    assert.equal(initial.body.defaults.subgameSelect.saveTheWorld.title, "Co-op PvE");
    assert.equal(initial.body.defaults.subgameSelect.battleRoyale.title, "100 Player PvP");

    // 2. Default content page adapts 1:1 to the detected version
    const default18 = (await pageFor(backend.port, "3724489")).body;
    assert.equal(default18.subgameselectdata.saveTheWorld.message.title, "ON SALE NOW - LIMITED TIME!");
    assert.equal(default18.subgameselectdata.battleRoyale.message.title, "100 Player PvP");
    assert.equal(default18.battleRoyaleNews.news.message.title, "Battle Royale - 1.8");

    const default181 = (await pageFor(backend.port, "3729133")).body;
    assert.equal(default181.subgameselectdata.saveTheWorld.message.title, "40% OFF - LIMITED TIME!");
    assert.equal(default181.subgameselectdata.battleRoyale.message.title, "New PVP!");
    assert.equal(default181.battleRoyaleNews.news.message.title, "Battle Royale - 1.8.1");

    const default182 = (await pageFor(backend.port, "3741772")).body;
    assert.equal(default182.subgameselectdata.saveTheWorld.message.title, "Co-op PvE");
    assert.equal(default182.subgameselectdata.battleRoyale.message.title, "New PVP!");

    const default172 = (await pageFor(backend.port, "3700114")).body;
    assert.equal(default172.subgameselectdata.saveTheWorld.message.title, "Co-op PvE");
    assert.equal(default172.subgameselectdata.battleRoyale.message.title, "100 Player PvP");
    assert.equal(default172.battleRoyaleNews.news.message.title, "Battle Royale - 1.7.2");

    // 3. Update news, login message, and mode select text via admin API
    const updated = await admin(backend, "/news", {
      battleRoyaleNews: { title: "Special Event {version}", body: "Double XP weekend!" },
      loginMessage: { title: "Server Announcement", body: "Maintenance tonight at midnight." },
      subgameSelect: {
        saveTheWorld: { title: "CAMPAIGN BOOST", body: "Double Commander XP active!" },
        battleRoyale: { title: "TOURNAMENT MODE", body: "Solo tournament lobbies now live." }
      }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.custom.battleRoyaleNews.title, "Special Event {version}");
    assert.equal(updated.body.custom.battleRoyaleNews.body, "Double XP weekend!");
    assert.equal(updated.body.custom.loginMessage.title, "Server Announcement");
    assert.equal(updated.body.custom.loginMessage.body, "Maintenance tonight at midnight.");
    assert.equal(updated.body.custom.subgameSelect.saveTheWorld.title, "CAMPAIGN BOOST");
    assert.equal(updated.body.custom.subgameSelect.battleRoyale.title, "TOURNAMENT MODE");

    // 4. Verify content API immediately serves the custom text across all builds
    const custom18 = (await pageFor(backend.port, "3724489")).body;
    assert.equal(custom18.battleRoyaleNews.news.message.title, "Special Event 1.8");
    assert.equal(custom18.battleRoyaleNews.news.message.body, "Double XP weekend!");
    assert.equal(custom18.loginmessage.loginmessage.message.title, "Server Announcement");
    assert.equal(custom18.subgameselectdata.saveTheWorld.message.title, "CAMPAIGN BOOST");
    assert.equal(custom18.subgameselectdata.saveTheWorld.message.body, "Double Commander XP active!");
    assert.equal(custom18.subgameselectdata.battleRoyale.message.title, "TOURNAMENT MODE");
    assert.equal(custom18.subgameselectdata.battleRoyale.message.body, "Solo tournament lobbies now live.");

    // 5. Resetting to null clears custom state (blank text boxes) and restores 1:1 version adaptation
    const reset = await admin(backend, "/news", {
      battleRoyaleNews: null,
      loginMessage: null,
      subgameSelect: null
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.custom.battleRoyaleNews, null);
    assert.equal(reset.body.custom.loginMessage, null);
    assert.equal(reset.body.custom.subgameSelect.saveTheWorld, null);
    assert.equal(reset.body.custom.subgameSelect.battleRoyale, null);

    // 1.8 is back to its 1:1 sale tag
    const reset18 = (await pageFor(backend.port, "3724489")).body;
    assert.equal(reset18.subgameselectdata.saveTheWorld.message.title, "ON SALE NOW - LIMITED TIME!");
    assert.equal(reset18.subgameselectdata.battleRoyale.message.title, "100 Player PvP");
    assert.equal(reset18.battleRoyaleNews.news.message.title, "Battle Royale - 1.8");

    // 1.8.1 is back to its 1:1 40% off and New PVP tags
    const reset181 = (await pageFor(backend.port, "3729133")).body;
    assert.equal(reset181.subgameselectdata.saveTheWorld.message.title, "40% OFF - LIMITED TIME!");
    assert.equal(reset181.subgameselectdata.battleRoyale.message.title, "New PVP!");

    // 1.8.2 is back to its 1:1 Co-op PvE and New PVP tags
    const reset182 = (await pageFor(backend.port, "3741772")).body;
    assert.equal(reset182.subgameselectdata.saveTheWorld.message.title, "Co-op PvE");
    assert.equal(reset182.subgameselectdata.battleRoyale.message.title, "New PVP!");

    // 6. Toggle login screen message off and on
    const disabled = await admin(backend, "/news", { loginMessageEnabled: false });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.body.loginMessageEnabled, false);

    // When disabled, content page omits loginmessage completely
    const disabledPage = (await pageFor(backend.port, "3724489")).body;
    assert.equal(disabledPage.loginmessage, undefined);

    // Updating custom text while disabled preserves custom text but keeps loginmessage omitted
    await admin(backend, "/news", { loginMessage: { title: "Patch Notes {version}", body: "Disabled test notes" } });
    const stillDisabledPage = (await pageFor(backend.port, "3724489")).body;
    assert.equal(stillDisabledPage.loginmessage, undefined);

    // Re-enabling restores the loginmessage with custom text immediately
    const reEnabled = await admin(backend, "/news", { loginMessageEnabled: true });
    assert.equal(reEnabled.status, 200);
    assert.equal(reEnabled.body.loginMessageEnabled, true);

    const reEnabledPage = (await pageFor(backend.port, "3724489")).body;
    assert.equal(reEnabledPage.loginmessage.loginmessage.message.title, "Patch Notes 1.8");
    assert.equal(reEnabledPage.loginmessage.loginmessage.message.body, "Disabled test notes");

    // Resetting loginMessage to null restores 1:1 default text while staying enabled
    await admin(backend, "/news", { loginMessage: null });
    const finalPage = (await pageFor(backend.port, "3724489")).body;
    assert.equal(finalPage.loginmessage.loginmessage.message.title, "v1.8");
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

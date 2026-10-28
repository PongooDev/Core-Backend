import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { get, post, startBackend } from "./helpers.js";

const admin = (backend, path, body) => (body === undefined
  ? get(backend.port, `/admin/api${path}`)
  : post(backend.port, `/admin/api${path}`, undefined, body));

test("the admin news API views, updates, and resets in-game news and login messages dynamically", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-news-test-"));
  const backend = await startBackend({ dataDir });

  try {
    // 1. Initial GET /admin/api/news returns the defaults
    const initial = await admin(backend, "/news");
    assert.equal(initial.status, 200);
    assert.equal(initial.body.battleRoyaleNews.title, "Battle Royale - {version}");
    assert.equal(initial.body.battleRoyaleNews.body, "Welcome to Battle Royale on Core!");
    assert.equal(initial.body.loginMessage.title, "v{version}");
    assert.equal(initial.body.loginMessage.body, "Welcome to Fortnite on Core!");

    // Initial content page request uses defaults
    let page = await get(backend.port, "/content/api/pages/fortnite-game");
    assert.equal(page.status, 200);
    assert.equal(page.body.battleRoyaleNews.news.message.title, "Battle Royale - 1.1");
    assert.equal(page.body.loginmessage.loginmessage.message.title, "v1.1");

    // 2. Update both news and login message via admin API
    const updated = await admin(backend, "/news", {
      battleRoyaleNews: { title: "Special Event {version}", body: "Double XP weekend!" },
      loginMessage: { title: "Server Announcement", body: "Maintenance tonight at midnight." }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.battleRoyaleNews.title, "Special Event {version}");
    assert.equal(updated.body.battleRoyaleNews.body, "Double XP weekend!");
    assert.equal(updated.body.loginMessage.title, "Server Announcement");
    assert.equal(updated.body.loginMessage.body, "Maintenance tonight at midnight.");

    // Verify GET /admin/api/news reflects the change
    const fetched = await admin(backend, "/news");
    assert.equal(fetched.body.battleRoyaleNews.title, "Special Event {version}");
    assert.equal(fetched.body.battleRoyaleNews.body, "Double XP weekend!");
    assert.equal(fetched.body.loginMessage.title, "Server Announcement");
    assert.equal(fetched.body.loginMessage.body, "Maintenance tonight at midnight.");

    // 3. Verify content API immediately reflects the updated messages without restart
    page = await get(backend.port, "/content/api/pages/fortnite-game");
    assert.equal(page.body.battleRoyaleNews.news.message.title, "Special Event 1.1");
    assert.equal(page.body.battleRoyaleNews.news.message.body, "Double XP weekend!");
    assert.equal(page.body.loginmessage.loginmessage.message.title, "Server Announcement");
    assert.equal(page.body.loginmessage.loginmessage.message.body, "Maintenance tonight at midnight.");

    // 4. Resetting to null restores the default values
    const reset = await admin(backend, "/news", {
      battleRoyaleNews: null,
      loginMessage: null
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.battleRoyaleNews.title, "Battle Royale - {version}");
    assert.equal(reset.body.loginMessage.title, "v{version}");

    page = await get(backend.port, "/content/api/pages/fortnite-game");
    assert.equal(page.body.battleRoyaleNews.news.message.title, "Battle Royale - 1.1");
    assert.equal(page.body.loginmessage.loginmessage.message.title, "v1.1");
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});


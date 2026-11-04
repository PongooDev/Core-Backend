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
    assert.equal(initial.body.battleRoyaleNewsEnabled, true);
    assert.equal(initial.body.defaults.battleRoyaleNewsEnabled, true);
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

    // 7. Toggle Battle Royale lobby news off and on
    const newsDisabled = await admin(backend, "/news", { battleRoyaleNewsEnabled: false });
    assert.equal(newsDisabled.status, 200);
    assert.equal(newsDisabled.body.battleRoyaleNewsEnabled, false);

    // Pre-1.9 (1.8): message is omitted when news is disabled
    const disabled18Page = (await pageFor(backend.port, "3724489")).body;
    assert.equal(disabled18Page.battleRoyaleNews.news.message, undefined);
    assert.deepEqual(disabled18Page.battleRoyaleNews.news.region_messages, []);

    // 1.9+: messages array is empty when news is disabled
    const disabled19Page = (await pageFor(backend.port, "3757339")).body;
    assert.deepEqual(disabled19Page.battleRoyaleNews.news.messages, []);

    // Re-enabling restores the news
    const newsReEnabled = await admin(backend, "/news", { battleRoyaleNewsEnabled: true });
    assert.equal(newsReEnabled.status, 200);
    assert.equal(newsReEnabled.body.battleRoyaleNewsEnabled, true);

    const reEnabled18Page = (await pageFor(backend.port, "3724489")).body;
    assert.equal(reEnabled18Page.battleRoyaleNews.news.message.title, "Battle Royale - 1.8");
    const reEnabled19Page = (await pageFor(backend.port, "3757339")).body;
    assert.equal(reEnabled19Page.battleRoyaleNews.news.messages[0].title, "Battle Royale - 1.9");
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("config.json's battleRoyaleNewsEnabled turns lobby news off until the panel says otherwise", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-brnews-config-test-"));
  const backend = await startBackend({ dataDir, battleRoyaleNewsEnabled: false });
  try {
    assert.equal((await pageFor(backend.port, "3724489")).body.battleRoyaleNews.news.message, undefined);
    assert.deepEqual((await pageFor(backend.port, "3757339")).body.battleRoyaleNews.news.messages, []);
    assert.equal((await admin(backend, "/news")).body.battleRoyaleNewsEnabled, false);
    // The panel's choice wins over config.json's.
    await admin(backend, "/news", { battleRoyaleNewsEnabled: true });
    assert.ok((await pageFor(backend.port, "3724489")).body.battleRoyaleNews.news.message);
    assert.equal((await pageFor(backend.port, "3757339")).body.battleRoyaleNews.news.messages.length, 1);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("config.json's loginMessageEnabled turns the login message off until the panel says otherwise (#116)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-news-config-test-"));
  const backend = await startBackend({ dataDir, loginMessageEnabled: false });
  try {
    assert.equal((await pageFor(backend.port, "3724489")).body.loginmessage, undefined);
    assert.equal((await admin(backend, "/news")).body.loginMessageEnabled, false);
    // The panel's choice wins over config.json's.
    await admin(backend, "/news", { loginMessageEnabled: true });
    assert.ok((await pageFor(backend.port, "3724489")).body.loginmessage);
  } finally {
    backend.close();
  }
});

test("1.9 gets the lobby news as battleRoyaleNews.news.messages[], earlier builds keep news.message, and the panel's text reaches both (#117)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-news-19-test-"));
  const backend = await startBackend({ dataDir });
  try {
    // 1.9 (CL-3757339) reads news.messages[] ({title, body, image}) and no longer news.message.
    const default19 = (await pageFor(backend.port, "3757339")).body.battleRoyaleNews.news;
    assert.deepEqual(default19.messages, [{ title: "Battle Royale - 1.9", body: "Welcome to Battle Royale on Core!", image: "" }]);
    assert.equal(default19.message, undefined);
    assert.deepEqual(default19.region_messages, []);
    assert.deepEqual(default19.platform_messages, []);
    // 1.10 (CL-3790078), 1.11 (CL-3807424), 2.1 (CL-3825894) and 2.2 (CL-3841827) read the array too, under their own versions (#131), and so does a newer
    // build Core doesn't know.
    assert.equal((await pageFor(backend.port, "3790078")).body.battleRoyaleNews.news.messages[0].title, "Battle Royale - 1.10");
    assert.equal((await pageFor(backend.port, "3807424")).body.battleRoyaleNews.news.messages[0].title, "Battle Royale - 1.11");
    assert.equal((await pageFor(backend.port, "3825894")).body.battleRoyaleNews.news.messages[0].title, "Battle Royale - 2.1");
    assert.equal((await pageFor(backend.port, "3841827")).body.battleRoyaleNews.news.messages[0].title, "Battle Royale - 2.2");
    assert.equal((await pageFor(backend.port, "3901517")).body.battleRoyaleNews.news.messages[0].title, "Battle Royale - 3.0");
    assert.equal((await pageFor(backend.port, "3915963")).body.battleRoyaleNews.news.messages[0].title, "Battle Royale - 3.1");
    assert.equal((await pageFor(backend.port, "3935073")).body.battleRoyaleNews.news.messages[0].title, "Battle Royale - 3.2");
    assert.equal((await pageFor(backend.port, "3942182")).body.battleRoyaleNews.news.messages[0].title, "Battle Royale - 3.3");
    assert.equal((await pageFor(backend.port, "3999999")).body.battleRoyaleNews.news.messages[0].title, "Battle Royale - CL-3999999");

    // Earlier builds are unchanged: news.message alone.
    for (const [changelist, version] of [["3700114", "1.7.2"], ["3724489", "1.8"], ["3729133", "1.8.1"], ["3741772", "1.8.2"]]) {
      const news = (await pageFor(backend.port, changelist)).body.battleRoyaleNews.news;
      assert.deepEqual(news, {
        message: { title: `Battle Royale - ${version}`, body: "Welcome to Battle Royale on Core!" },
        region_messages: [],
        platform_messages: []
      });
    }

    // The admin panel's news text flows into both shapes.
    await admin(backend, "/news", { battleRoyaleNews: { title: "Special Event {version}", body: "Double XP weekend!" } });
    assert.deepEqual((await pageFor(backend.port, "3757339")).body.battleRoyaleNews.news.messages,
      [{ title: "Special Event 1.9", body: "Double XP weekend!", image: "" }]);
    assert.deepEqual((await pageFor(backend.port, "3741772")).body.battleRoyaleNews.news.message,
      { title: "Special Event 1.8.2", body: "Double XP weekend!" });

    // Resetting it brings 1.9 back to Core's default.
    await admin(backend, "/news", { battleRoyaleNews: null });
    assert.equal((await pageFor(backend.port, "3757339")).body.battleRoyaleNews.news.messages[0].title, "Battle Royale - 1.9");
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("3.2's User-Agent (the engine version alone) still names its build: the news array and the version text (#231)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-news-32-test-"));
  const backend = await startBackend({ dataDir });
  try {
    // UE 4.20's default HTTP User-Agent, "%s/%s %s/%s": no "CL-" and no "version=".
    const page = (await send({
      host: "127.0.0.1",
      port: backend.port,
      method: "GET",
      path: "/content/api/pages/fortnite-game",
      headers: { "User-Agent": "Fortnite/4.20.0-3935073+++Fortnite+Release-3.2 Windows/10.0.17134.1.256.64bit" }
    })).body;
    assert.deepEqual(page.battleRoyaleNews.news.messages, [{ title: "Battle Royale - 3.2", body: "Welcome to Battle Royale on Core!", image: "" }]);
    assert.equal(page.battleRoyaleNews.news.message, undefined);
    assert.equal(page.loginmessage.loginmessage.message.title, "v3.2");
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("config.json's battleRoyaleNews reaches 1.9's news.messages[] (#117)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-news-19-config-test-"));
  const backend = await startBackend({ dataDir, battleRoyaleNews: { title: "Host news {version}", body: "From config.json" } });
  try {
    assert.deepEqual((await pageFor(backend.port, "3757339")).body.battleRoyaleNews.news.messages,
      [{ title: "Host news 1.9", body: "From config.json", image: "" }]);
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// A PNG and a JPEG of a given size: the store reads the size from the file's own header (services/content/images.js).
function png(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", Buffer.alloc(8)),
    chunk("IEND", Buffer.alloc(0))]);
}

function jpeg(width, height) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

const upload = (backend, data) => admin(backend, "/news/image", { data: data.toString("base64") });

test("the panel's lobby news image reaches 1.9+ as a URL on the address the client asked on, and builds before 1.9 are unchanged (#215)", async () => {
  const backend = await startBackend();
  try {
    // An uploaded PNG is stored under the data folder, named by its content.
    const picture = png(1024, 512);
    const uploaded = await upload(backend, picture);
    assert.equal(uploaded.status, 200);
    assert.match(uploaded.body.image, /^\/content\/api\/news-images\/[0-9a-f]{32}\.png$/);
    const name = uploaded.body.image.split("/").pop();
    assert.ok(fs.existsSync(path.join(backend.dataDir, "news-images", name)));

    const saved = await admin(backend, "/news", { battleRoyaleNews: { title: "Season {version}", body: "New map!", image: uploaded.body.image } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.custom.battleRoyaleNews.image, uploaded.body.image);

    // 1.9 gets the full URL on the host it asked on, and the CMS cache's _images_ list keeps it.
    const url = `http://127.0.0.1:${backend.port}${uploaded.body.image}`;
    const page19 = (await pageFor(backend.port, "3757339")).body;
    assert.deepEqual(page19.battleRoyaleNews.news.messages, [{ title: "Season 1.9", body: "New map!", image: url }]);
    assert.deepEqual(page19._images_, [url]);
    assert.equal((await pageFor(backend.port, "3901517")).body.battleRoyaleNews.news.messages[0].image, url);

    // The game can download it from there.
    const served = await fetch(url);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");
    assert.ok(Buffer.from(await served.arrayBuffer()).equals(picture));

    // Behind an https reverse proxy, the proxy's address.
    const proxied = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/content/api/pages/fortnite-game",
      headers: { "User-Agent": "Fortnite/++Fortnite+Release-Live-CL-3757339 Windows/10.0.19045.1.768.64bit", "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "core.example.com" } });
    assert.equal(proxied.body.battleRoyaleNews.news.messages[0].image, `https://core.example.com${uploaded.body.image}`);

    // Builds before 1.9 have no image in their news box: news.message and _images_ are as before.
    const page18 = (await pageFor(backend.port, "3741772")).body;
    assert.deepEqual(page18.battleRoyaleNews.news.message, { title: "Season 1.8.2", body: "New map!" });
    assert.deepEqual(page18._images_, []);

    // Another site's picture is handed out as it is; replacing the upload deletes it.
    const external = "https://cdn2.unrealengine.com/Fortnite/news/BR04_MOTD_Shield-1024x512.jpg";
    assert.equal((await admin(backend, "/news", { battleRoyaleNews: { title: "", body: "", image: external } })).status, 200);
    assert.equal((await pageFor(backend.port, "3757339")).body.battleRoyaleNews.news.messages[0].image, external);
    assert.deepEqual((await pageFor(backend.port, "3757339")).body._images_, [external]);
    assert.equal(fs.existsSync(path.join(backend.dataDir, "news-images", name)), false);
    assert.equal((await fetch(url)).status, 404);

    // A JPEG works too; resetting the news drops its image.
    const uploadedJpeg = await upload(backend, jpeg(1920, 1080));
    assert.equal(uploadedJpeg.status, 200);
    assert.match(uploadedJpeg.body.image, /\.jpg$/);
    await admin(backend, "/news", { battleRoyaleNews: { title: "JPEG", body: "", image: uploadedJpeg.body.image } });
    assert.equal((await fetch(`http://127.0.0.1:${backend.port}${uploadedJpeg.body.image}`)).headers.get("content-type"), "image/jpeg");
    await admin(backend, "/news", { battleRoyaleNews: null });
    assert.equal((await pageFor(backend.port, "3757339")).body.battleRoyaleNews.news.messages[0].image, "");
    assert.deepEqual((await pageFor(backend.port, "3757339")).body._images_, []);
    assert.deepEqual(fs.readdirSync(path.join(backend.dataDir, "news-images")), []);
  } finally {
    backend.close();
  }
});

test("news image uploads take only PNG and JPEG within the size limits, and only admin-panel writes (#215)", async () => {
  const backend = await startBackend();
  try {
    const rejected = async (data, pattern) => {
      const response = await upload(backend, data);
      assert.equal(response.status, 400);
      assert.match(response.body.errorMessage, pattern);
    };
    await rejected(Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;" + "x".repeat(32), "latin1"), /PNG and JPEG/);
    await rejected(Buffer.from("<html><script>alert(1)</script></html>".repeat(4)), /PNG and JPEG/);
    await rejected(png(4096, 4096), /pixels/);
    await rejected(Buffer.concat([png(16, 16), Buffer.alloc(4 * 1024 * 1024)]), /over 4 MB/);
    assert.equal((await admin(backend, "/news/image", { data: "not base64!" })).status, 400);
    assert.equal(fs.existsSync(path.join(backend.dataDir, "news-images")), false);

    // Admin writes must be JSON (admin/local.js), so another site can't post an upload.
    const form = await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/admin/api/news/image",
      headers: { "Content-Type": "image/png" } }, png(16, 16));
    assert.equal(form.status, 415);

    // The news only takes an http(s) URL or one of the backend's own uploads, so no other file can be named.
    for (const image of ["javascript:alert(1)", "file:///C:/Windows/win.ini", "/content/api/news-images/../settings.json",
      "/content/api/news-images/00000000000000000000000000000000.png", "../../settings.json"]) {
      const response = await admin(backend, "/news", { battleRoyaleNews: { title: "x", body: "", image } });
      assert.equal(response.status, 400, image);
    }
    // The image route serves the store's own names alone.
    for (const name of ["..%2fsettings.json", "..%5Csettings.json", "settings.json", "00000000000000000000000000000000.gif"]) {
      assert.equal((await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: `/content/api/news-images/${name}` })).status, 404, name);
    }
  } finally {
    backend.close();
  }
});

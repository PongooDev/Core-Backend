import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentPage } from "../src/services/content/pages.js";
import { createShowdownRefresh, currentShowdownEvent, customShowdownImages, showdownColors, showdownImagePath, showdownImageSlots,
  showdownImagesFor, tournamentAndHistory, tournamentInformationFor, tournamentsCompleteMessage } from "../src/tournaments/showdown.js";
import { createTournamentStore, validateImages } from "../src/tournaments/store.js";
import { get, post, send, startBackend } from "./helpers.js";

// Core-Backend #336: 6.10's Events tab showed white boxes where the tournament's pictures go (the tile, the poster, the
// EVENT DETAILS side, the box above PLAY) and invisible texts (no colours), and its lobby didn't follow an event's start.
// tournaments/showdown.js has what the client reads and when it refreshes.
const v610 = "4480234";
const v602 = "4461277";
const at = (iso) => new Date(iso);
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "core-336-"));
const origin = "http://127.0.0.1:3551";
const admin = (backend, url, body) => (body === undefined ? get(backend.port, `/admin/api${url}`) : post(backend.port, `/admin/api${url}`, undefined, body));
const agent610 = `Fortnite/++Fortnite+Release-6.10-CL-${v610} Windows/10.0.19045.1.256.64bit`;
const pageFor = (port, host = `127.0.0.1:${port}`) => send({ host: "127.0.0.1", port, method: "GET", path: "/content/api/pages/fortnite-game",
  headers: { "User-Agent": agent610, Host: host } });

function png(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IEND", Buffer.alloc(0))]);
}
const jpegSize = (data) => {
  for (let i = 2; i + 9 < data.length;) {
    const marker = data[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [data.readUInt16BE(i + 7), data.readUInt16BE(i + 5)];
    i += 2 + data.readUInt16BE(i + 2);
  }
  return null;
};

test("Core's own pictures: three JPEGs the client can show, each named by its content, and no default for the slot no screen shows", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "tournaments", "images");
  assert.deepEqual(showdownImageSlots.map(({ key, field }) => [key, field]), [["posterFront", "poster_front_image"], ["posterBack", "poster_back_image"],
    ["playlistTile", "playlist_tile_image"], ["loadingScreen", "loading_screen_image"]]);
  for (const slot of showdownImageSlots.filter(({ file }) => file)) {
    const data = fs.readFileSync(path.join(dir, slot.file));
    assert.deepEqual([...data.subarray(0, 3)], [0xff, 0xd8, 0xff], `${slot.file} is a JPEG`);
    const [width, height] = jpegSize(data);
    assert.equal(`${width}x${height}`, slot.size, slot.file);
    // The CMS image cache refuses width x height x 4 over 10,000,000 bytes (0x38C0F0).
    assert.ok(width * height * 4 <= 10_000_000, slot.file);
    // It keeps a picture by its URL's last segment for good: the name carries the content's hash.
    const hash = crypto.createHash("sha1").update(data).digest("hex").slice(0, 12);
    assert.ok(slot.file.endsWith(`-${hash}.jpg`), slot.file);
  }
  assert.equal(showdownImageSlots.find(({ key }) => key === "loadingScreen").file, null);
});

test("an event's entry as the client reads it: every colour in FColor::FromHex's form, and a picture for every slot a screen shows", () => {
  const dir = tempDir();
  try {
    const store = createTournamentStore(dir);
    const now = at("2026-11-12T23:00:00.000Z");
    const event = store.create({ name: "Agas Cup", playlist: "showdownSolo", startsAt: "2026-11-12T23:12:00.000Z", endsAt: "2026-11-12T23:24:00.000Z" }, now);
    const entry = tournamentInformationFor(v610, now, store, origin).tournament_info.tournaments[0];
    const colours = ["base_color", "primary_color", "secondary_color", "highlight_color", "title_color", "shadow_color", "background_left_color",
      "background_right_color", "background_text_color", "poster_fade_color"];
    for (const field of colours) assert.match(entry[field], /^[0-9A-F]{6}$/, field);
    assert.deepEqual(Object.keys(showdownColors).sort(), [...colours].sort());
    // Core's own pictures, on the address the client reached the page on; no loading screen picture (no screen has one).
    assert.equal(entry.poster_front_image, `${origin}${showdownImagePath}/${showdownImageSlots[0].file}`);
    assert.equal(entry.poster_back_image, `${origin}${showdownImagePath}/${showdownImageSlots[1].file}`);
    assert.equal(entry.playlist_tile_image, `${origin}${showdownImagePath}/${showdownImageSlots[2].file}`);
    assert.equal(Object.hasOwn(entry, "loading_screen_image"), false);
    assert.deepEqual(showdownImagesFor(v610, now, store, origin), [entry.poster_front_image, entry.poster_back_image, entry.playlist_tile_image]);
    assert.deepEqual(showdownImagesFor(v602, now, store, origin), [], "6.02 has no Events tab");
    // The admin's pictures: an upload on the same address, another site's as it is; a slot set back goes to Core's.
    const upload = "/content/api/news-images/0123456789abcdef0123456789abcdef.png";
    fs.mkdirSync(path.join(dir, "news-images"));
    fs.writeFileSync(path.join(dir, "news-images", "0123456789abcdef0123456789abcdef.png"), png(711, 1024));
    const changed = store.setImages(event.id, { posterFront: upload, playlistTile: "https://pictures.example/tile.jpg", loadingScreen: "https://pictures.example/load.jpg" },
      at("2026-11-12T23:01:00.000Z"));
    const info = tournamentInformationFor(v610, now, store, origin);
    const custom = info.tournament_info.tournaments[0];
    assert.equal(custom.poster_front_image, `${origin}${upload}`);
    assert.equal(custom.poster_back_image, `${origin}${showdownImagePath}/${showdownImageSlots[1].file}`);
    assert.equal(custom.playlist_tile_image, "https://pictures.example/tile.jpg");
    assert.equal(custom.loading_screen_image, "https://pictures.example/load.jpg");
    assert.equal(info.lastModified, "2026-11-13T00:00:00.000Z", "never older than the colours' and pictures' arrival");
    assert.deepEqual(customShowdownImages(store).sort(), ["https://pictures.example/load.jpg", "https://pictures.example/tile.jpg", upload].sort());
    assert.equal(changed.imagesSetAt, "2026-11-12T23:01:00.000Z");
    store.setImages(event.id, { posterFront: "", playlistTile: null });
    assert.deepEqual(store.get(event.id).images, { loadingScreen: "https://pictures.example/load.jpg" });
    // What a picture may be: an http(s) URL or an upload that exists; slots by name.
    assert.throws(() => validateImages({ posterFront: "ftp://pictures.example/a.png" }, {}, dir), /http/);
    assert.throws(() => validateImages({ posterFront: "/content/api/news-images/ffffffffffffffffffffffffffffffff.png" }, {}, dir), /uploaded/);
    assert.throws(() => validateImages({ banner: "https://pictures.example/a.png" }, {}, dir), /No picture slot banner/);
    assert.throws(() => validateImages([], {}, dir), /Pictures are/);
    // Only an in-game event has pictures.
    const old = store.create({ name: "Solo Showdown", playlist: "soloShowdown" }, now);
    assert.throws(() => store.setImages(old.id, { posterFront: "https://pictures.example/a.png" }), /Events tab/);
    assert.equal(store.setImages("nope", {}), null);
    // Made with its pictures.
    const made = store.create({ name: "Cup 2", playlist: "showdownDuos", images: { posterBack: "https://pictures.example/back.png" } }, now);
    assert.deepEqual(made.images, { posterBack: "https://pictures.example/back.png" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the window's countdown begins with the event's announcement, so the lobby's Showdown state needs no refresh at its start", () => {
  const dir = tempDir();
  try {
    const store = createTournamentStore(dir);
    const created = at("2026-11-12T23:10:00.000Z");
    const event = store.create({ name: "Agas Cup", playlist: "showdownSolo", startsAt: "2026-11-12T23:12:00.000Z", endsAt: "2026-11-12T23:24:00.000Z" }, created);
    const [window] = tournamentAndHistory("ann", v610, created, store).eventTournaments[0].eventWindows;
    assert.deepEqual([window.countdownBeginTime, window.beginTime, window.endTime], ["2026-11-12T23:10:00.000Z", "2026-11-12T23:12:00.000Z", "2026-11-12T23:24:00.000Z"]);
    // The lobby's Showdown state (0x2EBB350) holds from countdownBeginTime to endTime: a list fetched before the start
    // already has it, and the client's own state functions turn the box from "Starts In" to "Ends In" at beginTime.
    for (const time of ["2026-11-12T23:10:30.000Z", "2026-11-12T23:13:00.000Z"]) {
      const now = Date.parse(time);
      assert.ok(Date.parse(window.countdownBeginTime) <= now && now < Date.parse(window.endTime), time);
    }
    // An event made with a start already past counts down from that start.
    const late = store.create({ name: "Late Cup", playlist: "showdownDuos", startsAt: "2026-11-12T22:00:00.000Z" }, created);
    const lateWindow = tournamentAndHistory("ann", v610, created, store).eventTournaments.find(({ tournamentId }) => tournamentId === late.id).eventWindows[0];
    assert.equal(lateWindow.countdownBeginTime, "2026-11-12T22:00:00.000Z");
    assert.equal(event.id.length > 0, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the client's current event (0x118AFD0): of the windows not ended, the one that begins first, begun or not", () => {
  const dir = tempDir();
  try {
    const store = createTournamentStore(dir);
    const now = at("2026-11-12T23:00:00.000Z");
    assert.equal(currentShowdownEvent(v610, now, store), null);
    const later = store.create({ name: "Later", playlist: "showdownDuos", startsAt: "2026-11-13T10:00:00.000Z", endsAt: "2026-11-13T12:00:00.000Z" }, now);
    assert.equal(currentShowdownEvent(v610, now, store).id, later.id, "not begun yet, still the current one");
    const soon = store.create({ name: "Soon", playlist: "showdownSolo", startsAt: "2026-11-12T23:12:00.000Z", endsAt: "2026-11-12T23:24:00.000Z" }, now);
    assert.equal(currentShowdownEvent(v610, now, store).id, soon.id, "the earlier start wins");
    // An open event that began earlier keeps the others' playlists off while it runs.
    const open = store.create({ name: "Open", playlist: "showdownSquads", startsAt: "2026-11-12T20:00:00.000Z" }, now);
    assert.equal(currentShowdownEvent(v610, now, store).id, open.id);
    store.end(open.id, at("2026-11-12T23:05:00.000Z"));
    assert.equal(currentShowdownEvent(v610, at("2026-11-12T23:13:00.000Z"), store).id, soon.id);
    assert.equal(currentShowdownEvent(v610, at("2026-11-12T23:30:00.000Z"), store).id, later.id, "after its end, the next");
    assert.equal(currentShowdownEvent(v602, now, store), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the lobbies are told to ask again when an event changes and at each start and end, only on builds with the Events tab", () => {
  const dir = tempDir();
  try {
    const store = createTournamentStore(dir);
    let clock = Date.parse("2026-11-12T23:00:00.000Z");
    const sent = [];
    const xmpp = {
      onlineAccounts: () => [{ accountId: "ann" }, { accountId: "bob" }, { accountId: "cat" }],
      notify: (accountId, type, payload) => sent.push([accountId, type, payload])
    };
    const builds = { ann: v610, bob: v602, cat: undefined };
    const accounts = { get: (accountId) => ({ lastBuild: builds[accountId] }) };
    const timers = [];
    const refresh = createShowdownRefresh({ store, xmpp, accounts, now: () => new Date(clock),
      setTimer: (run, delay) => { const timer = { run, delay }; timers.push(timer); return timer; },
      clearTimer: (timer) => { timer.cleared = true; } });
    assert.equal(refresh.schedule(), null, "no event, no timer");
    assert.equal(timers.length, 0);
    store.create({ name: "Agas Cup", playlist: "showdownSolo", startsAt: "2026-11-12T23:12:00.000Z", endsAt: "2026-11-12T23:24:00.000Z" }, new Date(clock));
    // Made: the 6.10 player is told at once; 6.02's and an unknown build's aren't.
    assert.equal(refresh.changed(), 1);
    assert.deepEqual(sent, [["ann", tournamentsCompleteMessage, {}]]);
    // The next edge is the start, a second late.
    assert.equal(timers.at(-1).delay, 12 * 60 * 1000 + 1000);
    clock = Date.parse("2026-11-12T23:12:01.000Z");
    timers.at(-1).run();
    assert.equal(sent.length, 2, "told at the start");
    assert.equal(timers.at(-1).delay, 12 * 60 * 1000, "then the end");
    clock = Date.parse("2026-11-12T23:24:01.000Z");
    timers.at(-1).run();
    assert.equal(sent.length, 3, "told at the end");
    // Nothing left: no further timer once both edges have passed.
    const count = timers.length;
    assert.equal(refresh.schedule(), null);
    assert.equal(timers.length, count);
    // A timer longer than setTimeout allows only sets the next one.
    store.create({ name: "Next Month", playlist: "showdownDuos", startsAt: "2027-01-20T00:00:00.000Z" }, new Date(clock));
    refresh.schedule();
    const long = timers.at(-1);
    assert.equal(long.delay, 2 ** 31 - 1);
    long.run();
    assert.equal(sent.length, 3, "not an edge yet");
    // 4.2's Solo Showdown has no Events tab: its dates set no timer.
    const otherDir = tempDir();
    try {
      const other = createTournamentStore(otherDir);
      other.create({ name: "Solo Showdown", playlist: "soloShowdown", startsAt: "2027-11-13T00:00:00.000Z" }, new Date(clock));
      assert.equal(createShowdownRefresh({ store: other, xmpp, accounts, now: () => new Date(clock), setTimer: () => assert.fail("no timer") }).schedule(), null);
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the admin sets an event's pictures, the content page carries them with Core's for the rest, and Core's are served", async () => {
  const backend = await startBackend();
  try {
    const made = await admin(backend, "/tournaments", { name: "Agas Cup", playlist: "showdownSolo" });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const eventId = made.body.event.id;
    assert.deepEqual(made.body.imageSlots.map(({ key, default: file }) => [key, file]), showdownImageSlots.map(({ key, file }) => [key, file ? `${showdownImagePath}/${file}` : null]));
    assert.equal(made.body.currentInGameEvent, eventId, "the lobby's event now");

    // The page, asked on the backend's address (or an Epic host the -httpproxy brought here), names Core's pictures there.
    const host = `127.0.0.1:${backend.port}`;
    const page = (await pageFor(backend.port, host)).body;
    const entry = page.tournamentinformation.tournament_info.tournaments[0];
    assert.equal(entry.poster_front_image, `http://${host}${showdownImagePath}/${showdownImageSlots[0].file}`);
    for (const url of [entry.poster_front_image, entry.poster_back_image, entry.playlist_tile_image]) assert.ok(page._images_.includes(url), url);
    assert.equal(entry.title_color, showdownColors.title_color);
    const epicHost = (await pageFor(backend.port, "fortnitecontent-website-prod07.ol.epicgames.com")).body.tournamentinformation.tournament_info.tournaments[0];
    assert.equal(epicHost.playlist_tile_image, `http://fortnitecontent-website-prod07.ol.epicgames.com${showdownImagePath}/${showdownImageSlots[2].file}`);

    // Core's pictures are served, JPEGs, cacheable; nothing else under the path is.
    for (const slot of showdownImageSlots.filter(({ file }) => file)) {
      const response = await fetch(`http://127.0.0.1:${backend.port}${showdownImagePath}/${slot.file}`);
      assert.equal(response.status, 200, slot.file);
      assert.equal(response.headers.get("content-type"), "image/jpeg");
      const body = Buffer.from(await response.arrayBuffer());
      assert.deepEqual([...body.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    }
    for (const name of ["nope.jpg", "..%2F..%2Fpackage.json", "Showdown_PosterFront.jpg"]) {
      assert.equal((await fetch(`http://127.0.0.1:${backend.port}${showdownImagePath}/${name}`)).status, 404, name);
    }

    // An upload (the news pictures' store) and another site's URL, set on the event.
    const uploaded = await admin(backend, "/news/image", { data: png(711, 1024).toString("base64") });
    assert.equal(uploaded.status, 200);
    const set = await admin(backend, `/tournaments/${eventId}/images`, { images: { posterFront: uploaded.body.image, playlistTile: "https://pictures.example/tile.png" } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.deepEqual(set.body.event.images, { posterFront: uploaded.body.image, playlistTile: "https://pictures.example/tile.png" });
    const after = (await pageFor(backend.port, host)).body;
    const customEntry = after.tournamentinformation.tournament_info.tournaments[0];
    assert.equal(customEntry.poster_front_image, `http://${host}${uploaded.body.image}`);
    assert.equal(customEntry.playlist_tile_image, "https://pictures.example/tile.png");
    assert.equal(customEntry.poster_back_image, `http://${host}${showdownImagePath}/${showdownImageSlots[1].file}`);
    assert.ok(after._images_.includes(customEntry.poster_front_image));
    // The upload is kept while the event uses it, though the news is saved again (which prunes unused uploads).
    assert.equal((await admin(backend, "/news", { battleRoyaleNews: null })).status, 200);
    const stored = path.join(backend.dataDir, "news-images", uploaded.body.image.split("/").pop());
    assert.ok(fs.existsSync(stored));
    // Bad values are refused; a 4.2 event has no pictures; an unknown event is a 404.
    assert.equal((await admin(backend, `/tournaments/${eventId}/images`, { images: { posterFront: "javascript:alert(1)" } })).status, 400);
    assert.equal((await admin(backend, `/tournaments/${eventId}/images`, { images: { wallpaper: "https://pictures.example/a.png" } })).status, 400);
    const old = (await admin(backend, "/tournaments", { name: "Solo Showdown", playlist: "soloShowdown" })).body.event.id;
    assert.equal((await admin(backend, `/tournaments/${old}/images`, { images: { posterFront: "https://pictures.example/a.png" } })).status, 400);
    assert.equal((await admin(backend, "/tournaments/nope/images", { images: {} })).status, 404);
    // Back to Core's: the upload goes once nothing uses it.
    const reset = await admin(backend, `/tournaments/${eventId}/images`, { images: { posterFront: null, playlistTile: "" } });
    assert.deepEqual(reset.body.event.images, {});
    assert.equal(fs.existsSync(stored), false);
  } finally {
    backend.close();
  }
});

test("the content page without the Events tab is unchanged, and the 6.10 page's _images_ holds the tournaments' pictures", () => {
  const page602 = contentPage(undefined, undefined, v602, undefined, origin);
  assert.equal(page602._images_.some((url) => url.includes(showdownImagePath)), false);
  assert.equal(Object.hasOwn(page602, "tournamentinformation"), false);
});

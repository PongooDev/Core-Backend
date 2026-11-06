import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ltms } from "../src/events/ltms.js";
import { contentPage } from "../src/services/content/pages.js";
import { epicPlaylistImages, playlistImageModes, playlistImagesFor } from "../src/services/content/playlistimages.js";
import { get, post, send, startBackend } from "./helpers.js";

// Core-Backend #260: 4.0's mode select tiles read the content page's playlistimages.playlistimages.images[]
// {playlistname, image} (services/content/playlistimages.js); the admin panel sets a playlist's own picture.
const v40 = "4039451";
const v41 = "4053532";
const v36 = "4019403";

const admin = (backend, url, body) => (body === undefined ? get(backend.port, `/admin/api${url}`) : post(backend.port, `/admin/api${url}`, undefined, body));
const pageFor = (port, changelist) => send({ host: "127.0.0.1", port, method: "GET", path: "/content/api/pages/fortnite-game",
  headers: { "User-Agent": `Fortnite/++Fortnite+Release-4.0-CL-${changelist} Windows/10.0.19045.1.768.64bit` } });
const imageOf = (page, playlistName) => page.playlistimages.playlistimages.images.find((entry) => entry.playlistname === playlistName)?.image;

function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data) => {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.alloc(height * (width * 3 + 1)))), chunk("IEND", Buffer.alloc(0))]);
}

test("every playlist of 4.0 on has a tile entry: the default modes and the LTMs, each once", () => {
  const names = playlistImageModes().map(({ playlistName }) => playlistName);
  assert.equal(new Set(names).size, names.length);
  for (const name of ["Playlist_DefaultSolo", "Playlist_DefaultDuo", "Playlist_DefaultSquad"]) assert.ok(names.includes(name), name);
  for (const ltm of ltms.filter((entry) => entry.playlistName && (typeof entry.builds[1] !== "number" || entry.builds[1] >= Number(v40)))) {
    assert.ok(names.includes(ltm.playlistName), ltm.playlistName);
  }
  // Every Epic picture is a playlist the list has, on Epic's CDN.
  for (const [name, url] of Object.entries(epicPlaylistImages)) {
    assert.ok(names.includes(name), name);
    assert.match(url, /^https:\/\/cdn2\.unrealengine\.com\/Fortnite\/fortnite-game\/playlist(tiles|information)\/[\w.-]+\.(png|jpg)$/);
  }
});

test("4.0 and 4.1 get Epic's pictures per playlist; 3.6 and older get no section", () => {
  for (const build of [v40, v41]) {
    const page = contentPage(undefined, undefined, build);
    assert.equal(page.playlistimages._title, "playlistimages");
    const { images, _type } = page.playlistimages.playlistimages;
    assert.equal(_type, "PlaylistImageList");
    const byName = Object.fromEntries(images.map((entry) => [entry.playlistname, entry]));
    assert.equal(byName.Playlist_DefaultSolo.image, epicPlaylistImages.Playlist_DefaultSolo);
    assert.equal(byName.Playlist_DefaultSolo._type, "PlaylistImageEntry");
    assert.equal(byName.Playlist_50v50.image, epicPlaylistImages.Playlist_50v50);
    assert.notEqual(byName.Playlist_DefaultSolo.image, byName.Playlist_DefaultSquad.image, "each mode its own picture");
    assert.equal(byName.Playlist_SkySupply_Duos, undefined, "a playlist without a picture keeps the game's default");
    for (const entry of images) assert.ok(page._images_.includes(entry.image), "precached");
  }
  for (const build of [v36, "3541083", undefined]) assert.equal(contentPage(undefined, undefined, build).playlistimages, undefined, String(build));
  assert.equal(playlistImagesFor(v36), undefined);
});

test("a host's own picture replaces Epic's, an upload on the address the client asked on", () => {
  const section = playlistImagesFor(v40, { Playlist_DefaultSolo: "https://example.com/solo.png",
    Playlist_SkySupply_Duos: "/content/api/news-images/0123456789abcdef0123456789abcdef.png" }, "http://127.0.0.1:3551");
  const byName = Object.fromEntries(section.playlistimages.images.map((entry) => [entry.playlistname, entry.image]));
  assert.equal(byName.Playlist_DefaultSolo, "https://example.com/solo.png");
  assert.equal(byName.Playlist_SkySupply_Duos, "http://127.0.0.1:3551/content/api/news-images/0123456789abcdef0123456789abcdef.png");
  assert.equal(byName.Playlist_DefaultDuo, epicPlaylistImages.Playlist_DefaultDuo);
});

test("the admin panel sets, validates and resets a playlist's picture, and keeps its upload (#260)", async () => {
  const backend = await startBackend();
  try {
    const initial = await admin(backend, "/news");
    const solo = initial.body.playlistImages.find((mode) => mode.playlistName === "Playlist_DefaultSolo");
    assert.deepEqual(solo, { playlistName: "Playlist_DefaultSolo", name: "Solo", epic: epicPlaylistImages.Playlist_DefaultSolo, custom: "" });

    // Only http(s) URLs or uploads, and only the playlists the panel lists.
    for (const image of ["javascript:alert(1)", "file:///C:/Windows/win.ini", "ftp://example.com/a.png", "/content/api/news-images/../settings.json",
      "<img src=x onerror=alert(1)>"]) {
      assert.equal((await admin(backend, "/news", { playlistImages: { Playlist_DefaultSolo: image } })).status, 400, image);
    }
    assert.equal((await admin(backend, "/news", { playlistImages: { Playlist_Nope: "https://example.com/a.png" } })).status, 400);

    const saved = await admin(backend, "/news", { playlistImages: { Playlist_DefaultSolo: "https://example.com/solo.png" } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.playlistImages.find((mode) => mode.playlistName === "Playlist_DefaultSolo").custom, "https://example.com/solo.png");
    assert.equal(imageOf((await pageFor(backend.port, v40)).body, "Playlist_DefaultSolo"), "https://example.com/solo.png");

    // An upload, served by the backend, survives a news picture change (pruning keeps what the playlists use).
    const uploaded = await admin(backend, "/news/image", { data: png(1024, 512).toString("base64") });
    assert.equal(uploaded.status, 200);
    assert.equal((await admin(backend, "/news", { playlistImages: { Playlist_50v50: uploaded.body.image } })).status, 200);
    await admin(backend, "/news", { battleRoyaleNews: { title: "Hi", body: "There", image: "" } });
    const name = uploaded.body.image.split("/").pop();
    assert.ok(fs.existsSync(path.join(backend.dataDir, "news-images", name)), "the playlist's upload is kept");
    assert.equal(imageOf((await pageFor(backend.port, v40)).body, "Playlist_50v50"), `http://127.0.0.1:${backend.port}${uploaded.body.image}`);
    assert.equal(imageOf((await pageFor(backend.port, v40)).body, "Playlist_DefaultSolo"), "https://example.com/solo.png", "the other one stays");

    // Reset: Epic's picture again, and the upload no one uses goes.
    const reset = await admin(backend, "/news", { playlistImages: { Playlist_DefaultSolo: null, Playlist_50v50: "" } });
    assert.ok(reset.body.playlistImages.every((mode) => mode.custom === ""));
    assert.equal(fs.existsSync(path.join(backend.dataDir, "news-images", name)), false);
    assert.equal(imageOf((await pageFor(backend.port, v40)).body, "Playlist_DefaultSolo"), epicPlaylistImages.Playlist_DefaultSolo);
  } finally {
    backend.close();
  }
});

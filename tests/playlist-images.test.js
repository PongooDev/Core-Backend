import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ltms } from "../src/events/ltms.js";
import { contentPage } from "../src/services/content/pages.js";
import { epicPlaylistImages, playlistImageModes, playlistImagesFor, playlistInformationFor } from "../src/services/content/playlistimages.js";
import { get, post, send, startBackend } from "./helpers.js";

// Core-Backend #260: 4.0's mode select tiles read the content page's playlistimages.playlistimages.images[]
// {playlistname, image} (services/content/playlistimages.js); the admin panel sets a playlist's own picture.
const v40 = "4039451";
const v41 = "4053532";
const v36 = "4019403";
const v530 = "4305896";
const v540 = "4352937";

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

// Core-Backend #319: every LTM the backend offers on a build with tile pictures has Epic's picture, but the two Epic never
// ran (Sky Supply, Impact), which keep the default one unless the host sets one.
test("every LTM of 4.0 on has Epic's tile picture but Sky Supply and Impact (#319)", () => {
  const without = playlistImageModes().filter(({ epic }) => !epic).map(({ playlistName }) => playlistName).sort();
  // 6.10's default modes with glider redeploy and its tournament playlists had no tile of their own either, nor 6.20's
  // Fortnitemares tournament playlists, nor 6.30's Scavenger Pop-Up Cup ones. 6.20's Fortnitemares modes have Epic's (#348,
  // below).
  assert.deepEqual(without, ["Playlist_Deimos_DuoShow", "Playlist_Deimos_SoloShow",
    "Playlist_Deimos_SquadShow", "Playlist_GRD_Duos", "Playlist_GRD_Solo", "Playlist_GRD_Squads", "Playlist_Impact_Duos", "Playlist_Impact_Solo", "Playlist_Impact_Squads",
    "Playlist_ShowdownAlt_Duos", "Playlist_ShowdownAlt_Solo", "Playlist_ShowdownAlt_Squads",
    "Playlist_Showdown_Duos", "Playlist_Showdown_Solo", "Playlist_Showdown_Squads", "Playlist_SkySupply", "Playlist_SkySupply_Duos", "Playlist_SkySupply_Squads"]);
  const score = "https://cdn2.unrealengine.com/Fortnite/fortnite-game/playlisttiles/BR05_LobbyTile_LTM_ScoreRoyale-1024x512-b608aaf7840cdf6b7a702c5cbe1848a2247516d6.jpg";
  for (const name of ["Playlist_Score_Solo", "Playlist_Score_Duos", "Playlist_Score_Squads"]) assert.equal(epicPlaylistImages[name], score, name);
  // Season 5's others, as Epic's page of 28 August 2018 named them.
  assert.match(epicPlaylistImages.Playlist_Steady_Duos, /BR05_LobbyTile_LTM-Steady-Storm-/);
  assert.match(epicPlaylistImages.Playlist_FlyExplosives_Solo, /BR05_LTM_FlyExplosives-/);
  assert.match(epicPlaylistImages.Playlist_Soaring_50s, /BR05_LTM_Soaring50s-/);
  assert.equal(epicPlaylistImages.Playlist_50v50SAU, epicPlaylistImages.Playlist_SolidGold_Squads, "50v50 Solid Gold has Solid Gold's tile");
  assert.match(epicPlaylistImages.Playlist_Close_Squad, /BR04_LTM_CloseEncounters-/);
  assert.match(epicPlaylistImages.Playlist_Bling_Squads, /08BR_HighStakes_ModeTile-/);
});

test("5.30 gets Score Royale's own tile in playlistimages, and 5.0 to 5.30 every Season 5 LTM's (#319)", () => {
  const page = contentPage(undefined, undefined, v530);
  assert.equal(page.playlistinformation, undefined, "5.30 reads playlistimages only");
  const byName = Object.fromEntries(page.playlistimages.playlistimages.images.map((entry) => [entry.playlistname, entry.image]));
  for (const name of ["Playlist_Score_Solo", "Playlist_Score_Duos", "Playlist_Score_Squads", "Playlist_SolidGold_Duos", "Playlist_50v50SAU",
    "Playlist_Playground", "Playlist_50v50"]) {
    assert.equal(byName[name], epicPlaylistImages[name], name);
    assert.ok(page._images_.includes(byName[name]), `${name} precached`);
  }
  for (const build of ["4214610", "4240749", "4288479"]) {
    const images = contentPage(undefined, undefined, build).playlistimages.playlistimages.images.map((entry) => entry.playlistname);
    for (const name of ["Playlist_FlyExplosives_Squads", "Playlist_Steady_Solo", "Playlist_Soaring_50s", "Playlist_Snipers"]) assert.ok(images.includes(name), `${build} ${name}`);
  }
});

// Core-Backend #321: 5.40 reads playlistinformation (playlist_info.playlists[] {playlist_name, image, special_border}), not
// playlistimages, so every 5.40 tile kept the default picture.
test("5.40 gets playlistinformation: every mode's picture, The Getaway's with the High Stakes border (#321)", () => {
  const page = contentPage(undefined, undefined, v540);
  assert.equal(page.playlistimages, undefined, "5.40 has no playlistimages reader");
  const section = page.playlistinformation;
  assert.equal(section._title, "playlistinformation");
  assert.equal(section.frontend_matchmaking_header_style, "None");
  assert.equal(section.frontend_matchmaking_header_text, "");
  assert.equal(section.playlist_info._type, "Playlist Information");
  const byName = Object.fromEntries(section.playlist_info.playlists.map((entry) => [entry.playlist_name, entry]));
  assert.deepEqual(byName.Playlist_DefaultSolo, { image: epicPlaylistImages.Playlist_DefaultSolo, playlist_name: "Playlist_DefaultSolo",
    special_border: "None", _type: "FortPlaylistInfo" });
  for (const name of ["Playlist_DefaultDuo", "Playlist_DefaultSquad", "Playlist_50v50", "Playlist_Playground", "Playlist_Soaring_50s",
    "Playlist_50v50SAU", "Playlist_Close_Squad", "Playlist_Close_Solo", "Playlist_Close_Duos"]) {
    assert.equal(byName[name].image, epicPlaylistImages[name], name);
    assert.equal(byName[name].special_border, "None", name);
  }
  for (const name of ["Playlist_Bling_Squads", "Playlist_Bling_Duos", "Playlist_Bling_Solo"]) {
    assert.equal(byName[name].image, epicPlaylistImages[name], name);
    assert.equal(byName[name].special_border, "HighStakes", name);
  }
  for (const entry of section.playlist_info.playlists) {
    assert.ok(entry.image, entry.playlist_name);
    assert.ok(page._images_.includes(entry.image), `${entry.playlist_name} precached`);
    assert.equal(entry.description, undefined, "the tile keeps the playlist's own text");
  }
  // A host's own picture there too; builds before 5.40 get no section.
  const custom = playlistInformationFor(v540, { Playlist_Bling_Squads: "https://example.com/getaway.png" });
  assert.equal(custom.playlist_info.playlists.find((entry) => entry.playlist_name === "Playlist_Bling_Squads").image, "https://example.com/getaway.png");
  for (const build of [v530, v40, v36, undefined]) assert.equal(playlistInformationFor(build), undefined, String(build));
});

test("the content page route serves 5.40 its playlistinformation (#321)", async () => {
  const backend = await startBackend();
  try {
    const page = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/content/api/pages/fortnite-game",
      headers: { "User-Agent": `Fortnite/++Fortnite+Release-5.40-CL-${v540} Windows/10.0.19045.1.768.64bit` } });
    assert.equal(page.status, 200);
    assert.equal(page.body.playlistimages, undefined);
    const getaway = page.body.playlistinformation.playlist_info.playlists.find((entry) => entry.playlist_name === "Playlist_Bling_Squads");
    assert.equal(getaway.image, epicPlaylistImages.Playlist_Bling_Squads);
    assert.equal(getaway.special_border, "HighStakes");
    const score = (await pageFor(backend.port, v530)).body.playlistimages.playlistimages.images.find((entry) => entry.playlistname === "Playlist_Score_Solo");
    assert.equal(score.image, epicPlaylistImages.Playlist_Score_Solo);
  } finally {
    backend.close();
  }
});

// Core-Backend #348: 6.20's Fortnitemares Solo, Duos and Squads had no tile; Epic's later page names one for each, on its CDN.
test("6.20's and 6.21's Fortnitemares modes have Epic's tiles in playlistinformation (#348)", () => {
  const cdn = "https://cdn2.unrealengine.com/Fortnite/fortnite-game/playlistinformation/";
  assert.equal(epicPlaylistImages.Playlist_Deimos_Solo, `${cdn}BR06_Fortnitemares_In-GamePlaylist_1024x512_-Solo-1024x512-7e7fe76e48beb3a06da0592cb26e412265986e4d.jpg`);
  assert.equal(epicPlaylistImages.Playlist_Deimos_Duo, `${cdn}BR06_Fortnitemares_In-GamePlaylist_1024x512_Duos-1024x512-1eadb7cfab62c9eb5c90c65577c676d5d0bb15c2.jpg`);
  assert.equal(epicPlaylistImages.Playlist_Deimos_Squad, `${cdn}BR06_Fortnitemares_In-GamePlaylist_1024x512_Squads-1024x512-783a0812f6acf1f5931c8015e6ad13c0b76c5a9c.jpg`);
  for (const build of ["4497486", "4526925"]) {
    const entries = playlistInformationFor(build).playlist_info.playlists;
    for (const name of ["Playlist_Deimos_Solo", "Playlist_Deimos_Duo", "Playlist_Deimos_Squad"]) {
      assert.deepEqual(entries.find((entry) => entry.playlist_name === name), { image: epicPlaylistImages[name], playlist_name: name, special_border: "None", _type: "FortPlaylistInfo" }, `${build} ${name}`);
    }
    assert.equal(entries.some((entry) => entry.playlist_name === "Playlist_Deimos_SoloShow"), false, "the tournament playlists have none");
  }
});

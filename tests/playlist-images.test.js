import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { buildVersions } from "../src/builds/detect.js";
import { hasLtm, ltms } from "../src/events/ltms.js";
import { imageHostOf, isImageHost } from "../src/services/content/imagehosts.js";
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
  // Fortnitemares tournament playlists, nor 6.30's Scavenger Pop-Up Cup ones, nor 7.20's Ice Storm ones. 6.20's Fortnitemares modes have Epic's (#348,
  // below). 7.00's Creative (Playlist_PlaygroundV2) and 7.30's NFL Rumble (Playlist_Omaha) have the tiles Epic's later page
  // names for them (below). 7.30's Party at Pleasant Park (Playlist_Music_Highest) has none: that page names its playlist only
  // with a later event's tile, and no Showtime tile of Epic's was found (🟡 the default tile until the host sets one).
  // 8.40's Air Royale (Playlist_Goose_Duos) and Food Fight: Deep Fried (Playlist_Barrier_16_B_Lava) have Epic's (#422), and
  // 8.50's Endgame (Playlist_Ashton_*) the page's Playlist_Ashton_Sm tile. 9.00's Trios (Playlist_Trios) has none recorded
  // (🟡 the default tile until one of Epic's is found).
  assert.deepEqual(without, ["Playlist_Deimos_DuoShow", "Playlist_Deimos_Duo_WinterShow", "Playlist_Deimos_SoloShow", "Playlist_Deimos_Solo_WinterShow",
    "Playlist_Deimos_SquadShow", "Playlist_Deimos_Squad_WinterShow", "Playlist_GRD_Duos", "Playlist_GRD_Solo", "Playlist_GRD_Squads", "Playlist_Impact_Duos", "Playlist_Impact_Solo", "Playlist_Impact_Squads",
    "Playlist_Music_Highest",
    "Playlist_ShowdownAlt_Duos", "Playlist_ShowdownAlt_Solo", "Playlist_ShowdownAlt_Squads",
    "Playlist_ShowdownTournament_Duos", "Playlist_ShowdownTournament_Solo", "Playlist_ShowdownTournament_Squads",
    "Playlist_Showdown_Duos", "Playlist_Showdown_Solo", "Playlist_Showdown_Squads", "Playlist_SkySupply", "Playlist_SkySupply_Duos", "Playlist_SkySupply_Squads",
    "Playlist_Trios"]);
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

test("#354: Seasons 4 to 7 serve Epic's own default-mode tiles, BR_LobbyTileArt, the only ones Epic's pages named for them; 3.6 reads none", () => {
  const tile = (mode) => new RegExp(`/playlisttiles/BR_LobbyTileArt_${mode}-512x512-[0-9a-f]{40}\.png$`);
  for (const build of [v40, v530]) {
    const byName = Object.fromEntries(playlistImagesFor(build).playlistimages.images.map((entry) => [entry.playlistname, entry.image]));
    assert.match(byName.Playlist_DefaultSolo, tile("Solo"), build);
    assert.match(byName.Playlist_DefaultDuo, tile("Duo"), build);
    assert.match(byName.Playlist_DefaultSquad, tile("Squad"), build);
  }
  // Season 7 (7.00) too: no Season 7 default-mode tile exists anywhere (src/services/content/playlistimages.js).
  for (const build of [v540, "4402180", "4526925", "4573279", "4629139"]) {
    const byName = Object.fromEntries(playlistInformationFor(build).playlist_info.playlists.map((entry) => [entry.playlist_name, entry.image]));
    assert.match(byName.Playlist_DefaultSolo, tile("Solo"), build);
    assert.match(byName.Playlist_DefaultDuo, tile("Duo"), build);
    assert.match(byName.Playlist_DefaultSquad, tile("Squad"), build);
  }
  assert.equal(playlistImagesFor(v36), undefined);
  assert.equal(playlistInformationFor(v36), undefined);
});

// Every build from 4.0 to 7.40 and every playlist it serves (the default modes and the LTMs events/ltms.js gives that build):
// the tile Epic's pages gave it, by its file on Epic's CDN (playlistimages.js), and nothing else on the page. The playlists
// Epic made no mode select tile for get no entry, so their tile keeps the blueprint's default picture.
const epicTile = (file) => `https://cdn2.unrealengine.com/Fortnite/fortnite-game/${file}`;
const tileFiles = [
  [["Playlist_DefaultSolo"], "playlisttiles/BR_LobbyTileArt_Solo-512x512-24446ea2a54612c5604ecf0e30475b4dec81c3bc.png"],
  [["Playlist_DefaultDuo"], "playlisttiles/BR_LobbyTileArt_Duo-512x512-5dea8dfae97bddcd4e204dd47bfb245d3f68fc7b.png"],
  [["Playlist_DefaultSquad"], "playlisttiles/BR_LobbyTileArt_Squad-512x512-5225ec6ca3265611957834c2c549754fe1778449.png"],
  [["Playlist_50v50"], "playlisttiles/LTM_50v50-1024x512-788bf1a67426f54307c4296123ac2d3ff8cc0d6c.png"],
  [["Playlist_5x20"], "playlisttiles/BR04_LTM_5x20-1024x512-451b402db5751c25a1e7616930c5ae37d8b20710.png"],
  [["Playlist_Blitz_Squad", "Playlist_Blitz_Solo", "Playlist_Blitz_Duos"], "playlisttiles/BR04_LTM_Blitz-1024x512-98c63417095442c210177ee9b5f3463d0003cd5a.png"],
  [["Playlist_SolidGold_Squads", "Playlist_SolidGold_Solo", "Playlist_SolidGold_Duos", "Playlist_50v50SAU"],
    "playlisttiles/BR04_LTM_SolidGold-1024x512-36e202c36d3ef3bd151a97c060401d33ac6f549a.png"],
  [["Playlist_Snipers_Solo", "Playlist_Snipers_Duos", "Playlist_Snipers"], "playlisttiles/BR04_LTM_SniperShootout-1024x512-bcaf8004961e4e374d0603813f840f4b575d230b.jpg"],
  [["Playlist_HighExplosives_Solo", "Playlist_HighExplosives_Squads"], "playlistinformation/BR_LTM_HighExplosives-1024x512-4afc4219531db710e56f3b038e7cd84ca2be7675.jpg"],
  [["Playlist_Carmine"], "playlisttiles/BR04_LTM_Gauntlet-1024x512-a0dca279534a121957275bcdb0b42042d8a010fd.png"],
  [["Playlist_Comp_Solo"], "playlisttiles/BR04_LTM_SoloShowdown-1024x512-0f522b0881adebfe241c6527f03c9140f70b88a7.png"],
  [["Playlist_Close_Squad", "Playlist_Close_Solo", "Playlist_Close_Duos"], "playlisttiles/BR04_LTM_CloseEncounters-1024x512-e617b7603adb59353ba81ed392174859c0c6807b.jpg"],
  [["Playlist_Playground"], "playlisttiles/BR_LTM-Tile_Playground-1024x512-53db8a4b5fb41251af279eaf923bc00ecbc17792.jpg"],
  [["Playlist_Final_20", "Playlist_Final_12"], "playlisttiles/LTM_Tile_FinalFight-1024x576-5af82788940faeef422ad204aaa241e36e7c9c56.jpg"],
  [["Playlist_FlyExplosives_Squads", "Playlist_FlyExplosives_Solo", "Playlist_FlyExplosives_Duos"],
    "playlisttiles/BR05_LTM_FlyExplosives-1024x512-6283e3392b3aa44794dac64423b22606f8773503.png"],
  [["Playlist_Steady_Solo", "Playlist_Steady_Duos", "Playlist_Steady_Squads"],
    "playlisttiles/BR05_LobbyTile_LTM-Steady-Storm-1024x512-f38e603ed9c80b6210a25c4737d3d8b675b8d28e.jpg"],
  [["Playlist_Soaring_50s", "Playlist_Soaring_Solo", "Playlist_Soaring_Duos", "Playlist_Soaring_Squads"],
    "playlisttiles/BR05_LTM_Soaring50s-1024x512-80762dcc260cc959c11dac2ca2f6ae176eb63ef3.jpg"],
  [["Playlist_Score_Solo", "Playlist_Score_Duos", "Playlist_Score_Squads"],
    "playlisttiles/BR05_LobbyTile_LTM_ScoreRoyale-1024x512-b608aaf7840cdf6b7a702c5cbe1848a2247516d6.jpg"],
  [["Playlist_Bling_Squads", "Playlist_Bling_Duos", "Playlist_Bling_Solo"], "playlistinformation/08BR_HighStakes_ModeTile-1024x512-741e576e8ae2e30c256ff3508011760ace890711.jpg"],
  [["Playlist_Disco", "Playlist_Disco_32", "Playlist_Disco_40", "Playlist_Disco_Alt", "Playlist_Disco_40_Alt", "Playlist_Disco_32_Alt"],
    "playlistinformation/BR06_LobbyTile_LTM_DiscoDomination-1024x512-c79f07de78d8283656fcf4d1ee757f880911d775.jpg"],
  [["Playlist_Deimos_Solo"], "playlistinformation/BR06_Fortnitemares_In-GamePlaylist_1024x512_-Solo-1024x512-7e7fe76e48beb3a06da0592cb26e412265986e4d.jpg"],
  [["Playlist_Deimos_Duo"], "playlistinformation/BR06_Fortnitemares_In-GamePlaylist_1024x512_Duos-1024x512-1eadb7cfab62c9eb5c90c65577c676d5d0bb15c2.jpg"],
  [["Playlist_Deimos_Squad"], "playlistinformation/BR06_Fortnitemares_In-GamePlaylist_1024x512_Squads-1024x512-783a0812f6acf1f5931c8015e6ad13c0b76c5a9c.jpg"],
  [["Playlist_Deimos_50"], "playlistinformation/BR06_In-GamePlaylist_TeamTerror-1024x512-310430bdaf1b1dd0ecb4d3b180bb6409b7ff6e27.jpg"],
  [["Playlist_Barrier", "Playlist_Barrier_12"], "playlistinformation/BR06_LobbyTile_FoodFight-1024x512-5e1540a0a2ba0a1f663d32c60cfec3a360278672.png"],
  [["Playlist_WW_Solo", "Playlist_WW_Duos", "Playlist_WW_Squads"], "playlistinformation/BR06_ModeTile_LTM_WildWest-1024x512-f67d9d1dd2ca0b290c92b1380240429f0f257a10.jpg"],
  [["Playlist_Respawn_24"], "playlistinformation/BR06_ModeTile_TDM-1024x512-878ba9f92deb153ec85f2bcbce925e185344290e.jpg"],
  [["Playlist_Classic_Solo", "Playlist_Classic_Duos", "Playlist_Classic_Squads"], "playlistinformation/BR_LTM_Unvaulted-1024x512-d3cbe3c4a756190279af4ce98773d6599f7aab4f.jpg"],
  [["Playlist_Vamp_Solo", "Playlist_Vamp_Duo", "Playlist_Vamp_Squad"], "playlistinformation/BR_LTM_Siphon-1024x512-66cb27084be50387682989b50a01dbc9e42f5a5d.jpg"],
  [["Playlist_33"], "playlistinformation/BR07_14-DoF_Social-1024x512-5fa7dd4752d1f0cc1a101f09cb170d0f5b2a31cf.jpg"],
  [["Playlist_Hard_Squads"], "playlistinformation/BR_LTM_Barebones-1024x512-4a29337febb04e9043d57c9e61afe849f8a9e9c7.jpg"],
  [["Playlist_Slide_Solo", "Playlist_Slide_Duos"], "playlistinformation/BR_LTM_Slide-1024x512-189625349e80dc81e225691aa952ffd280996058.jpg"],
  [["Playlist_Ground_Squads"], "playlistinformation/BR_LTM_GroundGame-1024x512-37a4d1d335b4c9427bdc672db0f335f4df813874.jpg"],
  [["Playlist_Sneaky_Solo"], "playlistinformation/BR_LTM_SneakySilencers-1024x512-1669e2eeddca63b61e9b94cc19c3ec502fd33f29.jpg"],
  [["Playlist_Low_Squads"], "playlistinformation/BR_LTM_OneShot-1024x512-9914c2c88b21f72f9628681e0cbcd20bb7311a3f.jpg"],
  [["Playlist_50v50HE"], "playlistinformation/BR_LTM_HighExplosives50s-1024x512-3a8d44af3c2718b5aaaaebbd4627258a657bf0bf.jpg"],
  [["Playlist_Close_50"], "playlistinformation/BR_LTM_CloseEncounters50s-1024x512-03dcc058e1bec3e853b3ee20594128805223b5a3.jpg"],
  [["Playlist_Barrier_16"], "playlistinformation/BR_LTM_FoodFight16-1024x512-309538a1b961b5ab0c22417ab34170cc302bbab8.jpg"],
  [["Playlist_Deimos_Solo_Winter"], "playlistinformation/BR07_ModeTile_WinterDeimos_Solo-1024x512-5c759fe60ec85988f35c729b5fb6a7993d8dbb58.jpg"],
  [["Playlist_Deimos_Duo_Winter"], "playlistinformation/BR07_ModeTile_WinterDeimos_Duos_-1024x512-84315aac8d1fcfb840deba46c4dafda8e9005b2a.jpg"],
  [["Playlist_Deimos_Squad_Winter"], "playlistinformation/BR07_ModeTile_WinterDeimos_Squads-1024x512-cf4323aa9c2cfd027484cf4da14544128e3d4c7e.jpg"],
  [["Playlist_Love_Solo", "Playlist_Love_Duos", "Playlist_Love_Squads"], "playlistinformation/BR07_ModeTile_LTM_LoveShot_v2-1024x512-cd7b917157be2472bebc3db3b125e9b20174c748.jpg"],
  [["Playlist_Sword_Solo", "Playlist_Sword_Duos", "Playlist_Sword_Squads"],
    "playlistinformation/BR07_ModeTile_LTM_InfinityBlade_v2-1024x512-475608c25c288f7d5c884eeebc47fb565f6f5803.jpg"],
  [["Playlist_Toss_Solo", "Playlist_Toss_Duos", "Playlist_Toss_Squads"], "playlistinformation/BR07_ModeTile_LTM_CatchSquads-1024x512-7289222d56b08ef8de20c7187af2670496dca3df.jpg"],
  [["Playlist_Hover", "Playlist_Hover_64", "Playlist_Hover_48"],
    "playlistinformation/BR07_ModeTile_LTM_Drifting50s_Powder-1024x512-5fb24cfd4d83e4cd3a3589b126313beba9cc69a7.jpg"],
  [["Playlist_PlaygroundV2"], "playlistinformation/CM_LobbyTileArt-1024x512-fbcd48db36552ccb1ab4021b722ea29d515377cc.jpg"],
  [["Playlist_Omaha"], "playlistinformation/BR07_ModeTile_NFL_TeamRumble-1024x512-6facfc07214965dc2211d703904607a30c68d08a.jpg"],
  [["Playlist_Fill_Solo", "Playlist_Fill_Duos", "Playlist_Fill_Squads"],
    "playlistinformation/08BR_LTM_FloorIsLava_ModeTile-1024x512-f1af4cd98c7ff0ce4058f4e3b65a853641d0a35e.jpg"],
  [["Playlist_Green_Squad"], "playlistinformation/08BR_LTM_SolidGreen_ModeTile_Squads-1024x512-f0d931472907d54ffaa52ef81f78bf9d5fcfaa2d.jpg"],
  // 8.40's (#422).
  [["Playlist_Goose_Duos"], "playlistinformation/08BR_AirRoyale_Mode-Tile-1024x512-e071f542b7e0ce2cfc34c208e14604815b76439c.jpg"],
  [["Playlist_Barrier_16_B_Lava"], "playlistinformation/EN_08BR_DeepFried_Mode_Tile-1024x512-227979fa27053f858066a1a47d68b55f792fded1.jpg"],
  // 8.50's Endgame, the page's Playlist_Ashton_Sm tile for its three playlists.
  [["Playlist_Ashton_Sm", "Playlist_Ashton_Md", "Playlist_Ashton_Lg"],
    "playlistinformation/08BR_LTM_Endgame_InGame_Mode-Tile-1024x512-03bb0dc121ae8b2dcd27b8b386670737093d0c83.jpg"]
];
const tileOf = Object.fromEntries(tileFiles.flatMap(([names, file]) => names.map((name) => [name, epicTile(file)])));
// 7.10 on: the 14 Days of Fortnite's own tiles for two playlists the earlier pages show with another.
const tileFrom710Of = {
  Playlist_Disco_32_Alt: epicTile("playlistinformation/BR_LTM_HolidayDisco-1024x512-684bd4b41613e59d895a477389515a8b4878da6a.jpg"),
  Playlist_WW_Squads: epicTile("playlistinformation/BR_LTM_WildWest-1024x512-42779242a5a73d654332d9d0afe0983f9d8401d0.jpg")
};
const expectedTile = (name, build) => (Number(build) >= 4667333 ? tileFrom710Of[name] : undefined) ?? tileOf[name];
// No tile of Epic's: Sky Supply and Impact never ran, 6.10's glider redeploy defaults no page names, the tournaments' playlists
// take their tile from tournamentinformation, and 7.30's Party at Pleasant Park's only tile on Epic's pages is a later event's.
const noEpicTile = ["Playlist_SkySupply", "Playlist_SkySupply_Duos", "Playlist_SkySupply_Squads", "Playlist_Impact_Solo", "Playlist_Impact_Duos",
  "Playlist_Impact_Squads", "Playlist_GRD_Solo", "Playlist_GRD_Duos", "Playlist_GRD_Squads", "Playlist_Showdown_Solo", "Playlist_Showdown_Duos",
  "Playlist_Showdown_Squads", "Playlist_ShowdownAlt_Solo", "Playlist_ShowdownAlt_Duos", "Playlist_ShowdownAlt_Squads", "Playlist_Deimos_SoloShow",
  "Playlist_Deimos_DuoShow", "Playlist_Deimos_SquadShow", "Playlist_Deimos_Solo_WinterShow", "Playlist_Deimos_Duo_WinterShow",
  "Playlist_Deimos_Squad_WinterShow", "Playlist_Music_Highest",
  // Season 8's tournaments' (#421): their tiles are tournamentinformation's.
  "Playlist_ShowdownTournament_Solo", "Playlist_ShowdownTournament_Duos", "Playlist_ShowdownTournament_Squads",
  // 9.00's Trios: no tile of Epic's recorded.
  "Playlist_Trios"];
const tileBuilds = Object.keys(buildVersions).filter((build) => Number(build) >= Number(v40));
const pageTiles = (build) => {
  const page = contentPage(undefined, undefined, build);
  const entries = page.playlistimages
    ? page.playlistimages.playlistimages.images.map((entry) => ({ name: entry.playlistname, image: entry.image }))
    : page.playlistinformation.playlist_info.playlists.map((entry) => ({ name: entry.playlist_name, image: entry.image, border: entry.special_border }));
  return { page, entries, byName: new Map(entries.map((entry) => [entry.name, entry])) };
};

test("every build from 4.0 to 9.00 gives every playlist it serves Epic's tile, or none where Epic made none, and names no other", () => {
  assert.deepEqual([tileBuilds[0], tileBuilds.at(-1)], ["4039451", "6337466"]);
  assert.deepEqual(Object.keys(tileOf).sort(), Object.keys(epicPlaylistImages).sort(), "the table covers every Epic tile Core serves");
  for (const build of tileBuilds) {
    const { page, entries, byName } = pageTiles(build);
    assert.equal(byName.size, entries.length, `${build}: each playlist once`);
    const served = ["Playlist_DefaultSolo", "Playlist_DefaultDuo", "Playlist_DefaultSquad",
      ...ltms.filter((ltm) => ltm.playlistName && hasLtm(ltm.id, build)).map((ltm) => ltm.playlistName)];
    for (const name of served) {
      if (noEpicTile.includes(name)) {
        assert.equal(byName.get(name), undefined, `${build} ${name}: the default picture`);
        continue;
      }
      assert.equal(byName.get(name)?.image, expectedTile(name, build), `${build} ${name}`);
    }
    for (const { name, image, border } of entries) {
      assert.equal(image, expectedTile(name, build), `${build} ${name}: only Epic's tiles`);
      assert.ok(page._images_.includes(image), `${build} ${name} precached`);
      if (border !== undefined) assert.equal(border, name.startsWith("Playlist_Bling_") ? "HighStakes" : "None", `${build} ${name}'s border`);
    }
  }
});

test("7.00 to 7.40's Creative tile is Epic's CM_LobbyTileArt, no border, and 7.30's NFL Rumble its BR07 tile; earlier pages are as they were", () => {
  const creative = epicTile("playlistinformation/CM_LobbyTileArt-1024x512-fbcd48db36552ccb1ab4021b722ea29d515377cc.jpg");
  const nfl = epicTile("playlistinformation/BR07_ModeTile_NFL_TeamRumble-1024x512-6facfc07214965dc2211d703904607a30c68d08a.jpg");
  for (const build of ["4629139", "4667333", "4727874", "4834550", "5046157"]) {
    const entries = playlistInformationFor(build).playlist_info.playlists;
    assert.deepEqual(entries.find((entry) => entry.playlist_name === "Playlist_PlaygroundV2"),
      { image: creative, playlist_name: "Playlist_PlaygroundV2", special_border: "None", _type: "FortPlaylistInfo" }, build);
    assert.ok(contentPage(undefined, undefined, build)._images_.includes(creative), `${build} precaches it`);
    assert.equal(entries.find((entry) => entry.playlist_name === "Playlist_Omaha")?.image, Number(build) >= 4834550 ? nfl : undefined, `${build} NFL Rumble`);
    assert.equal(entries.some((entry) => entry.playlist_name === "Playlist_Music_Highest"), false, `${build}: Party at Pleasant Park keeps the default`);
  }
  for (const build of tileBuilds.filter((build) => Number(build) < 4629139)) {
    const { byName, page } = pageTiles(build);
    for (const name of ["Playlist_PlaygroundV2", "Playlist_Omaha"]) assert.equal(byName.get(name), undefined, `${build} has no ${name}`);
    assert.equal(page._images_.includes(creative) || page._images_.includes(nfl), false, build);
  }
});

test("every tile is a picture on Epic's CDN, which the -httpproxy tunnels to the real site: Core ships none", () => {
  for (const build of tileBuilds) {
    for (const { name, image } of pageTiles(build).entries) {
      assert.match(image, /^https:\/\/cdn2\.unrealengine\.com\/Fortnite\/fortnite-game\/playlist(tiles|information)\/[\w.-]+-[0-9a-f]{40}\.(png|jpg)$/, `${build} ${name}`);
      assert.equal(imageHostOf(image), "cdn2.unrealengine.com:443");
      assert.equal(isImageHost(imageHostOf(image)), true, `${build} ${name} tunnelled`);
    }
  }
});

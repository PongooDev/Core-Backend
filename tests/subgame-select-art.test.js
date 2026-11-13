import { test } from "node:test";
import assert from "node:assert/strict";
import { contentPage, subgameSelectFor, subgameSelectImages } from "../src/services/content/pages.js";
import { send, startBackend } from "./helpers.js";

// Core-Backend #331: from 5.30 the mode select screen takes its key art from subgameselectdata.<subgame>.message.image
// (services/content/pages.js). 6.00 cooks Season 5's picture, so without Season 6's from the page it showed Drift and
// Ragnarok.
const v600 = "4402180";
const v600early = "4395664";
// 6.01 (CL-4424678 and CL-4417689) cooks the same Season 5 picture, and its SubgameSelectScreen is 6.00's; 6.02's
// (CL-4461277 and CL-4442095) are 6.01's byte for byte, and 6.10's (CL-4480234, CL-4476098 and CL-4464155) 6.02's. 6.20's
// (CL-4497486) screen is a new revision with one texture more, T_STW_Oct_Sale (Update v6.20's "Save the World 50% Off Sale"),
// its own; it is served Season 6's picture the same, and so is 6.21 (CL-4526925), whose screen adds the sale tile's shine
// animation (SaleANIM, ShineAnim) and reads the same data.
const v601 = "4424678";
const v601early = "4417689";
const v602 = "4461277";
const builds610 = ["4480234", "4476098", "4464155", "4497486", "4526925"];
const v602early = "4442095";
const seasonSixArt = "https://cdn2.unrealengine.com/Fortnite/fortnite-game/subgameselect/"
  + "BR06_In-Game_Mode-Select-1920x1080-4c0975cfecd29167b1c2ddf5d916fafbdcaa0f6c.jpg";

// One build of each earlier season, 5.30 to 5.41 among them (they read the image too, and cook Season 5's own picture).
const earlierBuilds = { 1: ["3541083", "3700114", "3724489"], 2: ["3807424", "3889387"], 3: ["3901517", "4019403"],
  4: ["4039451", "4166199"], 5: ["4214610", "4288479", "4305896", "4352937", "4363240"] };

test("Season 6's picture is Epic's, on its CDN", () => {
  assert.equal(subgameSelectImages[6].battleRoyale, seasonSixArt);
  for (const images of Object.values(subgameSelectImages)) {
    for (const url of Object.values(images)) {
      assert.match(url, /^https:\/\/cdn2\.unrealengine\.com\/Fortnite\/fortnite-game\/subgameselect\/[\w.-]+-[0-9a-f]{40}\.(png|jpg)$/);
    }
  }
});

test("6.00's and 6.01's builds get Season 6's Battle Royale picture, precached; Save the World keeps its own", () => {
  for (const build of [v600, v600early, v601, v601early, v602, v602early, ...builds610]) {
    const page = contentPage(undefined, undefined, build);
    const select = page.subgameselectdata;
    assert.deepEqual(select.battleRoyale.message,
      { title: "100 Player PvP", body: "100 Player PvP Battle Royale.\n\nPvE progress does not affect Battle Royale.", image: seasonSixArt }, build);
    for (const key of ["saveTheWorld", "saveTheWorldUnowned"]) {
      assert.deepEqual(select[key].message, { title: "Co-op PvE", body: "Cooperative PvE storm-fighting adventure!" }, `${build} ${key}`);
    }
    assert.ok(page._images_.includes(seasonSixArt), `${build} precaches it`);
  }
});

test("earlier seasons get no picture and keep their own art", () => {
  for (const [season, builds] of Object.entries(earlierBuilds)) {
    for (const build of builds) {
      const page = contentPage(undefined, undefined, build);
      for (const [key, entry] of Object.entries(page.subgameselectdata)) {
        assert.equal(entry.message.image, undefined, `season ${season} ${build} ${key}`);
      }
      assert.ok(!page._images_.includes(seasonSixArt), `season ${season} ${build}`);
    }
  }
  // A request naming no build is Cert's.
  assert.equal(contentPage(undefined, undefined, undefined).subgameselectdata.battleRoyale.message.image, undefined);
});

test("the host's own text keeps Season 6's picture", () => {
  const select = subgameSelectFor(v600, { battleRoyale: { title: "TOURNAMENT MODE", body: "" } });
  assert.deepEqual(select.battleRoyale.message, {
    title: "TOURNAMENT MODE", body: "100 Player PvP Battle Royale.\n\nPvE progress does not affect Battle Royale.", image: seasonSixArt
  });
});

test("the page a 6.00 client fetches names Season 6's picture", async () => {
  const backend = await startBackend();
  try {
    const pageFor = (changelist) => send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/content/api/pages/fortnite-game",
      headers: { "User-Agent": `Fortnite/++Fortnite+Release-6.00-CL-${changelist} Windows/10.0.19045.1.768.64bit` } });
    for (const build of [v600, v600early, v601, v601early, v602, v602early, ...builds610]) {
      const page = (await pageFor(build)).body;
      assert.equal(page.subgameselectdata.battleRoyale.message.image, seasonSixArt, build);
      assert.ok(page._images_.includes(seasonSixArt), build);
    }
    assert.equal((await pageFor("4363240")).body.subgameselectdata.battleRoyale.message.image, undefined, "5.41");
  } finally {
    backend.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cosmeticImageId, cosmeticImageUrl, portalContentSecurityPolicy } from "../src/services/portal/images.js";
import { get, post, startBackend } from "./helpers.js";

// Core-Backend #249: item pictures on the portal's My account page, from fortnite-api.com's cosmetic icons, behind an admin switch.
const password = "SuperSecret123";
const host = "https://fortnite-api.com";

test("the image URL of a templateId is its lowercased cosmetic id on fortnite-api.com", () => {
  assert.equal(cosmeticImageId("AthenaCharacter:CID_029_Athena_Commando_F_Halloween"), "cid_029_athena_commando_f_halloween");
  assert.equal(cosmeticImageUrl("AthenaCharacter:CID_029_Athena_Commando_F_Halloween"),
    `${host}/images/cosmetics/br/cid_029_athena_commando_f_halloween/smallicon.png`);
  assert.equal(cosmeticImageUrl("AthenaPickaxe:Pickaxe_ID_013", { size: "icon" }), `${host}/images/cosmetics/br/pickaxe_id_013/icon.png`);
});

test("an id that is not a-z, 0-9 and _ is never put into a URL", () => {
  for (const templateId of ["AthenaCharacter:CID_../../x", "AthenaCharacter:cid 1", "AthenaCharacter:cid?x=1", "AthenaCharacter:cid#1", "AthenaCharacter:",
    "AthenaCharacter", "", null, undefined, "A:b:c", "AthenaCharacter:cidé", "AthenaCharacter:<img>"]) {
    assert.equal(cosmeticImageId(templateId), null, String(templateId));
    assert.equal(cosmeticImageUrl(templateId), null, String(templateId));
  }
  assert.equal(cosmeticImageUrl("AthenaCharacter:cid_1", { size: "../x" }), null);
});

test("with the switch off no URL is built", () => {
  assert.equal(cosmeticImageUrl("AthenaCharacter:cid_001", { enabled: false }), null);
});

test("the CSP names the image host only while the switch is on", () => {
  assert.ok(portalContentSecurityPolicy(true).includes(`img-src 'self' data: ${host}`));
  assert.equal(portalContentSecurityPolicy(false).includes("fortnite-api.com"), false);
});

test("the My account answer and page follow the admin switch", async () => {
  const backend = await startBackend();
  try {
    assert.equal((await post(backend.port, "/api/register", null, { username: "Pictured", password })).status, 201);
    const details = () => post(backend.port, "/api/account/details", null, { username: "Pictured", password });
    const urls = (body) => [...body.shop.featured, ...body.shop.daily, ...body.locker.cosmetics.flatMap((kind) => kind.items)].map((item) => item.image);

    assert.equal((await get(backend.port, "/api/portal/status")).body.showItemImages, true, "on by default");
    const page = await get(backend.port, "/my-account");
    assert.ok(page.headers["content-security-policy"].includes(`img-src 'self' data: ${host}`));
    const on = (await details()).body;
    assert.equal(on.images, true);
    const shown = urls(on).filter(Boolean);
    assert.ok(shown.length > 0);
    assert.ok(shown.every((url) => /^https:\/\/fortnite-api\.com\/images\/cosmetics\/br\/[a-z0-9_]+\/smallicon\.png$/.test(url)));
    assert.ok(on.shop.featured.concat(on.shop.daily).every((offer) => offer.title && "rarity" in offer));

    assert.equal((await post(backend.port, "/admin/api/settings", undefined, { showItemImages: false })).body.showItemImages, false);
    assert.equal((await get(backend.port, "/api/portal/status")).body.showItemImages, false);
    assert.equal((await get(backend.port, "/my-account")).headers["content-security-policy"].includes("fortnite-api.com"), false);
    const off = (await details()).body;
    assert.equal(off.images, false);
    assert.deepEqual(urls(off).filter(Boolean), []);
    assert.ok(off.shop.featured.length + off.shop.daily.length > 0, "the entries remain, without pictures");
  } finally {
    backend.close();
  }
});

test("the page sets the picture through DOM properties, lazily, with the name as alt and a fallback tile", () => {
  const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/services/portal/portal.html"), "utf8");
  const tile = html.slice(html.indexOf("function itemTile"), html.indexOf("function section(title)"));
  for (const part of ['img.loading = "lazy"', "img.alt = item.name", "img.src = item.image", 'addEventListener("error"']) assert.ok(tile.includes(part), part);
  assert.equal(/innerHTML|insertAdjacentHTML/.test(tile), false);
});

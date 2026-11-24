import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { get, startBackend } from "./helpers.js";

// Core-Backend #430: the Shop section listed no featured or daily items for Season 8 although the game's shop had them.
test("admin panel: Season 8's shop lists the offers the game gets", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-admin-shop8-test-"));
  const backend = await startBackend({ dataDir });
  try {
    const shop = await get(backend.port, "/admin/api/shop?season=8");
    assert.equal(shop.status, 200);
    assert.equal(shop.body.season, 8);
    assert.ok(shop.body.currentShop.featured.length + shop.body.currentShop.daily.length > 0);
    assert.ok(shop.body.availableCosmetics.length > 0);
    for (const offer of [...shop.body.currentShop.featured, ...shop.body.currentShop.daily]) assert.notEqual(offer.name, offer.templateId);
  } finally {
    backend.close();
  }
});

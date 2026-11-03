import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { get, startBackend } from "./helpers.js";

test("admin panel: Season 3's battle pass, item shop and events clock", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-admin-season3-test-"));
  const backend = await startBackend({ dataDir });

  try {
    const pass = await get(backend.port, "/admin/api/battlepass/overview?season=3");
    assert.equal(pass.status, 200);
    assert.equal(pass.body.season, 3);
    assert.equal(pass.body.seasonName, "Season 3 (3.0 – 3.6)");
    assert.equal(pass.body.tiers.length, 100);
    assert.equal(pass.body.config.battlePassPrice, 950);
    assert.equal(pass.body.config.bundlePrice, 2800);
    assert.deepEqual(pass.body.availableSeasons.map((s) => s.id), [1, 2, 3]);

    const shop = await get(backend.port, "/admin/api/shop?season=3");
    assert.equal(shop.status, 200);
    assert.equal(shop.body.season, 3);

    const events = await get(backend.port, "/admin/api/events/overview?season=3");
    assert.equal(events.status, 200);
    assert.equal(events.body.season, 3);
    assert.ok(events.body.calendar.seasons[3]);
    assert.equal(events.body.calendar.seasons[3].start.length, 10);
    assert.ok(events.body.sampleBuilds.some((b) => b.cl === 3901517));
  } finally {
    backend.close();
  }
});

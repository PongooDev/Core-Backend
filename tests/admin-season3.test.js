import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { get, post, startBackend } from "./helpers.js";

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

    // Core-Backend #207: every week of the weekly challenges at once.
    assert.equal(pass.body.challengesAllUnlocked, false);
    assert.equal((await post(backend.port, "/admin/api/battlepass/challenges", undefined, { allUnlocked: "yes" })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/battlepass/challenges", undefined, { allUnlocked: true })).body.challengesAllUnlocked, true);
    assert.equal((await get(backend.port, "/admin/api/battlepass/overview?season=3")).body.challengesAllUnlocked, true);
    assert.equal((await get(backend.port, "/admin/api/battlepass/overview?season=2")).body.challengesAllUnlocked, undefined);
    assert.equal((await get(backend.port, "/admin/api/battlepass/overview?season=2")).body.challenges, undefined);

    // Core-Backend #219: unlock modes and the weeks available. "Unlock all" is manual with every week.
    let challenges = (await get(backend.port, "/admin/api/battlepass/overview?season=3")).body.challenges;
    assert.equal(challenges.mode, "manual");
    // Season 3's newest data, 3.1's, has ten weeks.
    assert.equal(challenges.manualWeeks, 10);
    assert.equal(challenges.weeks.length, 10);
    assert.equal((await post(backend.port, "/admin/api/battlepass/challenges", undefined, { season: 2, mode: "original" })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/battlepass/challenges", undefined, { mode: "weekly" })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/battlepass/challenges", undefined, { mode: "interval" })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/battlepass/challenges", undefined, { mode: "manual", weeksAvailable: 11 })).status, 400);
    const saved = await post(backend.port, "/admin/api/battlepass/challenges", undefined,
      { season: 3, mode: "interval", startDate: "2026-01-01", intervalDays: 3, weeksAvailable: 5 });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.challengesAllUnlocked, false);
    challenges = (await get(backend.port, "/admin/api/battlepass/overview?season=3")).body.challenges;
    assert.equal(challenges.mode, "interval");
    assert.equal(challenges.startDate, "2026-01-01");
    assert.equal(challenges.intervalDays, 3);
    assert.equal(challenges.weeksAvailable, 5);
    assert.equal(challenges.weeks[1].unlocksAt, "2026-01-04T00:00:00.000Z");
    assert.equal(challenges.weeks[5].unlocksAt, null);
    assert.equal((await post(backend.port, "/admin/api/battlepass/challenges", undefined, { allUnlocked: false })).body.challenges.mode, "original");

    const shop = await get(backend.port, "/admin/api/shop?season=3");
    assert.equal(shop.status, 200);
    assert.equal(shop.body.season, 3);

    const events = await get(backend.port, "/admin/api/events/overview?season=3");
    assert.equal(events.status, 200);
    assert.equal(events.body.season, 3);
    assert.ok(events.body.calendar.seasons[3]);
    assert.equal(events.body.calendar.seasons[3].start.length, 10);
    assert.ok(events.body.sampleBuilds.some((b) => b.cl === 3901517));
    assert.ok(events.body.sampleBuilds.find((b) => b.cl === 3915963).flags.includes("EventFlag.Spring2018Phase2"));
  } finally {
    backend.close();
  }
});

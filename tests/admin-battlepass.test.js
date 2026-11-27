import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { get, post, startBackend } from "./helpers.js";
import { inBuild } from "../src/builds/context.js";
import { seasonShopOffers } from "../src/store/seasonshop.js";

const admin = (backend, urlPath, body) => (body === undefined
  ? get(backend.port, `/admin/api${urlPath}`)
  : post(backend.port, `/admin/api${urlPath}`, undefined, body));

test("admin battle pass tab: overview, custom milestones, level bypass, and reset defaults", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-admin-battlepass-test-"));
  const backend = await startBackend({ dataDir });

  try {
    // 1. GET /admin serves HTML with the Battle Pass navigation item
    const panelHtml = await get(backend.port, "/admin");
    assert.equal(panelHtml.status, 200);
    assert.ok(panelHtml.body.includes('href="#/battlepass"'));
    assert.ok(panelHtml.body.includes('data-view="battlepass"'));
    assert.ok(panelHtml.body.includes("Battle Pass"));
    assert.ok(panelHtml.body.includes('"battlepass"'));
    assert.ok(panelHtml.body.includes("Season 1 (1.8 – 1.10)"));

    // 2. GET /admin/api/battlepass/overview returns Season 1 2017 defaults
    const overviewRes = await admin(backend, "/battlepass/overview");
    assert.equal(overviewRes.status, 200);
    assert.equal(overviewRes.body.season, 1);
    assert.equal(overviewRes.body.seasonName, "Season 1 (1.8 – 1.10)");
    assert.ok(overviewRes.body.seasonEnd);

    const cfg = overviewRes.body.config;
    assert.equal(cfg.season, 1);
    assert.equal(cfg.levelRequirementsEnabled, true);
    assert.equal(cfg.xpMultiplier, 1.0);
    assert.equal(cfg.maxSeasonLevel, 100);

    const milestones = overviewRes.body.milestones;
    assert.equal(milestones.length, 4);

    const glider = milestones.find((m) => m.templateId.includes("glider_id_001"));
    assert.ok(glider);
    assert.equal(glider.name, "Aerial Assault One");
    assert.equal(glider.seasonLevel, 5);
    assert.equal(glider.price, 500);
    assert.equal(glider.unlockedLevel, 5);

    const trooper = milestones.find((m) => m.templateId.includes("cid_017_athena_commando_m"));
    assert.ok(trooper);
    assert.equal(trooper.name, "Aerial Assault Trooper");
    assert.equal(trooper.seasonLevel, 15);
    assert.equal(trooper.price, 1200);

    const renegade = milestones.find((m) => m.templateId.includes("cid_028_athena_commando_f"));
    assert.ok(renegade);
    assert.equal(renegade.name, "Renegade Raider");
    assert.equal(renegade.seasonLevel, 20);
    assert.equal(renegade.price, 1200);

    const axe = milestones.find((m) => m.templateId.includes("pickaxe_lockjaw"));
    assert.ok(axe);
    assert.equal(axe.name, "Raider's Revenge");
    assert.equal(axe.seasonLevel, 35);
    assert.equal(axe.price, 1500);

    // Verify inBuild offers match 2017 defaults
    inBuild("3741772", () => {
      const offers = seasonShopOffers();
      assert.equal(offers.length, 4);
      const oGlider = offers.find((o) => o.templateId.includes("glider_id_001"));
      assert.equal(oGlider.seasonLevel, 5);
      assert.equal(oGlider.price, 500);
    });

    // 3. POST /admin/api/battlepass/config updates custom thresholds, prices, and bypass
    const updateRes = await admin(backend, "/battlepass/config", {
      levelRequirementsEnabled: false,
      xpMultiplier: 2.0,
      maxSeasonLevel: 150,
      milestones: [
        { templateId: "AthenaGlider:glider_id_001", seasonLevel: 1, price: 200 },
        { templateId: "AthenaCharacter:cid_017_athena_commando_m", seasonLevel: 10, price: 900 },
        { templateId: "AthenaCharacter:cid_028_athena_commando_f", seasonLevel: 15, price: 900 },
        { templateId: "AthenaPickaxe:pickaxe_lockjaw", seasonLevel: 25, price: 1100 }
      ]
    });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.success, true);
    assert.equal(updateRes.body.config.levelRequirementsEnabled, false);
    assert.equal(updateRes.body.config.xpMultiplier, 2.0);
    assert.equal(updateRes.body.config.maxSeasonLevel, 150);

    // When levelRequirementsEnabled is false, catalog offers unlock at Level 1 for all items
    inBuild("3741772", () => {
      const offers = seasonShopOffers();
      assert.equal(offers.length, 4);
      assert.ok(offers.every((o) => o.seasonLevel === 1));
      const oGlider = offers.find((o) => o.templateId.includes("glider_id_001"));
      assert.equal(oGlider.price, 200);
      const oAxe = offers.find((o) => o.templateId.includes("pickaxe_lockjaw"));
      assert.equal(oAxe.price, 1100);
    });

    // 4. POST /admin/api/battlepass/actions/reset-defaults restores authentic 2017 settings
    const resetRes = await admin(backend, "/battlepass/actions/reset-defaults", {});
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.body.success, true);
    assert.equal(resetRes.body.config.levelRequirementsEnabled, true);
    assert.equal(resetRes.body.config.xpMultiplier, 1.0);
    assert.equal(resetRes.body.config.maxSeasonLevel, 100);

    inBuild("3741772", () => {
      const offers = seasonShopOffers();
      const oRenegade = offers.find((o) => o.templateId.includes("cid_028_athena_commando_f"));
      assert.equal(oRenegade.seasonLevel, 20);
      assert.equal(oRenegade.price, 1200);
      const oAxe = offers.find((o) => o.templateId.includes("pickaxe_lockjaw"));
      assert.equal(oAxe.seasonLevel, 35);
      assert.equal(oAxe.price, 1500);
    });
  } finally {
    backend.close();
  }
});

// Core-Backend #156: Season 2 lasted from 1.11 to 2.5. Core plays 1.11 and 2.1; a later 2.x build takes 2.1's data, and
// with it Season 2, without being a known build.
test("the admin panel names Season 2 by its whole range, 1.11 – 2.5, and a later 2.x build plays in Season 2", async () => {
  const { battleRoyaleSeasons, seasonName, versionOf } = await import("../src/builds/detect.js");
  const { athenaSeason } = await import("../src/gamedata/athena.js");
  assert.deepEqual(battleRoyaleSeasons.map(({ season }) => seasonName(season)), ["Season 1 (1.8 – 1.10)", "Season 2 (1.11 – 2.5)", "Season 3 (3.0 – 3.6)", "Season 4 (4.0 – 4.5)", "Season 5 (5.0 – 5.41)", "Season 6 (6.00 – 6.31)", "Season 7 (7.00 – 7.40)", "Season 8 (8.00 – 8.51)", "Season 9 (9.00 – 9.20)"]);
  const later2x = "3850000";
  assert.equal(versionOf(later2x), null);
  assert.equal(inBuild(later2x, () => athenaSeason()?.seasonNumber), 2);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-admin-battlepass-range-"));
  const backend = await startBackend({ dataDir });
  try {
    assert.ok((await get(backend.port, "/admin")).body.includes("Season 2 (1.11 – 2.5)"));
    const overview = await admin(backend, "/battlepass/overview?season=2");
    assert.equal(overview.body.seasonName, "Season 2 (1.11 – 2.5)");
    assert.deepEqual(overview.body.availableSeasons.map(({ range }) => range), ["1.8 – 1.10", "1.11 – 2.5", "3.0 – 3.6", "4.0 – 4.5", "5.0 – 5.41", "6.00 – 6.31", "7.00 – 7.40", "8.00 – 8.51", "9.00 – 9.20"]);
  } finally {
    await backend.close();
  }
});


// Core-Backend #432: showBattlePass sent only Seasons 2 to 7 to the season pass view, so Season 8 got Season 1's. The
// panel's SEASONS table has to match the backend's seasons, and every season from 2 on has a pass.
test("the admin panel's season table matches the backend's seasons and every season from 2 on opens its season pass", async () => {
  const { battleRoyaleSeasons, seasonName } = await import("../src/builds/detect.js");
  const panel = fs.readFileSync(new URL("../src/admin/panel.html", import.meta.url), "utf8");
  const table = panel.match(/const SEASONS = \[([\s\S]*?)\];/)[1];
  assert.deepEqual([...table.matchAll(/id: "(\d+)", label: "([^"]+)"/g)].map((m) => [Number(m[1]), m[2]]),
    battleRoyaleSeasons.map(({ season }) => [season, seasonName(season)]));
  const route = panel.match(/async function showBattlePass\(\) \{[\s\S]*?showSeasonPass\(season\);/)[0];
  assert.ok(route.includes("Number(season) >= 2"));
  assert.ok(!/\["2", "3"/.test(route));

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-admin-battlepass-s8-"));
  const backend = await startBackend({ dataDir });
  try {
    for (const { season } of battleRoyaleSeasons.filter((entry) => entry.season >= 2)) {
      const overview = await admin(backend, `/battlepass/overview?season=${season}`);
      assert.equal(overview.body.season, season);
      assert.ok(overview.body.tiers.length > 0, `Season ${season} has its tiers`);
    }
  } finally {
    await backend.close();
  }
});

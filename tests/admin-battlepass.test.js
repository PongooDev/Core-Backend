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
    assert.ok(panelHtml.body.includes("Season 1 (1.8 – 1.11)"));

    // 2. GET /admin/api/battlepass/overview returns Season 1 2017 defaults
    const overviewRes = await admin(backend, "/battlepass/overview");
    assert.equal(overviewRes.status, 200);
    assert.equal(overviewRes.body.season, 1);
    assert.equal(overviewRes.body.seasonName, "Season 1 (1.8 – 1.11)");
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


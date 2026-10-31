import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

const admin = (backend, urlPath, body) => (body === undefined
  ? get(backend.port, `/admin/api${urlPath}`)
  : post(backend.port, `/admin/api${urlPath}`, undefined, body));

test("admin events tab: overview API, live countdowns, compatibility matrix, and toggle", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-admin-events-test-"));
  const backend = await startBackend({ dataDir });

  try {
    // 1. GET /admin serves HTML with the Events navigation item
    const panelHtml = await get(backend.port, "/admin");
    assert.equal(panelHtml.status, 200);
    assert.ok(panelHtml.body.includes('href="#/events"'));
    assert.ok(panelHtml.body.includes('data-view="events"'));
    assert.ok(panelHtml.body.includes('Events & Seasons'));
    assert.ok(panelHtml.body.includes('Events Tab →'));
    assert.ok(panelHtml.body.includes("Season 1 (1.8 – 1.11)"));

    // 2. GET /admin/api/events/overview returns events, live calendar, and matrix
    const res = await admin(backend, "/events/overview");
    assert.equal(res.status, 200);
    assert.equal(res.body.season, 1);
    assert.equal(res.body.seasonName, "Season 1 (1.8 – 1.11)");
    assert.equal(typeof res.body.seasonalEvents, "boolean");
    assert.ok(Array.isArray(res.body.activeFlags));
    assert.ok(Array.isArray(res.body.sampleBuilds));
    assert.ok(res.body.sampleBuilds.some((b) => b.event === "Fortnitemares"));
    assert.ok(res.body.sampleBuilds.some((b) => b.event === "Mutant Storms"));
    assert.ok(res.body.eventsConfig);
    assert.equal(res.body.eventsConfig.mode, "auto");

    // Calendar timelines
    assert.ok(res.body.calendar.dailyStoreEnd);
    assert.ok(res.body.calendar.weeklyStoreEnd);
    assert.ok(res.body.calendar.seasonEnd);
    assert.equal(res.body.calendar.cacheIntervalMins, 60);

    // Event definitions
    const fortnitemares = res.body.events.find((e) => e.id === "fortnitemares");
    assert.ok(fortnitemares);
    assert.equal(fortnitemares.theater, "Hexsylvania");
    assert.equal(fortnitemares.questsCount, 56);
    assert.equal(fortnitemares.theaterZones.length, 4);

    const mutantStorms = res.body.events.find((e) => e.id === "mutantstorms");
    assert.ok(mutantStorms);
    assert.equal(mutantStorms.questsCount, 15);
    assert.ok(mutantStorms.leftoverConversion.includes("500"));


    // 3. Toggle seasonalEvents off via settings API
    const disableRes = await admin(backend, "/settings", { seasonalEvents: false });
    assert.equal(disableRes.status, 200);
    assert.equal(disableRes.body.seasonalEvents, false);

    const overviewDisabled = await admin(backend, "/events/overview");
    assert.equal(overviewDisabled.status, 200);
    assert.equal(overviewDisabled.body.seasonalEvents, false);
    assert.deepEqual(overviewDisabled.body.activeFlags, []);

    // 4. Re-enable seasonalEvents
    const enableRes = await admin(backend, "/settings", { seasonalEvents: true });
    assert.equal(enableRes.status, 200);
    assert.equal(enableRes.body.seasonalEvents, true);

    const overviewEnabled = await admin(backend, "/events/overview");
    assert.equal(overviewEnabled.status, 200);
    assert.equal(overviewEnabled.body.seasonalEvents, true);
  } finally {
    backend.close();
  }
});

test("admin events full customization: mode overrides, STW modifiers, calendar, and quick actions", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-admin-events-custom-test-"));
  const backend = await startBackend({ dataDir });

  try {
    // 1. Force Fortnitemares mode
    const forceHalloween = await admin(backend, "/events/config", {
      mode: "force_fortnitemares",
      hexsylvaniaGates: "open",
      candyMultiplier: 2.5,
      stormAlertQuota: 25,
      stormTicketMultiplier: 2.0,
      candyPerLlama: 250,
      autoConvertCandy: false,
      rotationHour: 18,
      weeklyDurationDays: 14,
      customSeasonEnd: "2029-01-01T00:00:00.000Z",
      calendarCacheMinutes: 45
    });
    assert.equal(forceHalloween.status, 200);
    assert.equal(forceHalloween.body.events.mode, "force_fortnitemares");
    assert.equal(forceHalloween.body.events.hexsylvaniaGates, "open");
    assert.equal(forceHalloween.body.events.candyMultiplier, 2.5);
    assert.equal(forceHalloween.body.events.stormAlertQuota, 25);
    assert.equal(forceHalloween.body.events.stormTicketMultiplier, 2.0);
    assert.equal(forceHalloween.body.events.candyPerLlama, 250);
    assert.equal(forceHalloween.body.events.autoConvertCandy, false);
    assert.equal(forceHalloween.body.events.rotationHour, 18);
    assert.equal(forceHalloween.body.events.weeklyDurationDays, 14);
    assert.equal(forceHalloween.body.events.customSeasonEnd, "2029-01-01T00:00:00.000Z");
    assert.equal(forceHalloween.body.events.calendarCacheMinutes, 45);

    // Verify GET /admin/api/events/overview reflects all forced settings
    const overview = await admin(backend, "/events/overview");
    assert.equal(overview.status, 200);
    assert.equal(overview.body.eventsConfig.mode, "force_fortnitemares");
    // All sample builds broadcast EventFlag.Fortnitemares when forced
    assert.ok(overview.body.sampleBuilds.every((b) => b.flags.includes("EventFlag.Fortnitemares")));
    assert.equal(overview.body.calendar.cacheIntervalMins, 45);
    assert.equal(overview.body.calendar.seasonEnd, "2029-01-01T00:00:00.000Z");

    // 2. Custom Flags mode
    const customConfig = await admin(backend, "/events/config", {
      mode: "custom",
      customFlags: ["EventFlag.Testing_Alpha", "EventFlag.Testing_Beta"]
    });
    assert.equal(customConfig.status, 200);
    assert.equal(customConfig.body.events.mode, "custom");
    assert.deepEqual(customConfig.body.events.customFlags, ["EventFlag.Testing_Alpha", "EventFlag.Testing_Beta"]);

    const overviewCustom = await admin(backend, "/events/overview");
    assert.deepEqual(overviewCustom.body.activeFlags, ["EventFlag.Testing_Alpha", "EventFlag.Testing_Beta"]);

    // 3. Quick Actions: Convert Candy Now & Reset Quotas Now
    // Create an account with Candy to test conversion
    const player = await userLogin(backend.port, "CandyHoarder");
    const accountId = player.accountId;

    // Grant 600 Candy to profile0
    await admin(backend, `/accounts/${accountId}/grant`, {
      templateId: "AccountResource:eventcurrency_candy",
      quantity: 600
    });

    // Run POST /admin/api/events/actions/convert-candy
    // With candyPerLlama = 250, 600 candy should yield 2 Fortnitemares Llamas (500 spent, 100 remainder)
    const convertRes = await admin(backend, "/events/actions/convert-candy", {});
    assert.equal(convertRes.status, 200);
    assert.equal(convertRes.body.success, true);
    assert.ok(convertRes.body.convertedProfiles >= 1);
    assert.ok(convertRes.body.totalLlamasGranted >= 2);
    assert.equal(convertRes.body.candyPerLlama, 250);

    // Verify account's inventory received the llamas and spent the candy
    const details = await admin(backend, `/accounts/${accountId}`);
    const items = details.body.items;
    const candyItem = items.find((i) => i.templateId.toLowerCase() === "accountresource:eventcurrency_candy");
    assert.ok(candyItem);
    assert.equal(candyItem.quantity, 100);
    const llamas = items.filter((i) => i.templateId.toLowerCase() === "cardpack:cardpack_event_2017_halloween");
    assert.ok(llamas.length >= 1);

    // Run POST /admin/api/events/actions/reset-quotas
    const resetRes = await admin(backend, "/events/actions/reset-quotas", {});
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.body.success, true);
    assert.ok(resetRes.body.resetProfiles >= 1);
  } finally {
    backend.close();
  }
});

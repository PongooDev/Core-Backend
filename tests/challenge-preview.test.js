import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { get, post, startBackend } from "./helpers.js";

const previewOf = (port, query) => get(port, `/admin/api/battlepass/challenges/preview?${new URLSearchParams({ season: "3", ...query })}`);
const weeksOf = (plan) => plan.weeks.map(({ week, unlocked, unlocksAt }) => ({ week, unlocked, unlocksAt }));

// Core-Backend #380: the admin panel's table of every week, its state and unlock time, from the backend's own weekPlan.
test("weekly challenges preview: the table is the saved plan's own calculation, and follows the draft", async () => {
  const backend = await startBackend({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "core-challenge-preview-test-")) });
  try {
    const start = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const draft = { mode: "interval", startDate: start, startTime: "15:30", intervalDays: 3, weeksAvailable: 8 };

    // A draft previews without saving anything.
    const before = (await get(backend.port, "/admin/api/battlepass/overview?season=3")).body.challenges;
    const preview = await previewOf(backend.port, draft);
    assert.equal(preview.status, 200);
    const plan = preview.body.challenges;
    assert.equal(plan.mode, "interval");
    assert.equal(plan.startTime, "15:30");
    assert.equal(plan.weeks.length, before.weeks.length);
    assert.equal(plan.weeks[0].unlocksAt, `${start}T15:30:00.000Z`);
    assert.equal(plan.weeks[1].unlocksAt, new Date(Date.parse(`${start}T15:30:00Z`) + 3 * 86400000).toISOString());
    assert.equal(plan.weeks[0].unlocked, true);
    assert.equal(plan.weeks[9].unlocksAt, null, "past the weeks available: never");
    assert.equal((await get(backend.port, "/admin/api/battlepass/overview?season=3")).body.challenges.mode, before.mode);

    // Saved, the overview's weeks are the preview's weeks: the same calculation.
    const saved = await post(backend.port, "/admin/api/battlepass/challenges", undefined, draft);
    assert.equal(saved.status, 200);
    const overview = (await get(backend.port, "/admin/api/battlepass/overview?season=3")).body.challenges;
    assert.equal(overview.startTime, "15:30");
    assert.deepEqual(weeksOf(overview), weeksOf((await previewOf(backend.port, draft)).body.challenges));
    assert.deepEqual(weeksOf(saved.body.challenges), weeksOf(overview));

    // The panel's other modes and fields move the table too.
    const manual = (await previewOf(backend.port, { mode: "manual", manualWeeks: 2, weeksAvailable: 6 })).body.challenges;
    assert.deepEqual(manual.weeks.map((w) => w.unlocked), manual.weeks.map((_, i) => i < 2));
    assert.ok(manual.weeks.every((w) => w.unlocksAt === null));
    const original = (await previewOf(backend.port, { mode: "original" })).body.challenges;
    assert.equal(original.weeks.length, overview.weeks.length);
    assert.ok(original.weeks.every((w) => typeof w.unlocksAt === "string" || w.week > original.weeksAvailable));
    // The time of day defaults to midnight UTC.
    assert.equal((await previewOf(backend.port, { mode: "interval", startDate: "2030-01-01" })).body.challenges.weeks[0].unlocksAt, "2030-01-01T00:00:00.000Z");

    // Refused as the save refuses.
    assert.equal((await previewOf(backend.port, { mode: "weekly" })).status, 400);
    assert.equal((await previewOf(backend.port, { mode: "interval" })).status, 400);
    assert.equal((await previewOf(backend.port, { ...draft, startTime: "25:00" })).status, 400);
    assert.equal((await previewOf(backend.port, { ...draft, intervalDays: "0" })).status, 400);
    assert.equal((await previewOf(backend.port, { ...draft, season: "2" })).status, 400);
    assert.equal((await post(backend.port, "/admin/api/battlepass/challenges", undefined, { ...draft, startTime: "7pm" })).status, 400);
  } finally {
    backend.close();
  }
});

test("admin panel: the weekly challenges table follows the form from the preview route", async () => {
  const backend = await startBackend({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "core-challenge-preview-panel-test-")) });
  try {
    const page = (await get(backend.port, "/admin")).body;
    assert.match(page, /\/admin\/api\/battlepass\/challenges\/preview\?/);
    assert.match(page, /Start time \(UTC\)/);
    assert.match(page, /Unlocks \(your time\)/);
    assert.match(page, /Next week unlocks in/);
  } finally {
    backend.close();
  }
});

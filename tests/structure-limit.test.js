import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dedicatedServerToken, get, post, startBackend } from "./helpers.js";

// Core-Backend #115: the Storm Shields' structure limit, for all of them and for each one, which CoreV2's gameserver
// asks for when a Storm Shield zone loads (services/fortnite/structurelimit.js).
const settings = (backend, body) => (body === undefined
  ? get(backend.port, "/admin/api/settings")
  : post(backend.port, "/admin/api/settings", undefined, body));
const limitOf = (backend, token, templateId) =>
  get(backend.port, `/fortnite/api/game/v2/world/structurelimit?templateId=${encodeURIComponent(templateId)}`, token);
const maxOf = async (backend, token, templateId) => (await limitOf(backend, token, templateId)).body.maxStructures;

test("by default every Storm Shield keeps the game's structure limit, and the gameserver needs a token to ask", async () => {
  const backend = await startBackend();
  try {
    const current = (await settings(backend)).body;
    assert.deepEqual([current.structureLimit, current.structureLimits], [null, {}]);
    const token = await dedicatedServerToken(backend.port);
    assert.deepEqual((await limitOf(backend, token, "Outpost:outpostcore_pve_01")).body,
      { templateId: "Outpost:outpostcore_pve_01", stormShield: "stonewood", maxStructures: null });
    assert.equal((await limitOf(backend, undefined, "Outpost:outpostcore_pve_01")).status, 401);
  } finally {
    backend.close();
  }
});

test("the panel sets a limit for all Storm Shields and each one's own, which the gameserver gets, and they last over a restart", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-structurelimit-"));
  let backend = await startBackend({ dataDir });
  try {
    let token = await dedicatedServerToken(backend.port);
    let saved = (await settings(backend, { structureLimit: 5000, structureLimits: { cannyValley: 8000, twinePeaks: "12000" } })).body;
    assert.deepEqual([saved.structureLimit, saved.structureLimits], [5000, { cannyValley: 8000, twinePeaks: 12000 }]);

    // A Storm Shield's own wins; the others, and an outpost that isn't one of the four, get the one for all.
    assert.equal(await maxOf(backend, token, "Outpost:outpostcore_pve_03"), 8000);
    assert.equal(await maxOf(backend, token, "outpost:OutpostCore_PvE_04"), 12000, "the template id's case doesn't matter");
    assert.equal(await maxOf(backend, token, "Outpost:outpostcore_pve_02"), 5000);
    assert.deepEqual((await limitOf(backend, token, "Outpost:outpostcore_pve_00")).body,
      { templateId: "Outpost:outpostcore_pve_00", stormShield: null, maxStructures: 5000 });

    // Limits that aren't whole numbers from 1 to 100000, and names that aren't Storm Shields, are ignored.
    saved = (await settings(backend, { structureLimit: 0, structureLimits: { stonewood: 100001, plankerton: "lots", outpost0: 50 } })).body;
    assert.deepEqual([saved.structureLimit, saved.structureLimits], [5000, { cannyValley: 8000, twinePeaks: 12000 }]);
    saved = (await settings(backend, { structureLimits: { stonewood: 100000 } })).body;
    assert.deepEqual(saved.structureLimits, { cannyValley: 8000, twinePeaks: 12000, stonewood: 100000 });

    // Blank clears one: Twine Peaks gets the one for all again.
    saved = (await settings(backend, { structureLimits: { twinePeaks: "" } })).body;
    assert.deepEqual(saved.structureLimits, { cannyValley: 8000, stonewood: 100000 });
    assert.equal(await maxOf(backend, token, "Outpost:outpostcore_pve_04"), 5000);

    backend.close();
    backend = await startBackend({ dataDir });
    token = await dedicatedServerToken(backend.port);
    saved = (await settings(backend)).body;
    assert.deepEqual([saved.structureLimit, saved.structureLimits], [5000, { cannyValley: 8000, stonewood: 100000 }]);
    assert.equal(await maxOf(backend, token, "Outpost:outpostcore_pve_01"), 100000);

    // "Use the game's": every limit cleared, so the gameserver leaves the game's own.
    saved = (await settings(backend, { structureLimit: null, structureLimits: { stonewood: null, plankerton: null, cannyValley: null, twinePeaks: null } })).body;
    assert.deepEqual([saved.structureLimit, saved.structureLimits], [null, {}]);
    assert.equal(await maxOf(backend, token, "Outpost:outpostcore_pve_03"), null);
  } finally {
    backend.close();
  }
});

test("config.json's structure limits are set at every start", async () => {
  const backend = await startBackend({ structureLimit: 4000, structureLimits: { plankerton: 6000 } });
  try {
    const saved = (await settings(backend)).body;
    assert.deepEqual([saved.structureLimit, saved.structureLimits], [4000, { plankerton: 6000 }]);
    const token = await dedicatedServerToken(backend.port);
    assert.equal(await maxOf(backend, token, "Outpost:outpostcore_pve_02"), 6000);
    assert.equal(await maxOf(backend, token, "Outpost:outpostcore_pve_01"), 4000);
  } finally {
    backend.close();
  }
});

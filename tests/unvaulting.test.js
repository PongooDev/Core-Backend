import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureEvents } from "../src/events/events.js";
import { createUnvaultingStore, epicUnvaultedItem, unvaultedItemNow, unvaultedPlaneSpawnPercent, unvaultingBuild, unvaultingLapNow, unvaultingRows } from "../src/events/unvaulting.js";
import { dedicatedServerToken, send, startBackend, userLogin } from "./helpers.js";

// 8.51's Unvaulting's winner (PongooDev/CoreV2#647): a gameserver reports its match's vote, and every later 8.51 match
// is given it after the event (Epic's Drum Gun until one has).
const hour = 3600000;
const minute = 60000;
const at = Date.parse("2026-11-25T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const schedule = (eventAt) => [
  { step: "countdown", startAt: iso(eventAt - 24 * hour), endAt: iso(eventAt) },
  { step: "level", startAt: iso(eventAt - 30 * minute), endAt: iso(eventAt + 15 * minute) },
  { step: "event", startAt: iso(eventAt), endAt: iso(eventAt + 10 * minute) },
  { step: "after", startAt: iso(eventAt + 10 * minute), endAt: null }
];
const configAt = (eventAt, extra = {}) => ({ mode: "auto", datedFlags: { unvaulting: { mode: "custom", schedule: schedule(eventAt) } }, ...extra });
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const tempStore = () => createUnvaultingStore(fs.mkdtempSync(path.join(os.tmpdir(), "core-unvaulting-")));

test("no item before or during the event, Epic's Drum Gun after it until a server reports", () => withConfig(configAt(at), () => {
  const store = tempStore();
  assert.deepEqual(unvaultedItemNow(store, new Date(at - hour), unvaultingBuild), { item: null, source: null, eventAt: null, after: false }, "before the event");
  assert.equal(unvaultedItemNow(store, new Date(at + minute), unvaultingBuild).item, null, "each match plays its own vote during the event");
  assert.deepEqual(unvaultedItemNow(store, new Date(at + hour), unvaultingBuild), { item: epicUnvaultedItem, source: "epic", eventAt: iso(at), after: true });
  assert.equal(unvaultedItemNow(store, new Date(at + hour), "6058028").item, null, "8.50 has no Unvaulting");
}));

test("the first report of the event's lap is kept, survives a restart and goes with a new event time", () => withConfig(configAt(at), () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-unvaulting-"));
  const store = createUnvaultingStore(dir);
  const lap = unvaultingLapNow(new Date(at + minute), unvaultingBuild);
  assert.deepEqual(lap, { eventAt: iso(at), after: false });
  assert.equal(store.report("Pillar", lap.eventAt), false, "not a pillar's name");
  assert.equal(store.report("GW.Sword", lap.eventAt, new Date(at + 3 * minute)), true);
  assert.equal(store.report("GW.Tac", lap.eventAt), false, "a later match's vote");
  assert.deepEqual(unvaultedItemNow(createUnvaultingStore(dir), new Date(at + hour), unvaultingBuild), { item: "GW.Sword", source: "reported", eventAt: iso(at), after: true });
  // The admin runs the event again later: the old lap's report is the old lap's.
  withConfig(configAt(at + 2 * hour), () => {
    assert.equal(unvaultedItemNow(store, new Date(at + 3 * hour), unvaultingBuild).source, "epic");
  });
  // The admin's own choice comes first.
  withConfig(configAt(at, { unvaultedItem: "GW.Bouncer" }), () => {
    assert.deepEqual(unvaultedItemNow(store, new Date(at + hour), unvaultingBuild), { item: "GW.Bouncer", source: "admin", eventAt: iso(at), after: true });
  });
}));

test("unvaulted planes are the biplane spawners' rows, hotfixed up; any other item is loot", () => withConfig(configAt(at), () => {
  const store = tempStore();
  assert.deepEqual(unvaultingRows(store, unvaultingBuild, new Date(at + hour)), [], "the Drum Gun is loot");
  store.report("Plane", iso(at));
  const rows = unvaultingRows(store, unvaultingBuild, new Date(at + hour));
  assert.deepEqual(rows.map(({ row, column, value }) => [row, column, value]),
    [["Default.BiPlane.MinSpawnPercent", "0", unvaultedPlaneSpawnPercent], ["Default.BiPlane.MaxSpawnPercent", "0", unvaultedPlaneSpawnPercent]]);
  assert.deepEqual(unvaultingRows(store, unvaultingBuild, new Date(at + minute)), [], "not during the event");
  assert.deepEqual(unvaultingRows(store, "6058028", new Date(at + hour)), [], "8.51 only");
}));

const userAgent = `game=Fortnite, engine=UE4, build=++Fortnite+Release-8.51-CL-${unvaultingBuild}`;
const call = (port, method, token, body) => send({ host: "127.0.0.1", port, method, path: "/fortnite/api/game/v2/unvaulting",
  headers: { "User-Agent": userAgent, Authorization: `bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) } }, body ? JSON.stringify(body) : undefined);

test("the gameserver reports its vote and reads the item back", async () => {
  const backend = await startBackend();
  const now = Date.now();
  configureEvents(configAt(now - 5 * minute));
  try {
    const server = await dedicatedServerToken(backend.port);
    assert.deepEqual((await call(backend.port, "GET", server)).body.item, null, "the event is on");
    const user = await userLogin(backend.port, "unvaultplayer");
    assert.equal((await call(backend.port, "POST", user.token, { item: "GW.DrumGun" })).status, 403, "only a game server reports");
    assert.equal((await call(backend.port, "POST", server, { item: "Nothing" })).status, 400);
    const reported = await call(backend.port, "POST", server, { item: "GW.Grappler" });
    assert.equal(reported.status, 200);
    assert.deepEqual(reported.body, { accepted: true, item: "GW.Grappler", eventAt: iso(now - 5 * minute) });
    assert.equal((await call(backend.port, "POST", server, { item: "GW.Tac" })).body.item, "GW.Grappler", "the first vote stays");
    // CoreV2's WinHTTP requests name no build in their user agent: the build is in the request.
    const plain = (method, body, query = "") => send({ host: "127.0.0.1", port: backend.port, method, path: `/fortnite/api/game/v2/unvaulting${query}`,
      headers: { "User-Agent": "Core V2", Authorization: `bearer ${server}`, ...(body ? { "Content-Type": "application/json" } : {}) } }, body ? JSON.stringify(body) : undefined);
    assert.equal((await plain("POST", { item: "GW.Sword" })).status, 400, "no build");
    assert.equal((await plain("POST", { item: "GW.Sword", build: unvaultingBuild })).body.item, "GW.Grappler");
    configureEvents(configAt(now - 20 * minute));
    assert.equal((await plain("GET", null, `?build=${unvaultingBuild}`)).body.item, epicUnvaultedItem);
    assert.equal((await call(backend.port, "GET", server)).body.item, epicUnvaultedItem, "another lap's event: Epic's");
  } finally {
    configureEvents(null);
    backend.close();
  }
});

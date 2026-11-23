import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { eventSchedules, scheduleEventPatch } from "../src/admin/eventschedules.js";
import { lootHotfixSection } from "../src/events/contentupdates.js";
import { configureEvents } from "../src/events/events.js";
import { sanitizeSiphon, siphonOn, siphonRates, siphonRows } from "../src/events/siphon.js";
import { createSettingsStore } from "../src/settings/store.js";

// PongooDev/CoreV2#557: 7.40 to 8.20's siphon and material changes in the core modes, as the hotfix's curve rows
// (events/siphon.js).
const v740 = "5046157";
const v800 = "5203069";
const v820 = "5625478";
const v730 = "4834550";
const gameData = "/Game/Athena/Balance/DataTables/AthenaGameData.AthenaGameData";
const rates = "/Game/Athena/Balance/DataTables/AthenaResourceRates.AthenaResourceRates";
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const rowsOf = (build) => siphonRows(build).map(({ table, row, value }) => [table === gameData ? "GD" : "RR", row, value]);

test("as Epic ran it: on in 7.40 and 8.00 by the hotfix's rows, off in 8.20, nothing elsewhere", () => withConfig({ mode: "auto" }, () => {
  assert.equal(siphonOn(v740), true);
  assert.equal(siphonOn(v800), true);
  assert.equal(siphonOn(v820), false);
  assert.equal(siphonOn(v730), null);
  assert.deepEqual(siphonRows(v730), []);
  const r740 = rowsOf(v740);
  assert.deepEqual(r740[0], ["GD", "Default.Siphon.Enabled", 1]);
  assert.equal(r740.filter(([table, row, value]) => table === "GD" && /^Default\.MaxStack\.Resources\.(Solos|Duos|Squads)\.(Wood|Stone|Metal)$/.test(row) && value === 500).length, 9);
  assert.ok(r740.some(([table, row, value]) => table === "RR" && row === "ResourceWoodVeryHigh" && value === 163.8), "7.40's Pop-up Cup rate, 1.4 times 117");
  assert.ok(r740.some(([table, row, value]) => table === "RR" && row === "ResourceSmall" && value === 15.4));
  assert.deepEqual(rowsOf(v800), [["GD", "Default.Siphon.GrantMatsOnKillEnabled", 1]], "8.00's paks have the rest");
  const r820 = rowsOf(v820);
  assert.deepEqual(r820[0], ["GD", "Default.Siphon.Enabled", 0]);
  assert.ok(r820.some(([table, row, value]) => table === "RR" && row === "ResourceWoodVeryHigh" && value === 117), "the base rate back");
  assert.ok(!r820.some(([, row]) => row.startsWith("Default.MaxStack")), "the cap row is Arena's too");
  assert.equal(Object.keys(siphonRates).length, 31);
}));

test("the admin's on and off", () => {
  withConfig({ mode: "auto", siphon: "off" }, () => {
    assert.deepEqual(siphonRows(v740), []);
    assert.deepEqual(rowsOf(v800)[0], ["GD", "Default.Siphon.Enabled", 0]);
    assert.equal(siphonOn(v820), false);
  });
  withConfig({ mode: "auto", siphon: "on" }, () => {
    assert.equal(siphonOn(v820), true);
    assert.deepEqual(siphonRows(v820), [], "8.20's paks have it on");
    assert.equal(rowsOf(v740)[0][2], 1);
  });
  withConfig({ mode: "off" }, () => assert.equal(siphonOn(v740), true, "not a seasonal event"));
  assert.equal(sanitizeSiphon("ON"), "on");
  assert.equal(sanitizeSiphon("half", "off"), "off");
  const store = createSettingsStore(null);
  assert.equal(store.get().events.siphon, "build");
  assert.equal(store.update({ events: { siphon: "off" } }).events.siphon, "off");
  assert.equal(store.update({ events: { siphon: "half" } }).events.siphon, "off", "an unknown value keeps the current");
  assert.deepEqual(scheduleEventPatch({ event: "siphon", mode: "on" }, {}, new Date()), { patch: { siphon: "on" } });
  assert.ok(scheduleEventPatch({ event: "siphon", mode: "dates" }, {}, new Date()).error);
  const card = eventSchedules({ now: new Date(), config: { mode: "auto" }, seasonalEvents: false }).find(({ id }) => id === "siphon");
  assert.deepEqual([card.mode, card.modes], ["build", ["build", "on", "off"]]);
  assert.notEqual(card.state.text, "Off: the Seasonal Events switch (Settings) is off");
});

test("7.40's hotfix carries them as [AssetHotfix] CurveTable RowUpdate lines", () => withConfig({ mode: "auto" }, () => {
  const lines = inBuild(v740, () => lootHotfixSection(new Date(), null, [], siphonRows(v740), v740)).split("\r\n");
  assert.equal(lines[0], "[AssetHotfix]");
  assert.ok(lines.includes(`+CurveTable=${gameData};RowUpdate;Default.Siphon.Enabled;0;1`));
  assert.ok(lines.includes(`+CurveTable=${gameData};RowUpdate;Default.MaxStack.Resources.Squads.Metal;0;500`));
  assert.ok(lines.includes(`+CurveTable=${rates};RowUpdate;ResourceLow;0;14`));
}));

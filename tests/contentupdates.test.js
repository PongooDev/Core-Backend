import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { contentUpdateStates, lootHotfixSection, sanitizeContentUpdates, updatedLootTables } from "../src/events/contentupdates.js";
import { athenaLootTables } from "../src/gamedata/athena.js";
import { clientToken, get, post, startBackend } from "./helpers.js";

// Core-Backend #156: Season 2's content updates (the Small Shield Potion with the Damage Trap, the Boogie Bomb, the
// Suppressed Pistol) and 2.1's Cozy Campfire, as Epic's [AssetHotfix] loot table rows.
const v111 = "3807424";
const v21 = "3825894";
const v110 = "3790078";
const packages = "/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client";
const tiers = "/Game/Items/Datatables/AthenaLootTierData_Client.AthenaLootTierData_Client";
const season = { mode: "season", overrides: {} };
const on = (build, now, config = season) => inBuild(build, () => contentUpdateStates(now, config))
  .filter((state) => state.on).map((state) => state.id);
const row = (tables, table, name) => tables[table]?.find((entry) => entry.Name === name);

// What 4.19's config merge does with a line (FParse::LineExtended, not exact): "//" outside quotes ends it, "|" outside
// quotes ends it, and braces outside quotes are dropped; quotes toggle on every '"', escaped or not.
function lineExtended(line) {
  let quoted = false;
  let ignore = false;
  let out = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (!quoted && c === "/" && line[i + 1] === "/") ignore = true;
    if (!quoted && c === "|") break;
    if (!quoted && (c === "{" || c === "}")) continue;
    quoted = quoted !== (c === "\"");
    if (!ignore) out += c;
  }
  return out;
}
// FParse::QuotedString: \\ and \" (and \n) unescaped, up to the closing quote.
function quotedString(text) {
  let out = "";
  let i = 1;
  for (; text[i] !== "\""; i++) {
    if (text[i] !== "\\") out += text[i];
    else { i++; out += text[i] === "n" ? "\n" : text[i]; }
  }
  return { value: out, rest: text.slice(i + 1) };
}
// The hotfix manager's reading of one +DataTable= value: ("<asset>","<json>").
function readEntry(line) {
  const value = lineExtended(line).slice("+DataTable=".length);
  assert.equal(value[0], "(");
  const asset = quotedString(value.slice(1));
  assert.equal(asset.rest[0], ",");
  const json = quotedString(asset.rest.slice(1));
  return { asset: asset.value, rows: JSON.parse(json.value) };
}

test("1.11 and 2.1 ship the Season 2 items in their loot tables at weight 0", () => {
  for (const build of [v111, v21]) {
    inBuild(build, () => {
      const tables = athenaLootTables();
      assert.equal(Object.keys(tables[packages]).length, 175);
      assert.equal(Object.keys(tables[tiers]).length, 35);
      const weight = (name) => tables[packages][name].Weight;
      assert.equal(tables[packages]["WorldList.AthenaConsumables.10"].ItemDefinition,
        "/Game/Athena/Items/Consumables/ShieldSmall/Athena_ShieldSmall.Athena_ShieldSmall");
      assert.deepEqual(["WorldList.AthenaConsumables.10", "WorldList.AthenaHighConsumables.03", "WorldList.AthenaTraps.01",
        "WorldList.AthenaTraps.02", "WorldList.AthenaLoot.Weapon.Handgun.04"].map(weight), [0, 0, 0, 0, 0]);
      assert.equal(tables[tiers].Loot_AthenaTreasure_01.LootPackage, "WorldPKG.AthenaLoot.Weapon.SuppressedHandgun");
      assert.equal(tables[tiers].Loot_AthenaTreasure_01.Weight, 0);
    });
  }
  // The stack Epic changed for the Boogie Bomb update ships in 2.1.
  assert.equal(inBuild(v111, () => athenaLootTables()[packages]["WorldList.AthenaHighConsumables.03"].Count), 3);
  assert.equal(inBuild(v21, () => athenaLootTables()[packages]["WorldList.AthenaHighConsumables.03"].Count), 1);
  assert.deepEqual(inBuild(v110, () => athenaLootTables()), {});
});

test("1.11 follows Season 2's dates: day 1 is 14 December 2017", () => {
  // No settings store: Season 2's replay starts on its history's first day, 14 December 2017.
  assert.deepEqual(on(v111, new Date("2017-12-14T00:00:00Z")), []);
  assert.deepEqual(on(v111, new Date("2017-12-19T12:59:00Z")), []);
  assert.deepEqual(on(v111, new Date("2017-12-19T13:00:00Z")), ["smallShieldPotion"]);
  assert.deepEqual(on(v111, new Date("2017-12-23T16:00:00Z")), ["smallShieldPotion", "boogieBomb"]);
  assert.deepEqual(on(v111, new Date("2018-01-02T13:00:00Z")), ["smallShieldPotion", "boogieBomb", "suppressedPistol"]);
  assert.deepEqual(on(v111, new Date("2018-02-21T23:00:00Z")), ["smallShieldPotion", "boogieBomb", "suppressedPistol"]);
  // The replay starts over after the season's 70 days, as the shop does.
  assert.deepEqual(on(v111, new Date("2018-02-22T01:00:00Z")), []);
  // The campfire is 2.1's.
  assert.ok(!inBuild(v111, () => contentUpdateStates(new Date())).some((state) => state.id === "cozyCampfire"));
});

test("1.11 can have everything on, or each update forced on or off; 2.1 always has all of them and its Cozy Campfire", () => {
  const day1 = new Date("2017-12-14T10:00:00Z");
  assert.deepEqual(on(v111, day1, { mode: "all" }), ["smallShieldPotion", "boogieBomb", "suppressedPistol"]);
  assert.deepEqual(on(v111, day1, { mode: "season", overrides: { suppressedPistol: "on" } }), ["suppressedPistol"]);
  assert.deepEqual(on(v111, day1, { mode: "all", overrides: { boogieBomb: "off" } }), ["smallShieldPotion", "suppressedPistol"]);
  for (const config of [season, { mode: "all", overrides: { boogieBomb: "off" } }]) {
    assert.deepEqual(on(v21, day1, config), ["smallShieldPotion", "boogieBomb", "suppressedPistol", "cozyCampfire"]);
  }
  assert.deepEqual(inBuild(v110, () => contentUpdateStates(day1, { mode: "all" })), []);
  assert.deepEqual(sanitizeContentUpdates({ mode: "bad", overrides: { boogieBomb: "on", nope: "on", smallShieldPotion: "maybe" } }),
    { mode: "season", overrides: { boogieBomb: "on" } });
  assert.deepEqual(sanitizeContentUpdates({ overrides: { boogieBomb: "auto" } }, { mode: "all", overrides: { boogieBomb: "on" } }),
    { mode: "all", overrides: {} });
});

test("the updated tables change only the updates' rows", () => {
  const tables = inBuild(v21, () => updatedLootTables(new Date()));
  const shipped = inBuild(v21, () => athenaLootTables());
  assert.deepEqual(Object.keys(tables).sort(), [packages, tiers].sort());
  assert.equal(tables[packages].length, 175);
  const changed = tables[packages].filter((entry) => JSON.stringify({ ...shipped[packages][entry.Name], Name: undefined })
    !== JSON.stringify({ ...entry, Name: undefined }));
  assert.deepEqual(changed.map((entry) => [entry.Name, entry.Weight, entry.Count]), [
    ["WorldList.AthenaLoot.Weapon.Handgun.04", 0.075, 1],
    ["WorldList.AthenaLoot.Weapon.Handgun.05", 0.01875, 1],
    ["WorldList.AthenaHighConsumables.03", 0.5, 1],
    ["WorldList.AthenaHighConsumables.10", 1, 3],
    ["WorldList.AthenaConsumables.10", 1, 3],
    ["WorldList.AthenaTraps.01", 3.75, 1],
    ["WorldList.AthenaTraps.02", 0.5, 1],
    ["WorldList.AthenaTraps.03", 0, 1],
    ["WorldList.AthenaTraps.04", 0, 1],
    ["WorldList.AthenaTraps.05", 0, 1],
    ["WorldList.AthenaTraps.06", 1, 1],
    ["WorldList.AthenaTraps.07", 0, 1],
    ["WorldList.AthenaTraps.08", 0, 1]
  ]);
  assert.equal(row(tables, tiers, "Loot_AthenaTreasure_01").Weight, 0.125);
  // The rows' order is the asset's, and nothing else changes.
  assert.deepEqual(tables[packages].map((entry) => entry.Name), Object.keys(shipped[packages]));
  // 1.11's Boogie Bomb stack becomes 1 on the floor too, where it stays at weight 0.
  const boogie = inBuild(v111, () => updatedLootTables(new Date(), { mode: "all" }));
  assert.deepEqual([row(boogie, packages, "WorldList.AthenaConsumables.03").Weight, row(boogie, packages, "WorldList.AthenaConsumables.03").Count], [0, 1]);
});

test("the [AssetHotfix] section reads back through the 4.19 config merge and hotfix as the updated tables", () => {
  const now = new Date();
  const section = inBuild(v21, () => lootHotfixSection(now));
  const lines = section.split("\r\n");
  assert.equal(lines[0], "[AssetHotfix]");
  assert.equal(lines.at(-1), "");
  const entries = lines.slice(1, -1).map(readEntry);
  const expected = inBuild(v21, () => updatedLootTables(now));
  assert.deepEqual(Object.fromEntries(entries.map(({ asset, rows }) => [asset, rows])), expected);
  // Every row carries every property the shipped one has (CreateTableFromJSONString reports a missing one).
  const shipped = inBuild(v21, () => athenaLootTables());
  for (const { asset, rows } of entries) {
    for (const entry of rows) assert.deepEqual(Object.keys(entry).filter((key) => key !== "Name"), Object.keys(shipped[asset][entry.Name]));
  }
  // Nothing in before the first update, nothing at all before Season 2.
  assert.equal(inBuild(v111, () => lootHotfixSection(new Date("2017-12-15T00:00:00Z"))), "");
  assert.equal(inBuild(v110, () => lootHotfixSection(now, { mode: "all" })), "");
});

function raw(port, urlPath, token, build) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers: { "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${build}`,
      Authorization: `bearer ${token}` } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    }).on("error", reject);
  });
}

test("DefaultGame.ini ends with the loot hotfix for 2.1, and for 1.11 by the admin's choice; the admin panel shows and sets it", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-contentupdates-"));
  const backend = await startBackend({ dataDir });
  try {
    const token = await clientToken(backend.port);
    const gameIni = async (build) => (await raw(backend.port, "/fortnite/api/cloudstorage/system/DefaultGame.ini", token, build)).body;
    const ini21 = await gameIni(v21);
    assert.ok(ini21.startsWith("[/Script/FortniteGame.FortGlobals]\r\nTimeBetweenLeaderboardRequestsMinutes=1\r\n"));
    assert.ok(ini21.includes("\r\n[AssetHotfix]\r\n+DataTable=(\"/Game/Items/Datatables/AthenaLootPackages_Client.AthenaLootPackages_Client\",\""));
    const sections = ini21.split("\r\n").filter((line) => line.startsWith("[") && line.endsWith("]"));
    assert.equal(sections.at(-1), "[AssetHotfix]", "the section comes last");
    assert.ok(!(await gameIni(v110)).includes("[AssetHotfix]"));
    // 1.11's Season 2 starts today, its day 1: nothing yet.
    assert.ok(!(await gameIni(v111)).includes("[AssetHotfix]"));

    assert.equal((await post(backend.port, "/admin/api/events/config", undefined, { contentUpdates: { mode: "all", overrides: { boogieBomb: "off" } } })).status, 200);
    const ini111 = await gameIni(v111);
    const entries = ini111.split("\r\n").filter((line) => line.startsWith("+DataTable=")).map(readEntry);
    const tables = Object.fromEntries(entries.map(({ asset, rows }) => [asset, rows]));
    assert.equal(row(tables, packages, "WorldList.AthenaConsumables.10").Weight, 1);
    assert.equal(row(tables, packages, "WorldList.AthenaHighConsumables.03").Weight, 0);
    assert.equal(row(tables, tiers, "Loot_AthenaTreasure_01").Weight, 0.125);

    const overview = (await get(backend.port, "/admin/api/events/overview")).body.contentUpdates;
    assert.deepEqual(overview.config, { mode: "all", overrides: { boogieBomb: "off" } });
    assert.deepEqual(overview.builds.map(({ version, updates }) => [version, updates.map(({ id, on: isOn, why }) => `${id}:${isOn}:${why}`)]), [
      ["1.11", ["smallShieldPotion:true:all", "boogieBomb:false:off", "suppressedPistol:true:all"]],
      ["2.1", ["smallShieldPotion:true:shipped", "boogieBomb:true:shipped", "suppressedPistol:true:shipped", "cozyCampfire:true:shipped"]],
      ["2.3", ["chugJug:true:shipped"]],
      ["2.4", ["minigun:true:shipped", "suppressedPistolNerf:true:shipped"]]
    ]);
    assert.ok((await get(backend.port, "/admin")).body.includes("Season 2 Content Updates"));
  } finally {
    await backend.close();
  }
});

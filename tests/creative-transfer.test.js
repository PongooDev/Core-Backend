import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { islandFileFormat, maxIslandFileBytes, readIslandFile } from "../src/services/dss/transfer.js";
import { dedicatedServerToken, get, send, startBackend, userLogin } from "./helpers.js";

// A Creative island exported to a .coreisland file and imported on another Core backend (Core-Launcher #21).
const v700 = "4629139";
const v710 = "4667333";
const v720 = "4727874";
const v730 = "4834550";
const agentOf = (build, version) => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;
const dayMs = 86_400_000;
const startForDay = (day) => {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - (day - 1) * dayMs).toISOString().slice(0, 10);
};
// Season 7's replay past 13 December 2018: every account has its islands.
const creativeBackend = () => startBackend({ events: { seasonStarts: { 7: startForDay(20) } } });
const as = (port, token, method, url, { agent, body, headers = {} } = {}) => send({ host: "127.0.0.1", port, method, path: url,
  headers: { ...(agent ? { "User-Agent": agent } : {}), ...(token ? { Authorization: `bearer ${token}` } : {}), ...headers } }, body);
// What Core-Launcher sends: the player's token, no game User-Agent.
const launcher = (port, token, method, url, body) => as(port, token, method, url, body === undefined ? {} : { body, headers: { "Content-Type": "application/json" } });
const plotsOf = async (port, player, agent) => {
  const answer = await as(port, player.token, "POST", `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=creative&rvn=-1`,
    { agent, body: "{}", headers: { "Content-Type": "application/json" } });
  return Object.entries(answer.body.profileChanges[0].profile.items);
};
const islandPath = (accountId, plotItemId) => `/api/dss/v1/creative/islands/personal/${accountId}/${plotItemId}.island`;

// A player's island saved through the DSS as a server of `build` saves it.
async function saveIsland(port, player, plotItemId, contents, agent) {
  const server = await dedicatedServerToken(port);
  const raw = (method, url, body) => as(port, server, method, url, { agent, body, headers: { "Content-Type": "application/octet-stream", "X-Epic-Meta-serialized-at": "2019-01-01T00:00:00Z", "X-Epic-Meta-num-actors-new": "42" } });
  assert.equal((await raw("POST", `${islandPath(player.accountId, plotItemId)}/checkout?pid=server-21&dl=true`)).status, 204);
  assert.equal((await raw("PUT", `${islandPath(player.accountId, plotItemId)}?autolock=false`, contents)).status, 204);
  assert.equal((await raw("POST", `${islandPath(player.accountId, plotItemId)}/checkin`)).status, 204);
}
const readSave = async (port, accountId, plotItemId) => {
  const server = await dedicatedServerToken(port);
  return as(port, server, "GET", islandPath(accountId, plotItemId));
};
const ofType = (plots, templateId) => plots.filter(([, item]) => item.templateId === templateId)
  .sort(([, a], [, b]) => a.attributes.islandIndex - b.attributes.islandIndex);

// An island file as Core makes one, with `changes` over its fields.
function islandFile(save = Buffer.from("island record"), { build = v720, type = "CreativePlot:temperate_medium", ...changes } = {}) {
  const packed = zlib.gzipSync(save);
  return { format: islandFileFormat, formatVersion: 1, exportedAt: new Date().toISOString(), build: { changelist: build },
    island: { type, name: "", title: "Box Fights", description: "1v1", meta: {} },
    save: { compression: "gzip", size: save.length, sha256: crypto.createHash("sha256").update(save).digest("hex"), data: packed.toString("base64") }, ...changes };
}
const fileBytes = (document) => Buffer.from(JSON.stringify(document));

test("an island exported on one backend is imported on another: a new island in the first free slot, its save and title as they were", async () => {
  const first = await creativeBackend();
  const second = await creativeBackend();
  try {
    // On the first backend: a 7.20 player's second island, saved by a 7.20 server.
    const builder = await userLogin(first.port, "IslandBuilder21");
    const [, [plotItemId]] = ofType(await plotsOf(first.port, builder, agentOf(v720, "7.20")), "CreativePlot:temperate_medium");
    const save = crypto.randomBytes(200_000);
    await saveIsland(first.port, builder, plotItemId, save, agentOf(v720, "7.20"));

    const listed = await launcher(first.port, builder.token, "GET", `/core/api/creative/islands?build=${v720}`);
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    const mine = listed.body.islands.find((island) => island.plotItemId === plotItemId);
    assert.deepEqual([mine.name, mine.saved, mine.free, mine.size, mine.build.changelist, mine.build.from, mine.loadsOnBuild],
      ["Island 2", true, false, save.length, v720, "save", true]);
    const temperate = listed.body.slots.find((slot) => slot.templateId === "CreativePlot:temperate_medium");
    assert.deepEqual([temperate.limit, temperate.islands, temperate.free], [4, 4, 3]);
    assert.ok(listed.body.slots.some((slot) => slot.name === "Frosty Fortress"), "7.20 has Frosty Fortress");
    assert.ok(!(await launcher(first.port, builder.token, "GET", `/core/api/creative/islands?build=${v700}`)).body.slots.some((slot) => slot.name === "Arctic Island"),
      "7.00 has only its four islands");

    const exported = await launcher(first.port, builder.token, "GET", `/core/api/creative/islands/${plotItemId}/export`);
    assert.equal(exported.status, 200, JSON.stringify(exported.body));
    assert.match(exported.headers["content-disposition"], /^attachment; filename="?Island-2\.coreisland"?$/);
    const file = exported.body;
    assert.deepEqual([file.format, file.formatVersion, file.build.changelist, file.build.version, file.build.from, file.island.type],
      ["core-island", 1, v720, "7.20", "save", "CreativePlot:temperate_medium"]);
    assert.deepEqual(file.island.meta, { "serialized-at": "2019-01-01T00:00:00Z", "num-actors-new": "42" });
    assert.deepEqual([file.save.compression, file.save.size, file.save.sha256], ["gzip", save.length, crypto.createHash("sha256").update(save).digest("hex")]);
    assert.equal(JSON.stringify(file).includes(builder.accountId), false, "the file doesn't name the owner");
    assert.equal(JSON.stringify(file).includes(plotItemId), false, "or the island's id");

    // On the second backend: a player whose first island is built on already.
    const visitor = await userLogin(second.port, "IslandVisitor21");
    const temperateTwo = ofType(await plotsOf(second.port, visitor, agentOf(v730, "7.30")), "CreativePlot:temperate_medium");
    await saveIsland(second.port, visitor, temperateTwo[0][0], "the visitor's own island", agentOf(v730, "7.30"));
    const imported = await launcher(second.port, visitor.token, "POST", `/core/api/creative/islands/import?build=${v730}`, JSON.stringify(file));
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    const island = imported.body.imported;
    assert.deepEqual([island.name, island.islandIndex, island.title, island.build.changelist], ["Island 2", 2, "", v720]);
    assert.notEqual(island.plotItemId, plotItemId, "a new island id");
    assert.notEqual(island.plotItemId, temperateTwo[1][0], "not the free slot's old id");
    // The profile: the free slot's plot is replaced by the new island, the others are as they were.
    const after = ofType(await plotsOf(second.port, visitor, agentOf(v730, "7.30")), "CreativePlot:temperate_medium");
    assert.deepEqual(after.map(([id]) => id), [temperateTwo[0][0], island.plotItemId, temperateTwo[2][0], temperateTwo[3][0]]);
    assert.equal((await readSave(second.port, visitor.accountId, temperateTwo[0][0])).body, "the visitor's own island");
    const loaded = await readSave(second.port, visitor.accountId, island.plotItemId);
    assert.equal(loaded.status, 200);
    assert.equal(loaded.headers["x-epic-meta-num-actors-new"], "42", "the save's meta comes along");
    const saved = fs.readFileSync(path.join(second.dataDir, "accounts", visitor.accountId, "creative", "islands", `${island.plotItemId}.island`));
    assert.ok(saved.equals(save), "the save byte for byte");

    // Exported again from the second backend: the same save, still 7.20's.
    const again = await launcher(second.port, visitor.token, "GET", `/core/api/creative/islands/${island.plotItemId}/export`);
    assert.deepEqual([again.body.save.sha256, again.body.build.changelist, again.body.build.from], [file.save.sha256, v720, "save"]);
    const relisted = (await launcher(second.port, visitor.token, "GET", `/core/api/creative/islands?build=${v730}`)).body;
    assert.ok(relisted.islands.find((entry) => entry.plotItemId === island.plotItemId).imported);
  } finally {
    first.close();
    second.close();
  }
});

test("an import never touches another account's islands, and only the token's own account is served", async () => {
  const backend = await creativeBackend();
  try {
    const owner = await userLogin(backend.port, "IslandOwner21");
    const plots = ofType(await plotsOf(backend.port, owner, agentOf(v720, "7.20")), "CreativePlot:temperate_medium");
    await saveIsland(backend.port, owner, plots[0][0], "owner's island", agentOf(v720, "7.20"));
    const intruder = await userLogin(backend.port, "IslandIntruder21");
    // A file naming the owner's account and island: those fields aren't read.
    const crafted = islandFile(Buffer.from("intruder's island"), { owner: owner.accountId, plotItemId: plots[1][0], accountId: owner.accountId });
    crafted.island.plotItemId = plots[1][0];
    const imported = await launcher(backend.port, intruder.token, "POST", `/core/api/creative/islands/import?build=${v720}`, JSON.stringify(crafted));
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.equal(fs.existsSync(path.join(backend.dataDir, "accounts", intruder.accountId, "creative", "islands", `${imported.body.imported.plotItemId}.island`)), true);
    assert.equal((await readSave(backend.port, owner.accountId, plots[0][0])).body, "owner's island");
    assert.equal((await readSave(backend.port, owner.accountId, plots[1][0])).status, 404, "the owner's free island stays free");
    assert.deepEqual(ofType(await plotsOf(backend.port, owner, agentOf(v720, "7.20")), "CreativePlot:temperate_medium").map(([id]) => id), plots.map(([id]) => id));

    // Someone else's island isn't exported; a server token and no token are refused.
    assert.equal((await launcher(backend.port, intruder.token, "GET", `/core/api/creative/islands/${plots[0][0]}/export`)).status, 404);
    const server = await dedicatedServerToken(backend.port);
    assert.equal((await launcher(backend.port, server, "GET", "/core/api/creative/islands")).status, 403);
    assert.equal((await launcher(backend.port, undefined, "GET", "/core/api/creative/islands")).status, 401);
    assert.equal((await launcher(backend.port, undefined, "POST", "/core/api/creative/islands/import", JSON.stringify(islandFile()))).status, 401);
    // An island never saved has nothing to export.
    const unsaved = await launcher(backend.port, owner.token, "GET", `/core/api/creative/islands/${plots[2][0]}/export`);
    assert.deepEqual([unsaved.status, unsaved.body.errorCode], [404, "errors.com.epicgames.creative.island_not_saved"]);
  } finally {
    backend.close();
  }
});

test("bad island files are refused, and nothing is written", async () => {
  // Each refusal as readIslandFile gives it.
  const refused = (contents, code) => assert.throws(() => readIslandFile(contents), (error) => error.errorCode === `errors.com.epicgames.creative.${code}`, code);
  refused(Buffer.alloc(0), "island_file_invalid");
  refused(Buffer.from("not json"), "island_file_invalid");
  refused(fileBytes({ ...islandFile(), format: "something-else" }), "island_file_invalid");
  refused(fileBytes({ ...islandFile(), formatVersion: 2 }), "island_format_unsupported");
  refused(fileBytes(islandFile(undefined, { build: "4000805" })), "island_file_invalid");
  refused(fileBytes(islandFile(undefined, { type: "CreativePlot:featured_temperate_medium1" })), "island_type_unsupported");
  const damaged = islandFile();
  damaged.save.sha256 = "0".repeat(64);
  refused(fileBytes(damaged), "island_file_invalid");
  const notBase64 = islandFile();
  notBase64.save.data = "####";
  refused(fileBytes(notBase64), "island_file_invalid");
  // A small file that unpacks past an island's 16 MB.
  const bomb = islandFile();
  bomb.save.data = zlib.gzipSync(Buffer.alloc(17 * 1024 * 1024)).toString("base64");
  refused(fileBytes(bomb), "island_file_invalid");
  refused(fileBytes({ ...islandFile(), save: { ...islandFile().save, size: 17 * 1024 * 1024 } }), "island_file_too_large");
  refused(Buffer.alloc(maxIslandFileBytes + 1, 0x20), "island_file_too_large");
  // A known file keeps only what it knows.
  const known = readIslandFile(Buffer.from(JSON.stringify(islandFile()).replace(/^\{/, '{"__proto__":{"polluted":true},"extra":1,')));
  assert.deepEqual(Object.keys(known).sort(), ["build", "description", "meta", "name", "save", "title", "type"]);
  assert.equal({}.polluted, undefined);

  const backend = await creativeBackend();
  try {
    const player = await userLogin(backend.port, "IslandImporter21");
    await plotsOf(backend.port, player, agentOf(v720, "7.20"));
    const islandsFolder = path.join(backend.dataDir, "accounts", player.accountId, "creative", "islands");
    const before = fs.existsSync(islandsFolder) ? fs.readdirSync(islandsFolder) : [];
    const importAs = (body, build = v720) => launcher(backend.port, player.token, "POST", `/core/api/creative/islands/import${build ? `?build=${build}` : ""}`, body);
    const expect = async (body, status, code, build) => {
      const answer = await importAs(body, build);
      assert.deepEqual([answer.status, answer.body?.errorCode], [status, `errors.com.epicgames.creative.${code}`], JSON.stringify(answer.body));
      return answer;
    };
    await expect("{", 400, "island_file_invalid");
    await expect(JSON.stringify(damaged), 400, "island_file_invalid");
    // A 7.30 island on a 7.20 player's game, and on a 6.31 one.
    const newer = await expect(JSON.stringify(islandFile(undefined, { build: v730 })), 409, "island_newer_build");
    assert.match(newer.body.errorMessage, /newer build \(7\.30 \(CL-4834550\)\) than yours \(7\.20 \(CL-4727874\)\)/);
    await expect(JSON.stringify(islandFile()), 400, "creative_unavailable", "4573279");
    // An Arctic island needs 7.10's islands.
    await expect(JSON.stringify(islandFile(undefined, { build: v710, type: "CreativePlot:arctic_medium" })), 400, "island_type_unavailable", v700);
    // Past the import's size limit.
    await expect(Buffer.alloc(maxIslandFileBytes + 1024, 0x20), 413, "island_file_too_large");
    assert.deepEqual(fs.existsSync(islandsFolder) ? fs.readdirSync(islandsFolder) : [], before, "nothing written");
  } finally {
    backend.close();
  }
});

test("an import takes the lowest free slot of its type, up to the type's limit; a reset frees one, whose history the new island keeps", async () => {
  const backend = await creativeBackend();
  try {
    const player = await userLogin(backend.port, "IslandCollector21");
    const plots = ofType(await plotsOf(backend.port, player, agentOf(v720, "7.20")), "CreativePlot:temperate_medium");
    await saveIsland(backend.port, player, plots[2][0], "island three", agentOf(v720, "7.20"));
    const importOne = (save) => launcher(backend.port, player.token, "POST", `/core/api/creative/islands/import?build=${v720}`, JSON.stringify(islandFile(Buffer.from(save))));
    const indexes = [];
    for (const save of ["first", "second", "third"]) {
      const answer = await importOne(save);
      assert.equal(answer.status, 200, JSON.stringify(answer.body));
      indexes.push(answer.body.imported.islandIndex);
    }
    assert.deepEqual(indexes, [1, 2, 4], "island 3 holds a save");
    const full = await importOne("fourth");
    assert.deepEqual([full.status, full.body.errorCode], [409, "errors.com.epicgames.creative.no_free_island_slot"]);
    assert.match(full.body.errorMessage, /all 4 of IslandCollector21's Island slots hold an island \(the limit is 4\)/);
    const listed = (await launcher(backend.port, player.token, "GET", `/core/api/creative/islands?build=${v720}`)).body;
    assert.equal(listed.slots.find((slot) => slot.templateId === "CreativePlot:temperate_medium").free, 0);
    assert.equal(ofType(await plotsOf(backend.port, player, agentOf(v720, "7.20")), "CreativePlot:temperate_medium").length, 4, "never more than the limit");
    // Another type has its own slots: Frosty Fortress, one of it.
    const frosty = () => launcher(backend.port, player.token, "POST", `/core/api/creative/islands/import?build=${v720}`,
      JSON.stringify(islandFile(Buffer.from("fortress"), { type: "CreativePlot:arctic_competitive_medium1" })));
    assert.equal((await frosty()).status, 200);
    assert.equal((await frosty()).body.errorCode, "errors.com.epicgames.creative.no_free_island_slot");

    // The admin resets island 3 (its save kept as a backup): the next import goes there, and the backup with it.
    const admin = (url, body) => send({ host: "127.0.0.1", port: backend.port, method: "POST", path: `/admin/api${url}`,
      headers: { "Content-Type": "application/json" } }, body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));
    assert.equal((await admin(`/accounts/${player.accountId}/creative/${plots[2][0]}/reset`, {})).status, 200);
    const intoReset = await importOne("into the reset slot");
    assert.equal(intoReset.status, 200, JSON.stringify(intoReset.body));
    assert.equal(intoReset.body.imported.islandIndex, 3);
    const view = (await get(backend.port, `/admin/api/accounts/${player.accountId}/creative`)).body;
    const three = view.islands.find((island) => island.plotItemId === intoReset.body.imported.plotItemId);
    assert.deepEqual([three.islandIndex, three.backups.length, three.backups[0].note, three.build.version], [3, 1, "before reset", "7.20"]);
    assert.equal(view.islands.some((island) => island.plotItemId === plots[2][0]), false, "the old island id is gone");

    // The admin panel's export and import of the same player.
    const exported = await get(backend.port, `/admin/api/accounts/${player.accountId}/creative/${three.plotItemId}/export`);
    assert.equal(exported.status, 200);
    assert.equal(Buffer.from(exported.body.save.data, "base64").length > 0, true);
    const other = await userLogin(backend.port, "IslandReceiver21");
    await plotsOf(backend.port, other, agentOf(v720, "7.20"));
    const adminImport = await admin(`/accounts/${other.accountId}/creative/import`, JSON.stringify(exported.body));
    assert.equal(adminImport.status, 200, JSON.stringify(adminImport.body));
    assert.equal(adminImport.body.imported.islandIndex, 1);
    assert.equal(adminImport.body.islands.find((island) => island.plotItemId === adminImport.body.imported.plotItemId).save.size, "into the reset slot".length);
  } finally {
    backend.close();
  }
});

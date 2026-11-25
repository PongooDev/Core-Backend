import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { islandFileOf, islandSaveVersion, readIslandInfo } from "../src/services/dss/dss.js";
import { dedicatedServerToken, send, startBackend, userLogin } from "./helpers.js";

// A save from an older SaveVersion than the island's file (8.20's 8 over 8.50's 10) is kept beside it, not over it
// (PongooDev/CoreV2#661): 8.20 to 8.40 can't read 8.50's VolumeInfoActorRecords.
const v820 = "5625478";
const v851 = "6165369";
const agentOf = (build, version) => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;

// A tiny island file as the game writes one: FString "None", the int16 SaveVersion, 8 bytes, then a compressed block's tag.
function islandData(saveVersion, body) {
  const name = Buffer.from("None\0", "latin1");
  const header = Buffer.alloc(4 + name.length + 2 + 8);
  header.writeInt32LE(name.length, 0);
  name.copy(header, 4);
  header.writeInt16LE(saveVersion, 4 + name.length);
  header.writeInt32LE(1, 4 + name.length + 2);
  return Buffer.concat([header, Buffer.from([0xc1, 0x83, 0x2a, 0x9e, 0, 0, 0, 0]), Buffer.from(body)]);
}

async function islandOf(backend, name) {
  const player = await userLogin(backend.port, name);
  const server = await dedicatedServerToken(backend.port);
  const profile = await send({ host: "127.0.0.1", port: backend.port, method: "POST",
    path: `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=creative&rvn=-1`,
    headers: { "User-Agent": agentOf(v851, "8.51"), Authorization: `bearer ${player.token}`, "Content-Type": "application/json" } }, "{}");
  const [plotItemId] = Object.entries(profile.body.profileChanges[0].profile.items).find(([, item]) => item.templateId === "CreativePlot:temperate_medium");
  const url = `/api/dss/v1/creative/islands/personal/${player.accountId}/${plotItemId}.island`;
  const as = (build, version, method, path, body) => send({ host: "127.0.0.1", port: backend.port, method, path,
    headers: { "User-Agent": agentOf(build, version), Authorization: `bearer ${server}`, "Content-Type": "application/octet-stream" } }, body);
  const island = { owner: player.accountId, plotItemId };
  return { url, as, island, file: islandFileOf(backend.dataDir, island) };
}

test("an island file's SaveVersion", () => {
  assert.equal(islandSaveVersion(islandData(10, "x")), 10);
  assert.equal(islandSaveVersion(islandData(5, "x")), 5);
  assert.equal(islandSaveVersion(Buffer.from("island record")), null);
  assert.equal(islandSaveVersion(Buffer.alloc(0)), null);
});

test("an older SaveVersion's upload is kept beside a newer island; the same or a newer one replaces it", async () => {
  const backend = await startBackend();
  try {
    const { url, as, island, file } = await islandOf(backend, "SaveVersionOwner");
    const v10 = islandData(10, "the 8.51 island");
    assert.equal((await as(v851, "8.51", "POST", `${url}/checkout?pid=server-851&dl=true`)).status, 204);
    assert.equal((await as(v851, "8.51", "PUT", `${url}?autolock=false`, v10)).status, 204);
    assert.equal(readIslandInfo(backend.dataDir, island).build, v851);

    // 8.20 opens it, saves (v8), and checks in with another v8 record: answered as saves, the v10 island untouched.
    assert.equal((await as(v820, "8.20", "POST", `${url}/checkout?pid=server-820&dl=true`)).status, 200);
    assert.equal((await as(v820, "8.20", "PUT", `${url}?autolock=false`, islandData(8, "the 8.20 save"))).status, 204);
    assert.equal((await as(v820, "8.20", "POST", `${url}/checkin`, islandData(8, "the 8.20 check-in"))).status, 204);
    assert.deepEqual(fs.readFileSync(file), v10);
    assert.equal(fs.existsSync(`${file}.prev`), false, "no .prev written");
    const info = readIslandInfo(backend.dataDir, island);
    assert.equal(info.build, v851);
    assert.equal(info.lock, undefined, "checked in");
    assert.equal(fs.readFileSync(`${file}.v8`).subarray(-17).toString(), "the 8.20 check-in");
    const side = JSON.parse(fs.readFileSync(`${file}.v8.json`, "utf8"));
    assert.deepEqual([side.build, side.saveVersion, side.islandSaveVersion], [v820, 8, 10]);
    assert.match(String((await as(v851, "8.51", "GET", url)).body), /the 8\.51 island$/);

    // A file without a readable header is written as before.
    assert.equal((await as(v820, "8.20", "POST", `${url}/checkout?pid=server-820`)).status, 204);
    assert.equal((await as(v820, "8.20", "PUT", `${url}?autolock=false`, "not a record")).status, 204);
    assert.equal(fs.readFileSync(file).toString(), "not a record");
  } finally {
    backend.close();
  }
});

test("v8 over v8 and v8 then v10 save as before", async () => {
  const backend = await startBackend();
  try {
    const { url, as, island, file } = await islandOf(backend, "SaveVersionSame");
    assert.equal((await as(v820, "8.20", "POST", `${url}/checkout?pid=server-820`)).status, 204);
    assert.equal((await as(v820, "8.20", "PUT", `${url}?autolock=false`, islandData(8, "first"))).status, 204);
    assert.equal((await as(v820, "8.20", "PUT", `${url}?autolock=false`, islandData(8, "second"))).status, 204);
    assert.equal(fs.readFileSync(file).subarray(-6).toString(), "second");
    assert.equal(fs.readFileSync(`${file}.prev`).subarray(-5).toString(), "first");

    const v10 = islandData(10, "upgraded");
    assert.equal((await as(v851, "8.51", "POST", `${url}/checkout?pid=server-851`)).status, 204);
    assert.equal((await as(v851, "8.51", "POST", `${url}/checkin`, v10)).status, 204);
    assert.deepEqual(fs.readFileSync(file), v10);
    assert.equal(fs.readFileSync(`${file}.prev`).subarray(-6).toString(), "second");
    const info = readIslandInfo(backend.dataDir, island);
    assert.deepEqual([info.build, info.previousBuild, info.lock], [v851, v820, undefined]);
    assert.equal(fs.readdirSync(path.dirname(file)).some((name) => /\.v\d+$/.test(name)), false, "no side file");
  } finally {
    backend.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dedicatedServerToken, post, send, startBackend, userLogin } from "./helpers.js";

// CoreV2 #723: 9.20+ gameservers upload Horde Rush's score and the Crucible's times to the stats ingestion service.
const bestScore = "mash_bestscore_gamepad_m0_playlist_mash_squads";
const courseTime = "crucible_timeoverall_gamepad_m0_playlist_crucible_solo";

test("a gameserver's stats ingestion upload answers 204 and the stats come back through stats v2", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-statsingestion-"));
  let backend = await startBackend({ dataDir });
  try {
    const player = await userLogin(backend.port, "IngestPlayer");
    const friend = await userLogin(backend.port, "IngestFriend");
    const dedicated = await dedicatedServerToken(backend.port);
    const upload = (token, stats) => post(backend.port, "/api/stats/fortnite", token,
      { timestamp: Math.floor(Date.now() / 1000), appId: "fortnite", stats });

    // A player can't upload; the DedicatedServer client can, and an unknown account or a non-number is skipped.
    assert.equal((await upload(player.token, [{ ownerId: player.accountId, stats: { [bestScore]: 99999 } }])).status, 403);
    assert.equal((await upload(dedicated, [
      { ownerId: player.accountId, stats: { [bestScore]: 1200, [courseTime]: 95000, junk: "x" } },
      { ownerId: friend.accountId, stats: { [bestScore]: 800 } },
      { ownerId: "0123456789abcdef0123456789abcdef", stats: { [bestScore]: 5 } }
    ])).status, 204);
    // A worse score keeps the best; any other stat takes the latest.
    assert.equal((await upload(dedicated, [{ ownerId: player.accountId, stats: { [bestScore]: 300, [courseTime]: 99000 } }])).status, 204);

    backend.close();
    backend = await startBackend({ dataDir });
    const again = await userLogin(backend.port, "IngestPlayer");
    const payload = JSON.stringify({ appId: "fortnite", startDate: 0, endDate: 9223372036854775807,
      owners: [player.accountId, friend.accountId], stats: [bestScore] });
    const query = await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/fortnite/api/statsv2/query",
      headers: { "User-Agent": "game=Fortnite, engine=UE4, build=++Fortnite+Release-9.21-CL-6922310",
        Authorization: `bearer ${again.token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, payload);
    assert.equal(query.status, 200);
    assert.deepEqual(query.body.map(({ accountId, stats }) => ({ accountId, stats })), [
      { accountId: player.accountId, stats: { [bestScore]: 1200 } },
      { accountId: friend.accountId, stats: { [bestScore]: 800 } }
    ]);

    const account = await send({ host: "127.0.0.1", port: backend.port, path: `/fortnite/api/statsv2/account/${player.accountId}`,
      headers: { Authorization: `bearer ${again.token}` } });
    assert.equal(account.body.stats[courseTime], 99000);
    assert.ok(!("junk" in account.body.stats));
  } finally {
    backend.close();
  }
});

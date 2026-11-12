import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { certUserAgent, send, startBackend, userLogin } from "./helpers.js";

// SetBansViewed (UFortMcpProfileCommonCore's, from 4.4.0): the ban notice's acknowledgement. 6.02's PlayerBannedModal
// sends it while common_core's ban_status (FMcpBanInfo) has bRequiresUserAck set, and is put up again for as long as it is.
const agent602 = "Fortnite/++Fortnite+Release-6.02-CL-4461277 Windows/10.0.19045.1.256.64bit";
const agent440 = "Fortnite/++Fortnite+Release-4.4-CL-4117433 Windows/10.0.17134.1.256.64bit";

const client = (backend, player, agent) => (command, profileId, rvn = -1) => send({ host: "127.0.0.1", port: backend.port, method: "POST",
  path: `/fortnite/api/game/v2/profile/${player.accountId}/client/${command}?profileId=${profileId}&rvn=${rvn}`,
  headers: { "User-Agent": agent, Authorization: `bearer ${player.token}`, "Content-Type": "application/json", "Content-Length": 2 } }, "{}");

// A ban notice as Epic's service wrote one, put in the saved profile (Core's own bans write none).
function giveBanStatus(backend, accountId, status) {
  const file = path.join(backend.dataDir, "accounts", accountId, "profiles", "profile0.json");
  const profile = JSON.parse(fs.readFileSync(file, "utf8"));
  profile.stats.attributes.ban_status = status;
  fs.writeFileSync(file, JSON.stringify(profile));
}

const warning = { bRequiresUserAck: true, banReasons: ["Teaming"], bBanHasStarted: true, banStartTimeUtc: "2018-10-01T00:00:00.000Z", banDurationDays: 1 };

test("SetBansViewed acknowledges the ban notice: common_core's ban_status no longer requires it, and keeps the rest", async () => {
  const backend = await startBackend();
  try {
    for (const agent of [agent602, agent440]) {
      const player = await userLogin(backend.port, `Banned${agent === agent602 ? 602 : 440}`);
      const mcp = client(backend, player, agent);
      const attributesOf = async (profileId) => (await mcp("QueryProfile", profileId)).body.profileChanges[0].profile.stats.attributes;
      assert.equal((await attributesOf("common_core")).ban_status, undefined, "no account has one by itself");

      giveBanStatus(backend, player.accountId, warning);
      // The notice is common_core's, where the client reads it, not campaign's.
      const before = await mcp("QueryProfile", "common_core");
      assert.deepEqual(before.body.profileChanges[0].profile.stats.attributes.ban_status, warning);
      assert.equal((await attributesOf("campaign")).ban_status, undefined);

      const seen = await mcp("SetBansViewed", "common_core", before.body.profileRevision);
      assert.equal(seen.status, 200, JSON.stringify(seen.body));
      assert.equal(seen.body.profileId, "common_core");
      assert.deepEqual(seen.body.profileChanges, [{ changeType: "statModified", name: "ban_status", value: { ...warning, bRequiresUserAck: false } }]);
      assert.deepEqual((await attributesOf("common_core")).ban_status, { ...warning, bRequiresUserAck: false });

      // Seen already: nothing more changes.
      const again = await mcp("SetBansViewed", "common_core", seen.body.profileRevision);
      assert.equal(again.status, 200);
      assert.deepEqual(again.body.profileChanges, []);
      assert.equal(again.body.profileRevision, seen.body.profileRevision);
    }
  } finally {
    backend.close();
  }
});

test("SetBansViewed with no ban notice changes nothing, on a split profile or on profile0", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "NeverBanned");
    for (const [agent, profileId] of [[agent602, "common_core"], [certUserAgent, "profile0"]]) {
      const mcp = client(backend, player, agent);
      const before = await mcp("QueryProfile", profileId);
      const seen = await mcp("SetBansViewed", profileId, before.body.profileRevision);
      assert.equal(seen.status, 200, JSON.stringify(seen.body));
      assert.deepEqual(seen.body.profileChanges, []);
      assert.equal((await mcp("QueryProfile", profileId)).body.profileChanges[0].profile.stats.attributes.ban_status, undefined);
    }
  } finally {
    backend.close();
  }
});

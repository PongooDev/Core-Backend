import { test } from "node:test";
import assert from "node:assert/strict";
import { get, send, startBackend, userLogin } from "./helpers.js";

const agent18 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-Live-CL-3724489";

function command(port, { accountId, token }, name, profileId, body = {}) {
  const text = JSON.stringify(body);
  return send({
    host: "127.0.0.1",
    port,
    method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`,
    headers: { "User-Agent": agent18, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }
  }, text);
}

test("1.8's login queries the athena profile: it has the loadout's slots, empty for the default cosmetics", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Athena18");
    const athena = await command(backend.port, player, "QueryProfile", "athena");
    assert.equal(athena.status, 200);
    const profile = [athena.body, ...(athena.body.multiUpdate ?? [])].find((update) => update.profileId === "athena").profileChanges[0].profile;
    assert.deepEqual(profile.items, {});
    const attributes = profile.stats.attributes;
    assert.equal(attributes.level, 1);
    assert.equal(attributes.accountLevel, 1);
    for (const slot of ["character", "hat", "backpack", "pickaxe", "glider", "loadingscreen", "battlebus", "dance", "victorypose"]) {
      assert.equal(attributes[`favorite_${slot}`], "", slot);
    }
  } finally {
    backend.close();
  }
});

test("1.8's event calendar answers with no active events, cached for an hour", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Calendar18");
    const timeline = await get(backend.port, "/fortnite/api/calendar/v1/timeline?rvn=2&leanResponse=true", token);
    assert.equal(timeline.status, 200);
    const events = timeline.body.channels["client-events"];
    assert.deepEqual(events.states.map((state) => state.activeEvents), [[]]);
    assert.ok(Date.parse(events.cacheExpire) > Date.parse(timeline.body.currentTime));
  } finally {
    backend.close();
  }
});

test("1.8's Battle Royale lobby gets a leaderboard cohort of just the player", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "Cohort18");
    const cohort = await get(backend.port, `/fortnite/api/game/v2/leaderboards/cohort/${accountId}?playlist=pc_m0_p2`, token);
    assert.equal(cohort.status, 200);
    assert.deepEqual([cohort.body.accountId, cohort.body.cohortAccounts, cohort.body.playlist], [accountId, [accountId], "pc_m0_p2"]);
    assert.ok(Date.parse(cohort.body.expiresAt) > Date.now());
  } finally {
    backend.close();
  }
});

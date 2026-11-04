import { test } from "node:test";
import assert from "node:assert/strict";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #229: Season 3's Twitch Prime pack, an admin setting (off by default).
const agent30 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-3.0-CL-3901517";
const agent25 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-2.5-CL-3889387";
const outfit = "AthenaCharacter:cid_085_athena_commando_m_twitch";
const glider = "AthenaGlider:glider_id_018_twitch";

async function athena(port, { accountId, token }, agent) {
  const response = await send({
    host: "127.0.0.1",
    port,
    method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=athena&rvn=-1`,
    headers: { "User-Agent": agent, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": 2 }
  }, "{}");
  const update = [response.body, ...(response.body.multiUpdate ?? [])].find((entry) => entry.profileId === "athena");
  return update.profileChanges[0].profile.items;
}

test("the Twitch Prime pack is off by default and the admin panel switches it", async () => {
  const backend = await startBackend();
  try {
    assert.equal((await get(backend.port, "/admin/api/settings")).body.twitchPrimePack, false);
    const player = await userLogin(backend.port, "PrimeOff");
    const items = await athena(backend.port, player, agent30);
    assert.ok(!items[outfit] && !items[glider]);
    assert.equal((await post(backend.port, "/admin/api/settings", undefined, { twitchPrimePack: true })).body.twitchPrimePack, true);
    assert.equal((await get(backend.port, "/admin/api/settings")).body.twitchPrimePack, true);
  } finally {
    backend.close();
  }
});

test("with the pack on, a 3.x login gives the Sub Commander and the Slipstream once; earlier builds get nothing", async () => {
  const backend = await startBackend({ twitchPrimePack: true });
  try {
    const early = await userLogin(backend.port, "PrimeEarly");
    const earlyItems = await athena(backend.port, early, agent25);
    assert.ok(!Object.keys(earlyItems).some((id) => id.toLowerCase().includes("twitch")));

    const items = await athena(backend.port, early, agent30);
    assert.equal(items[outfit].templateId, outfit);
    assert.equal(items[glider].templateId, glider);
    assert.equal(Object.keys(items).filter((id) => id.toLowerCase().includes("twitch")).length, 2);
    assert.equal(Object.keys(items).filter((id) => id.toLowerCase().startsWith("athenadance:spid")).length, 0);
    assert.deepEqual(Object.keys(await athena(backend.port, early, agent30)).sort(), Object.keys(items).sort());

    // Turning it off keeps what was given; an account that logs in afterwards gets nothing.
    await post(backend.port, "/admin/api/settings", undefined, { twitchPrimePack: false });
    assert.ok((await athena(backend.port, early, agent30))[outfit]);
    const late = await userLogin(backend.port, "PrimeLate");
    const lateItems = await athena(backend.port, late, agent30);
    assert.ok(!lateItems[outfit] && !lateItems[glider]);

    // Turned on later, an account that already played gets the pack the next time it loads.
    await post(backend.port, "/admin/api/settings", undefined, { twitchPrimePack: true });
    assert.ok((await athena(backend.port, late, agent30))[glider]);
  } finally {
    backend.close();
  }
});

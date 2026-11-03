import { test } from "node:test";
import assert from "node:assert/strict";
import { hasShootingTest, shootingTestHotfixTables, shootingTestOn, shootingTestTeams } from "../src/events/shootingtest.js";
import { formTeams, playlistTeamsOf } from "../src/matchmaking/service.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #189: Shooting Test #1, the lobby's AthenaEvent4 queue, MCP playlist 15 (events/shootingtest.js).
const v23 = "3847564";
const v24 = "3858292";
const v242 = "3870737";
const v25 = "3889387";
const table = "/Game/Athena/Items/Weapons/AthenaRangedWeapons_ShootingModel3.AthenaRangedWeapons_ShootingModel3";

function as(changelist, port, method, urlPath, token) {
  const headers = { "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${changelist}` };
  if (token) headers.Authorization = `bearer ${token}`;
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers });
}
const setModes = (backend, modes) => post(backend.port, "/admin/api/matchmaking/config", undefined, { modes });
const regionState = async (changelist, port, token) =>
  (await as(changelist, port, "GET", "/fortnite/api/calendar/v1/timeline", token)).body.channels["client-matchmaking"]?.states[0].state.region;
const ticket = (changelist, port, { accountId, token }, playlist) =>
  as(changelist, port, "GET", `/fortnite/api/game/v2/matchmakingservice/ticket/player/${accountId}?bucketId=${changelist}:0:NA:${playlist}`, token);

test("Shooting Test #1 is 2.4's to 2.5's, off until turned on; solo from 2.4.2, squads on 2.4", () => {
  assert.deepEqual([v23, v24, v242, v25, "3901517"].map(hasShootingTest), [false, true, true, true, false]);
  assert.equal(shootingTestOn(v242, { shootingTest: false }), false);
  assert.equal(shootingTestOn(v242, { shootingTest: true }), true);
  assert.equal(shootingTestOn(v23, { shootingTest: true }), false);
  assert.deepEqual(shootingTestTeams(v24), { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 });
  assert.deepEqual(shootingTestTeams(v242), { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 });
  assert.deepEqual(playlistTeamsOf(`${v25}:0:NA:15`, v25), shootingTestTeams(v25));
  // 2.4.2's parties play alone, as in Solo, whatever their size; 2.4's fill squads.
  const party = (fill, ...players) => ({ players, fill });
  assert.deepEqual(formTeams([party(true, "a", "b"), party(true, "c")], playlistTeamsOf(`${v242}:0:NA:15`, v242)), [[["a"]], [["b"]], [["c"]]]);
  assert.deepEqual(formTeams([party(true, "a", "b"), party(true, "c")], playlistTeamsOf(`${v24}:0:NA:15`, v24)), [[["a", "b"], ["c"]]]);
});

test("each build's hotfix brings its ShootingModel3 to the next build's: 2.4 to 2.4.2's, 2.4.2 to 2.5's", () => {
  assert.deepEqual(shootingTestHotfixTables(v25), []);
  assert.deepEqual(shootingTestHotfixTables(v23), []);
  const [from242] = shootingTestHotfixTables(v24);
  const [from25] = shootingTestHotfixTables(v242);
  assert.equal(from242.table, table);
  assert.equal(from25.table, table);
  const row = (rows, name) => rows.find((entry) => entry.Name === name);
  // 2.4.2's tables: the test's first values (shotguns' headshots at 150%, the Scoped AR falling off to 70%).
  assert.equal(from242.rows.length, 55);
  assert.equal(row(from242.rows, "Shotgun_Standard_Athena_C_Ore_T03").DamageZone_Critical, 1.5);
  assert.equal(row(from242.rows, "Assault_Surgical_Athena_R_Ore_T03").DmgMid, 17.5);
  // 2.5's: 2.4.2's notes' changes, and the Crossbow's rows.
  assert.equal(from25.rows.length, 57);
  assert.equal(row(from25.rows, "Shotgun_Standard_Athena_C_Ore_T03").DamageZone_Critical, 2);
  const scoped = row(from25.rows, "Assault_Surgical_Athena_R_Ore_T03");
  assert.deepEqual([scoped.SpreadDownsights, scoped.DmgPB, scoped.DmgMid, scoped.DmgLong, scoped.DmgMaxRange], [0, 25, 25, 25, 25]);
  assert.ok(row(from25.rows, "Crossbow_Athena_VR_Ore_T03"));
  assert.equal(scoped.Durability, "/Game/Items/Datatables/WeaponDurabilityRarity.WeaponDurabilityRarity");
  assert.equal(scoped.DmgScaleTable, "None");
});

test("the hotfix files turn bShootingTest3Enabled on for 2.4 to 2.5 and carry the table to 2.4 and 2.4.2", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "ShootingFiles");
    const game = async (changelist) => (await as(changelist, backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultGame.ini", token)).body;
    for (const changelist of [v24, v242, v25]) {
      const file = await game(changelist);
      assert.match(file, /\[\/Script\/FortniteGame\.FortGlobals\]\r\nTimeBetweenLeaderboardRequestsMinutes=1\r\nbShootingTest3Enabled=true\r\n/, changelist);
      assert.equal(file.includes(`+DataTable=("${table}",`), changelist !== v25, changelist);
    }
    const file242 = await game(v242);
    // The [AssetHotfix] section comes last, the loot update's line and the weapon table's in it.
    assert.equal(file242.split("[AssetHotfix]").length, 2);
    assert.ok(file242.indexOf("[AssetHotfix]") > file242.indexOf("bCustomKeyEnabled"));
    const line = file242.split("\r\n").find((entry) => entry.startsWith(`+DataTable=("${table}",`));
    const rows = JSON.parse(line.slice(`+DataTable=("${table}","`.length, -2).replace(/\\"/g, "\"").replace(/\\\\/g, "\\"));
    assert.equal(rows.find((entry) => entry.Name === "Assault_Surgical_Athena_VR_Ore_T03").SpreadDownsights, 0);
    assert.doesNotMatch(await game(v23), /ShootingTest|ShootingModel/);
  } finally {
    backend.close();
  }
});

test("the admin panel's toggle offers it through the calendar (Event4 forced on) and lets its tickets through", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "ShootingPlayer");
    // Off: no Event4, and its tickets are refused.
    for (const changelist of [v24, v242, v25]) {
      const regions = await regionState(changelist, backend.port, player.token);
      assert.equal(regions?.NA?.EventFlagsForcedOn, undefined, changelist);
    }
    const refused = await ticket(v242, backend.port, player, 15);
    assert.equal(refused.status, 400);
    assert.equal(refused.body.errorCode, "errors.com.epicgames.fortnite.matchmaking_disabled");

    assert.equal((await setModes(backend, { shootingTest: true })).body.modes.shootingTest, true);
    for (const changelist of [v24, v242, v25]) {
      const regions = await regionState(changelist, backend.port, player.token);
      for (const region of ["NA", "EU", "OCE", "BR", "ASIA"]) assert.deepEqual(regions[region].EventFlagsForcedOn, ["Event4"], `${changelist} ${region}`);
    }
    assert.equal((await ticket(v242, backend.port, player, 15)).status, 200);
    // 2.3 has no such queue.
    assert.equal((await regionState(v23, backend.port, player.token))?.NA?.EventFlagsForcedOn, undefined);
    assert.equal((await ticket(v23, backend.port, player, 15)).status, 400);
    // The other modes stay as they were.
    assert.equal((await ticket(v242, backend.port, player, 2)).status, 200);
  } finally {
    backend.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describeItem } from "../src/admin/describe.js";
import { get, openTunnel, post, send, startBackend, userLogin } from "./helpers.js";

test("the admin panel lists accounts and skips the tutorial", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");

    const page = await get(backend.port, "/admin");
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /^text\/html/);

    const [account] = (await get(backend.port, "/admin/api/accounts")).body;
    assert.deepEqual({ id: account.id, name: account.displayName, done: account.tutorialCompleted }, { id: accountId, name: "CoreTest", done: false });

    const skipped = await post(backend.port, `/admin/api/accounts/${accountId}/skip-tutorial`, undefined, {});
    assert.equal(skipped.status, 200);
    assert.equal(skipped.body.tutorialCompleted, true);
    assert.ok(skipped.body.items.some((item) => item.templateId === "Hero:hid_constructor_rushbase_uc_t01"));
    assert.deepEqual(skipped.body.worldItems.map((item) => item.templateId), ["Weapon:wid_shotgun_standard_uc_ore_t01"]);

    const query = await post(backend.port, `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=profile0&rvn=-1`, token, {});
    const quests = Object.values(query.body.profileChanges[0].profile.items).filter((item) => item.templateId === "Quest:homebaseonboarding");
    assert.equal(quests[0].attributes.quest_state, "Claimed");

    assert.equal((await get(backend.port, "/admin/api/accounts/00000000000000000000000000000000")).status, 404);
  } finally {
    backend.close();
  }
});

test("admin writes need JSON and a local Host, so other sites can't trigger them", async () => {
  const backend = await startBackend();
  try {
    const { accountId } = await userLogin(backend.port, "CoreTest");
    const path = `/admin/api/accounts/${accountId}/skip-tutorial`;

    const form = await send({ host: "127.0.0.1", port: backend.port, method: "POST", path, headers: { "Content-Type": "text/plain" } }, "{}");
    assert.equal(form.status, 415);

    const rebound = await send({ host: "127.0.0.1", port: backend.port, path: "/admin/api/accounts", headers: { Host: "attacker.example" } });
    assert.equal(rebound.status, 403);

    const [account] = (await get(backend.port, "/admin/api/accounts")).body;
    assert.equal(account.tutorialCompleted, false);
  } finally {
    backend.close();
  }
});

test("the client's DevSkipTutorial admin command skips the tutorial for its own account", async () => {
  const backend = await startBackend();
  try {
    const me = await userLogin(backend.port, "CoreTest");
    const other = await userLogin(backend.port, "Other");
    const path = (accountId) => `/fortnite/api/admin/account/${accountId}/profile0/command/DevSkipTutorial?rvn=-1`;

    assert.equal((await post(backend.port, path(other.accountId), me.token, {})).status, 403);
    assert.equal((await post(backend.port, path(me.accountId), undefined, {})).status, 401);

    const host = "fortnite-public-service-prod11.ol.epicgames.com";
    const tunnel = await openTunnel(backend.port, host);
    const response = await send({
      createConnection: () => tunnel,
      method: "POST",
      path: path(me.accountId),
      headers: { Host: host, Authorization: `bearer ${me.token}`, "Content-Type": "application/json" }
    }, "{}");
    assert.equal(response.status, 200);
    assert.equal(response.body.profileId, "profile0");
    const items = Object.values(response.body.profileChanges[0].profile.items);
    assert.ok(items.some((item) => item.templateId === "Quest:homebaseonboardingafteroutpost" && item.attributes.quest_state === "Claimed"));
  } finally {
    backend.close();
  }
});

test("the panel names items as the game does, later builds' items and schematics included (#76)", async () => {
  const name = (templateId) => describeItem(templateId).name;
  // 1.8's heroes, survivors and schematics, which Cert's data hasn't.
  assert.equal(name("Hero:hid_commando_gunheadshothw_vr_t01"), "Skull Trooper Jonesy");
  assert.equal(describeItem("Hero:hid_commando_gunheadshothw_vr_t01").maxLevel, 10);
  assert.equal(name("Hero:hid_outlander_zoneharvesthw_sr_t01"), "Bloodfinder A.C.");
  assert.equal(name("Worker:worker_halloween_troll_sr_t01"), "Troll");
  // A schematic is named after what it crafts, trimmed; one with a name of its own keeps it (Cert's tier names).
  assert.equal(name("Schematic:sid_assault_auto_halloween_sr_ore_t01"), "Grave Digger");
  assert.equal(name("Schematic:sid_assault_auto_c_ore_t00"), "Assault Rifle");
  assert.equal(name("Schematic:sid_floor_spikes_wood_c_t01"), "Wooden Floor Spikes");
  assert.equal(name("Schematic:ammo_bulletsheavy"), "Ammo: Heavy Bullets");
  assert.equal(name("Schematic:sid_launcher_pumpkin_rpg_sr_ore_t01"), "Copper Jack-O-Launcher");
  // Items Cert has keep Cert's names; Battle Royale's cosmetics get theirs.
  assert.equal(name("CardPack:cardpack_melee_tool_c"), "Common Tool Schematic");
  assert.equal(name("Hero:hid_commando_007_r_t01"), "Support Specialist Hawk");
  assert.equal(name("AthenaCharacter:cid_030_athena_commando_m_halloween"), "Skull Trooper");
  assert.equal(name("AthenaGlider:founderglider"), "Founder's Glider");

  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "Names18");
    await post(backend.port, `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=profile0&rvn=-1`, token, {});
    const file = path.join(backend.dataDir, "accounts", accountId, "profiles", "profile0.json");
    const profile = JSON.parse(fs.readFileSync(file, "utf8"));
    profile.items.jonesy = { templateId: "Hero:hid_commando_gunheadshothw_vr_t01", attributes: { level: 1 }, quantity: 1 };
    fs.writeFileSync(file, JSON.stringify(profile));
    const { items } = (await get(backend.port, `/admin/api/accounts/${accountId}`)).body;
    assert.equal(items.find((item) => item.itemId === "jonesy").name, "Skull Trooper Jonesy");
  } finally {
    backend.close();
  }
});

test("the admin panel leaves Core's gameserver accounts out of its player lists (#137)", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "PanelPlayer");
    const server = await userLogin(backend.port, "CoreServer1");
    const listed = (await get(backend.port, "/admin/api/accounts")).body.map((account) => account.id);
    assert.ok(listed.includes(player.accountId));
    assert.ok(!listed.includes(server.accountId), "a gameserver isn't a player");

    const overview = (await get(backend.port, "/admin/api/overview")).body;
    assert.equal(overview.accounts, 1);
    assert.ok(!overview.recentLogins.some((account) => account.id === server.accountId));
    assert.equal((await get(backend.port, `/admin/api/accounts/${server.accountId}`)).status, 200, "still there by id");
  } finally {
    backend.close();
  }
});

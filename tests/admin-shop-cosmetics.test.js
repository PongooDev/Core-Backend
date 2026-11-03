import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { dataBuilds } from "../src/gamedata/read.js";
import { lockerCosmetics } from "../src/profiles/athena.js";
import { soldCosmeticIds } from "../src/store/itemshop.js";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #163: the admin panel's Give all item shop cosmetics: every cosmetic Season 1's, Season 2's and Season 3's shops sold,
// and the custom shop's, that any build has, given as the full locker gives, so Remove granted takes them back.
const agent111 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3807424";

async function athena(port, { accountId, token }) {
  const { body } = await send({
    host: "127.0.0.1", port, method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=athena&rvn=-1`,
    headers: { "User-Agent": agent111, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": 2 }
  }, "{}");
  return [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === "athena").profileChanges[0].profile;
}
const holds = (profile, templateId) => Object.values(profile.items).some((item) => item.templateId.toLowerCase() === templateId.toLowerCase());

test("Give all item shop cosmetics gives what the shops sold, not earned items, and Remove granted takes it back", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "ShopCosmetics");
    const { history } = soldCosmeticIds({});
    const sold = new Set(history.map((id) => id.toLowerCase()));
    const anyBuild = new Set(dataBuilds.flatMap((build) => inBuild(build, lockerCosmetics)).map((id) => id.toLowerCase()));

    // The custom shop lists one cosmetic no history sold, and a Battle Pass reward and a victory umbrella, never sold.
    const battlePass = inBuild("3807424", () => athenaSeason().bookPaidRewards.flatMap(({ rewards }) => rewards)
      .map(({ templateId }) => templateId).find((id) => id.toLowerCase().startsWith("athenacharacter:")));
    const custom = Object.keys(inBuild("3807424", athenaCosmetics)).find((id) => id.toLowerCase().startsWith("athenadance:emoji_")
      && !sold.has(id.toLowerCase()) && anyBuild.has(id.toLowerCase()));
    assert.ok(battlePass && custom);
    const saved = await post(backend.port, "/admin/api/shop", undefined,
      { mode: "fnbr", custom: { featured: [[custom, 1500], [battlePass, 1500]], daily: [["AthenaGlider:solo_umbrella", 500], ["AthenaDance:eid_gunshow", 100]] } });
    assert.equal(saved.status, 200);

    const given = await post(backend.port, `/admin/api/accounts/${player.accountId}/cosmetics/grant-shop`, undefined, {});
    assert.equal(given.status, 200, JSON.stringify(given.body));
    const { granted, alreadyOwned, total } = given.body.shopGrant;
    const expected = history.filter((id) => anyBuild.has(id.toLowerCase())).length + 1;
    assert.equal(total, expected);
    assert.equal(granted + alreadyOwned, total);
    assert.ok(granted > 60);
    assert.equal(given.body.locker.granted, granted);

    const profile = await athena(backend.port, player);
    // Season 1's Skull Trooper, Season 2's Red-Nosed Raider, the Warthog Season 2's shop sold, and the custom shop's item.
    for (const id of ["AthenaCharacter:cid_030_athena_commando_m_halloween", "AthenaCharacter:cid_047_athena_commando_f_holidayreindeer",
      "AthenaGlider:glider_warthog", custom]) {
      if (anyBuild.has(id.toLowerCase())) assert.ok(holds(profile, id), id);
    }
    // Not the Battle Pass's, a victory umbrella, the consumable emote (#161), or what the shop never sold.
    for (const id of [battlePass, "AthenaGlider:solo_umbrella", "AthenaDance:eid_gunshow", "AthenaGlider:umbrella_gold"]) {
      assert.ok(!holds(profile, id), id);
    }

    // Again: nothing new.
    const again = await post(backend.port, `/admin/api/accounts/${player.accountId}/cosmetics/grant-shop`, undefined, {});
    assert.deepEqual(again.body.shopGrant, { granted: 0, alreadyOwned: total, total });

    // Remove granted takes them back; the starters stay.
    const removed = await post(backend.port, `/admin/api/accounts/${player.accountId}/locker/remove-granted`, undefined, {});
    assert.equal(removed.status, 200);
    assert.equal(removed.body.removed.cosmetics, granted);
    const after = await athena(backend.port, player);
    assert.ok(!holds(after, "AthenaCharacter:cid_030_athena_commando_m_halloween") && !holds(after, custom));
    assert.ok(holds(after, "AthenaGlider:defaultglider"));
    assert.equal((await get(backend.port, `/admin/api/accounts/${player.accountId}`)).body.locker.granted, 0);
  } finally {
    backend.close();
  }
});

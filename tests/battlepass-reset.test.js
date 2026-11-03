import { test } from "node:test";
import assert from "node:assert/strict";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #201: the admin panel's Battle Pass reset, back to before the player bought it; #202: 3.0's Battle Pass
// purchase screen, a GiftBox:GB_BattlePass of what the purchase gave.
const agent30 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-3.0-CL-3901517";
const agent25 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-2.5-CL-3889387";

function command(port, { accountId, token }, name, profileId, body = {}, agent = agent30) {
  const text = JSON.stringify(body);
  return send({
    host: "127.0.0.1", port, method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`,
    headers: { "User-Agent": agent, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }
  }, text);
}
const profileOf = (body, profileId) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === profileId);
const athena = async (port, player, agent) => profileOf((await command(port, player, "QueryProfile", "athena", {}, agent)).body, "athena").profileChanges[0].profile;
const vbucks = async (port, player) => {
  const { body } = await get(port, `/admin/api/accounts/${player.accountId}`);
  return body.currencies.find((currency) => currency.key === "vbucks").quantity;
};
const held = (profile, templateId) => Object.values(profile.items).some((item) => item.templateId.toLowerCase() === templateId.toLowerCase());
const mission = "AthenaCharacter:cid_080_athena_commando_m_space";

test("3.0's Battle Pass purchase gives a GiftBox:GB_BattlePass of its rewards, which RemoveGiftBox takes away; 2.5's gives none", async () => {
  const backend = await startBackend();
  try {
    for (const [agent, name] of [[agent30, "GiftBox30"], [agent25, "GiftBox25"]]) {
      const player = await userLogin(backend.port, name);
      await athena(backend.port, player, agent);
      assert.equal((await post(backend.port, `/admin/api/accounts/${player.accountId}/currency`, undefined, { key: "vbucks", quantity: 5000 })).status, 200);
      const offerId = agent === agent30 ? "core_br_season3_battlepass" : "C3BA14F04F4D56FC1D490F8011B56553";
      const bought = await command(backend.port, player, "PurchaseCatalogEntry", "profile0",
        { offerId, purchaseQuantity: 1, currency: "MtxCurrency", expectedPrice: 950 }, agent);
      assert.equal(bought.status, 200, JSON.stringify(bought.body));
      assert.equal(bought.body.notifications[0].type, "CatalogPurchase");
      const profile = await athena(backend.port, player, agent);
      const boxes = Object.entries(profile.items).filter(([, item]) => item.templateId.toLowerCase().startsWith("giftbox:"));
      if (agent === agent25) {
        assert.equal(boxes.length, 0);
        continue;
      }
      assert.equal(boxes.length, 1);
      const [boxId, box] = boxes[0];
      assert.equal(box.templateId, "GiftBox:gb_battlepass");
      assert.equal(box.attributes.fromAccountId, "");
      // The Mission Specialist in it is what plays the client's "Battle Pass UPGRADED!" animation.
      assert.ok(box.attributes.lootList.some((loot) => loot.itemType === mission && loot.itemProfile === "athena"));
      assert.deepEqual(box.attributes.lootList, bought.body.notifications[0].lootResult.items);
      const removed = await command(backend.port, player, "RemoveGiftBox", "athena", { giftBoxItemId: boxId });
      assert.equal(removed.status, 200);
      assert.equal((await athena(backend.port, player)).items[boxId], undefined);
    }
  } finally {
    backend.close();
  }
});

test("the admin panel resets a season's Battle Pass to before it was bought, taking back its rewards and refunding what Core was paid", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "PassReset");
    const reset = (body) => post(backend.port, `/admin/api/accounts/${player.accountId}/battle-pass/reset`, undefined, body);
    const none = await reset({});
    assert.equal(none.status, 400);
    assert.match(none.body.errorMessage, /no Battle Royale profile/);

    await athena(backend.port, player);
    assert.equal((await post(backend.port, `/admin/api/accounts/${player.accountId}/currency`, undefined, { key: "vbucks", quantity: 5000 })).status, 200);
    // The bundle: the pass and 25 tiers, whose V-Bucks (tiers 4, 11, 18 and 19) and season XP go back on the reset.
    const bought = await command(backend.port, player, "PurchaseCatalogEntry", "profile0",
      { offerId: "core_br_season3_battlebundle", purchaseQuantity: 1, currency: "MtxCurrency", expectedPrice: 2800 });
    assert.equal(bought.status, 200, JSON.stringify(bought.body));
    let profile = await athena(backend.port, player);
    assert.equal(profile.stats.attributes.book_purchased, true);
    assert.equal(profile.stats.attributes.book_level, 26);
    assert.ok(held(profile, mission));
    assert.equal(await vbucks(backend.port, player), 5000 - 2800 + 400);

    const { body: details } = await get(backend.port, `/admin/api/accounts/${player.accountId}`);
    assert.deepEqual(details.battleRoyale.battlePasses.find((pass) => pass.season === 3), { season: 3, tier: 26, purchased: true, paid: 2800 });
    assert.equal((await reset({ season: 1 })).status, 400);

    const done = await reset({});
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.battlePassReset.season, 3);
    assert.equal(done.body.battlePassReset.refunded, 2800);
    assert.equal(done.body.battlePassReset.vbucksTaken, 400);
    assert.ok(done.body.battlePassReset.cosmetics.includes(mission));
    profile = await athena(backend.port, player);
    const { attributes } = profile.stats;
    assert.deepEqual([attributes.book_purchased, attributes.book_level, attributes.book_xp, attributes.season_match_boost,
      attributes.season_friend_match_boost], [false, 1, 0, 0, 0]);
    assert.equal(attributes.level, 1, "the season XP the tiers gave is taken back");
    assert.ok(!held(profile, mission));
    assert.ok(!Object.values(profile.items).some((item) => item.templateId.toLowerCase().startsWith("giftbox:")));
    // The season's own weekly challenges stay: every player has them.
    assert.ok(held(profile, "ChallengeBundleSchedule:season3_challenge_schedule") || !held(profile, "ChallengeBundleSchedule:season3_tier_100_schedule"));
    assert.equal(await vbucks(backend.port, player), 5000);
    assert.equal(done.body.battleRoyale.battlePasses.find((pass) => pass.season === 3).paid, 0);

    // The pass can be bought again.
    const again = await command(backend.port, player, "PurchaseCatalogEntry", "profile0",
      { offerId: "core_br_season3_battlepass", purchaseQuantity: 1, currency: "MtxCurrency", expectedPrice: 950 });
    assert.equal(again.status, 200, JSON.stringify(again.body));
  } finally {
    backend.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { rollContents, rollOptions } from "../src/cardpacks/contents.js";
import { pool, vindertechSchematics } from "../src/cardpacks/pools.js";
import { fortnitemares, hasEventEnded, mutantStorms } from "../src/events/events.js";
import { getCardPack } from "../src/gamedata/items.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #129, 1.9.1's Mutant Storms: the Vindertech Llama for Storm Tickets, the Vindertech packs' weapons, and
// unspent Fortnitemares Candy turned into Fortnitemares Llamas.
const builds = { "1.7.2": "3700114", "1.8": "3724489", "1.9": "3757339", "1.9.1": "3775276" };
const agent = (changelist) => `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${changelist}`;
const candy = "AccountResource:eventcurrency_candy";
const tickets = "AccountResource:eventcurrency_stormzone";
const halloweenLlama = "CardPack:cardpack_event_2017_halloween";
const vindertechLlama = "CardPack:cardpack_event_vindertech";

function as(changelist, port, method, urlPath, token, body) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": agent(changelist), Authorization: `bearer ${token}` };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
}
const mcp = (changelist, port, { accountId, token }, name, body = {}) =>
  as(changelist, port, "POST", `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`, token, body);
const profileOf = (response) => [response.body, ...(response.body.multiUpdate ?? [])].find((update) => update.profileId === "profile0")
  .profileChanges.find((change) => change.changeType === "fullProfileUpdate").profile;
const held = (profile, templateId) => Object.values(profile.items).filter((item) => item.templateId === templateId)
  .reduce((sum, item) => sum + item.quantity, 0);

function editProfile(backend, accountId, edit) {
  const file = path.join(backend.dataDir, "accounts", accountId, "profiles", "profile0.json");
  const profile = JSON.parse(fs.readFileSync(file, "utf8"));
  edit(profile);
  fs.writeFileSync(file, JSON.stringify(profile));
}

const isVindertech = (templateId) => /^Schematic:sid_[a-z_]+_vt_(vr|sr)_(ore|crystal)_t0\d$/.test(templateId);

test("Fortnitemares has ended on 1.9.1 only; the Mutant Storms haven't ended anywhere", () => {
  assert.equal(hasEventEnded(fortnitemares, builds["1.9.1"]), true);
  for (const changelist of [builds["1.7.2"], builds["1.8"], builds["1.9"]]) assert.equal(hasEventEnded(fortnitemares, changelist), false, changelist);
  for (const changelist of Object.values(builds)) assert.equal(hasEventEnded(mutantStorms, changelist), false, changelist);
});

test("each Vindertech weapon pack holds its own Vindertech weapon at its rarity", () => {
  inBuild(builds["1.9.1"], () => {
    const packs = ["assault_auto", "blunt_hammer_rocket", "edged_axe", "edged_sword_medium", "pistol_autoheavy", "pistol_handcannon_semi",
      "pistol_handcannon", "shotgun_standard", "sniper_standard_scope"];
    for (const weapon of packs) {
      for (const rarity of ["vr", "sr"]) {
        const templateId = `CardPack:cardpack_vindertech_${weapon}_${rarity}`;
        if (!getCardPack(templateId)) continue;
        for (let roll = 0; roll < 5; roll++) {
          assert.deepEqual(rollContents(templateId), [{ templateId: `Schematic:sid_${weapon}_vt_${rarity}_ore_t01`, quantity: 1 }], templateId);
        }
      }
    }
    // pistol_handcannon_vt has no Epic version; its pack is the Legendary one.
    assert.ok(getCardPack("CardPack:cardpack_vindertech_pistol_handcannon_sr"));
    assert.equal(vindertechSchematics("vr").length, 8);
    assert.equal(vindertechSchematics("sr").length, 9);
  });
});

test("the Vindertech Llama holds an Upgrade Llama's items and an Epic or Legendary Vindertech weapon", () => {
  inBuild(builds["1.9.1"], () => {
    for (let roll = 0; roll < 30; roll++) {
      const contents = rollContents(vindertechLlama).map((item) => item.templateId);
      assert.ok(contents.length >= 5, String(contents));
      assert.equal(contents.filter(isVindertech).length, 1, String(contents));
    }
  });
});

test("the Vindertech choice packs offer two different Vindertech weapons of their rarity", () => {
  inBuild(builds["1.9.1"], () => {
    for (const rarity of ["vr", "sr"]) {
      for (let roll = 0; roll < 10; roll++) {
        const options = rollOptions(`CardPack:cardpack_choice_vindertech_${rarity}`).map((option) => option.itemType);
        assert.equal(options.length, 2);
        assert.notEqual(options[0], options[1]);
        for (const option of options) assert.match(option, new RegExp(`_vt_${rarity}_`));
      }
    }
  });
});

test("other packs don't give the Vindertech weapons", () => {
  inBuild(builds["1.9.1"], () => {
    for (const rarity of ["vr", "sr"]) {
      for (const kind of ["ranged", "melee", "schematic"]) assert.ok(!pool(kind, null, rarity).some(isVindertech), `${kind} ${rarity}`);
    }
  });
  // 1.9 already ships them (and their packs); 1.8 has none.
  inBuild(builds["1.8"], () => assert.deepEqual(vindertechSchematics("sr"), []));
});

test("1.9.1's llama store sells the Vindertech Llama for Storm Tickets; other builds don't", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Vinder191");
    const catalog = async (changelist) => (await as(changelist, backend.port, "GET", "/fortnite/api/storefront/v2/catalog", player.token)).body
      .storefronts.find((front) => front.name === "CardPackStore").catalogEntries;
    const offer = (await catalog(builds["1.9.1"])).find((entry) => entry.offerId === "core_event_vindertech_llama");
    assert.deepEqual(offer.prices.map(({ currencyType, currencySubType, finalPrice }) => [currencyType, currencySubType, finalPrice]),
      [["GameItem", tickets, 1000]]);
    assert.deepEqual(offer.itemGrants, [{ templateId: vindertechLlama, quantity: 1 }]);
    assert.equal(offer.metaAssetInfo.payload.packDefinition, "/Game/Items/CardPacks/Events/Release/CardPack_Event_Vindertech.CardPack_Event_Vindertech");
    for (const changelist of [builds["1.7.2"], builds["1.8"], builds["1.9"]]) {
      assert.ok(!(await catalog(changelist)).some((entry) => entry.offerId === "core_event_vindertech_llama"), changelist);
    }
    // Fortnitemares' llama is gone from 1.9.1's store.
    assert.ok(!(await catalog(builds["1.9.1"])).some((entry) => entry.offerId === "core_event_fortnitemares_llama"));

    const purchase = { offerId: "core_event_vindertech_llama", purchaseQuantity: 1, currency: "GameItem", currencySubType: tickets, expectedPrice: 1000 };
    await mcp(builds["1.9.1"], backend.port, player, "QueryProfile");
    const poor = await mcp(builds["1.9.1"], backend.port, player, "PurchaseCatalogEntry", purchase);
    assert.equal(poor.body.errorCode, "errors.com.epicgames.modules.gamesubcatalog.purchase_not_allowed");

    editProfile(backend, player.accountId, (profile) => {
      profile.items["ticket-stack"] = { templateId: tickets, attributes: { level: 1, item_seen: 0 }, quantity: 1250 };
    });
    const bought = await mcp(builds["1.9.1"], backend.port, player, "PurchaseCatalogEntry", purchase);
    assert.equal(bought.status, 200);
    assert.deepEqual(bought.body.notifications[0].lootResult.items.map((item) => item.itemType), [vindertechLlama]);
    const profile = profileOf(await mcp(builds["1.9.1"], backend.port, player, "QueryProfile"));
    assert.equal(held(profile, tickets), 250);
    assert.equal(held(profile, vindertechLlama), 1);
  } finally {
    backend.close();
  }
});

test("1.9.1 turns each 500 unspent Candy into a Fortnitemares Llama in the loot tab, once; 1.9 keeps the Candy", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Candy191");
    await mcp(builds["1.9"], backend.port, player, "QueryProfile");
    editProfile(backend, player.accountId, (profile) => {
      profile.items["candy-a"] = { templateId: candy, attributes: { level: 1, item_seen: 0 }, quantity: 1000 };
      profile.items["candy-b"] = { templateId: candy, attributes: { level: 1, item_seen: 0 }, quantity: 320 };
    });

    // The event still runs on 1.9: nothing changes.
    let profile = profileOf(await mcp(builds["1.9"], backend.port, player, "QueryProfile"));
    assert.equal(held(profile, candy), 1320);
    assert.equal(held(profile, halloweenLlama), 0);

    profile = profileOf(await mcp(builds["1.9.1"], backend.port, player, "QueryProfile"));
    assert.equal(held(profile, candy), 320);
    assert.equal(held(profile, halloweenLlama), 2);
    const llamas = Object.values(profile.items).filter((item) => item.templateId === halloweenLlama);
    assert.ok(llamas.every((item) => item.attributes.pack_source === "Store"), "opened from the loot tab");

    // Again: the 320 left over isn't enough for another.
    await mcp(builds["1.9.1"], backend.port, player, "ClientQuestLogin");
    profile = profileOf(await mcp(builds["1.9.1"], backend.port, player, "QueryProfile"));
    assert.equal(held(profile, candy), 320);
    assert.equal(held(profile, halloweenLlama), 2);

    // The ClientQuestLogin converts too.
    editProfile(backend, player.accountId, (account) => {
      account.items["candy-c"] = { templateId: candy, attributes: { level: 1, item_seen: 0 }, quantity: 180 };
    });
    await mcp(builds["1.9.1"], backend.port, player, "ClientQuestLogin");
    profile = profileOf(await mcp(builds["1.9"], backend.port, player, "QueryProfile"));
    assert.equal(held(profile, candy), 0);
    assert.equal(held(profile, halloweenLlama), 3);
  } finally {
    backend.close();
  }
});

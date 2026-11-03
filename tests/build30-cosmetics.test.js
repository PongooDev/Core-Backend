import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { splitOffBackpacks } from "../src/gamedata/athena.js";
import { athenaNeedsSetUp, athenaQuestLogin, grantCosmetic, seasonRewardFunctions, setUpAthena } from "../src/profiles/athena.js";
import { findItem } from "../src/profiles/items.js";
import { grant } from "../src/profiles/progress.js";
import { addBookXp, takeUpSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// 3.0 (CL-3901517): the back blings it split off outfits (Core-Backend #203), BulkEquipBattleRoyaleCustomization and the
// contrail slot (#204), the gift box of the tiers reached (#205) and the Battle Pass Promise (#206).
const v30 = "3901517";
const v25 = "3889387";
const agent30 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-3.0-CL-3901517";

function withStore(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build30-cosmetics-"));
  try {
    return run(createProfileStore(dataDir));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
const giftBoxes = (profile) => Object.values(profile.items).filter((item) => item.templateId.toLowerCase().startsWith("giftbox:"));

test("3.0 gives the owners of Season 1 and 2 outfits the back blings it split off them, from the game data", () => withStore((store) => {
  // The game data's link: the part the outfit's hero wore on 2.5 is the back bling's on 3.0, or else its name.
  const expected = { "AthenaCharacter:cid_032_athena_commando_m_medieval": "AthenaBackpack:bid_001_bluesquire",
    "AthenaCharacter:cid_053_athena_commando_m_skidude": "AthenaBackpack:bid_006_skidude",
    "AthenaCharacter:cid_062_athena_commando_f_skigirl_usa": "AthenaBackpack:bid_015_skigirl_usa",
    "AthenaCharacter:cid_031_athena_commando_m_retro": "AthenaBackpack:bid_005_raptor",
    "AthenaCharacter:cid_070_athena_commando_m_cupid": "AthenaBackpack:bid_022_cupid" };
  for (const [outfit, backpack] of Object.entries(expected)) {
    assert.deepEqual(inBuild(v30, () => splitOffBackpacks(outfit)), [backpack], outfit);
    assert.deepEqual(inBuild(v25, () => splitOffBackpacks(outfit)), [], `2.5 still wears ${outfit}'s built in`);
  }
  assert.deepEqual(inBuild(v30, () => splitOffBackpacks("AthenaCharacter:cid_080_athena_commando_m_space")), []);

  // Bought on 2.5: no back bling there; the next 3.0 login gives it.
  const squire = "AthenaCharacter:cid_032_athena_commando_m_medieval";
  inBuild(v25, () => {
    const session = openSession(store, "squire");
    setUpAthena(session);
    grantCosmetic(session, squire);
    assert.equal(findItem(session.profile("athena").profile, "AthenaBackpack:bid_001_bluesquire"), undefined);
    assert.equal(athenaNeedsSetUp(session.profile("athena").profile), false);
    session.commit();
  });
  inBuild(v30, () => {
    // The profile is set up as 3.0 opens it (profiles/setup.js).
    const session = openSession(store, "squire");
    assert.ok(findItem(session.profile("athena").profile, "AthenaBackpack:bid_001_bluesquire"));
    assert.equal(athenaNeedsSetUp(session.profile("athena").profile), false);
    // Bought on 3.0: the back bling comes with it.
    grantCosmetic(session, "AthenaCharacter:cid_061_athena_commando_f_skigirl");
    assert.ok(findItem(session.profile("athena").profile, "AthenaBackpack:bid_014_skigirl"));
  });
}));

test("3.0's tiers reached through Battle Stars come in a GiftBox:GB_BattlePass; 2.5's in none", () => withStore((store) => {
  for (const build of [v30, v25]) {
    inBuild(build, () => {
      const session = openSession(store, `tiers${build}`);
      setUpAthena(session);
      takeUpSeason(session);
      addBookXp(session, 50, seasonRewardFunctions());
      const boxes = giftBoxes(session.profile("profile0").profile);
      assert.equal(giftBoxes(session.profile("athena").profile).length, 0, "gift boxes are profile0's (#212)");
      if (build === v25) return assert.equal(boxes.length, 0);
      assert.equal(session.profile("athena").profile.stats.attributes.book_level, 6);
      assert.equal(boxes.length, 1);
      assert.equal(boxes[0].templateId, "GiftBox:gb_battlepass");
      // Free tier 6: the BRSeason03 donut banner.
      assert.ok(boxes[0].attributes.lootList.some((loot) => loot.itemType.toLowerCase() === "homebasebannericon:brseason03donut"));
    });
  }
}));

test("3.0's Battle Pass Promise: a Season 2 pass's Free Tiers token becomes 5 tiers, once, with its gift box", () => withStore((store) => {
  inBuild(v30, () => {
    const session = openSession(store, "promise");
    setUpAthena(session);
    takeUpSeason(session);
    grant(session, "Token:athenanextseasontierboost", 5);
    athenaQuestLogin(session);
    const athena = session.profile("athena").profile;
    assert.equal(athena.stats.attributes.book_level, 6);
    assert.equal(findItem(session.profile("profile0").profile, "Token:athenanextseasontierboost"), undefined);
    const promise = giftBoxes(session.profile("profile0").profile).find((item) => item.templateId === "GiftBox:gb_battlepasspromise");
    assert.deepEqual(promise.attributes.lootList.map(({ itemType, quantity }) => [itemType, quantity]), [["AccountResource:athenaseasonalbp", 50]]);
    athenaQuestLogin(session);
    assert.equal(athena.stats.attributes.book_level, 6, "once a season");

    // A pass bought before 2.2 put the token in its tier 2: the Season 2 record counts.
    const old = openSession(store, "promise-old");
    setUpAthena(old);
    takeUpSeason(old);
    old.profile("athena").profile.coreSeasons = { 2: { level: 10, xp: 0, book_level: 20, book_xp: 0, book_purchased: true } };
    athenaQuestLogin(old);
    assert.equal(old.profile("athena").profile.stats.attributes.book_level, 6);

    const none = openSession(store, "promise-none");
    setUpAthena(none);
    takeUpSeason(none);
    athenaQuestLogin(none);
    assert.equal(none.profile("athena").profile.stats.attributes.book_level, 1);
  });
}));

test("a gift box left in the athena profile moves to profile0, where 3.0 looks for them (#212)", () => withStore((store) => {
  inBuild(v30, () => {
    const session = openSession(store, "oldbox");
    session.profile("profile0");
    setUpAthena(session);
    const box = { templateId: "GiftBox:gb_battlepass", attributes: { fromAccountId: "", lootList: [], params: {}, giftedOn: "2026-11-03T20:30:00.000Z" }, quantity: 1 };
    session.profile("athena").addItem("old-box", box);
    session.commit();
    assert.equal(athenaNeedsSetUp(store.load("oldbox", "athena")), true);

    const next = openSession(store, "oldbox");
    assert.equal(next.profile("athena").profile.items["old-box"], undefined);
    assert.deepEqual(next.profile("profile0").profile.items["old-box"], box);
    assert.equal(athenaNeedsSetUp(next.profile("athena").profile), false);
  });
}));

test("3.0's locker equips several slots at once (BulkEquipBattleRoyaleCustomization), contrails among them", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "BulkEquip");
    const command = (name, body = {}) => {
      const text = JSON.stringify(body);
      return send({
        host: "127.0.0.1", port: backend.port, method: "POST",
        path: `/fortnite/api/game/v2/profile/${player.accountId}/client/${name}?profileId=athena&rvn=-1`,
        headers: { "User-Agent": agent30, Authorization: `bearer ${player.token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }
      }, text);
    };
    await command("QueryProfile");
    const outfit = "AthenaCharacter:cid_032_athena_commando_m_medieval";
    const contrail = "AthenaSkyDiveContrail:trails_id_001_disco";
    const given = await post(backend.port, `/admin/api/accounts/${player.accountId}/cosmetics/grant`, undefined, { build: v30, templateIds: [outfit, contrail] });
    assert.equal(given.status, 200, JSON.stringify(given.body));
    const equipped = await command("BulkEquipBattleRoyaleCustomization", { loadoutData: [
      { slotName: "Character", itemToSlot: outfit, indexWithinSlot: 0 },
      { slotName: "Backpack", itemToSlot: "AthenaBackpack:bid_001_bluesquire", indexWithinSlot: 0 },
      { slotName: "SkyDiveContrail", itemToSlot: contrail, indexWithinSlot: 0 }] });
    assert.equal(equipped.status, 200, JSON.stringify(equipped.body));
    const { attributes } = (await command("QueryProfile")).body.profileChanges[0].profile.stats;
    assert.deepEqual([attributes.favorite_character, attributes.favorite_backpack, attributes.favorite_skydivecontrail].map((id) => id.toLowerCase()),
      [outfit, "AthenaBackpack:bid_001_bluesquire", contrail].map((id) => id.toLowerCase()));
    assert.equal((await command("BulkEquipBattleRoyaleCustomization", {})).status, 400);
  } finally {
    backend.close();
  }
});

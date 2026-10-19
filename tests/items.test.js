import { test } from "node:test";
import assert from "node:assert/strict";
import { getItem } from "../src/gamedata/items.js";
import { trackChanges } from "../src/profiles/changes.js";
import { grantItem } from "../src/profiles/items.js";

function memorySession() {
  const trackers = {};
  return {
    trackers,
    profile(profileId) {
      trackers[profileId] ??= trackChanges({ profileId, stats: { attributes: { collection_book: { pages: [], maxBookXpLevelAchieved: 0 } } }, items: {} });
      return trackers[profileId];
    }
  };
}

test("item data routes account items to profile0 and world items to theater0", () => {
  const hero = getItem("Hero:hid_constructor_rushbase_uc_t01");
  assert.deepEqual([hero.class, hero.profile, hero.maxStackSize, hero.tier], ["FortHeroType", "profile", 1, "I"]);
  const shotgun = getItem("weapon:WID_Shotgun_Standard_UC_Ore_T01");
  assert.deepEqual([shotgun.templateId, shotgun.class, shotgun.profile], ["Weapon:wid_shotgun_standard_uc_ore_t01", "FortWeaponRangedItemDefinition", "theater"]);
  assert.equal(getItem("Currency:mtxgiveaway").maxStackSize, 999999);
});

test("stackable rewards stack up to their limit and unique ones become separate items", () => {
  const session = memorySession();
  grantItem(session, "Currency:mtxgiveaway", 999990);
  grantItem(session, "Currency:mtxgiveaway", 50);
  grantItem(session, "Schematic:ingredient_duct_tape", 2);
  grantItem(session, "Token:homebasepoints", 0);

  const items = Object.values(session.trackers.profile0.profile.items);
  assert.deepEqual(items.filter((item) => item.templateId === "Currency:mtxgiveaway").map((item) => item.quantity), [999999]);
  assert.deepEqual(items.filter((item) => item.templateId === "Schematic:ingredient_duct_tape").map((item) => item.quantity), [1, 1]);
  assert.equal(items.some((item) => item.templateId === "Token:homebasepoints"), false);
  assert.deepEqual(Object.keys(session.trackers), ["profile0"]);
});

test("collection book pages are unlocked once and unknown items are skipped", () => {
  const session = memorySession();
  grantItem(session, "CollectionBookPage:pageheroes_commando", 1);
  grantItem(session, "CollectionBookPage:PageHeroes_Commando", 1);
  grantItem(session, "Hero:does_not_exist", 1);
  assert.deepEqual(session.trackers.profile0.profile.stats.attributes.collection_book.pages, ["pageheroes_commando"]);
  assert.deepEqual(session.trackers.profile0.profile.items, {});
});

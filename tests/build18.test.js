import { test } from "node:test";
import assert from "node:assert/strict";
import { athenaCosmetics } from "../src/gamedata/athena.js";
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

const athenaOf = (body) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === "athena");
const athenaProfile = async (port, player) => {
  const response = await command(port, player, "QueryProfile", "athena");
  assert.equal(response.status, 200);
  return athenaOf(response.body).profileChanges[0].profile;
};

// The starter cosmetics a new locker holds (Core-Backend #77); the rest are bought or earned.
// No Recruit outfits (CID_001-008): an empty character slot plays one at random (#77).
const starters = ["AthenaGlider:defaultglider", "AthenaPickaxe:defaultpickaxe", "AthenaDance:eid_dancemoves",
  "AthenaLoadingScreen:lsid_defaultbg", "AthenaBattleBus:bbid_defaultbus", "AthenaGlider:founderglider"];

test("1.8's login queries the athena profile: the starter cosmetics, the default glider and pickaxe equipped, the other slots empty for their defaults", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Athena18");
    const profile = await athenaProfile(backend.port, player);
    // Each cosmetic under its template id as item id.
    assert.deepEqual(Object.keys(profile.items).sort(), [...starters].sort());
    for (const templateId of starters) assert.equal(profile.items[templateId].templateId, templateId);
    const attributes = profile.stats.attributes;
    assert.equal(attributes.level, 1);
    assert.equal(attributes.accountLevel, 1);
    for (const slot of ["character", "hat", "backpack", "loadingscreen", "battlebus", "dance", "victorypose"]) {
      assert.equal(attributes[`favorite_${slot}`], "", slot);
    }
    // The glider and pickaxe hold the defaults: an empty glider crashed the client loading into a match (#74).
    assert.equal(attributes.favorite_glider, "AthenaGlider:defaultglider");
    assert.equal(attributes.favorite_pickaxe, "AthenaPickaxe:defaultpickaxe");
  } finally {
    backend.close();
  }
});

test("with giveAllCosmetics on, the locker holds every Battle Royale cosmetic of the build but the random Recruits", async () => {
  const backend = await startBackend({ giveAllCosmetics: true });
  try {
    const profile = await athenaProfile(backend.port, await userLogin(backend.port, "AllCosmetics18"));
    // The test characters (00_TestAssets) aren't among them.
    const cosmetics = Object.keys(athenaCosmetics());
    assert.ok(cosmetics.length >= 70);
    assert.ok(!cosmetics.some((templateId) => templateId.includes("cid_test")));
    // The Recruit outfits (CID_001-008) are never locker items: an empty character slot plays one at random (#77).
    const recruit = (templateId) => /cid_00[1-8]_athena_commando_[fm]_default$/.test(templateId);
    assert.equal(cosmetics.filter(recruit).length, 8);
    assert.deepEqual(Object.keys(profile.items).sort(), cosmetics.filter((templateId) => !recruit(templateId)).sort());
    for (const templateId of ["AthenaCharacter:cid_029_athena_commando_f_halloween", "AthenaPickaxe:halloweenscythe", "AthenaGlider:glider_warthog",
      "AthenaVictoryPose:eid_ridethepony", "AthenaLoadingScreen:lsid_fiercecloudpuff", "AthenaBattleBus:bbid_purplebus"]) {
      assert.equal(profile.items[templateId]?.templateId, templateId);
    }
  } finally {
    backend.close();
  }
});

test("the Battle Royale locker equips a cosmetic per slot (EquipBattleRoyaleCustomization) and takes it off again", async () => {
  const backend = await startBackend({ giveAllCosmetics: true });
  try {
    const player = await userLogin(backend.port, "Locker18");
    await athenaProfile(backend.port, player);
    const equip = (slotName, itemToSlot) => command(backend.port, player, "EquipBattleRoyaleCustomization", "athena", { slotName, itemToSlot });

    const ghoul = "AthenaCharacter:cid_029_athena_commando_f_halloween";
    const equipped = await equip("Character", ghoul);
    assert.equal(equipped.status, 200);
    assert.equal(athenaOf(equipped.body).profileChanges[0].profile.stats.attributes.favorite_character, ghoul);
    assert.equal((await equip("EAthenaCustomizationCategory::Glider", "AthenaGlider:glider_warthog")).status, 200);
    assert.equal((await equip("Pickaxe", "athenapickaxe:HalloweenScythe")).status, 200);

    // An item of another slot's type, one the player hasn't, or no such slot: refused, nothing changes.
    assert.equal((await equip("Glider", ghoul)).body.errorCode, "errors.com.epicgames.fortnite.invalid_parameter");
    assert.equal((await equip("Character", "AthenaCharacter:cid_999")).body.errorCode, "errors.com.epicgames.fortnite.item_not_found");
    assert.equal((await equip("Wrap", ghoul)).body.errorCode, "errors.com.epicgames.fortnite.invalid_parameter");

    let attributes = (await athenaProfile(backend.port, player)).stats.attributes;
    assert.deepEqual([attributes.favorite_character, attributes.favorite_glider, attributes.favorite_pickaxe],
      [ghoul, "AthenaGlider:glider_warthog", "AthenaPickaxe:halloweenscythe"]);

    // "" is the slot's default.
    assert.equal((await equip("Character", "")).status, 200);
    attributes = (await athenaProfile(backend.port, player)).stats.attributes;
    assert.equal(attributes.favorite_character, "");
    assert.equal(attributes.favorite_glider, "AthenaGlider:glider_warthog");
    // Unequipping the glider puts the default glider back, never an empty one (#74).
    assert.equal((await equip("Glider", "")).status, 200);
    assert.equal((await athenaProfile(backend.port, player)).stats.attributes.favorite_glider, "AthenaGlider:defaultglider");
  } finally {
    backend.close();
  }
});

test("the Battle Royale banner (SetBattleRoyaleBanner) is one the player owns, kept in athena apart from the homebase's", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Banner18");
    const account = (await command(backend.port, player, "QueryProfile", "profile0")).body.profileChanges[0].profile;
    const owned = (type) => Object.values(account.items).map((item) => item.templateId).filter((id) => id.startsWith(`${type}:`)).map((id) => id.split(":")[1]);
    const [icon] = owned("HomebaseBannerIcon").filter((row) => row !== account.stats.attributes.homebase.bannerIconId);
    const [, color] = owned("HomebaseBannerColor");
    assert.ok(icon && color);

    const set = (homebaseBannerIconId, homebaseBannerColorId) =>
      command(backend.port, player, "SetBattleRoyaleBanner", "athena", { homebaseBannerIconId, homebaseBannerColorId });
    assert.equal((await set(icon, color)).status, 200);
    const attributes = (await athenaProfile(backend.port, player)).stats.attributes;
    assert.deepEqual([attributes.banner_icon, attributes.banner_color], [icon, color]);
    // The homebase banner stays as it was.
    const homebase = (await command(backend.port, player, "QueryProfile", "profile0")).body.profileChanges[0].profile.stats.attributes.homebase;
    assert.deepEqual(homebase, account.stats.attributes.homebase);

    // A banner the player doesn't own (or no such row) is refused.
    assert.equal((await set("NoSuchBanner", color)).body.errorCode, "errors.com.epicgames.fortnite.item_not_found");
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


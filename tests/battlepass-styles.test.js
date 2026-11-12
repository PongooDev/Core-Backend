import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetBattlePass } from "../src/battlepass/reset.js";
import { inBuild } from "../src/builds/context.js";
import { athenaSeason, athenaVariantTokens } from "../src/gamedata/athena.js";
import { athenaNeedsSetUp, grantCosmetic, seasonRewardFunctions, setUpAthena } from "../src/profiles/athena.js";
import { heldGiftBoxes } from "../src/profiles/giftboxes.js";
import { addBookXp, buyBattlePass, buyTiers, givenVariantTokens } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { editItemStyles, takeBackVariantToken } from "../src/profiles/variants.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #332: 6.00's (CL-4402180, Season 6) Battle Pass tiers give styles, CosmeticVariantTokens (Bonesy's and
// Scales' at tiers 59, 74, 90 and 98), which went to grant and were dropped; and Calamity's and Dire's progressive
// challenges count events Core didn't (GainAthenaSeasonXp, HasItem).
const v600 = "4402180";
const v50 = "4214610";
const bonesy = "AthenaBackpack:petcarrier_001_dog";
const scales = "AthenaBackpack:petcarrier_003_dragon";
const calamity = "AthenaCharacter:cid_237_athena_commando_f_cowgirl";
const dire = "AthenaCharacter:cid_230_athena_commando_m_werewolf";
const drift = "AthenaCharacter:cid_161_athena_commando_m_drift";
const bonesyWhite = "CosmeticVariantToken:vtid_033_petcarrier_dog_styleb";
const weeklyToken = "Token:athenabattlepass_weeklychallenge_token";

function withSession(build, name, run) {
  return inBuild(build, () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-bpstyles-"));
    try {
      const session = openSession(createProfileStore(dataDir), name);
      setUpAthena(session);
      return run(session, seasonRewardFunctions());
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
}

const owned = (session, templateId, channel) => session.profile("athena").profile.items[templateId]?.attributes.variants
  ?.find((entry) => entry.channel === channel)?.owned ?? [];
const questOf = (session, questId) => Object.values(session.profile("athena").profile.items)
  .find((item) => item.templateId.toLowerCase() === `quest:${questId}`);

test("#332: 6.00's Battle Pass gives Bonesy's and Scales' styles at tiers 59, 74, 90 and 98", () => inBuild(v600, () => {
  const tokens = athenaSeason().bookPaidRewards.flatMap(({ level, rewards }) => rewards
    .filter(({ templateId }) => templateId.toLowerCase().startsWith("cosmeticvarianttoken:")).map(({ templateId }) => [level, templateId]));
  assert.deepEqual(tokens, [[59, bonesyWhite], [74, "CosmeticVariantToken:vtid_035_petcarrier_dragon_styleb"],
    [90, "CosmeticVariantToken:vtid_034_petcarrier_dog_stylec"], [98, "CosmeticVariantToken:vtid_036_petcarrier_dragon_stylec"]]);
  assert.deepEqual(athenaVariantTokens()[bonesyWhite], { channel: "Material", cosmetic: bonesy, giftBox: false, variant: "Mat1" });
}));

test("#332: tier 59 owns Bonesy's white style, tier 98 every pet style; the tiers' screen lists the style", () => withSession(v600, "pets", (session, athena) => {
  buyBattlePass(session, athena);
  // The tiers' season XP gives levels, whose Battle Stars give a tier or two more.
  buyTiers(session, 40, athena);
  const { attributes } = session.profile("athena").profile.stats;
  assert.ok(attributes.book_level < 59, `tier ${attributes.book_level}`);
  assert.deepEqual(owned(session, bonesy, "Material"), ["Mat0"], "Bonesy (tier 12) with its first style only");
  // Tier 59 by Battle Stars: the GB_BattlePass of the tiers reached lists the token, an athena item by its template id.
  addBookXp(session, (59 - attributes.book_level) * 10 - attributes.book_xp, athena);
  assert.ok(attributes.book_level >= 59 && attributes.book_level < 74, `tier ${attributes.book_level}`);
  assert.deepEqual(owned(session, bonesy, "Material"), ["Mat0", "Mat1"]);
  const [, box] = heldGiftBoxes(session.profile("profile0").profile).at(-1);
  assert.deepEqual(box.attributes.lootList.filter(({ itemType }) => itemType.toLowerCase().startsWith("cosmeticvarianttoken:")),
    [{ itemType: bonesyWhite, itemGuid: bonesyWhite, itemProfile: "athena", quantity: 1 }]);
  const loot = buyTiers(session, 98 - attributes.book_level, athena);
  assert.ok(attributes.book_level >= 98, `tier ${attributes.book_level}`);
  assert.equal(loot.filter(({ templateId }) => templateId.toLowerCase().startsWith("cosmeticvarianttoken:")).length, 3);
  assert.deepEqual(owned(session, bonesy, "Material"), ["Mat0", "Mat1", "Mat2"]);
  assert.deepEqual(owned(session, scales, "Material"), ["Mat0", "Mat1", "Mat2"]);
}));

test("#332: tiers reached before the fix give their styles at the next profile load, once", () => withSession(v600, "backfill", (session) => {
  const tracker = session.profile("athena");
  const { profile } = tracker;
  // As the backend left it: the pass bought and tier 95 reached and given, the pets in the locker without the tiers' styles.
  tracker.setStat("book_purchased", true);
  tracker.setStat("book_level", 95);
  profile.coreSeasonRewards = { 6: { seasonLevel: 1, free: 95, paid: 95 } };
  grantCosmetic(session, bonesy);
  grantCosmetic(session, scales);
  assert.deepEqual(givenVariantTokens(profile).map((id) => id.toLowerCase()).sort(),
    [bonesyWhite.toLowerCase(), "cosmeticvarianttoken:vtid_034_petcarrier_dog_stylec", "cosmeticvarianttoken:vtid_035_petcarrier_dragon_styleb"]);
  assert.equal(athenaNeedsSetUp(profile, session.settings ?? {}), true);
  setUpAthena(session);
  assert.deepEqual(owned(session, bonesy, "Material"), ["Mat0", "Mat1", "Mat2"]);
  assert.deepEqual(owned(session, scales, "Material"), ["Mat0", "Mat1"], "tier 98's style isn't reached");
  assert.equal(athenaNeedsSetUp(profile, session.settings ?? {}), false, "settled once");
  // Another season's build gives none of them.
  assert.deepEqual(inBuild(v50, () => givenVariantTokens(profile)), []);
}));

test("#332: Calamity's stages count the season XP gained (GainAthenaSeasonXp), her colours the weekly challenges done (HasItem)", () => withSession(v600, "calamity", (session, athena) => {
  // Three weekly challenges done before the pass: their tokens count once her challenges come with it.
  athena.acquireAthenaToken(session, weeklyToken, 3);
  buyBattlePass(session, athena);
  const color1 = "quest_br_s6_complete_weeklychallenges_progressivea_01";
  assert.equal(questOf(session, color1).attributes.completion_athena_s6_season_complete_weeklychallenges_progressive_a_01, 3);
  assert.deepEqual(owned(session, calamity, "ClothingColor"), ["Mat0"]);
  athena.acquireAthenaToken(session, weeklyToken, 7);
  assert.notEqual(questOf(session, color1).attributes.quest_state, "Active");
  assert.deepEqual(owned(session, calamity, "ClothingColor"), ["Mat0", "Mat1"]);
  assert.equal(questOf(session, "quest_br_s6_complete_weeklychallenges_progressivea_02").attributes
    .completion_athena_s6_season_complete_weeklychallenges_progressive_a_02, 10);

  const stage1 = "quest_br_s6_gain_seasonxp_progressivea_01";
  athena.addSeasonXp(session, 19000);
  assert.equal(questOf(session, stage1).attributes.completion_athena_season_xp_gained, 19000);
  assert.deepEqual(owned(session, calamity, "Progressive"), ["Stage0"]);
  athena.addSeasonXp(session, 1000);
  assert.notEqual(questOf(session, stage1).attributes.quest_state, "Active");
  assert.deepEqual(owned(session, calamity, "Progressive"), ["Stage0", "Stage1"]);
  assert.equal(questOf(session, "quest_br_s6_gain_seasonxp_progressivea_02").attributes.completion_athena_season_xp_gained, 20000);
}));

test("#332: Dire's challenges (tier 100's schedule) count the weekly challenges already done", () => withSession(v600, "dire", (session, athena) => {
  buyBattlePass(session, athena);
  grantCosmetic(session, dire);
  athena.acquireAthenaToken(session, weeklyToken, 20);
  athena.grantChallengeSchedule(session, "ChallengeBundleSchedule:season6_progressiveb_schedule");
  assert.notEqual(questOf(session, "quest_br_s6_complete_weeklychallenges_progressiveb_01").attributes.quest_state, "Active");
  assert.deepEqual(owned(session, dire, "ClothingColor"), ["Mat0", "Mat1"]);
  athena.addSeasonXp(session, 30000);
  assert.deepEqual(owned(session, dire, "Progressive"), ["Stage0", "Stage1"]);
}));

test("#332: Season 5's progressive styles still come: Drift's first stage at 10,000 season XP", () => withSession(v50, "drift", (session, athena) => {
  buyBattlePass(session, athena);
  assert.deepEqual(owned(session, drift, "Progressive"), ["Stage0"]);
  athena.addSeasonXp(session, 10000);
  assert.deepEqual(owned(session, drift, "Progressive"), ["Stage0", "Stage1"]);
}));

test("#332: the admin panel keeps a tier's style, and the Battle Pass reset takes it back", () => withSession(v600, "admin", (session, athena) => {
  buyBattlePass(session, athena);
  buyTiers(session, 58, athena);
  const { profile } = session.profile("athena");
  assert.ok(profile.stats.attributes.book_level < 74);
  const removed = editItemStyles(session, bonesy, [{ channel: "Material", tags: ["Mat1"] }], { remove: true, earnedTokens: givenVariantTokens(profile) });
  assert.deepEqual(removed, { changed: false, kept: ["Material.Mat1"] });
  // Taken back off a pet that stays, its active style back to the default.
  session.profile("athena").setItemAttribute(bonesy, "variants", [{ channel: "Material", active: "Mat1", owned: ["Mat0", "Mat1"] }]);
  assert.equal(takeBackVariantToken(session, bonesyWhite), true);
  assert.deepEqual(profile.items[bonesy].attributes.variants, [{ channel: "Material", active: "Mat0", owned: ["Mat0"] }]);
  assert.equal(takeBackVariantToken(session, bonesyWhite), false, "nothing left to take");
  // The reset takes Bonesy and the style still waiting for a pet that a tier reached gave, not one of a tier never reached.
  profile.coreVariantTokens = ["cosmeticvarianttoken:vtid_035_petcarrier_dragon_styleb", bonesyWhite.toLowerCase()];
  const result = resetBattlePass(session, 6);
  assert.ok(result.cosmetics.some((id) => id.toLowerCase() === bonesy.toLowerCase()));
  assert.deepEqual(result.styles, [bonesyWhite]);
  assert.deepEqual(profile.coreVariantTokens, ["cosmeticvarianttoken:vtid_035_petcarrier_dragon_styleb"], "tier 74 was never reached");
}));

// The issue's case end to end: 6.00's client buys the pass and tiers to 59, and its athena profile shows the style owned.
const agent600 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-6.00-CL-4402180";
function command(port, { accountId, token }, name, profileId, body) {
  const text = JSON.stringify(body ?? {});
  return send({
    host: "127.0.0.1", port, method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`,
    headers: { "User-Agent": agent600, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }
  }, text);
}
const profileOf = (body, profileId) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === profileId);

test("#332: a 6.00 client buying tiers to 59 is shown Bonesy's white style and owns it", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "Bonesy332");
    await command(backend.port, player, "QueryProfile", "athena");
    assert.equal((await post(backend.port, `/admin/api/accounts/${player.accountId}/currency`, undefined, { key: "vbucks", quantity: 10000 })).status, 200);
    const buy = async (offerId, expectedPrice, purchaseQuantity = 1) => {
      const bought = await command(backend.port, player, "PurchaseCatalogEntry", "common_core",
        { offerId, purchaseQuantity, currency: "MtxCurrency", expectedPrice });
      assert.equal(bought.status, 200, JSON.stringify(bought.body));
      return bought.body.notifications[0].lootResult.items;
    };
    await buy("core_br_season6_battlepass", 950);
    const loot = await buy("A6FE59C497B844068E1B5D84396F19BA", 150, 58);
    assert.ok(loot.some((item) => item.itemType === bonesyWhite && item.itemProfile === "athena"), JSON.stringify(loot));
    const athena = profileOf((await command(backend.port, player, "QueryProfile", "athena")).body, "athena").profileChanges[0].profile;
    assert.ok(athena.stats.attributes.book_level >= 59 && athena.stats.attributes.book_level < 74, `tier ${athena.stats.attributes.book_level}`);
    assert.deepEqual(athena.items[bonesy].attributes.variants, [{ channel: "Material", active: "Mat0", owned: ["Mat0", "Mat1"] }]);
  } finally {
    backend.close();
  }
});

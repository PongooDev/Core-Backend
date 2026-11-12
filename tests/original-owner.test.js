import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason, athenaVariantTokens, getAthenaQuest } from "../src/gamedata/athena.js";
import { buildGameData, dataBuilds } from "../src/gamedata/read.js";
import { advanceAthenaObjectives, athenaQuestLogin, fullLockerState, grantCosmetic, grantFullLocker, grantLockerStyles, lockerCosmetics, recordMatchProgress,
  removeFullLocker, removeLockerCosmetic, removeLockerStyles, settleOriginalOwnerMark } from "../src/profiles/athena.js";
import { originalOwnerStyles, originalOwnerTokens } from "../src/profiles/challenges.js";
import { fullProfile } from "../src/profiles/changes.js";
import { heldGiftBoxes } from "../src/profiles/giftboxes.js";
import { isOriginalOwner, markOriginalOwner, shopBuildOf, shopSeasonOf } from "../src/profiles/origins.js";
import { grant } from "../src/profiles/progress.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { purchaseCatalogEntry } from "../src/services/mcp/commands/PurchaseCatalogEntry.js";
import { configureItemShop } from "../src/store/itemshop.js";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #335: the Skull Trooper's Purple Glow and the Ghost Portal's purple are its original owners', those who
// bought the outfit at its first release in Season 1 (profiles/challenges.js originalOwnerStyles, profiles/origins.js),
// and the admin panel's full locker gives every style.
const v18 = "3724489";
const v25 = "3889387";
const v36 = "4019403";
const v601 = "4424678";
const v602 = "4461277";
const builds602 = ["4442095", v602];
const skullTrooper = "AthenaCharacter:cid_030_athena_commando_m_halloween";
const ghostPortal = "AthenaBackpack:bid_105_ghostportal";
const purpleGlow = "CosmeticVariantToken:vtid_052_skull_trooper_redflames";
const purplePortal = "CosmeticVariantToken:vtid_053_ghost_portal__redflames";
const skullOffer = "core_br_cid_030_athena_commando_m_halloween";
const schedule = "bundleschedule_styles_skulltrooper";
const bundle = "questbundle_styles_skulltrooper";
const day = 86400000;
const daysAgo = (days) => new Date(Date.now() - days * day).toISOString().slice(0, 10);

// The item shop on the days it sold the Skull Trooper: Season 1's replay at its first day, 30 October 2017 (1,200
// V-Bucks), and Season 6's at 11 October 2018, the day after his return (1,500).
const replay = { mode: "fnbr", rotationHour: 0, seasonStarts: { 1: daysAgo(0), 6: daysAgo(14) } };
function withStore(run, shop = replay) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-original-owner-"));
  configureItemShop(shop);
  try {
    return run(createProfileStore(dataDir));
  } finally {
    configureItemShop(null);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
// One request of a build: the account's profiles opened, run, and the changed ones saved as a command's are.
function as(build, store, name, run) {
  return inBuild(build, () => {
    const session = openSession(store, name);
    const result = run(session);
    session.commit();
    return result;
  });
}
function buySkullTrooper(session, expectedPrice) {
  grant(session, "Currency:mtxgiveaway", 5000);
  purchaseCatalogEntry({ req: { body: { offerId: skullOffer, currency: "MtxCurrency", expectedPrice } }, session, notifications: [] });
}
const itemsOf = (session, type) => Object.entries(session.profile("athena").profile.items).filter(([, item]) => item.templateId.toLowerCase().startsWith(`${type}:`));
const heldOf = (session, templateId) => itemsOf(session, templateId.split(":")[0].toLowerCase()).find(([, item]) => item.templateId.toLowerCase() === templateId.toLowerCase());
const variantsOf = (session, templateId) => heldOf(session, templateId)?.[1].attributes.variants;
// The bundle's challenges done as the gameserver and the match results report them.
function finishSkullTrooperChallenges(session) {
  const tracker = session.profile("athena");
  const [, held] = heldOf(session, `ChallengeBundle:${bundle}`);
  for (const questItemId of held.attributes.grantedquestinstanceids) {
    const questId = tracker.profile.items[questItemId].templateId.split(":")[1];
    advanceAthenaObjectives(session, getAthenaQuest(questId).objectives.map(({ name }) => ({ statName: name, count: 1_000_000 })));
  }
  for (let match = 0; match < 60; match++) recordMatchProgress(session, 2, { place: 10, kills: 1 });
}
const challengeItems = (session) => [...itemsOf(session, "challengebundleschedule"), ...itemsOf(session, "challengebundle"), ...itemsOf(session, "quest")]
  .map(([, item]) => item.templateId.toLowerCase()).filter((id) => /styles_/.test(id)).sort();

test("6.02's files give the purple styles to nobody: two tokens no quest, bundle or season names, and one bundle of five challenges for the back bling", () => inBuild(v602, () => {
  assert.deepEqual(athenaVariantTokens()[purpleGlow], { channel: "ClothingColor", cosmetic: skullTrooper, giftBox: true, variant: "Mat1" });
  assert.deepEqual(athenaVariantTokens()[purplePortal], { channel: "Particle", cosmetic: ghostPortal, giftBox: true, variant: "Particle1" });
  // The purple options are the only ones that don't start unlocked.
  assert.deepEqual(athenaCosmetics()[skullTrooper].variants, [{ channel: "ClothingColor", default: "Mat0", options: ["Mat0", "Mat1", "Mat2"], unlocked: ["Mat0", "Mat2"] }]);
  assert.deepEqual(athenaCosmetics()[ghostPortal].variants, [{ channel: "Particle", default: "Particle0", options: ["Particle0", "Particle1", "Particle2"], unlocked: ["Particle0", "Particle2"] }]);
  const full = buildGameData(v602, "athena", {});
  const rewards = JSON.stringify({ quests: full.quests, bundles: full.challengeBundles, schedules: full.challengeSchedules, season: full.season }).toLowerCase();
  for (const token of [purpleGlow, purplePortal]) assert.equal(rewards.includes(token.split(":")[1]), false, token);
  // The Skull Trooper's only schedule and bundle: five challenges given with it, and one reward when every one is done.
  assert.deepEqual(Object.keys(athenaChallengeSchedules()).filter((id) => /skull|ghost|halloween/.test(id)), [schedule]);
  assert.deepEqual(Object.keys(athenaChallengeBundles()).filter((id) => /skull|ghost|halloween/.test(id)), [bundle]);
  assert.deepEqual(athenaChallengeSchedules()[schedule].bundles.map((entry) => entry.bundle), [bundle]);
  assert.equal(athenaChallengeBundles()[bundle].quests.length, 5);
  assert.ok(athenaChallengeBundles()[bundle].quests.every((entry) => entry.grantWithBundle && !entry.requiresBattlePass));
  assert.deepEqual(athenaChallengeBundles()[bundle].completionSteps.map(({ count, rewards: given }) => [count, given.map(({ templateId }) => templateId)]), [[-1, [ghostPortal]]]);
  // The rule is Core's: the outfit, the season of its first release, and for the portal the challenges.
  assert.deepEqual(originalOwnerStyles, [{ token: purpleGlow, outfit: skullTrooper, season: 1 }, { token: purplePortal, outfit: skullTrooper, season: 1, schedule }]);
  // 6.01 and everything before have neither token: nothing is given there.
  for (const build of dataBuilds.filter((candidate) => Number(candidate) < Number(v602))) {
    assert.equal(inBuild(build, () => athenaVariantTokens()?.[purpleGlow] ?? athenaVariantTokens()?.[purplePortal]), undefined, build);
  }
}));

test("an item shop purchase notes the build whose shop sold it, a grant notes nothing, the client is never sent the note, and it goes with the item", () => withStore((store) => {
  as(v18, store, "noted", (session) => {
    assert.equal(athenaSeason()?.seasonNumber ?? 1, 1, "1.8 is Season 1");
    buySkullTrooper(session, 1200);
    grantCosmetic(session, "AthenaPickaxe:halloweenscythe");
    const { profile } = session.profile("athena");
    assert.deepEqual(profile.coreShopBuilds, { [skullTrooper.toLowerCase()]: v18 });
    assert.deepEqual([shopBuildOf(profile, skullTrooper), shopSeasonOf(profile, skullTrooper)], [v18, 1]);
    assert.deepEqual([shopBuildOf(profile, "AthenaPickaxe:halloweenscythe"), shopSeasonOf(profile, "AthenaPickaxe:halloweenscythe")], [null, null]);
    assert.equal(isOriginalOwner(profile, skullTrooper, 1), true);
    assert.equal(isOriginalOwner(profile, "AthenaPickaxe:halloweenscythe", 1), false);
    // What a client is sent: the profile's stats and items, the item as it always was.
    assert.deepEqual(Object.keys(fullProfile(profile)), ["version", "wipeNumber", "stats", "items"]);
    assert.deepEqual(profile.items[skullTrooper], { templateId: skullTrooper, attributes: { level: 1, item_seen: 0, favorite: 0 }, quantity: 1 });
    assert.equal(JSON.stringify(fullProfile(profile)).includes("coreShopBuilds"), false);
  });
  // Saved with the profile, and gone when the item leaves the locker: given again, it is a later copy.
  as(v18, store, "noted", (session) => {
    const { profile } = session.profile("athena");
    assert.deepEqual(profile.coreShopBuilds, { [skullTrooper.toLowerCase()]: v18 });
    assert.deepEqual(removeLockerCosmetic(session, skullTrooper), { removed: true });
    assert.deepEqual(profile.coreShopBuilds, {});
    grantCosmetic(session, skullTrooper);
    assert.equal(isOriginalOwner(profile, skullTrooper, 1), false);
  });
  // A purchase on a later build notes that build: Season 6's shop, and a Season 2 build's custom shop.
  as(v602, store, "later", (session) => {
    buySkullTrooper(session, 1500);
    const { profile } = session.profile("athena");
    assert.deepEqual([shopBuildOf(profile, skullTrooper), shopSeasonOf(profile, skullTrooper)], [v602, 6]);
    assert.equal(isOriginalOwner(profile, skullTrooper, 1), false);
  });
  configureItemShop({ mode: "custom", custom: { featured: [[skullTrooper, 1500]], daily: [] } });
  as(v25, store, "season2", (session) => {
    buySkullTrooper(session, 1500);
    const { profile } = session.profile("athena");
    assert.deepEqual([shopBuildOf(profile, skullTrooper), shopSeasonOf(profile, skullTrooper)], [v25, 2]);
    assert.equal(isOriginalOwner(profile, skullTrooper, 1), false);
  });
}));

test("an original owner: the Skull Trooper bought in a Season 1 build's shop has the Purple Glow on 6.02, and the Skull Trooper Challenges give the Ghost Portal with its purple", () => {
  for (const build of builds602) {
    withStore((store) => {
      const name = `original${build}`;
      as(v18, store, name, (session) => buySkullTrooper(session, 1200));
      // Builds whose files have no such style give none: 1.8 itself, 3.6, 6.01.
      for (const earlier of [v18, v36, v601]) {
        as(earlier, store, name, (session) => {
          assert.deepEqual(variantsOf(session, skullTrooper) ?? [], [], earlier);
          assert.deepEqual(originalOwnerTokens(session.profile("athena").profile), [purpleGlow], "the rule holds whatever the build");
        });
      }
      as(build, store, name, (session) => {
        // At the login: the Purple Glow beside the styles everyone has, the one he wore still worn.
        assert.deepEqual(variantsOf(session, skullTrooper), [{ channel: "ClothingColor", active: "Mat0", owned: ["Mat0", "Mat2", "Mat1"] }]);
        athenaQuestLogin(session);
        assert.equal(heldOf(session, `ChallengeBundle:${bundle}`)[1].attributes.num_granted_bundle_quests, 5);
        assert.equal(heldOf(session, ghostPortal), undefined);
        assert.deepEqual(originalOwnerTokens(session.profile("athena").profile), [purpleGlow], "the portal's waits for the challenges");

        finishSkullTrooperChallenges(session);
        assert.deepEqual(variantsOf(session, ghostPortal), [{ channel: "Particle", active: "Particle0", owned: ["Particle0", "Particle2", "Particle1"] }]);
        assert.deepEqual(originalOwnerTokens(session.profile("athena").profile), [purpleGlow, purplePortal]);
        // The reward's box is the one the data names, with the reward the data names.
        const boxes = heldGiftBoxes(session.profile("profile0").profile).map(([, item]) => item).filter((item) => item.templateId === "GiftBox:gb_challengecomplete");
        assert.deepEqual(boxes.map((box) => box.attributes.lootList.map(({ itemType }) => itemType)), [[ghostPortal]]);
        assert.equal(session.profile("athena").profile.coreVariantTokens, undefined, "nothing waits for a cosmetic");
      });
      // The lobby's quest login cleans the finished schedule up; the styles stay, and nothing is given twice.
      as(build, store, name, (session) => {
        athenaQuestLogin(session);
        assert.deepEqual(challengeItems(session), []);
        assert.deepEqual(session.profile("athena").profile.coreCleanedUpSchedules, [schedule]);
      });
      as(build, store, name, (session) => {
        athenaQuestLogin(session);
        assert.deepEqual(variantsOf(session, skullTrooper), [{ channel: "ClothingColor", active: "Mat0", owned: ["Mat0", "Mat2", "Mat1"] }]);
        assert.deepEqual(variantsOf(session, ghostPortal), [{ channel: "Particle", active: "Particle0", owned: ["Particle0", "Particle2", "Particle1"] }]);
        assert.deepEqual(session.profile("athena").changes.filter((change) => change.attributeName === "variants"), []);
        assert.deepEqual(challengeItems(session), [], "the challenges don't start over");
      });
    });
  }
});

test("a later owner: bought in Season 6's shop, in a Season 2 build's shop or given, the purple styles stay locked, with the same five challenges and the same back bling", () => {
  const laterOwners = [
    ["season6", (store, name) => as(v602, store, name, (session) => buySkullTrooper(session, 1500)), replay],
    ["season2", (store, name) => as(v25, store, name, (session) => buySkullTrooper(session, 1500)), { mode: "custom", custom: { featured: [[skullTrooper, 1500]], daily: [] } }],
    ["given", (store, name) => as(v18, store, name, (session) => grantCosmetic(session, skullTrooper)), replay]
  ];
  const original = withStore((store) => {
    as(v18, store, "original", (session) => buySkullTrooper(session, 1200));
    return as(v602, store, "original", (session) => (athenaQuestLogin(session), challengeItems(session)));
  });
  assert.equal(original.length, 7, "the schedule, its bundle and five challenges");
  for (const [name, own, shop] of laterOwners) {
    withStore((store) => {
      own(store, name);
      as(v602, store, name, (session) => {
        const { profile } = session.profile("athena");
        assert.equal(isOriginalOwner(profile, skullTrooper, 1), false, name);
        assert.deepEqual(originalOwnerTokens(profile), [], name);
        assert.deepEqual(variantsOf(session, skullTrooper), [{ channel: "ClothingColor", active: "Mat0", owned: ["Mat0", "Mat2"] }], name);
        athenaQuestLogin(session);
        // What the challenges tab lists is what an original owner's lists: no challenge is added or left out for the purple portal.
        assert.deepEqual(challengeItems(session), original, name);

        finishSkullTrooperChallenges(session);
        assert.deepEqual(variantsOf(session, ghostPortal), [{ channel: "Particle", active: "Particle0", owned: ["Particle0", "Particle2"] }], name);
        assert.deepEqual(variantsOf(session, skullTrooper), [{ channel: "ClothingColor", active: "Mat0", owned: ["Mat0", "Mat2"] }], name);
        assert.deepEqual(originalOwnerTokens(profile), [], name);
      });
      as(v602, store, name, (session) => {
        athenaQuestLogin(session);
        assert.deepEqual(variantsOf(session, ghostPortal), [{ channel: "Particle", active: "Particle0", owned: ["Particle0", "Particle2"] }], name);
        assert.equal(session.profile("athena").profile.coreVariantTokens, undefined, name);
      });
    }, shop);
  }
});

test("a profile from before purchases were noted: its Skull Trooper is a later owner's, on every build, and nothing about it changes", () => withStore((store) => {
  // As a 1.8 purchase left it before this change: the item, and no note.
  as(v18, store, "before", (session) => {
    const tracker = session.profile("athena");
    tracker.addItem(skullTrooper, { templateId: skullTrooper, attributes: { level: 1, item_seen: 1, favorite: 0 }, quantity: 1 });
  });
  as(v18, store, "before", (session) => {
    const tracker = session.profile("athena");
    assert.deepEqual(tracker.changes, [], "1.8 gives it nothing");
    assert.deepEqual(tracker.profile.items[skullTrooper], { templateId: skullTrooper, attributes: { level: 1, item_seen: 1, favorite: 0 }, quantity: 1 });
    assert.equal(tracker.profile.coreShopBuilds, undefined);
    assert.equal(tracker.profile.coreOriginalOwner, undefined);
  });
  as(v602, store, "before", (session) => {
    const { profile } = session.profile("athena");
    assert.equal(isOriginalOwner(profile, skullTrooper, 1), false);
    // The styles every owner has, as before; the challenges, as before.
    assert.deepEqual(variantsOf(session, skullTrooper), [{ channel: "ClothingColor", active: "Mat0", owned: ["Mat0", "Mat2"] }]);
    athenaQuestLogin(session);
    assert.equal(challengeItems(session).length, 7);
    finishSkullTrooperChallenges(session);
    assert.deepEqual(variantsOf(session, ghostPortal), [{ channel: "Particle", active: "Particle0", owned: ["Particle0", "Particle2"] }]);
    assert.equal(profile.coreShopBuilds, undefined);
    assert.equal(profile.coreOriginalOwner, undefined);
    assert.equal(profile.coreGrantedStyles, undefined);
  });
}));

// The styles a token unlocks on a locker cosmetic, in every build's data: what the full locker gives beyond the cosmetics.
function everyTokenStyle() {
  const locker = new Set(dataBuilds.flatMap((build) => inBuild(build, lockerCosmetics)).map((id) => id.toLowerCase()));
  const tokens = new Map();
  for (const build of dataBuilds) {
    for (const [id, token] of Object.entries(inBuild(build, () => athenaVariantTokens() ?? {}))) if (locker.has(token.cosmetic.toLowerCase())) tokens.set(id.toLowerCase(), token);
  }
  return tokens;
}
const ownsStyle = (profile, token) => (Object.values(profile.items).find((item) => item.templateId.toLowerCase() === token.cosmetic.toLowerCase())?.attributes.variants ?? [])
  .some((entry) => entry.channel === token.channel && entry.owned.includes(token.variant));

test("the full locker's styles: every style of every build's cosmetics, taken back with it, except what the player earned", () => withStore((store) => {
  const tokens = everyTokenStyle();
  assert.ok(tokens.size >= 49 && tokens.has(purpleGlow.toLowerCase()) && tokens.has("cosmeticvarianttoken:vtid_002_carbideblue_stage1"));
  // A later owner (the outfit given for good) and an original owner, each with the full locker.
  as(v18, store, "later", (session) => grantCosmetic(session, skullTrooper));
  as(v18, store, "original", (session) => buySkullTrooper(session, 1200));
  for (const name of ["later", "original"]) {
    // The panel names no build.
    const session = openSession(store, name);
    grantFullLocker(session);
    assert.equal(grantLockerStyles(session), tokens.size, name);
    const { profile } = session.profile("athena");
    for (const [id, token] of tokens) assert.equal(ownsStyle(profile, token), true, `${name} ${id}`);
    assert.equal(profile.coreGrantedStyles.length, tokens.size);
    assert.deepEqual(fullLockerState(profile, session.profile("profile0").profile).styles, { owned: tokens.size, total: tokens.size });
    assert.equal(grantLockerStyles(session), 0, "once");
    // The style worn doesn't change, and no token waits for a cosmetic.
    assert.deepEqual(variantsOf(session, skullTrooper), [{ channel: "ClothingColor", active: "Mat0", owned: ["Mat0", "Mat2", "Mat1"] }]);
    assert.equal(profile.coreVariantTokens, undefined);
    session.commit();
    for (const profileId of ["athena", "profile0"]) store.save(session.profile(profileId).profile);
  }
  // On 6.02 both wear what they like; a build without styles is sent its own cosmetics as before.
  for (const name of ["later", "original"]) {
    as(v602, store, name, (session) => {
      assert.deepEqual(variantsOf(session, skullTrooper), [{ channel: "ClothingColor", active: "Mat0", owned: ["Mat0", "Mat2", "Mat1"] }], name);
      assert.deepEqual(variantsOf(session, ghostPortal), [{ channel: "Particle", active: "Particle0", owned: ["Particle0", "Particle2", "Particle1"] }]);
    });
    as(v18, store, name, (session) => {
      const sent = fullProfile(session.profile("athena").profile);
      const own = new Set(Object.keys(athenaCosmetics()).map((id) => id.toLowerCase()));
      for (const item of Object.values(sent.items)) if (/^athena/i.test(item.templateId)) assert.ok(own.has(item.templateId.toLowerCase()), item.templateId);
    });
  }
  // Remove granted: the cosmetics the panel gave go with their styles; the Skull Trooper is each player's own, and its
  // Purple Glow goes from the later owner and stays the original owner's.
  for (const [name, purple] of [["later", false], ["original", true]]) {
    const session = openSession(store, name);
    removeFullLocker(session);
    const { profile } = session.profile("athena");
    // The styles of the cosmetics that went are no longer the panel's to take back: the Skull Trooper's is left.
    assert.deepEqual(profile.coreGrantedStyles, [purpleGlow.toLowerCase()], name);
    assert.equal(removeLockerStyles(session), purple ? 0 : 1, name);
    assert.deepEqual(profile.coreGrantedStyles, []);
    assert.deepEqual(variantsOf(session, skullTrooper), [{ channel: "ClothingColor", active: "Mat0", owned: purple ? ["Mat0", "Mat2", "Mat1"] : ["Mat0", "Mat2"] }], name);
    assert.equal(heldOf(session, ghostPortal), undefined, "the panel's back bling goes");
    assert.equal(fullLockerState(profile, session.profile("profile0").profile).granted, 0);
    assert.equal(removeLockerStyles(session), 0);
  }
}));

test("a style earned after the full locker gave it is the player's: Remove granted leaves it", () => withStore((store) => {
  const tomatohead = "AthenaCharacter:cid_109_athena_commando_m_pizza";
  const crown = "cosmeticvarianttoken:vtid_032_tomatohead_crown";
  as(v602, store, "earned", (session) => grantCosmetic(session, tomatohead));
  const panel = openSession(store, "earned");
  grantFullLocker(panel);
  grantLockerStyles(panel);
  assert.ok(panel.profile("athena").profile.coreGrantedStyles.includes(crown));
  panel.commit();
  for (const profileId of ["athena", "profile0"]) store.save(panel.profile(profileId).profile);
  // Tomatohead's three challenges give the Crown the panel had given: it is earned now.
  as(v602, store, "earned", (session) => {
    athenaQuestLogin(session);
    const tracker = session.profile("athena");
    const [, held] = heldOf(session, "ChallengeBundle:questbundle_styles_tomatohead");
    for (const questItemId of held.attributes.grantedquestinstanceids) {
      const questId = tracker.profile.items[questItemId].templateId.split(":")[1];
      advanceAthenaObjectives(session, getAthenaQuest(questId).objectives.map(({ name }) => ({ statName: name, count: 1_000_000 })));
    }
    for (let match = 0; match < 60; match++) recordMatchProgress(session, 2, { place: 10, kills: 1 });
    assert.equal(heldOf(session, "ChallengeBundle:questbundle_styles_tomatohead")[1].attributes.num_quests_completed, 3);
    assert.equal(tracker.profile.coreGrantedStyles.includes(crown), false);
  });
  const taken = openSession(store, "earned");
  removeFullLocker(taken);
  removeLockerStyles(taken);
  assert.deepEqual(variantsOf(taken, tomatohead).find((entry) => entry.channel === "Material").owned.includes("Mat1"), true);
}));

const agentOf = { [v18]: "game=Fortnite, engine=UE4, build=++Fortnite+Release-Live-CL-3724489", [v602]: "game=Fortnite, engine=UE4, build=++Fortnite+Release-6.02-CL-4461277" };
async function athenaOf(port, { accountId, token }, build) {
  const { status, body } = await send({
    host: "127.0.0.1", port, method: "POST", path: `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=athena&rvn=-1`,
    headers: { "User-Agent": agentOf[build], Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": 2 }
  }, "{}");
  assert.equal(status, 200);
  return [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === "athena").profileChanges[0].profile;
}
const itemOf = (profile, templateId) => Object.values(profile.items).find((item) => item.templateId.toLowerCase() === templateId.toLowerCase());

test("the admin panel's Grant full locker unlocks every style, counts them, and Remove granted takes them back; 1.8's client is sent what it was", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "EveryStyle");
    const admin = (action) => post(backend.port, `/admin/api/accounts/${player.accountId}/locker/${action}`, undefined, {});
    const before18 = await athenaOf(backend.port, player, v18);
    const total = everyTokenStyle().size;
    const fresh = (await get(backend.port, `/admin/api/accounts/${player.accountId}`)).body.locker;
    assert.deepEqual(fresh.styles, { owned: 0, total });

    const given = await admin("grant-all");
    assert.equal(given.status, 200);
    assert.equal(given.body.granted.styles, total);
    assert.deepEqual(given.body.locker.styles, { owned: total, total });
    assert.equal(given.body.locker.granted, given.body.granted.cosmetics + given.body.granted.banners + total);
    assert.deepEqual((await admin("grant-all")).body.granted, { cosmetics: 0, banners: 0, styles: 0 });

    // A 6.02 client: every style its files gate behind a token is owned on its cosmetic, the default one worn.
    const full602 = await athenaOf(backend.port, player, v602);
    for (const [id, token] of Object.entries(inBuild(v602, athenaVariantTokens))) {
      const channel = itemOf(full602, token.cosmetic).attributes.variants.find((entry) => entry.channel === token.channel);
      assert.ok(channel.owned.includes(token.variant), id);
    }
    assert.deepEqual(itemOf(full602, skullTrooper).attributes.variants, [{ channel: "ClothingColor", active: "Mat0", owned: ["Mat0", "Mat2", "Mat1"] }]);
    assert.deepEqual(itemOf(full602, ghostPortal).attributes.variants, [{ channel: "Particle", active: "Particle0", owned: ["Particle0", "Particle2", "Particle1"] }]);
    // A 1.8 client (no styles in its files): the cosmetics of its build, each one's level, seen and favourite as before.
    const full18 = await athenaOf(backend.port, player, v18);
    const own18 = new Set(inBuild(v18, () => Object.keys(athenaCosmetics())).map((id) => id.toLowerCase()));
    for (const item of Object.values(full18.items)) if (/^athena/i.test(item.templateId)) assert.ok(own18.has(item.templateId.toLowerCase()), item.templateId);
    for (const [itemId, item] of Object.entries(before18.items)) {
      const { variants, ...attributes } = full18.items[itemId].attributes;
      assert.deepEqual(attributes, item.attributes, itemId);
    }

    const removed = await admin("remove-granted");
    assert.equal(removed.body.removed.styles, 0, "the cosmetics that held them went");
    assert.deepEqual(removed.body.locker.styles, { owned: 0, total });
    assert.equal(removed.body.locker.granted, 0);
    assert.deepEqual((await admin("remove-granted")).body.removed, { cosmetics: 0, banners: 0, styles: 0 });
  } finally {
    backend.close();
  }
});

test("an account an admin marked is an original owner: the Purple Glow at the login, the portal's purple with the challenges, and both go with the mark", () => withStore((store) => {
  as(v602, store, "marked", (session) => {
    grantCosmetic(session, skullTrooper);
    const { profile } = session.profile("athena");
    assert.equal(markOriginalOwner(profile, skullTrooper, true), true);
    assert.equal(markOriginalOwner(profile, skullTrooper, true), false);
    assert.deepEqual(profile.coreOriginalOwner, [skullTrooper.toLowerCase()]);
    assert.equal(JSON.stringify(fullProfile(profile)).includes("coreOriginalOwner"), false);
  });
  as(v602, store, "marked", (session) => {
    assert.deepEqual(variantsOf(session, skullTrooper), [{ channel: "ClothingColor", active: "Mat0", owned: ["Mat0", "Mat2", "Mat1"] }]);
    athenaQuestLogin(session);
    finishSkullTrooperChallenges(session);
    assert.deepEqual(variantsOf(session, ghostPortal), [{ channel: "Particle", active: "Particle0", owned: ["Particle0", "Particle2", "Particle1"] }]);
    athenaQuestLogin(session);
  });
  // The panel names no build: the mark off takes both styles back, cleaned up schedule or not, and they stay off.
  const panel = openSession(store, "marked");
  markOriginalOwner(panel.profile("athena").profile, skullTrooper, false);
  assert.deepEqual(settleOriginalOwnerMark(panel), { given: [], taken: [purpleGlow, purplePortal] });
  panel.commit();
  store.save(panel.profile("athena").profile);
  as(v602, store, "marked", (session) => {
    assert.deepEqual(variantsOf(session, skullTrooper), [{ channel: "ClothingColor", active: "Mat0", owned: ["Mat0", "Mat2"] }]);
    assert.deepEqual(variantsOf(session, ghostPortal), [{ channel: "Particle", active: "Particle0", owned: ["Particle0", "Particle2"] }]);
    assert.deepEqual(session.profile("athena").profile.coreOriginalOwner, []);
  });
  // On again, the challenges already done: both come back at once.
  const again = openSession(store, "marked");
  markOriginalOwner(again.profile("athena").profile, skullTrooper, true);
  assert.deepEqual(settleOriginalOwnerMark(again), { given: [purpleGlow, purplePortal], taken: [] });
}));

test("the admin panel's original owner mark: off by default, it gives the Purple Glow at once and takes it back, and only an outfit with such styles has one", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "MarkedOwner");
    const base = `/admin/api/accounts/${player.accountId}/cosmetics`;
    const styles = async () => (await get(backend.port, `${base}/styles?${new URLSearchParams({ build: v602, templateId: skullTrooper })}`)).body;
    const mark = (original, templateId = skullTrooper) => post(backend.port, `${base}/original-owner`, undefined, { build: v602, templateId, original });

    assert.match((await mark(true)).body.errorMessage, /no Battle Royale profile/);
    await athenaOf(backend.port, player, v602);
    assert.match((await mark(true)).body.errorMessage, /isn't in the account's locker/);
    assert.equal((await post(backend.port, `${base}/grant`, undefined, { build: v602, templateIds: [skullTrooper, "AthenaCharacter:cid_109_athena_commando_m_pizza"] })).status, 200);
    assert.match((await mark(true, "AthenaCharacter:cid_109_athena_commando_m_pizza")).body.errorMessage, /no styles for its original owners/);
    assert.match((await post(backend.port, `${base}/original-owner`, undefined, { build: v602, templateId: skullTrooper })).body.errorMessage, /true or false/);

    // Off by default: a given Skull Trooper is a later owner's, and nothing notes a purchase.
    assert.deepEqual((await styles()).originalOwner, { season: 1, original: false, marked: false, shopBuild: null, shopVersion: null, shopSeason: null });
    assert.equal((await styles()).variants.some((entry) => entry.owned.includes("Mat1")), false);
    // A cosmetic without such styles has no mark to show.
    assert.equal((await get(backend.port, `${base}/styles?${new URLSearchParams({ build: v602, templateId: "AthenaCharacter:cid_109_athena_commando_m_pizza" })}`)).body.originalOwner, null);

    const marked = await mark(true);
    assert.equal(marked.status, 200);
    assert.deepEqual([marked.body.originalOwnerChange.changed, marked.body.originalOwnerChange.given, marked.body.originalOwnerChange.taken], [true, [purpleGlow], []]);
    assert.deepEqual(marked.body.originalOwnerChange.originalOwner, { season: 1, original: true, marked: true, shopBuild: null, shopVersion: null, shopSeason: null });
    assert.deepEqual(marked.body.originalOwnerChange.variants, [{ channel: "ClothingColor", active: "Mat0", owned: ["Mat0", "Mat2", "Mat1"] }]);
    assert.deepEqual(itemOf(await athenaOf(backend.port, player, v602), skullTrooper).attributes.variants, [{ channel: "ClothingColor", active: "Mat0", owned: ["Mat0", "Mat2", "Mat1"] }]);
    assert.deepEqual([(await mark(true)).body.originalOwnerChange.changed, (await mark(true)).body.originalOwnerChange.given], [false, []]);
    // An original owner's style isn't taken off by hand: it would come back at the next login.
    const off = await post(backend.port, `${base}/styles`, undefined, { build: v602, templateId: skullTrooper, styles: [{ channel: "ClothingColor", tags: ["Mat1"] }], remove: true });
    assert.deepEqual([off.body.styleChange.changed, off.body.styleChange.kept], [false, ["ClothingColor.Mat1"]]);

    // Off again: the Purple Glow goes, and the next login doesn't bring it back.
    const unmarked = await mark(false);
    assert.deepEqual([unmarked.body.originalOwnerChange.changed, unmarked.body.originalOwnerChange.taken], [true, [purpleGlow]]);
    assert.deepEqual(itemOf(await athenaOf(backend.port, player, v602), skullTrooper).attributes.variants, [{ channel: "ClothingColor", active: "Mat0", owned: ["Mat0", "Mat2"] }]);
  } finally {
    backend.close();
  }
});

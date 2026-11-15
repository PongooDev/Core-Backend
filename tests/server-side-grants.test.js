import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { grantCodeRewards } from "../src/friendcodes/rewards.js";
import { athenaQuestLogin, ownsCosmetic, seasonRewardFunctions } from "../src/profiles/athena.js";
import { grant } from "../src/profiles/progress.js";
import { buyBattlePass, buyTiers, seasonNeedsSwitch } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { payCreator } from "../src/store/creatorpayouts.js";
import { grantRealMoneyOffer } from "../src/store/currency.js";
import { configureGifting } from "../src/store/gifting.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { giftCatalogEntry } from "../src/services/mcp/commands/GiftCatalogEntry.js";

// A grant the server makes with no client of the account's asking (a redeem code, a tournament prize, a gift's receiver,
// a web purchase, a creator's payout) reads some build's data, often the newest's; it never moves the profile to that
// build's season (a fresh Season 1 account went to Season 6 that way), its Battle Pass, its challenges or profile0's
// Commander XP scale. The account's next login from its own build is what moves anything.
const v18 = "3724489";
const v36 = "4019403";
const v631 = "4573279";
const outfit = "AthenaCharacter:CID_028_Athena_Commando_F";
const day = 24 * 60 * 60 * 1000;

const schedulesOf = (profile) => Object.values(profile.items).filter((item) => /^challengebundle(schedule)?:/i.test(item.templateId))
  .map((item) => item.templateId.toLowerCase()).sort();
const seasonOf = (profile) => {
  const { season_num: season, book_level: tier, book_purchased: purchased, level } = profile.stats.attributes;
  return { season, tier, purchased, level, schedules: schedulesOf(profile) };
};

function withAccounts(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-server-grants-"));
  try {
    const profiles = createProfileStore(dataDir);
    // A lobby login on a build: the profile set up (and its season taken up) as it opens.
    const login = (build, accountId, then = () => {}) => inBuild(build, () => {
      const session = openSession(profiles, accountId);
      session.profile("athena");
      athenaQuestLogin(session);
      const result = then(session, session.profile("athena").profile);
      session.commit();
      return result;
    });
    // The account's profiles as saved, opened by no build.
    const saved = (accountId) => ({ athena: profiles.load(accountId, "athena"), profile0: profiles.load(accountId, "profile0") });
    return run({ profiles, login, saved });
  } finally {
    configureGifting(undefined);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

// A Season 3 player on 3.6: the Battle Pass, five tiers bought, its challenges; then a lobby login that settles what
// the pass brings at login (its Season 2 promise's tiers), so the profile is as 3.6 leaves it.
function playSeasonThree(login, accountId) {
  login(v36, accountId, (session) => {
    grant(session, "Currency:MtxPurchased", 10000);
    buyBattlePass(session, seasonRewardFunctions());
    buyTiers(session, 5, seasonRewardFunctions());
  });
  return login(v36, accountId, (session, profile) => seasonOf(profile));
}

test("a redeem code's or prize's cosmetic, read in the newest build, leaves a Season 3 profile's season, tier and challenges", () => withAccounts(({ profiles, login, saved }) => {
  const before = playSeasonThree(login, "player");
  assert.equal(before.season, 3);
  assert.equal(before.purchased, true);
  assert.ok(before.tier > 1 && before.schedules.some((id) => id.includes("season3")), "the pass's tiers and Season 3's challenges");
  const xpScale = saved("player").profile0.coreXpScale;

  // As the portal's redeem and tournaments/payouts.js give: a session opened by no build, the outfit read in 6.31's data,
  // Save the World's access token in 1.8's.
  const session = openSession(profiles, "player");
  const given = grantCodeRewards(session, { vbucks: 500, campaignAccess: true, items: [{ templateId: outfit }] });
  session.commit();
  assert.ok(given.length >= 2, `given: ${given.join(", ")}`);

  const { athena, profile0 } = saved("player");
  assert.deepEqual(seasonOf(athena), before, "still Season 3, its tier, pass and challenges");
  assert.ok(Object.values(athena.items).some((item) => item.templateId.toLowerCase() === outfit.toLowerCase()), "the outfit is given");
  assert.equal(profile0.coreXpScale, xpScale, "profile0's Commander XP scale is as 3.6 left it");

  // Its own build finds nothing to move; 6.31's first login is what takes up Season 6.
  login(v36, "player", (s, profile) => {
    assert.deepEqual(seasonOf(profile), before);
    assert.equal(seasonNeedsSwitch(profile), false);
  });
  login(v631, "player", (s, profile) => assert.equal(profile.stats.attributes.season_num, 6));
}));

test("a fresh account last seen on 1.8 stays in Season 1 when a prize is given (the report's Season 1 to Season 6)", () => withAccounts(({ profiles, login, saved }) => {
  login(v18, "fresh");
  assert.equal(saved("fresh").athena.stats.attributes.season_num ?? 1, 1);
  const session = openSession(profiles, "fresh");
  grantCodeRewards(session, { items: [{ templateId: outfit }] });
  session.commit();
  assert.equal(saved("fresh").athena.stats.attributes.season_num ?? 1, 1);
  assert.equal(saved("fresh").athena.coreSeasons, undefined, "no season set aside");
}));

test("a gift from a 6.31 sender, a web purchase and a creator's payout leave the receiver's season as theirs", () => withAccounts(({ profiles, login, saved }) => {
  const before = playSeasonThree(login, "receiver");
  const xpScale = saved("receiver").profile0.coreXpScale;

  // 6.31's GiftCatalogEntry, the receiver a friend of three days.
  inBuild(v631, () => {
    const offer = [...itemShopOffers().BRDailyStorefront, ...itemShopOffers().BRWeeklyStorefront].find((entry) => entry.athena && entry.price > 0);
    const sessions = new Map();
    const sessionFor = (accountId) => sessions.get(accountId) ?? sessions.set(accountId, openSession(profiles, accountId)).get(accountId);
    const created = new Date(Date.now() - 3 * day).toISOString();
    const friends = { get: () => ({ status: "ACCEPTED", created }) };
    grant(sessionFor("sender"), "Currency:MtxPurchased", 5000);
    giftCatalogEntry({ req: { body: { offerId: offer.offerId, receiverAccountIds: ["receiver"] } }, session: sessionFor("sender"), sessionFor,
      context: { friends, settings: { get: () => ({}) } } });
    assert.ok(ownsCosmetic(sessionFor("receiver"), offer.templateId), "the gift is given");
    for (const session of sessions.values()) session.commit();
  });
  assert.deepEqual(seasonOf(saved("receiver").athena), before, "a gift keeps Season 3");

  // A real-money offer of Season 6's cosmetics, bought on the purchase page (no build).
  const bought = openSession(profiles, "receiver");
  grantRealMoneyOffer(bought, { offerId: "test", grants: [], season: 6, cosmetics: [outfit] }, "T1");
  bought.commit();
  assert.deepEqual(seasonOf(saved("receiver").athena), before, "a web purchase keeps Season 3");

  // A supporter on 6.31 buying with the receiver's creator code.
  inBuild(v631, () => {
    const buyer = openSession(profiles, "buyer");
    buyer.profile("profile0").profile.stats.attributes.mtx_affiliate = "receivercode";
    const creatorSession = openSession(profiles, "receiver");
    const paid = payCreator({ session: buyer, sessionFor: () => creatorSession, offerId: "offer", spent: 1000,
      settingsValue: { creators: [{ code: "receivercode", accountId: "receiver", enabled: true }] } });
    creatorSession.commit();
    if (paid) assert.equal(paid.creatorAccountId, "receiver");
  });
  assert.equal(saved("receiver").profile0.coreXpScale, xpScale, "profile0's Commander XP scale is as 3.6 left it");
  assert.deepEqual(seasonOf(saved("receiver").athena), before);
}));

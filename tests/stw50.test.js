import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { blockbusterConversion, blockbusterLlama, blockbusterTickets } from "../src/events/blockbuster2018.js";
import { configureEvents, isEventActive, roadTrip2018 } from "../src/events/events.js";
import { convertEventLeftovers } from "../src/events/leftovers.js";
import { getQuest } from "../src/gamedata/quests.js";
import { foundersEditionOf, foundersEditions, foundersTokensMigration, setFoundersEdition, setUpFoundersTokens, trollStashToken }
  from "../src/profiles/founders.js";
import { grantItem } from "../src/profiles/items.js";
import { openSession } from "../src/profiles/session.js";
import { needsSetUp } from "../src/profiles/setup.js";
import { createProfileStore } from "../src/profiles/store.js";
import { storefronts } from "../src/store/catalog.js";
import { findRealMoneyOffer, foundersOffers, grantRealMoneyOffer, offerBlocked } from "../src/store/currency.js";
import { eventStoreEnds, eventStoreOffers, eventStorefront, hasEventStore, weeklyStorefront } from "../src/store/eventstore.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #300: Update v5.00's Save the World notes.
const v500 = "4204761";
const v50 = "4214610";
const v45 = "4166199";
const v42 = "4072250";
const now = new Date("2026-11-09T12:00:00Z");

function withStore(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-stw50-"));
  try {
    return run(createProfileStore(dataDir));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
const total = (session, templateId) => Object.values(session.profile("profile0").profile.items)
  .filter((item) => item.templateId.toLowerCase() === templateId.toLowerCase()).reduce((sum, item) => sum + item.quantity, 0);

test("5.0 ends Blockbuster: its tickets become Blockbuster Llamas, one a 500 and one more for what is left over, once", () => withStore((store) => {
  assert.equal(inBuild(v45, () => blockbusterConversion.due()), false, "Blockbuster still runs on 4.5");
  for (const build of [v500, v50]) assert.equal(inBuild(build, () => blockbusterConversion.due()), true, build);
  inBuild(v45, () => {
    const session = openSession(store, "blockbuster");
    grantItem(session, blockbusterTickets, 1234);
    assert.deepEqual(convertEventLeftovers(session).filter(({ templateId }) => templateId === blockbusterLlama), []);
    session.commit();
  });
  inBuild(v50, () => {
    const session = openSession(store, "blockbuster");
    convertEventLeftovers(session);
    assert.equal(total(session, blockbusterLlama), 3, "1,234 tickets: two of 500 and one for the 234 left over");
    assert.equal(total(session, blockbusterTickets), 0);
    assert.ok(session.profile("profile0").profile.coreMigrations.includes("eventLeftovers.Blockbuster2018"));
    // Once: tickets earned afterwards (on 4.5) stay.
    grantItem(session, blockbusterTickets, 600);
    convertEventLeftovers(session);
    assert.equal(total(session, blockbusterTickets), 600);
    assert.equal(total(session, blockbusterLlama), 3);
  });
  inBuild(v500, () => {
    const session = openSession(store, "exact");
    grantItem(session, blockbusterTickets, 1000);
    convertEventLeftovers(session);
    assert.equal(total(session, blockbusterLlama), 2, "exactly 1,000: two, no extra");
  });
}));

const weeklyIds = (build) => inBuild(build, () => eventStoreOffers(now)[weeklyStorefront].map(({ templateId }) => templateId));
const perkUps = ["AccountResource:reagent_alteration_generic", "AccountResource:reagent_alteration_upgrade_uc", "AccountResource:reagent_alteration_upgrade_r"];

test("5.0's persistent Weekly Store offers RE-PERK!, Uncommon and Rare PERK-UP!; 4.2 to 4.5 keep all five", () => {
  for (const build of [v500, v50]) {
    const ids = weeklyIds(build);
    for (const templateId of perkUps) assert.ok(ids.includes(templateId), `${build} ${templateId}`);
    assert.ok(!ids.includes("AccountResource:reagent_alteration_upgrade_vr") && !ids.includes("AccountResource:reagent_alteration_upgrade_sr"), build);
  }
  for (const build of [v42, v45]) {
    const ids = weeklyIds(build);
    for (const templateId of [...perkUps, "AccountResource:reagent_alteration_upgrade_vr", "AccountResource:reagent_alteration_upgrade_sr"]) {
      assert.ok(ids.includes(templateId), `${build} ${templateId}`);
    }
  }
});

test("5.0's Weekly Store stays open with no event running, its event section empty; 4.5's closes", () => {
  configureEvents({ mode: "auto", season4Flags: { overrides: { "EventFlag.RoadTrip2018": "off" } } });
  try {
    assert.equal(inBuild(v50, () => isEventActive(roadTrip2018)), false);
    assert.equal(inBuild(v50, hasEventStore), true);
    const offers = inBuild(v50, () => eventStoreOffers(now));
    assert.deepEqual(offers[eventStorefront], []);
    for (const templateId of perkUps) assert.ok(offers[weeklyStorefront].some((offer) => offer.templateId === templateId));
    const ends = inBuild(v50, () => eventStoreEnds(now));
    assert.deepEqual(ends.stwEventStoreEnd, ends.stwWeeklyStoreEnd);
  } finally {
    configureEvents(null);
  }
});

test("5.0's founders quests give Legendary Troll Stash Llama tokens where earlier builds gave friend codes", () => {
  const rewards = (build, questId) => inBuild(build, () => getQuest(questId).rewards
    .filter(({ templateId }) => /jackpot|friendcode/i.test(templateId)).map(({ templateId, quantity }) => `${quantity} ${templateId}`));
  assert.deepEqual(rewards(v45, "foundersquest_getrewards_2_3"), ["1 ConsumableAccountItem:foundersfriendcode"]);
  assert.deepEqual(["foundersquest_getrewards_2_3", "foundersquest_getrewards_3_4", "foundersquest_getrewards_4_5"].map((id) => rewards(v500, id)),
    [[`5 ${trollStashToken}`], [`5 ${trollStashToken}`], [`10 ${trollStashToken}`]]);
});

// An account whose edition quests up to `edition` were claimed (before 5.0), and those above it held unclaimed.
function founder(store, accountId, edition, claimedUpTo = edition) {
  inBuild(v45, () => {
    const session = openSession(store, accountId);
    const tracker = session.profile("profile0");
    for (const step of foundersEditions.slice(0, edition)) {
      tracker.addItem(`token-${step.edition}`, { templateId: step.token, quantity: 1, attributes: {} });
      tracker.addItem(`quest-${step.edition}`, { templateId: `Quest:${step.quest}`, quantity: 1,
        attributes: { quest_state: step.edition <= claimedUpTo ? "Claimed" : "Completed" } });
    }
    session.commit();
  });
}

test("existing founders get their edition's Troll Stash tokens once on 5.0: Super Deluxe 5, Limited 10, Ultimate 20", () => withStore((store) => {
  for (const [accountId, edition, tokens] of [["standard", 1, 0], ["deluxe", 2, 0], ["superdeluxe", 3, 5], ["limited", 4, 10], ["ultimate", 5, 20]]) {
    founder(store, accountId, edition);
    // Not before 5.0.
    inBuild(v45, () => {
      const session = openSession(store, accountId);
      assert.equal(setUpFoundersTokens(session), 0);
    });
    // Opening the session on 5.0 sets the profile up (profiles/setup.js).
    inBuild(v50, () => {
      const session = openSession(store, accountId);
      assert.equal(needsSetUp(session.profile("profile0").profile), false, accountId);
      assert.equal(total(session, trollStashToken), tokens, accountId);
      assert.ok(session.profile("profile0").profile.coreMigrations.includes(foundersTokensMigration));
      assert.equal(setUpFoundersTokens(session), 0, "once");
      assert.equal(total(session, trollStashToken), tokens);
    });
  }
  // A quest not claimed yet gives its own tokens when claimed on 5.0, so the migration leaves it out.
  founder(store, "unclaimed", 5, 3);
  inBuild(v500, () => {
    const session = openSession(store, "unclaimed");
    assert.equal(total(session, trollStashToken), 5, "Super Deluxe's only: Limited's and Ultimate's quests give theirs");
  });
}));

const foundersFront = (build, profile0, accountId = "buyer") => inBuild(build, () => storefronts(profile0, now, { accountId, vbuckPacks: true })
  .find(({ name }) => name === "FoundersPack"));
const editionProfile = (edition) => ({ items: Object.fromEntries(foundersEditions.slice(0, edition)
  .map((step) => [step.token, { templateId: step.token, quantity: 1, attributes: {} }])) });

test("5.0's Store tab sells the Super Deluxe and Limited Founder's Packs: outright, or as the upgrade from the account's edition", () => {
  const offers = (edition) => foundersFront(v50, editionProfile(edition))?.catalogEntries
    .map((entry) => [entry.offerId, entry.displayAssetPath.split(".").pop(), entry.prices[0].currencyType]) ?? [];
  assert.deepEqual(offers(0), [["core_founders_0_3", "DA_FoundersPack_3", "RealMoney"], ["core_founders_0_4", "DA_FoundersPack_4", "RealMoney"]]);
  assert.deepEqual(offers(1).map(([id, asset]) => [id, asset]), [["core_founders_1_3", "DA_FoundersPack_1_3"], ["core_founders_1_4", "DA_FoundersPack_1_4"]]);
  assert.deepEqual(offers(2).map(([id]) => id), ["core_founders_2_3", "core_founders_2_4"]);
  assert.deepEqual(offers(3).map(([id, asset]) => [id, asset]), [["core_founders_3_4", "DA_FoundersPack_3_4"]]);
  assert.deepEqual(offers(4), [], "Limited and Ultimate founders have nothing to buy");
  assert.deepEqual(offers(5), []);
  assert.equal(foundersFront(v500, editionProfile(1)).catalogEntries.length, 2, "on the launch build too");
  // Not before 5.0, nor in the V-Bucks storefront.
  for (const build of [v45, "3915963"]) assert.equal(foundersFront(build, editionProfile(1)), undefined, build);
  assert.ok(!inBuild(v50, () => storefronts(editionProfile(1), now, { accountId: "buyer", vbuckPacks: true })
    .find(({ name }) => name === "CurrencyStorefront").catalogEntries.some(({ offerId }) => offerId.startsWith("core_founders"))));
  // Off with the packs.
  assert.equal(inBuild(v50, () => storefronts(editionProfile(1), now, { accountId: "buyer", vbuckPacks: false })
    .find(({ name }) => name === "FoundersPack")), undefined);
  assert.deepEqual(inBuild(v50, () => foundersOffers(undefined, editionProfile(1))), []);
  // An upgrade costs the difference of Epic's list prices.
  assert.deepEqual(["core_founders_0_3", "core_founders_1_4", "core_founders_3_4"].map((id) => findRealMoneyOffer(id).price), [8999, 14999 - 3999, 14999 - 8999]);
});

test("buying a Founder's Pack raises the edition with 5.0's quests, and the offer for the old edition is refused afterwards", () => withStore((store) => {
  founder(store, "upgrader", 1);
  const offer = findRealMoneyOffer("core_founders_1_4");
  const session = openSession(store, "upgrader");
  assert.equal(offerBlocked(offer, session.profile("profile0").profile), null);
  const granted = grantRealMoneyOffer(session, offer, "T1").map(({ templateId }) => templateId);
  assert.deepEqual(granted, ["Token:campaignaccess", "Token:founderspack_2", "Quest:foundersquest_getrewards_1_2", "Token:founderspack_3", "Quest:foundersquest_getrewards_2_3",
    "Token:founderspack_4", "Quest:foundersquest_getrewards_3_4", "Quest:foundersquest_chooseherobundle"]);
  const { profile } = session.profile("profile0");
  assert.equal(foundersEditionOf(profile), 4);
  assert.match(offerBlocked(offer, profile), /another edition/);
  assert.match(offerBlocked(findRealMoneyOffer("core_founders_1_3"), profile), /another edition/);
  assert.equal(profile.stats.attributes.in_app_purchases.fulfillmentCounts.core_founders_1_4, 1);
  // setFoundersEdition is unchanged for the admin panel.
  assert.ok(setFoundersEdition(session, 3).error);
}));

test("the Founder's Pack purchase page sells on 5.0 and refuses a second buy of the same upgrade", async () => {
  const backend = await startBackend();
  try {
    const agent = `game=FortniteGame, engine=UE4, build=++Fortnite+Release-5.0-CL-${v50}`;
    const player = await userLogin(backend.port, "FoundersBuyer");
    const headers = { "User-Agent": agent, Authorization: `bearer ${player.token}` };
    // The account's profile0 is set up (Standard Edition by default) by its first query.
    await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=profile0&rvn=-1`,
      headers: { ...headers, "Content-Type": "application/json", "Content-Length": 2 } }, "{}");
    const body = (await send({ host: "127.0.0.1", port: backend.port, path: "/fortnite/api/storefront/v2/catalog", headers })).body;
    const front = body.storefronts.find(({ name }) => name === "FoundersPack");
    assert.deepEqual(front.catalogEntries.map(({ offerId }) => offerId), ["core_founders_1_3", "core_founders_1_4"]);
    const id = front.catalogEntries[0].appStoreId[1];
    const open = () => send({ host: "127.0.0.1", port: backend.port, path: `/purchase?showNavigation=true&namespace=fn&offers=${id}&analyticsSessionId=x`,
      headers: { "User-Agent": agent } });
    const page = await open();
    assert.equal(page.status, 200);
    assert.match(page.body, /Super Deluxe/);
    const purchaseId = /name="purchaseId" value="([^"]+)"/.exec(page.body)[1];
    const form = `purchaseId=${encodeURIComponent(purchaseId)}`;
    const done = await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/purchase/complete",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(form), Origin: `http://127.0.0.1:${backend.port}` } }, form);
    assert.equal(done.status, 200);
    assert.equal(done.body.receipt.TransactionState, "Purchased");
    assert.equal((await open()).status, 409, "now Super Deluxe: the Standard upgrade is refused");
    const after = (await send({ host: "127.0.0.1", port: backend.port, path: "/fortnite/api/storefront/v2/catalog", headers })).body;
    assert.deepEqual(after.storefronts.find(({ name }) => name === "FoundersPack").catalogEntries.map(({ offerId }) => offerId), ["core_founders_3_4"]);
  } finally {
    backend.close();
  }
});

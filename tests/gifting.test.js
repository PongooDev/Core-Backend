import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { McpError } from "../src/errors.js";
import { grantCosmetic, ownsCosmetic } from "../src/profiles/athena.js";
import { grant } from "../src/profiles/progress.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { giftCatalogEntry } from "../src/services/mcp/commands/GiftCatalogEntry.js";
import { createSettingsStore } from "../src/settings/store.js";
import { configureGifting, giftInfoOf, giftingRuntimeOptions, giftsInLastDay, notEligibleError, receiverErrors } from "../src/store/gifting.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { post, send, startBackend, userLogin } from "./helpers.js";

// 6.31's item shop gifting (store/gifting.js): Epic opened it with 6.31 (CL-4573279); 6.30 and before stay as they were.
const v631 = "4573279";
const v630 = "4573096";
const v36 = "4019403";
const day = 24 * 60 * 60 * 1000;
const agentOf = (build, version) => `game=Fortnite, engine=UE4, build=++Fortnite+Release-${version}-CL-${build}`;

const shopOffer = () => [...itemShopOffers().BRDailyStorefront, ...itemShopOffers().BRWeeklyStorefront].find((offer) => offer.athena && offer.price > 0);

test("giftInfo and the hotfix: 6.31 and later only, on by default, off with the admin switch", () => {
  const offer = { athena: true, currencyType: "MtxCurrency", templateId: "AthenaCharacter:cid_x", price: 800 };
  assert.equal(giftInfoOf(offer, v630, {}), undefined, "6.30 gets no giftInfo");
  assert.equal(giftInfoOf(offer, v36, {}), undefined);
  assert.deepEqual(giftInfoOf(offer, v631, {}), { bIsEnabled: true, forcedGiftBoxTemplateId: "",
    purchaseRequirements: [{ requirementType: "DenyOnItemOwnership", requiredId: "AthenaCharacter:cid_x", minQuantity: 1 }] });
  assert.equal(giftInfoOf(offer, v631, { gifting: false }).bIsEnabled, false);
  assert.equal(giftInfoOf({ ...offer, seasonLevel: 5 }, v631, {}).bIsEnabled, false, "not the Season Shop");
  assert.equal(giftInfoOf({ battlePass: "pass", currencyType: "MtxCurrency" }, v631, {}).bIsEnabled, false, "not the Battle Pass");

  assert.deepEqual(giftingRuntimeOptions(v630, {}), []);
  assert.deepEqual(giftingRuntimeOptions(v631, {}), ["bDisableGifting=false", "bCanGiftYourself=false", "GiftLimitAmount=3", "DaysOfFriendshipBeforeCanGift=2"]);
  assert.deepEqual(giftingRuntimeOptions(v631, { giftingFriendDays: 0 }).at(-1), "DaysOfFriendshipBeforeCanGift=0");
  assert.deepEqual(giftingRuntimeOptions(v631, { gifting: false }), ["bDisableGifting=true"]);

  const store = createSettingsStore(null);
  assert.deepEqual([store.get().gifting, store.get().giftingFriendDays], [true, 2]);
  store.update({ gifting: false, giftingFriendDays: 31 });
  assert.deepEqual([store.get().gifting, store.get().giftingFriendDays], [false, 2], "31 days is out of range");
  store.update({ giftingFriendDays: 0 });
  assert.equal(store.get().giftingFriendDays, 0);
});

// A sender, receivers and friendships, in one build.
function world(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-gifting-"));
  try {
    return inBuild(v631, () => {
      const profiles = createProfileStore(dataDir);
      const sessions = new Map();
      const sessionFor = (accountId) => (accountId === "nobody" ? null : sessions.get(accountId) ?? sessions.set(accountId, openSession(profiles, accountId)).get(accountId));
      const friendships = new Map();
      const befriend = (a, b, daysAgo = 3, status = "ACCEPTED") => {
        const created = new Date(Date.now() - daysAgo * day).toISOString();
        friendships.set(`${a}|${b}`, { status, created });
        friendships.set(`${b}|${a}`, { status, created });
      };
      const friends = { get: (owner, other) => friendships.get(`${owner}|${other}`) };
      let settingsValue = {};
      const context = { friends, settings: { get: () => settingsValue } };
      const gift = (body, sender = "sender") => giftCatalogEntry({ req: { body }, session: sessionFor(sender), sessionFor, context });
      const vbucks = (accountId) => Object.values(sessionFor(accountId).profile("profile0").profile.items)
        .filter(({ templateId }) => templateId.toLowerCase().startsWith("currency:mtx")).reduce((sum, item) => sum + item.quantity, 0);
      return fn({ sessionFor, befriend, gift, vbucks, setSettings: (value) => { settingsValue = value; } });
    });
  } finally {
    configureGifting(undefined);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

const refusal = (run) => {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof McpError, String(error));
    return error;
  }
  assert.fail("the gift went through");
};

test("a gift charges the sender and gives each receiver the item and a gift box from them, with the message", () => world(({ sessionFor, befriend, gift, vbucks }) => {
  const offer = shopOffer();
  assert.ok(offer, "6.31's shop has a cosmetic");
  grant(sessionFor("sender"), "Currency:MtxPurchased", 5000);
  befriend("sender", "alice");
  befriend("sender", "bob");
  gift({ offerId: offer.offerId, currency: "MtxCurrency", currencySubType: "", expectedTotalPrice: offer.price * 2,
    receiverAccountIds: ["alice", "bob"], giftWrapTemplateId: "GiftBox:gb_giftwrap2", personalMessage: "Happy holidays" });

  assert.equal(vbucks("sender"), 5000 - offer.price * 2);
  assert.ok(!ownsCosmetic(sessionFor("sender"), offer.templateId), "the sender gets nothing");
  for (const receiver of ["alice", "bob"]) {
    const session = sessionFor(receiver);
    assert.ok(ownsCosmetic(session, offer.templateId), `${receiver} owns it`);
    const boxes = Object.values(session.profile("profile0").profile.items).filter(({ templateId }) => templateId.startsWith("GiftBox:"));
    assert.equal(boxes.length, 1);
    const [box] = boxes;
    assert.equal(box.templateId, "GiftBox:GB_GiftWrap2");
    assert.equal(box.attributes.fromAccountId, "sender");
    assert.equal(box.attributes.params.userMessage, "Happy holidays");
    assert.ok(box.attributes.lootList.some(({ itemType, itemProfile }) => itemType.toLowerCase() === offer.templateId.toLowerCase() && itemProfile === "athena"));
    assert.equal(session.profile("profile0").profile.stats.attributes.gift_history.receivedFrom.sender, box.attributes.giftedOn);
  }
  const history = sessionFor("sender").profile("profile0").profile.stats.attributes.gift_history;
  assert.equal(history.num_sent, 2);
  assert.deepEqual(history.gifts.map(({ toAccountId, offerId }) => [toAccountId, offerId]), [["alice", offer.offerId], ["bob", offer.offerId]]);
  assert.equal(giftsInLastDay(sessionFor("sender").profile("profile0")), 2, "the client's daily count");

  // A wrap the client doesn't offer is the default box; the third gift of the day is the last.
  befriend("sender", "carol");
  befriend("sender", "dave");
  gift({ offerId: offer.offerId, receiverAccountIds: ["carol"], giftWrapTemplateId: "GiftBox:GB_BattlePass" });
  assert.equal(Object.values(sessionFor("carol").profile("profile0").profile.items).find(({ templateId }) => templateId.startsWith("GiftBox:")).templateId, "GiftBox:GB_Default");
  const limit = refusal(() => gift({ offerId: offer.offerId, receiverAccountIds: ["dave"] }));
  assert.match(limit.message, /3 gifts in 24 hours/);
  assert.ok(!ownsCosmetic(sessionFor("dave"), offer.templateId));
}));

test("refused receivers: not friends (or not long enough), opted out, already owning it; nothing is charged or given", () => world(({ sessionFor, befriend, gift, vbucks, setSettings }) => {
  const offer = shopOffer();
  grant(sessionFor("sender"), "Currency:MtxPurchased", 5000);
  befriend("sender", "newfriend", 1);
  befriend("sender", "pending", 5, "PENDING");
  befriend("sender", "optedout");
  sessionFor("optedout").profile("profile0").setStat("allowed_to_receive_gifts", false);
  befriend("sender", "owner");
  grantCosmetic(sessionFor("owner"), offer.templateId);
  befriend("sender", "friend");

  // At most three receivers in a day: two refused gifts of three.
  const first = refusal(() => gift({ offerId: offer.offerId, receiverAccountIds: ["stranger", "newfriend", "pending"] }));
  assert.equal(first.errorCode, notEligibleError);
  assert.deepEqual(first.messageVars, ["[stranger, newfriend, pending]", `[${Array(3).fill(receiverErrors.notFriend).join(", ")}]`]);
  const second = refusal(() => gift({ offerId: offer.offerId, receiverAccountIds: ["optedout", "owner", "friend"] }));
  assert.deepEqual(second.messageVars, ["[optedout, owner]", `[${receiverErrors.optedOut}, ${receiverErrors.owned}]`]);
  assert.deepEqual(refusal(() => gift({ offerId: offer.offerId, receiverAccountIds: ["sender"] })).messageVars, ["[sender]", `[${receiverErrors.notFriend}]`],
    "not to yourself");
  assert.equal(vbucks("sender"), 5000, "nothing was paid");
  assert.ok(!ownsCosmetic(sessionFor("friend"), offer.templateId), "an eligible friend in a refused gift gets nothing");

  // A friend of one day can be sent gifts once the panel asks for no days.
  setSettings({ giftingFriendDays: 0 });
  gift({ offerId: offer.offerId, receiverAccountIds: ["newfriend"] });
  assert.ok(ownsCosmetic(sessionFor("newfriend"), offer.templateId));
}));

test("not enough V-Bucks, a wrong price, an offer that isn't the shop's, and gifting off", () => world(({ sessionFor, befriend, gift, vbucks, setSettings }) => {
  const offer = shopOffer();
  befriend("sender", "alice");
  grant(sessionFor("sender"), "Currency:MtxPurchased", offer.price - 1);
  assert.equal(refusal(() => gift({ offerId: offer.offerId, receiverAccountIds: ["alice"] })).errorCode, "errors.com.epicgames.currency.mtx.insufficient");
  grant(sessionFor("sender"), "Currency:MtxPurchased", 10000);
  assert.equal(refusal(() => gift({ offerId: offer.offerId, expectedTotalPrice: offer.price + 1, receiverAccountIds: ["alice"] })).errorCode,
    "errors.com.epicgames.modules.gamesubcatalog.price_mismatch");
  assert.equal(refusal(() => gift({ offerId: "core_no_such_offer", receiverAccountIds: ["alice"] })).errorCode,
    "errors.com.epicgames.modules.gamesubcatalog.catalog_out_of_date");
  assert.equal(refusal(() => gift({ offerId: offer.offerId, receiverAccountIds: [] })).errorCode, "errors.com.epicgames.common.invalid_parameter");
  setSettings({ gifting: false });
  assert.match(refusal(() => gift({ offerId: offer.offerId, receiverAccountIds: ["alice"] })).message, /Gifting is off/);
  assert.equal(vbucks("sender"), offer.price - 1 + 10000);
  assert.ok(!ownsCosmetic(sessionFor("alice"), offer.templateId));
}));

test("6.30 is unchanged: no giftInfo, no gifting hotfix, GiftCatalogEntry refused", () => world(({ befriend, gift }) => {
  const offer = shopOffer();
  befriend("sender", "alice");
  inBuild(v630, () => {
    assert.match(refusal(() => gift({ offerId: offer.offerId, receiverAccountIds: ["alice"] })).message, /Gifting is off/);
  });
}));

test("6.31 end to end: the catalog's giftInfo, the hotfix, GiftCatalogEntry and its refusal's messageVars, the receiver's box", async () => {
  const backend = await startBackend();
  try {
    const sender = await userLogin(backend.port, "Giver631");
    const receiver = await userLogin(backend.port, "Getter631");
    const stranger = await userLogin(backend.port, "Stranger631");
    const call = (player, method, route, body, build = v631, version = "6.31") => {
      const text = body === undefined ? undefined : JSON.stringify(body);
      return send({ host: "127.0.0.1", port: backend.port, method, path: route,
        headers: { "User-Agent": agentOf(build, version), Authorization: `bearer ${player.token}`, ...(text ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } : {}) } }, text);
    };
    const mcp = (player, command, profileId, body = {}) => call(player, "POST", `/fortnite/api/game/v2/profile/${player.accountId}/client/${command}?profileId=${profileId}&rvn=-1`, body);
    const profileOf = (body, profileId) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === profileId).profileChanges[0].profile;
    const entries = (fronts) => fronts.filter(({ name }) => name === "BRDailyStorefront" || name === "BRWeeklyStorefront").flatMap(({ catalogEntries }) => catalogEntries);

    const offers = entries((await call(sender, "GET", "/fortnite/api/storefront/v2/catalog")).body.storefronts);
    const offer = offers.find((entry) => entry.prices?.[0]?.currencyType === "MtxCurrency" && entry.prices[0].finalPrice > 0);
    assert.ok(offer);
    assert.equal(offer.giftInfo.bIsEnabled, true);
    assert.ok(entries((await call(sender, "GET", "/fortnite/api/storefront/v2/catalog", undefined, v630, "6.30")).body.storefronts).every((entry) => !("giftInfo" in entry)),
      "6.30's catalog has no giftInfo");
    const options = String((await call(sender, "GET", "/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini")).body);
    assert.match(options, /bDisableGifting=false\r\nbCanGiftYourself=false\r\nGiftLimitAmount=3\r\nDaysOfFriendshipBeforeCanGift=2\r\n/);
    assert.doesNotMatch(String((await call(sender, "GET", "/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini", undefined, v630, "6.30")).body), /Gift/);

    const core = profileOf((await mcp(sender, "QueryProfile", "common_core")).body, "common_core");
    assert.deepEqual([core.stats.attributes.allowed_to_send_gifts, core.stats.attributes.allowed_to_receive_gifts, core.stats.attributes.mfa_enabled], [true, true, true]);
    await mcp(receiver, "QueryProfile", "athena");
    assert.equal((await post(backend.port, `/admin/api/accounts/${sender.accountId}/currency`, undefined, { key: "vbucks", quantity: 5000 })).status, 200);
    // Friends just now: a gift needs no days once the panel says so.
    await call(sender, "POST", `/friends/api/public/friends/${sender.accountId}/${receiver.accountId}`);
    await call(receiver, "POST", `/friends/api/public/friends/${receiver.accountId}/${sender.accountId}`);
    assert.equal((await post(backend.port, "/admin/api/settings", undefined, { giftingFriendDays: 0 })).body.giftingFriendDays, 0);

    const price = offer.prices[0].finalPrice;
    const refused = await mcp(sender, "GiftCatalogEntry", "common_core", { offerId: offer.offerId, currency: "MtxCurrency", currencySubType: "",
      expectedTotalPrice: price * 2, gameContext: "", receiverAccountIds: [receiver.accountId, stranger.accountId], giftWrapTemplateId: "GiftBox:GB_GiftWrap1", personalMessage: "hi" });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.errorCode, notEligibleError);
    assert.deepEqual(refused.body.messageVars, [`[${stranger.accountId}]`, `[${receiverErrors.notFriend}]`]);

    const sent = await mcp(sender, "GiftCatalogEntry", "common_core", { offerId: offer.offerId, currency: "MtxCurrency", currencySubType: "",
      expectedTotalPrice: price, gameContext: "", receiverAccountIds: [receiver.accountId], giftWrapTemplateId: "GiftBox:GB_GiftWrap1", personalMessage: "hi" });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const senderCore = profileOf(sent.body, "common_core");
    assert.equal(senderCore.stats.attributes.gift_history.gifts.length, 1);

    const theirs = profileOf((await mcp(receiver, "QueryProfile", "common_core")).body, "common_core");
    const [boxId, box] = Object.entries(theirs.items).find(([, item]) => item.templateId === "GiftBox:GB_GiftWrap1");
    assert.equal(box.attributes.fromAccountId, sender.accountId);
    assert.equal((await mcp(receiver, "RemoveGiftBox", "common_core", { giftBoxItemId: boxId })).status, 200);
    const athena = profileOf((await mcp(receiver, "QueryProfile", "athena")).body, "athena");
    assert.ok(Object.values(athena.items).some(({ templateId }) => templateId.toLowerCase() === offer.itemGrants[0].templateId.toLowerCase()));

    // Off in the panel: the catalog's giftInfo is off and the hotfix turns gifting off.
    await post(backend.port, "/admin/api/settings", undefined, { gifting: false });
    assert.equal(entries((await call(sender, "GET", "/fortnite/api/storefront/v2/catalog")).body.storefronts).find((entry) => entry.offerId === offer.offerId).giftInfo.bIsEnabled, false);
    assert.match(String((await call(sender, "GET", "/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini")).body), /bDisableGifting=true/);
  } finally {
    backend.close();
  }
});

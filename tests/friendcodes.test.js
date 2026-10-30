import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { post, send, startBackend, userLogin } from "./helpers.js";

const admin = (backend, urlPath, body, method) => (body === undefined && !method
  ? send({ host: "127.0.0.1", port: backend.port, method: "GET", path: `/admin/api${urlPath}` })
  : send({ host: "127.0.0.1", port: backend.port, method: method || "POST", path: `/admin/api${urlPath}`,
    headers: { "Content-Type": "application/json" } }, body !== undefined ? JSON.stringify(body) : undefined));

const redeem = (backend, username, password, code) =>
  post(backend.port, "/api/redeem", undefined, { username, password, code });

const agents = { "1.8": "game=Fortnite, engine=UE4, build=++Fortnite+Release-Live-CL-3724489" };

function as(build, port, method, urlPath, token, body) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": agents[build], Authorization: `bearer ${token}` };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
}

const command = (port, { accountId, token }, name, profileId, body = {}) =>
  as("1.8", port, "POST", `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`, token, body);
const updateOf = (body, profileId) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === profileId);
const queryProfile = async (port, player, profileId) =>
  updateOf((await command(port, player, "QueryProfile", profileId)).body, profileId).profileChanges[0].profile;

test("isolated standalone portals (/redeem, /register, /change-password, /email, /reset-password)", async () => {
  const backend = await startBackend();
  try {
    // 1. /redeem page
    const redeemRes = await send({ host: "127.0.0.1", port: backend.port, path: "/redeem" });
    assert.equal(redeemRes.status, 200);
    assert.ok(redeemRes.body.includes('id="form-redeem"'));
    assert.ok(redeemRes.body.includes('isStandalone = true'));

    // 2. /register page
    const regRes = await send({ host: "127.0.0.1", port: backend.port, path: "/register" });
    assert.equal(regRes.status, 200);
    assert.ok(regRes.body.includes('id="form-register"'));

    // 3. /change-password page
    const chgRes = await send({ host: "127.0.0.1", port: backend.port, path: "/change-password" });
    assert.equal(chgRes.status, 200);
    assert.ok(chgRes.body.includes('id="form-change"'));

    // 4. /email page
    const emlRes = await send({ host: "127.0.0.1", port: backend.port, path: "/email" });
    assert.equal(emlRes.status, 200);
    assert.ok(emlRes.body.includes('id="form-email"'));

    // 5. /portal page (central hub)
    const hubRes = await send({ host: "127.0.0.1", port: backend.port, path: "/portal" });
    assert.equal(hubRes.status, 200);
    assert.ok(hubRes.body.includes('id="portal-tabs"'));
  } finally {
    await backend.close();
  }
});

test("defaultFoundersAccess setting toggle and new account access", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-founders-test-"));
  // Start backend with defaultFoundersAccess: false
  const backend = await startBackend({ dataDir, defaultFoundersAccess: false });
  try {
    // 1. Register account with defaultFoundersAccess: false
    const regRes = await post(backend.port, "/api/register", undefined, {
      username: "NoFounderPlayer",
      password: "Password123!"
    });
    assert.equal(regRes.status, 201);

    const player = await userLogin(backend.port, "NoFounderPlayer", "Password123!");
    const campaignProf = await queryProfile(backend.port, player, "profile0");

    // Profile should NOT have founders pack or campaign access
    const itemTemplates = Object.values(campaignProf.items).map((i) => i.templateId.toLowerCase());
    assert.ok(!itemTemplates.includes("token:campaignaccess"), "Should not have Token:campaignaccess by default");
    assert.ok(!itemTemplates.includes("token:founderspack_1"), "Should not have Token:founderspack_1 by default");

    // 2. Toggle setting to true via admin API
    const settingsUpdate = await admin(backend, "/settings", { defaultFoundersAccess: true });
    assert.equal(settingsUpdate.status, 200);
    assert.equal(settingsUpdate.body.defaultFoundersAccess, true);

    // 3. Register a new account after enabling
    const regRes2 = await post(backend.port, "/api/register", undefined, {
      username: "YesFounderPlayer",
      password: "Password123!"
    });
    assert.equal(regRes2.status, 201);

    const player2 = await userLogin(backend.port, "YesFounderPlayer", "Password123!");
    const campaignProf2 = await queryProfile(backend.port, player2, "profile0");
    const itemTemplates2 = Object.values(campaignProf2.items).map((i) => i.templateId.toLowerCase());

    assert.ok(itemTemplates2.includes("token:campaignaccess"), "New account should have Token:campaignaccess when enabled");
    assert.ok(itemTemplates2.includes("token:founderspack_1"), "New account should have Token:founderspack_1 when enabled");
  } finally {
    await backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("promotional and friend codes creation, folders, archiving, and redemption", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-codes-test-"));
  const backend = await startBackend({ dataDir, defaultFoundersAccess: false });
  try {
    // Register test players
    const aliceReg = await post(backend.port, "/api/register", undefined, { username: "PlayerAlice", password: "AlicePassword123!" });
    const bobReg = await post(backend.port, "/api/register", undefined, { username: "PlayerBob", password: "BobPassword123!" });
    const charlieReg = await post(backend.port, "/api/register", undefined, { username: "PlayerCharlie", password: "CharliePassword123!" });
    assert.equal(aliceReg.status, 201);
    assert.equal(bobReg.status, 201);
    assert.equal(charlieReg.status, 201);

    // 1. Custom Code Folders Management
    const initialFolders = await admin(backend, "/code-folders");
    assert.equal(initialFolders.status, 200);
    assert.ok(initialFolders.body.some((f) => f.slug === "promotional"));

    // Create a new custom folder
    const createFolderRes = await admin(backend, "/code-folders", { name: "Summer Giveaways", slug: "summer-giveaways" });
    assert.equal(createFolderRes.status, 201);
    assert.equal(createFolderRes.body.slug, "summer-giveaways");

    // 2. Create a promotional code assigned to this folder
    const createRes = await admin(backend, "/codes", {
      code: "SUMMER-VB-2024",
      note: "Summer Promo Code",
      folder: "summer-giveaways",
      maxUses: 2,
      vbucks: 1500,
      foundersEdition: 2, // Deluxe Founder's Pack
      campaignAccess: true,
      items: [
        { templateId: "AthenaCharacter:cid_029_athena_commando_f_halloween", quantity: 1 },
        { templateId: "Ingredient:ingredient_ore_copper", quantity: 50 }
      ]
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.code, "SUMMER-VB-2024");
    assert.equal(createRes.body.folder, "summer-giveaways");
    assert.equal(createRes.body.rewards.vbucks, 1500);

    // Filter promotional codes by folder via query param
    const folderFilter = await admin(backend, "/codes?folder=summer-giveaways");
    assert.equal(folderFilter.status, 200);
    assert.equal(folderFilter.body.length, 1);
    assert.equal(folderFilter.body[0].code, "SUMMER-VB-2024");

    // Filter active codes
    const activeFilter = await admin(backend, "/codes?folder=active");
    assert.equal(activeFilter.status, 200);
    assert.ok(activeFilter.body.some((c) => c.code === "SUMMER-VB-2024"));

    // 3. Issue a Player Founder Friend Code for Alice
    const issueFcRes = await admin(backend, `/accounts/${aliceReg.body.id}/friend-codes`, {});
    assert.equal(issueFcRes.status, 201);
    assert.ok(issueFcRes.body.code);
    assert.equal(issueFcRes.body.isFriendCode, true);

    // Player friend codes are retrieved via account endpoint
    const aliceCodes = await admin(backend, `/accounts/${aliceReg.body.id}/friend-codes`);
    assert.equal(aliceCodes.status, 200);
    assert.equal(aliceCodes.body.length, 1);
    assert.equal(aliceCodes.body[0].code, issueFcRes.body.code);

    // Server-wide player friend codes endpoint
    const allFriendCodes = await admin(backend, "/friend-codes");
    assert.equal(allFriendCodes.status, 200);
    assert.ok(allFriendCodes.body.some((c) => c.code === issueFcRes.body.code));

    // Promotional codes endpoint excludes player friend codes
    const promoOnly = await admin(backend, "/codes?type=promotional");
    assert.equal(promoOnly.status, 200);
    assert.ok(!promoOnly.body.some((c) => c.code === issueFcRes.body.code), "Promotional list must not contain friend codes");

    // 4. Player Alice redeems SUMMER-VB-2024
    const aliceRedeem = await redeem(backend, "PlayerAlice", "AlicePassword123!", "SUMMER-VB-2024");
    assert.equal(aliceRedeem.status, 200);
    assert.equal(aliceRedeem.body.success, true);
    assert.equal(aliceRedeem.body.rewards.vbucks, 1500);
    // Everything the code gives is in Alice's profiles.
    const alice = await userLogin(backend.port, "PlayerAlice", "AlicePassword123!");
    const aliceItems = async (profileId) => Object.values((await queryProfile(backend.port, alice, profileId)).items).map((i) => i.templateId.toLowerCase());
    assert.ok((await aliceItems("athena")).includes("athenacharacter:cid_029_athena_commando_f_halloween"));
    assert.ok((await aliceItems("profile0")).includes("currency:mtxgiveaway"));
    assert.ok((await aliceItems("profile0")).includes("token:founderspack_2"));
    assert.ok(aliceRedeem.body.granted.some((line) => line.includes("1,500 V-Bucks")));

    // One-per-account: Alice cannot redeem again
    const aliceSecondTry = await redeem(backend, "PlayerAlice", "AlicePassword123!", "SUMMER-VB-2024");
    assert.equal(aliceSecondTry.status, 400);

    // 5. Player Bob redeems the 2nd use of SUMMER-VB-2024 -> code reaches maxUses (2)
    const bobRedeem = await redeem(backend, "PlayerBob", "BobPassword123!", "SUMMER-VB-2024");
    assert.equal(bobRedeem.status, 200);

    // Third attempt is rejected as depleted
    const charlieRedeem = await redeem(backend, "PlayerCharlie", "CharliePassword123!", "SUMMER-VB-2024");
    assert.equal(charlieRedeem.status, 400);

    // 6. Archived Codes filter: fully redeemed code is now archived!
    const archivedFilter = await admin(backend, "/codes?folder=archived-codes");
    assert.equal(archivedFilter.status, 200);
    assert.ok(archivedFilter.body.some((c) => c.code === "SUMMER-VB-2024"), "Redeemed code must appear in archived-codes");

    // 7. Player Bob redeems Alice's issued friend code
    const bobFriendRedeem = await redeem(backend, "PlayerBob", "BobPassword123!", issueFcRes.body.code);
    assert.equal(bobFriendRedeem.status, 200);
    assert.equal(bobFriendRedeem.body.rewards.campaignAccess, true);
    assert.equal(bobFriendRedeem.body.rewards.foundersEdition, 1);

    // Check Alice's friend codes view: status is now redeemed!
    const aliceCodesAfter = await admin(backend, `/accounts/${aliceReg.body.id}/friend-codes`);
    assert.equal(aliceCodesAfter.status, 200);
    assert.equal(aliceCodesAfter.body[0].isDepleted, true);
    assert.equal(aliceCodesAfter.body[0].redeemedCount, 1);

    // 8. Delete folder
    const delFolderRes = await admin(backend, "/code-folders/summer-giveaways", undefined, "DELETE");
    assert.equal(delFolderRes.status, 200);
  } finally {
    await backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("concurrent redemptions on single-use code are mutex-protected against race conditions", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-race-test-"));
  const backend = await startBackend({ dataDir });
  try {
    await post(backend.port, "/api/register", undefined, { username: "Racer1", password: "Password123!" });
    await post(backend.port, "/api/register", undefined, { username: "Racer2", password: "Password123!" });

    // Single-use code with 10,000 V-Bucks
    await admin(backend, "/codes", {
      code: "SPEED-RUN-CODE",
      maxUses: 1,
      vbucks: 10000
    });

    // Fire both redemptions simultaneously
    const [res1, res2] = await Promise.all([
      redeem(backend, "Racer1", "Password123!", "SPEED-RUN-CODE"),
      redeem(backend, "Racer2", "Password123!", "SPEED-RUN-CODE")
    ]);

    const successes = [res1, res2].filter((r) => r.status === 200);
    const failures = [res1, res2].filter((r) => r.status === 400);

    assert.equal(successes.length, 1, "Exactly one racer should succeed");
    assert.equal(failures.length, 1, "Exactly one racer should fail due to mutex exhaustion");
    assert.ok(failures[0].body.errorMessage.includes("already been redeemed"));
  } finally {
    await backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// Core-Backend #126 review: what the merge's follow-up fixed.
test("friend codes saved before #126 still list in game, in the panel, and redeem", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-legacy-codes-"));
  const backend = await startBackend({ dataDir });
  try {
    const owner = await post(backend.port, "/api/register", undefined, { username: "LegacyOwner", password: "Password123!" });
    await post(backend.port, "/api/register", undefined, { username: "LegacyFriend", password: "Password123!" });
    const code = "ABCDE-FGHJK-MNPQR-STUVW";
    // The format #35 saved: no folders, no uses, no rewards.
    fs.writeFileSync(path.join(dataDir, "friendcodes.json"), JSON.stringify({
      codes: { [code]: { accountId: owner.body.id, codeType: "CodeToken:FounderFriendInvite", backend: "epic", created: "2026-01-01T00:00:00.000Z" } }
    }));
    await backend.close();
    const reopened = await startBackend({ dataDir });
    try {
      const listed = await admin(reopened, `/accounts/${owner.body.id}/friend-codes`);
      assert.deepEqual(listed.body.map((c) => [c.code, c.isFriendCode, c.redeemedCount, c.maxUses]), [[code, true, 0, 1]]);
      const player = await userLogin(reopened.port, "LegacyOwner", "Password123!");
      const inGame = await as("1.8", reopened.port, "GET", `/fortnite/api/game/v2/friendcodes/${owner.body.id}/epic`, player.token);
      assert.deepEqual(inGame.body.map(({ codeId }) => codeId), [code]);

      // Its owner can't use it; a friend gets the Standard Edition with it, once.
      const own = await redeem(reopened, "LegacyOwner", "Password123!", code);
      assert.equal(own.status, 400);
      assert.match(own.body.errorMessage, /own friend code/);
      const friend = await redeem(reopened, "LegacyFriend", "Password123!", code.toLowerCase());
      assert.equal(friend.status, 200);
      assert.equal(friend.body.rewards.foundersEdition, 1);
      assert.deepEqual((await as("1.8", reopened.port, "GET", `/fortnite/api/game/v2/friendcodes/${owner.body.id}/epic`, player.token)).body, []);
    } finally {
      await reopened.close();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a code takes only real items and existing folders, and a deleted folder's codes move to Promotional", async () => {
  const backend = await startBackend();
  try {
    const unknownItem = await admin(backend, "/codes", { code: "BAD-ITEM", items: [{ templateId: "AthenaCharacter:cid_999_athena_commando_f_notreal" }] });
    assert.equal(unknownItem.status, 400);
    const unknownFolder = await admin(backend, "/codes", { code: "BAD-FOLDER", folder: "nowhere" });
    assert.equal(unknownFolder.status, 400);

    assert.equal((await admin(backend, "/code-folders", { name: "Events" })).status, 201);
    assert.equal((await admin(backend, "/codes", { code: "EVENT-ONE", folder: "events", vbucks: 100 })).status, 201);
    assert.equal((await admin(backend, "/code-folders/events", undefined, "DELETE")).status, 200);
    const promotional = await admin(backend, "/codes?folder=promotional");
    assert.ok(promotional.body.some((c) => c.code === "EVENT-ONE"));
  } finally {
    await backend.close();
  }
});

test("a redemption whose rewards fail leaves the code unused", async () => {
  const { createFriendCodeStore } = await import("../src/friendcodes/store.js");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-redeem-fail-"));
  try {
    const store = createFriendCodeStore(dataDir);
    store.create({ code: "FAIL-ONCE", vbucks: 10 });
    await assert.rejects(store.redeem("FAIL-ONCE", { id: "a1" }, "", () => { throw new Error("grant failed"); }), /grant failed/);
    assert.equal(store.get("FAIL-ONCE").redeemedCount, 0);
    const done = await store.redeem("FAIL-ONCE", { id: "a1" }, "", () => ["10 V-Bucks"]);
    assert.deepEqual(done.applied, ["10 V-Bucks"]);
    assert.equal(createFriendCodeStore(dataDir).get("FAIL-ONCE").redeemedCount, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("with Default Founder's Access turned back on, accounts made while it was off get the Standard Edition too", async () => {
  const backend = await startBackend({ defaultFoundersAccess: false });
  try {
    await post(backend.port, "/api/register", undefined, { username: "MadeWhileOff", password: "Password123!" });
    const player = await userLogin(backend.port, "MadeWhileOff", "Password123!");
    const items = async () => Object.values((await queryProfile(backend.port, player, "profile0")).items).map((i) => i.templateId.toLowerCase());
    assert.ok(!(await items()).includes("token:founderspack_1"));
    assert.equal((await admin(backend, "/settings", { defaultFoundersAccess: true })).status, 200);
    const after = await items();
    assert.ok(after.includes("token:founderspack_1"));
    assert.ok(after.includes("token:campaignaccess"));
  } finally {
    await backend.close();
  }
});

test("X-Forwarded-For is believed only from this PC", async () => {
  const { getClientIp } = await import("../src/services/portal/ratelimit.js");
  const req = (remoteAddress, forwarded) => ({ socket: { remoteAddress }, headers: forwarded ? { "x-forwarded-for": forwarded } : {} });
  assert.equal(getClientIp(req("127.0.0.1", "198.51.100.7, 10.0.0.1")), "198.51.100.7");
  assert.equal(getClientIp(req("203.0.113.5", "127.0.0.1")), "203.0.113.5");
  assert.equal(getClientIp(req("203.0.113.5")), "203.0.113.5");
});

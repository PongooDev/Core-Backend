import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inBuild } from "../src/builds/context.js";
import { advanceAthenaObjectives, seasonRewardFunctions } from "../src/profiles/athena.js";
import { buyBattlePass, takeUpSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { get, post, send, startBackend } from "./helpers.js";

// Core-Backend #249: the portal's My account page, a player's own account read-only: V-Bucks counted as the client
// counts them, levels, challenges, the item shop and the locker, for the build the account last played.
const v33 = "3942182";
const v351 = "4000805";
const password = "SuperSecret123";

const register = async (backend, username, email) => {
  const response = await post(backend.port, "/api/register", null, { username, password, email });
  assert.equal(response.status, 201);
  return response.body.id;
};
const details = (backend, username, pass = password) => post(backend.port, "/api/account/details", null, { username, password: pass });

// A game client of a build logging in: the build the account last played is the one its User-Agent names.
const playAs = (backend, username, changelist) => send({
  host: "127.0.0.1",
  port: backend.port,
  method: "POST",
  path: "/account/api/oauth/token",
  headers: {
    Authorization: `basic ${Buffer.from("ec684b8c687f479fadea3cb2ad83f5c6:secret").toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-CL-${changelist}`
  }
}, new URLSearchParams({ grant_type: "password", username, password }).toString());

// What the client of a build is sent of a profile (the same QueryProfile the game runs).
const queryProfile = async (backend, accountId, build, profileId) => {
  const token = (await playAs(backend, "CountsMtx", build)).body.access_token;
  const response = await send({
    host: "127.0.0.1", port: backend.port, method: "POST", path: `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=${profileId}&rvn=-1`,
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-CL-${build}` }
  }, "{}");
  assert.equal(response.status, 200);
  return response.body.profileChanges[0].profile;
};
// The client's balance: the Currency:Mtx* items of the profile whose platform it counts (Epic before 3.5, Shared in common_core).
const clientBalance = (profile, platform) => Object.values(profile.items)
  .filter((item) => /^currency:mtx/i.test(item.templateId) && item.attributes.platform === platform).reduce((sum, item) => sum + item.quantity, 0);

const writeProfile0 = (backend, accountId, items) => {
  const file = path.join(backend.dataDir, "accounts", accountId, "profiles", "profile0.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    profileId: "profile0", accountId, rvn: 4, wipeNumber: 1, version: "core", commandRevision: 3, stats: { attributes: { level: 2 } },
    items: Object.fromEntries(items.map(([templateId, quantity, platform], index) => [`mtx${index}`,
      { templateId, attributes: { level: 1, item_seen: 0, ...(platform ? { platform } : {}) }, quantity }]))
  }));
};

test("signed in, a player sees their own account; signed out, nobody sees anything", async () => {
  const backend = await startBackend();
  try {
    const id = await register(backend, "OwnData", "own.data@example.com");
    assert.equal((await playAs(backend, "OwnData", v351)).status, 200);
    writeProfile0(backend, id, [["Currency:MtxPurchased", 1000, "Epic"]]);

    const own = await details(backend, "OwnData");
    assert.equal(own.status, 200);
    assert.equal(own.body.displayName, "OwnData");
    assert.equal(own.body.build.version, "3.5.1");
    assert.equal(own.body.build.lastPlayed, true);
    assert.equal(own.body.vbucks.total, 1000);
    // The email the player linked works as the sign-in too.
    assert.equal((await details(backend, "own.data@example.com")).body.displayName, "OwnData");

    // Nothing secret is in it: not the id, the password's hash, the email or a token.
    const text = JSON.stringify(own.body);
    for (const secret of [id, "example.com", "scrypt", "password", "token"]) assert.equal(text.toLowerCase().includes(secret.toLowerCase()), false, secret);

    for (const body of [{}, { username: "OwnData" }, { username: "OwnData", password: "" }, { password }]) {
      const refused = await post(backend.port, "/api/account/details", null, body);
      assert.ok(refused.status >= 400 && refused.status < 500, JSON.stringify(body));
      assert.equal(refused.body.displayName, undefined);
      assert.equal(refused.body.vbucks, undefined);
    }
    assert.equal((await details(backend, "OwnData", "wrong-password")).status, 401);
    // A game token is no sign-in to the portal.
    const token = (await playAs(backend, "OwnData", v351)).body.access_token;
    assert.ok(token);
    const viaToken = await post(backend.port, "/api/account/details", token, {});
    assert.ok(viaToken.status >= 400);
    assert.equal(viaToken.body.displayName, undefined);
    // It is a read: a GET is no route.
    assert.equal((await get(backend.port, "/api/account/details")).status, 404);
  } finally {
    backend.close();
  }
});

test("one player cannot see another's account, by name, email or id", async () => {
  const backend = await startBackend();
  try {
    const richId = await register(backend, "RichPlayer", "rich@example.com");
    await register(backend, "PoorPlayer");
    await playAs(backend, "RichPlayer", v351);
    writeProfile0(backend, richId, [["Currency:MtxPurchased", 9999, "Epic"]]);

    // Their own password with the other's name or email is a refusal; so is the other's name with nothing.
    assert.equal((await details(backend, "RichPlayer", "SomeoneElse123")).status, 401);
    assert.equal((await details(backend, "rich@example.com", "SomeoneElse123")).status, 401);
    const poor = await details(backend, "PoorPlayer");
    assert.equal(poor.status, 200);
    assert.equal(poor.body.displayName, "PoorPlayer");
    assert.equal(poor.body.vbucks.total, 0);
    assert.equal(JSON.stringify(poor.body).includes("RichPlayer"), false);
    // The request names no account id: one smuggled in is not read.
    const smuggled = await post(backend.port, "/api/account/details", null, { username: "PoorPlayer", password, accountId: richId, id: richId });
    assert.equal(smuggled.body.displayName, "PoorPlayer");
    assert.equal(smuggled.body.vbucks.total, 0);
    // A banned player is refused.
    assert.equal((await post(backend.port, `/admin/api/accounts/${richId}/ban`, undefined, { reason: "test" })).status, 200);
    assert.equal((await details(backend, "RichPlayer")).status, 403);
  } finally {
    backend.close();
  }
});

test("the V-Bucks are counted as the account's last build counts them: Epic's on 3.3, common_core's wallet on 3.5.1", async () => {
  const backend = await startBackend();
  try {
    const id = await register(backend, "CountsMtx");
    writeProfile0(backend, id, [["Currency:MtxPurchased", 1000, "Epic"], ["Currency:MtxPurchaseBonus", 200, "Epic"], ["Currency:MtxGiveaway", 300, "Epic"],
      ["Currency:MtxComplimentary", 50, "Epic"], ["Currency:MtxGiveaway", 25], ["AccountResource:currency_xrayllama", 5]]);

    // 3.3 (profile0) counts the Currency:Mtx* items whose platform is exactly Epic (one saved without a platform gets it
    // when the profile loads), and nothing else: the page's total is the client's.
    await playAs(backend, "CountsMtx", v33);
    const on33 = await details(backend, "CountsMtx");
    assert.equal(on33.body.build.version, "3.3");
    assert.deepEqual(on33.body.vbucks, { total: 1575, purchased: 1000, bonus: 200, giveaway: 325, complimentary: 50 });
    assert.equal(clientBalance(await queryProfile(backend, id, v33, "profile0"), "Epic"), on33.body.vbucks.total);

    // 3.5.1 (common_core) shows them as Shared, which it counts whatever the wallet: the same V-Bucks, the account's own.
    await playAs(backend, "CountsMtx", v351);
    const on351 = await details(backend, "CountsMtx");
    assert.equal(on351.body.build.version, "3.5.1");
    assert.deepEqual(on351.body.vbucks, on33.body.vbucks);
    assert.equal(clientBalance(await queryProfile(backend, id, v351, "common_core"), "Shared"), on351.body.vbucks.total);

    // Spent V-Bucks leave the page's count as they leave the client's.
    const file = path.join(backend.dataDir, "accounts", id, "profiles", "profile0.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    saved.items.mtx0.quantity = 400;
    fs.writeFileSync(file, JSON.stringify(saved));
    assert.equal((await details(backend, "CountsMtx")).body.vbucks.total, 975);
    assert.equal(clientBalance(await queryProfile(backend, id, v351, "common_core"), "Shared"), 975);
  } finally {
    backend.close();
  }
});

test("Battle Royale: the season level, the Battle Pass, the weekly challenges' progress, the shop and the locker, on 3.5.1 and 3.3", async () => {
  const backend = await startBackend();
  try {
    const id = await register(backend, "BrPlayer");
    assert.equal((await post(backend.port, `/admin/api/accounts/${id}/cosmetics/grant`, undefined, { build: v351, templateId: "AthenaCharacter:cid_102_athena_commando_m_raven" })).status, 200);
    for (const build of [v33, v351]) {
      await playAs(backend, "BrPlayer", build);
      inBuild(build, () => {
        const session = openSession(createProfileStore(backend.dataDir), id);
        takeUpSeason(session);
        if (build === v351) {
          buyBattlePass(session, seasonRewardFunctions());
          advanceAthenaObjectives(session, [{ statName: "battlepass_damage_athena_player_pistol", count: 200 }]);
        }
        session.commit();
      });

      const response = await details(backend, "BrPlayer");
      assert.equal(response.status, 200, build);
      const { battleRoyale, challenges, shop, locker } = response.body;
      assert.equal(battleRoyale.season, 3);
      assert.equal(battleRoyale.level, 1);
      assert.equal(battleRoyale.maxLevel, 100);
      assert.ok(battleRoyale.xpToNextLevel > 0);
      assert.ok(battleRoyale.battlePass.maxTier > 1);
      assert.ok(shop.featured.length + shop.daily.length > 0, build);
      assert.ok(shop.daily.every((offer) => offer.title && offer.price > 0 && offer.owned === false));
      assert.ok(locker.cosmetics.find(({ label }) => label === "Outfits").total > 0);
      assert.ok(locker.cosmetics.find(({ label }) => label === "Outfits").owned >= 1, "the granted outfit");
      assert.equal(JSON.stringify(response.body).includes(id), false);

      if (build === v351) {
        assert.equal(battleRoyale.battlePass.purchased, true);
        const week1 = challenges.weekly.find((bundle) => bundle.id === "s3_week1_questbundle");
        assert.equal(week1.name, "Week 1");
        assert.equal(week1.threshold, 4);
        const pistol = week1.challenges.find((quest) => quest.id === "quest_br_damage_pistol");
        assert.deepEqual([pistol.name, pistol.progress, pistol.target, pistol.done], ["Damage Pistol", 200, 500, false]);
        assert.equal(pistol.rewards.stars, 5);
      }
    }
  } finally {
    backend.close();
  }
});

test("Save the World: the commander level and quests for a player who has it, nothing for one who has not; matches when recorded", async () => {
  const backend = await startBackend({ defaultFoundersAccess: false });
  try {
    const stwId = await register(backend, "Commander");
    await register(backend, "BrOnly");
    await playAs(backend, "Commander", v33);
    // The admin panel's founder's pack gives Save the World.
    assert.equal((await post(backend.port, `/admin/api/accounts/${stwId}/founders`, undefined, { edition: 1 })).status, 200);
    assert.equal((await post(backend.port, `/admin/api/accounts/${stwId}/level`, undefined, { level: 7 })).status, 200);

    const commander = (await details(backend, "Commander")).body;
    assert.equal(commander.saveTheWorld.level, 7);
    assert.ok(commander.saveTheWorld.maxLevel >= 7);
    assert.ok(Array.isArray(commander.saveTheWorld.quests));
    assert.equal(commander.matches, null);

    assert.equal((await details(backend, "BrOnly")).body.saveTheWorld, null);

    // The matches the backend recorded, by playlist, with the totals.
    const fighterId = await register(backend, "Fighter");
    const dir = path.join(backend.dataDir, "accounts", fighterId);
    fs.writeFileSync(path.join(dir, "stats.json"), JSON.stringify({
      playlists: { 2: { matchesplayed: 5, placetop1: 1, kills: 12, secondsplayed: 1230, score: 900 }, 9: { matchesplayed: 2, kills: 3, secondsplayed: 300, score: 150 } }
    }));
    const { matches } = (await details(backend, "Fighter")).body;
    assert.deepEqual(matches.playlists.map(({ name, matches: played, wins, kills, minutes, score }) => [name, played, wins, kills, minutes, score]),
      [["Solo", 5, 1, 12, 20, 900], ["Squads", 2, 0, 3, 5, 150]]);
    assert.deepEqual(matches.totals, { matches: 7, wins: 1, kills: 15, minutes: 25, score: 1050 });
  } finally {
    backend.close();
  }
});

test("the portal serves the page, links it in its tabs, and builds the account from text only", () => {
  const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/services/portal/portal.html"), "utf8");
  assert.match(html, /switchTab\('account'\)">My Account</);
  const view = html.slice(html.indexOf("function renderAccount"), html.indexOf("function signOutAccount"));
  assert.ok(view.length > 500);
  // Everything the account view shows goes in as text (textContent / append), never as markup.
  assert.equal(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(view), false);
});

test("the My account page route serves the portal", async () => {
  const backend = await startBackend();
  try {
    for (const route of ["/my-account", "/portal"]) {
      const page = await get(backend.port, route);
      assert.equal(page.status, 200, route);
      assert.match(page.body, /My Account/);
    }
  } finally {
    backend.close();
  }
});

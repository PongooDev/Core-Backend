import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { battleRoyaleBuilds, versionOf } from "../src/builds/detect.js";
import { activeEventFlags, hasEventEnded, isEventActive, lobbyWinterDecor, passiveStorms, supplyDropGift, winter2017, winterBattleBus } from "../src/events/events.js";
import { holidayLlama, winterEventQuests } from "../src/events/winter2017.js";
import { athenaCosmetics, athenaDisplayAssets, athenaSeason } from "../src/gamedata/athena.js";
import { getCardPack, getItem } from "../src/gamedata/items.js";
import { dataBuild } from "../src/gamedata/read.js";
import { assignmentBucket } from "../src/matchmaking/service.js";
import { advanceAthenaObjectives, grantAthenaQuest } from "../src/profiles/athena.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { hasEventStore } from "../src/store/eventstore.js";
import { itemShopOffers, seasonEnd } from "../src/store/itemshop.js";
import { dedicatedServerToken, send, startBackend, userLogin } from "./helpers.js";

// Fortnite 2.1 (++Fortnite+Release-Cert-CL-3825894, UE 4.19, 10 January 2018): its own game data and version, still
// Season 2 with 1.11, and 1.11's events.
const v21 = "3825894";
const v111 = "3807424";
const agents = {
  [v21]: "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3825894",
  [v111]: "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3807424"
};
const as = (build, port, method, urlPath, token, body) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": agents[build], Authorization: `bearer ${token}` };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
};
const command = (port, { accountId, token }, name, profileId, body, build) =>
  as(build, port, "POST", `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=${profileId}&rvn=-1`, token, body ?? {});
const updateOf = (body, profileId) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === profileId);
const profileOf = async (port, player, profileId, build) =>
  updateOf((await command(port, player, "QueryProfile", profileId, {}, build)).body, profileId).profileChanges[0].profile;

test("2.1 is known by its version and plays on its own game data: 1.11's with 2.1's changes", () => {
  assert.equal(versionOf(v21), "2.1");
  assert.equal(dataBuild(v21), v21);
  assert.ok(battleRoyaleBuilds.includes(v21));
  // "Changed the Boogie Bomb rarity to blue/rare".
  assert.equal(inBuild(v21, () => getItem("Weapon:athena_dancegrenade").rarity), "Sturdy");
  assert.equal(inBuild(v111, () => getItem("Weapon:athena_dancegrenade").rarity), "Ordinary");
  // 2.1's new card pack, the Uncommon Trap Schematic (CardPack_Trap_WallLauncher_Fix).
  assert.equal(inBuild(v21, () => getCardPack("CardPack:cardpack_trap_walllauncher_fix")).displayName, "Uncommon Trap Schematic");
  assert.equal(inBuild(v111, () => getCardPack("CardPack:cardpack_trap_walllauncher_fix")), undefined);
  // Everything else is 1.11's: Season 2's cosmetics and display assets, the Holiday Survival Llama.
  const same = (fn) => assert.deepEqual(inBuild(v21, fn), inBuild(v111, fn));
  same(athenaCosmetics);
  same(athenaDisplayAssets);
  same(() => getCardPack(holidayLlama));
});

test("2.1 is still Season 2: 1.11's Battle Pass, season clock and shop", () => {
  const season = inBuild(v21, athenaSeason);
  assert.equal(season.seasonNumber, 2);
  assert.deepEqual(season, inBuild(v111, athenaSeason));
  // Season 2's newest data is 2.2's since (build22.test.js).
  assert.equal(buildOfSeason(2), "3889387");
  const now = new Date("2026-11-02T12:00:00Z");
  assert.equal(inBuild(v21, () => seasonEnd(now, { rotationHour: 0 })).toISOString(), inBuild(v111, () => seasonEnd(now, { rotationHour: 0 })).toISOString());
  const config = { mode: "custom", custom: { featured: [["AthenaGlider:glider_prismatic", 800]], daily: [["AthenaPickaxe:skiicepickaxe", 800]] } };
  const offers = (build) => inBuild(build, () => itemShopOffers(now, config));
  assert.deepEqual(offers(v21), offers(v111));
  // Its daily offers carry their display assets too.
  assert.equal(offers(v21).BRDailyStorefront[0].displayAssetPath,
    "/Game/Catalog/DisplayAssets/DA_Featured_PickaxeCliffhanger.DA_Featured_PickaxeCliffhanger");
});

test("2.1 keeps 1.11's events: Survive the Holidays, ticketless storms, the winter lobby and bus, and 50v50", () => {
  assert.deepEqual(activeEventFlags(v21), ["EventFlag.BR.Allow50v50", winter2017, passiveStorms, lobbyWinterDecor, winterBattleBus, supplyDropGift]);
  for (const flag of [winter2017, passiveStorms, lobbyWinterDecor, winterBattleBus, supplyDropGift]) {
    assert.ok(isEventActive(flag, v21), flag);
    assert.ok(!hasEventEnded(flag, v21), flag);
  }
  // 2.2.0 ended Battle Royale's (build22.test.js); Save the World's ran on.
  for (const flag of [lobbyWinterDecor, winterBattleBus, supplyDropGift]) assert.ok(hasEventEnded(flag, "3841827"), flag);
  for (const flag of [winter2017, passiveStorms]) assert.ok(!hasEventEnded(flag, "3841827"), flag);
  assert.deepEqual(inBuild(v21, winterEventQuests), inBuild(v111, winterEventQuests));
  assert.ok(inBuild(v21, hasEventStore));
});

test("2.1 servers take AssignMatch's bucket in six fields, as 1.11's", () => {
  assert.equal(assignmentBucket(`${v21}:0:NA:11`, v21), `Fortnite:Fortnite:${v21}:0:NA:11`);
});

test("1.11 and 2.1 share one Season 2 profile: its level and XP, and six emote slots", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build21-test-"));
  const backend = await startBackend({ dataDir });
  try {
    const player = await userLogin(backend.port, "build21");
    const dedicated = await dedicatedServerToken(backend.port);
    await profileOf(backend.port, player, "athena", v111);
    const report = (build) => as(build, backend.port, "POST", "/fortnite/api/game/v2/battleroyale/recordresults", dedicated,
      { playlistId: 2, matchId: `build21-${build}-${Math.random().toString(16).slice(2, 10)}`, countWins: true,
        results: [{ accountId: player.accountId, place: 1, kills: 5, secondsAlive: 1200 }] });
    await report(v21);
    const two = (await profileOf(backend.port, player, "athena", v111)).stats.attributes;
    assert.equal(two.season_num, 2);
    assert.ok(two.level > 1);
    // A 2.1 lobby finds the same season, with no season put aside.
    const two21 = (await profileOf(backend.port, player, "athena", v21)).stats.attributes;
    assert.equal(two21.season_num, 2);
    assert.equal(two21.level, two.level);
    assert.equal(two21.xp, two.xp);
    assert.deepEqual(two21.past_seasons, two.past_seasons);

    const equip = (build, indexWithinSlot) => command(backend.port, player, "EquipBattleRoyaleCustomization", "athena",
      { slotName: "Dance", itemToSlot: "", indexWithinSlot }, build);
    assert.equal((await equip(v21, 5)).status, 200);
    const dances = (await profileOf(backend.port, player, "athena", v21)).stats.attributes.favorite_dance;
    assert.ok(Array.isArray(dances));
    assert.equal(dances.length, 6);
  } finally {
    await backend.close();
  }
});

// 2.1's notes: "Daily challenge rewards are automatically collected if another challenge is completed in the same
// category" (profiles/athena.js).
test("a challenge completed in 2.1 collects the Completed ones of its category; 1.11 leaves them for Collect Rewards", () => {
  const run = (build) => inBuild(build, () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-build21-collect-"));
    try {
      const session = openSession(createProfileStore(dataDir), "collector");
      const tracker = session.profile("athena");
      const chests = grantAthenaQuest(tracker, "athenadailyquest_interacttreasurechest");
      const pass = grantAthenaQuest(tracker, "athena_battlepass_outlive_solo");
      const ammo = grantAthenaQuest(tracker, "athenadailyquest_interactammocrate");
      advanceAthenaObjectives(session, [{ statName: "athena_battlepass_outlive_solo_players", count: 150 }]);
      advanceAthenaObjectives(session, [{ statName: "daily_athena_loot_chest_v2", count: 7 }]);
      const progress = () => (tracker.profile.stats.attributes.level ?? 1) * 1_000_000 + (tracker.profile.stats.attributes.xp ?? 0);
      const before = progress();
      advanceAthenaObjectives(session, [{ statName: "athena_daily_loot_ammobox_v2", count: 7 }]);
      const state = (itemId) => tracker.profile.items[itemId].attributes.quest_state;
      return { chests: state(chests), pass: state(pass), ammo: state(ammo), paid: progress() > before };
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
  // The daily done before is collected and paid; the Battle Pass challenge, another category, and the one just done wait.
  assert.deepEqual(run(v21), { chests: "Claimed", pass: "Completed", ammo: "Completed", paid: true });
  assert.deepEqual(run(v111), { chests: "Completed", pass: "Completed", ammo: "Completed", paid: false });
});

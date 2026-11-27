import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eventCard } from "../src/admin/eventschedules.js";
import { battlePassOffers } from "../src/battlepass/season2.js";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { releasedOn, seasonName, versionOf } from "../src/builds/detect.js";
import { blockEventOf, blockStates } from "../src/events/block.js";
import { activeEventFlags, blockSlab, configureEvents, lobbySeason9, ltmWax } from "../src/events/events.js";
import { fortbytesDay } from "../src/events/fortbytes.js";
import { hasLtm, isHeldLtm, ltmFrontEndPlaylists, ltmOn, ltmPlaylistTag, playlistIdOfName } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { season9Flag, season9Phase1 } from "../src/events/talesofbeyond.js";
import { wargamesDailyQuests, wargamesFlag, wargamesGlobals, wargamesQuests } from "../src/events/wargames.js";
import { wicksBountyCalendarEvent, wicksBountyFlagsNow, wicksBountyStates } from "../src/events/wicksbounty.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason, getAthenaQuest } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { playlistTeamsOf, teamsOfPlaylist } from "../src/matchmaking/service.js";
import { athenaQuestLogin, setUpAthena } from "../src/profiles/athena.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { storefronts } from "../src/store/catalog.js";
import { eventStorefront, eventStoreEnds } from "../src/store/eventstore.js";
import { configureItemShop, itemShopOffers, seasonOfBuild } from "../src/store/itemshop.js";
import { clientToken, post, send, startBackend, userLogin } from "./helpers.js";

// Fortnite 9.01 (Update v9.01, 15 May 2019; Season 9): CL-6428087, on its own data (gamedata/6428087). Season 9's Battle Pass,
// lobby, Fortbytes, Block and LTMs as 9.00's; Wick's Bounty and its challenges, John Wick in the shop, Save the World's
// Mist Pods Wargame and Prehistoric Izza in the Event Store. No new MCP command or route (SDK and IDA against 9.00).
const v901 = "6428087";
const v900 = "6337466";
const v851 = "6165369";
const at = (iso) => new Date(iso);
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const season9 = { mode: "auto", seasonStarts: { 9: "2019-05-09" } };
const typesOf = (states) => states[0]?.events.map(({ eventType }) => eventType) ?? [];
const replayDaysAgo = (days) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - days * 86400000)
  .toISOString().slice(0, 10);
const withSession = (build, name, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-901-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const templatesOf = (session) => Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);

test("9.01 is known, on its own data", () => {
  assert.equal(versionOf(v901), "9.01");
  assert.equal(allowedBuildList(["9.01"]).join(), v901);
  assert.equal(dataBuild(v901), v901);
  assert.equal(dataBuild(v900), v900, "9.00 keeps its own data");
  assert.equal(dataBuild("6400000"), v900, "a build between 9.00 and 9.01 plays on 9.00's");
  assert.equal(dataBuild("6500000"), v901, "a build between 9.01 and 9.10 plays on 9.01's");
  assert.equal(releasedOn(v901), Date.UTC(2019, 4, 15));
  assert.equal(seasonName(9), "Season 9 (9.00 – 9.30)");
  const season = inBuild(v901, athenaSeason);
  assert.deepEqual([season.seasonNumber, season.storefront, season.numBookLevels], [9, "BRSeason9", 100]);
  assert.equal(inBuild(v901, seasonOfBuild), 9);
  assert.deepEqual(inBuild(v901, () => battlePassOffers()).map(({ offerId, price }) => [offerId, price]),
    [["core_br_season9_battlepass", 950], ["core_br_season9_battlebundle", 2800], ["33E185A84ED7B64F2856E69AADFD092C", 150]]);
});

test("9.01's cosmetics: 9.00's and seven of John Wick's", () => {
  const [c901, c900] = [inBuild(v901, athenaCosmetics), inBuild(v900, athenaCosmetics)];
  assert.equal(Object.keys(c901).length, 1802);
  assert.deepEqual(Object.keys(c900).filter((id) => !c901[id]), []);
  assert.deepEqual(Object.keys(c901).filter((id) => !c900[id]).sort(), ["AthenaBackpack:bid_271_assassinsuitmale",
    "AthenaBackpack:bid_273_assassinsuitcoin", "AthenaCharacter:cid_416_athena_commando_m_assassinsuit", "AthenaDance:eid_assassinsalute",
    "AthenaDance:eid_assassinvest", "AthenaGlider:umbrella_assassinsuit", "AthenaPickaxe:pickaxe_id_213_assassinsuitsledgehammer"]);
  assert.equal(c901["AthenaCharacter:cid_416_athena_commando_m_assassinsuit"].name, "John Wick");
});

test("the Wick's Bounty Challenges: 9.01's schedule, its 9.01 counts, served 16 to 21 May on Season 9's replay", () => {
  inBuild(v901, () => {
    const schedule = athenaChallengeSchedules().schedule_ltm_wax;
    assert.deepEqual([schedule.eventName, schedule.cleanUpOnBundleCompletion], [ltmWax, true]);
    const bundle = athenaChallengeBundles().questbundle_ltm_wax;
    assert.equal(bundle.quests.length, 6);
    assert.ok(bundle.quests.every(({ grantWithBundle }) => grantWithBundle));
    assert.deepEqual(bundle.completionSteps, [{ count: 5, rewards: [{ quantity: 1, templateId: "AthenaBackpack:bid_273_assassinsuitcoin" }] }]);
    assert.deepEqual(["quest_br_wax_collectcoins", "quest_br_wax_collectcoins_singlematch", "quest_br_wax_play_matches"]
      .map((id) => getAthenaQuest(id).objectives[0].count), [120, 20, 5]);
  });
  withConfig(season9, () => {
    assert.deepEqual(typesOf(inBuild(v901, () => wicksBountyStates(at("2019-05-16T00:00:00Z")))), [ltmWax, wicksBountyCalendarEvent]);
    assert.deepEqual(typesOf(inBuild(v901, () => wicksBountyStates(at("2019-05-21T23:00:00Z")))), [ltmWax, wicksBountyCalendarEvent]);
    assert.deepEqual(inBuild(v901, () => wicksBountyFlagsNow(at("2019-05-15T12:00:00Z"))), []);
    assert.deepEqual(inBuild(v901, () => wicksBountyFlagsNow(at("2019-05-22T12:00:00Z"))), []);
    assert.deepEqual(inBuild(v900, () => wicksBountyFlagsNow(at("2019-05-18T12:00:00Z"))), [], "9.00 has no mode for them");
  });
  withConfig({ ...season9, datedFlags: { wicksBounty: { mode: "off" } } }, () => {
    assert.deepEqual(inBuild(v901, () => wicksBountyFlagsNow(at("2019-05-18T12:00:00Z"))), []);
  });
  withConfig({ ...season9, season4Flags: { overrides: { [ltmWax]: "on" } } }, () => {
    assert.ok(inBuild(v901, () => activeEventFlags()).includes(ltmWax), "switched on, always served");
  });
  assert.deepEqual(season4Flag(ltmWax).builds, [6428087, 7095426]);
  assert.deepEqual(eventCard("wicksBounty").ranges, [[6428087, 7095426]]);
});

test("a 9.01 player gets the Wick's Bounty Challenges at quest login while they run", () => {
  withConfig({ mode: "auto", seasonStarts: { 9: replayDaysAgo(8) } }, () => withSession(v901, "wick901", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const templates = templatesOf(session);
    assert.ok(templates.includes("ChallengeBundleSchedule:schedule_ltm_wax"));
    assert.ok(templates.includes("ChallengeBundle:questbundle_ltm_wax"));
    for (const id of ["quest_br_wax_win", "quest_br_wax_play_matches", "quest_br_wax_damage_assault"]) assert.ok(templates.includes(`Quest:${id}`), id);
  }));
  withConfig({ mode: "auto", seasonStarts: { 9: replayDaysAgo(8) } }, () => withSession(v900, "wick900", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    assert.equal(templatesOf(session).includes("ChallengeBundleSchedule:schedule_ltm_wax"), false, "not on 9.00");
  }));
});

test("Wick's Bounty's modes: 9.01's three playlists by their Original dates, off by default, tagged for the challenges", () => {
  const dated = { ltmOriginalDates: true };
  for (const [id, playlistId, first] of [["wicksBountySquads", 1004, "2019-05-16"], ["wicksBountyDuos", 1003, "2019-05-19"],
    ["wicksBountySolo", 1002, "2019-05-20"]]) {
    assert.deepEqual([hasLtm(id, v901), hasLtm(id, v900)], [true, false], id);
    assert.equal(ltmOn(id, v901, {}, at(`${first}T12:00:00Z`)), false, `${id} is off by default`);
    assert.equal(ltmOn(id, v901, dated, at(`${first}T12:00:00Z`)), true, `${id} from ${first}`);
    assert.equal(ltmOn(id, v901, dated, at("2019-05-15T12:00:00Z")), false, `${id} before`);
    assert.equal(ltmOn(id, v901, dated, at("2019-05-22T12:00:00Z")), false, `${id} after`);
    assert.equal(ltmPlaylistTag(playlistId, v901), "Athena.Playlist.Wax");
    assert.equal(teamsOfPlaylist(playlistId, v901).maxTeamCount, 72);
  }
  assert.deepEqual([1002, 1003, 1004].map((id) => teamsOfPlaylist(id, v901).maxTeamSize), [1, 2, 4]);
  assert.equal(teamsOfPlaylist(1004, v900), null, "9.00 has no Wick's Bounty");
});

test("Season 9's modes and events run on 9.01 as on 9.00: 50v50, Playground, Creative, the lobby, the Fortbytes, the Block", () => {
  withConfig(season9, () => {
    for (const id of ["fiftyFiftySeason9", "playgroundV2", "creative"]) assert.equal(ltmOn(id, v901, {}, at("2019-05-20T12:00:00Z")), true, id);
    for (const id of ["triosSeason9", "solidGoldSeason9Squads", "oneShotSeason9Squads"]) assert.equal(hasLtm(id, v901), true, id);
    assert.equal(inBuild(v901, () => fortbytesDay(at("2019-05-16T12:00:00Z"))), 7);
    assert.deepEqual(typesOf(inBuild(v901, () => blockStates(at("2019-05-20T12:00:00Z")))), [blockSlab(2)]);
  });
  const flags = activeEventFlags(v901);
  for (const flag of [lobbySeason9, wargamesFlag, season9Flag, season9Phase1]) assert.ok(flags.includes(flag), flag);
  assert.equal(blockEventOf(v901)?.id, "block900");
  for (const id of ["season9Lobby", "wargames", "talesOfBeyond"]) assert.deepEqual(eventCard(id).ranges, [[6337466, 7095426]], id);
  assert.deepEqual(eventCard("block900").ranges, [[6337466, 6428087]]);
});

test("9.01's Wargames add Update v9.01's Mist Pods: the hotfix's list, its quests and dailies; 9.00's stay off", () => {
  assert.deepEqual(wargamesGlobals(v901), ["bEnableIronCity=true", "+IronCityWargameTagList=Stat.Mission.IronCity.Pods"]);
  assert.deepEqual(wargamesGlobals(v900), ["bEnableIronCity=true"]);
  const quests901 = inBuild(v901, wargamesQuests);
  const quests900 = inBuild(v900, wargamesQuests);
  for (const id of ["wargames_quest_wargame_pods", "wargames_visibilityquest_wargame_pods"]) {
    assert.ok(quests901.includes(id), id);
    assert.equal(quests900.includes(id), false, id);
  }
  assert.equal(quests901.length, quests900.length + 5);
  assert.ok(inBuild(v901, () => wargamesDailyQuests("stonewood")).some((id) => id.startsWith("wargames_dailyquest_pods_")));
  assert.equal(inBuild(v900, () => wargamesDailyQuests("stonewood")).some((id) => id.startsWith("wargames_dailyquest_pods_")), false);
});

test("9.01's Event Store sells Prehistoric Izza for 2,800 Gold to Season 9's end; 9.00's has no event items", () => {
  withConfig(season9, () => {
    const eventFront = (build) => inBuild(build, () => storefronts(null)).find(({ name }) => name === eventStorefront)?.catalogEntries ?? [];
    const izza = eventFront(v901).find(({ itemGrants }) => itemGrants[0].templateId === "Hero:hid_constructor_027_dinoconstructor_sr_t01");
    assert.ok(izza, "Prehistoric Izza");
    assert.equal(izza.prices[0].finalPrice, 2800);
    assert.equal(eventFront(v900).length, 0);
    const ends = inBuild(v901, () => eventStoreEnds(at("2019-05-20T12:00:00Z")));
    assert.ok(ends.stwEventStoreEnd);
  });
});

test("9.01's shop: 9.00's history with John Wick's cosmetics in, from 17 May; 9.00 never shows them", () => {
  const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 9: "2019-05-09" } };
  configureItemShop(() => shopConfig);
  try {
    const wick = "AthenaCharacter:cid_416_athena_commando_m_assassinsuit";
    const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season9.json", import.meta.url), "utf8")).days;
    const day = history.find(({ featured, daily }) => [...featured, ...daily].some(([templateId]) => templateId === wick));
    assert.equal(day.date, "2019-05-17");
    const offersOn = (build) => inBuild(build, () => {
      const shop = itemShopOffers(at(`${day.date}T12:00:00Z`), shopConfig);
      return [...shop.BRWeeklyStorefront, ...shop.BRDailyStorefront].map(({ templateId }) => templateId);
    });
    assert.ok(offersOn(v901).includes(wick));
    assert.equal(offersOn(v900).includes(wick), false);
  } finally {
    configureItemShop(null);
  }
});

// Core-Backend #440: 9.01's paks hold the same earlier seasons' playlists as 9.00's (events/buildplaylists.js).
test("9.01 offers an earlier season's mode its paks hold once the admin turns it on, never by default or Original dates", () => {
  const now = at("2019-05-20T12:00:00Z");
  const on = (modes) => ({ matchmakingModes: modes });
  withConfig(season9, () => {
    for (const id of ["endgame", "endgame48", "endgame64", "getawaySeason8Squads", "foodFight", "foodFight16", "foodFightDeepFried", "closeEncountersSeason8Squads"]) {
      assert.deepEqual([hasLtm(id, v901), isHeldLtm(id, v901), isHeldLtm(id, v851)], [true, true, false], id);
      assert.equal(ltmOn(id, v901, {}, now), false, `${id} off by default`);
      assert.equal(ltmOn(id, v901, on({ [id]: true }), now), true, `${id} on by its switch`);
      assert.equal(ltmOn(id, v901, { ...on({ [id]: true }), ltmOriginalDates: true }, now), false, `${id}: no window on 9.01`);
      assert.equal(ltmOn(id, v901, { allGameModes: true }, now), true, `${id} by All game modes`);
    }
    // 9.01's own ids and teams: the same as 9.00's.
    assert.deepEqual([playlistIdOfName("playlist_score_squads", v901), playlistIdOfName("playlist_close_squad", v901)], [100, 46]);
    assert.deepEqual(playlistTeamsOf(`${v901}:0:NAE:playlist_final_12`, v901), { maxTeamCount: 8, maxTeamSize: 12, maxSquadSize: 4 });
    // Not held: a live event's, a tournament's, the Arena's and the Ice Storm's, and 9.10's Unvaulted, a later build's.
    for (const id of ["airRoyaleDuos", "unvaulting", "partyAtPleasantPark", "arenaSolo", "tournamentS8Solo", "iceStormSolo", "unvaultedSeason9Squads"]) {
      assert.equal(ltmOn(id, v901, { allGameModes: true, matchmakingModes: { [id]: true } }, now), false, id);
    }
    // 9.01's own Wick's Bounty is its own, not held.
    assert.deepEqual([hasLtm("wicksBountySolo", v901), isHeldLtm("wicksBountySolo", v901)], [true, false]);
    const listed = (settings) => ltmFrontEndPlaylists(v901, settings, now).map(({ name, enabled }) => [name, enabled]);
    assert.equal(listed({}).some(([name]) => name === "Playlist_Ashton_Sm"), false);
    assert.deepEqual(listed(on({ endgame: true })).find(([name]) => name === "Playlist_Ashton_Sm"), ["Playlist_Ashton_Sm", true]);
  });
});

test("9.01's lobby lists Endgame and takes its ticket once the admin turns it on (#440)", async () => {
  const agent = `Fortnite/++Fortnite+Release-9.01-CL-${v901} Windows/10.0.19045.1.256.64bit`;
  const backend = await startBackend();
  try {
    const endgameLine = async () => {
      const token = await clientToken(backend.port);
      const ini = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/cloudstorage/system/DefaultGame.ini",
        headers: { "User-Agent": agent, Authorization: `bearer ${token}` } });
      return String(ini.body ?? "").split("\r\n").find((line) => line.startsWith("+FrontEndPlaylistData=(PlaylistName=Playlist_Ashton_Sm,"));
    };
    const player = await userLogin(backend.port, "Endgame901");
    const ticket = () => send({ host: "127.0.0.1", port: backend.port, method: "GET",
      path: `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
        `&bucketId=${v901}:0:NAE:playlist_ashton_sm&player.platform=Windows`,
      headers: { "User-Agent": agent, Authorization: `bearer ${player.token}` } });
    assert.equal(await endgameLine(), undefined);
    assert.equal((await ticket()).status, 400);
    await post(backend.port, "/admin/api/matchmaking/config", undefined, { modes: { endgame: true } });
    assert.match(await endgameLine(), /PlaylistAccess=\(bEnabled=true,/);
    assert.equal((await ticket()).status, 200);
    await post(backend.port, "/admin/api/matchmaking/config", undefined, { modes: { endgame: false } });
    assert.equal(await endgameLine(), undefined);
    assert.equal((await ticket()).status, 400);
  } finally {
    backend.close();
  }
});

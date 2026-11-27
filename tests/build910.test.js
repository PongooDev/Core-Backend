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
import { downtownDropCalendarEvent, downtownDropFlagsNow, downtownDropStates } from "../src/events/downtowndrop.js";
import { activeEventFlags, blockSlab, configureEvents, lobbySeason9, ltmVigilante, ltmWax } from "../src/events/events.js";
import { hasLtm, isHeldLtm, ltmFrontEndPlaylists, ltmOn, playlistIdOfName } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { season9Flag, season9Phase1 } from "../src/events/talesofbeyond.js";
import { wargamesDailyQuests, wargamesFlag, wargamesGlobals, wargamesQuests } from "../src/events/wargames.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { dataBuild } from "../src/gamedata/read.js";
import { playlistTeamsOf, teamsOfPlaylist } from "../src/matchmaking/service.js";
import { athenaQuestLogin, setUpAthena } from "../src/profiles/athena.js";
import { styleSchedules } from "../src/profiles/challenges.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { storefronts } from "../src/store/catalog.js";
import { eventStorefront } from "../src/store/eventstore.js";
import { configureItemShop, itemShopOffers, seasonOfBuild } from "../src/store/itemshop.js";
import { clientToken, post, send, startBackend, userLogin } from "./helpers.js";

// Fortnite 9.10 (Season 9): two builds, both "9.10". CL-6639283 (Content Update v9.10, 29 May 2019) on its own data
// (gamedata/6639283), and CL-6573057 (Update v9.10, 22 May), whose paks Core has no copy of, on CL-6639283's (laterData).
// Season 9's Battle Pass, lobby, Fortbytes, Wargames and Tales of Beyond run on; its own: the Hang Time set and the Downtown
// Drop Challenges, the Block's 9.10 builds, Update v9.10's and Content Update v9.10's rotations, Space Rocks (both) and
// Hexed (CL-6639283), Rex Jonesy (both) and Fossil Southie (CL-6639283) in the Event Store, and the party pings
// (tests/party.test.js).
const v910 = "6639283";
const v9100 = "6573057";
const v901 = "6428087";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-910-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const templatesOf = (session) => Object.values(session.profile("athena").profile.items).map(({ templateId }) => templateId);

test("9.10's two builds are known as 9.10; Update v9.10's plays on Content Update v9.10's data", () => {
  assert.deepEqual([versionOf(v9100), versionOf(v910)], ["9.10", "9.10"]);
  assert.equal(allowedBuildList(["9.10"]).join(), `${v9100},${v910}`, "the version name allows both");
  assert.equal(allowedBuildList(["CL-6639283"]).join(), v910);
  assert.equal(dataBuild(v910), v910);
  assert.equal(dataBuild(v9100), v910, "CL-6573057 has no data of its own");
  assert.equal(dataBuild(v901), v901, "9.01 keeps its own data");
  assert.equal(dataBuild("6600000"), v901, "a build Core doesn't know before 9.10's content update plays on 9.01's");
  assert.equal(dataBuild("6700000"), v910);
  assert.deepEqual([releasedOn(v9100), releasedOn(v910)], [Date.UTC(2019, 4, 22), Date.UTC(2019, 4, 29)]);
  assert.equal(buildOfSeason(9), "6822798", "9.20 is Season 9's newest");
  assert.equal(seasonName(9), "Season 9 (9.00 – 9.20)");
  for (const build of [v9100, v910]) {
    const season = inBuild(build, athenaSeason);
    assert.deepEqual([season.seasonNumber, season.storefront, season.numBookLevels], [9, "BRSeason9", 100]);
    assert.equal(inBuild(build, seasonOfBuild), 9);
    assert.deepEqual(inBuild(build, () => battlePassOffers()).map(({ offerId, price }) => [offerId, price]),
      [["core_br_season9_battlepass", 950], ["core_br_season9_battlebundle", 2800], ["33E185A84ED7B64F2856E69AADFD092C", 150]]);
  }
});

test("9.10's cosmetics: 9.01's and 39 more, the Hang Time set's among them; the Burst SMG", () => {
  const [c910, c901] = [inBuild(v910, athenaCosmetics), inBuild(v901, athenaCosmetics)];
  assert.equal(Object.keys(c910).length, 1841);
  assert.deepEqual(Object.keys(c901).filter((id) => !c910[id]), []);
  assert.equal(Object.keys(c910).filter((id) => !c901[id]).length, 39);
  assert.deepEqual(["AthenaCharacter:cid_424_athena_commando_m_vigilante", "AthenaCharacter:cid_423_athena_commando_f_painter",
    "AthenaBackpack:bid_278_vigilanteboard"].map((id) => c910[id]?.name), ["Grind", "Clutch", "Back Board"]);
  assert.equal(inBuild(v9100, athenaCosmetics)["AthenaCharacter:cid_424_athena_commando_m_vigilante"].name, "Grind");
  assert.ok(inBuild(v910, () => getItem("Weapon:wid_pistol_burstfiresmg_athena_r_ore_t03")));
  assert.ok(!inBuild(v901, () => getItem("Weapon:wid_pistol_burstfiresmg_athena_r_ore_t03")));
});

test("the Downtown Drop Challenges: 9.10's schedule, served 22 May to 3 June on Season 9's replay, given at quest login", () => {
  inBuild(v910, () => {
    const schedule = athenaChallengeSchedules().bundleschedule_event_vigilanteboard;
    assert.equal(schedule.eventName, ltmVigilante);
    const bundle = athenaChallengeBundles().questbundle_event_vigilanteboard;
    assert.equal(bundle.quests.length, 13);
    assert.equal(bundle.quests.filter(({ grantWithBundle }) => grantWithBundle).length, 2);
    assert.deepEqual(bundle.completionSteps.map(({ count, rewards }) => [count, rewards[0].templateId]),
      [[1, "AthenaBackpack:bid_278_vigilanteboard"], [13, "CosmeticVariantToken:vtid_217_vigilanteboard_backbling_styleb"]]);
  });
  withConfig(season9, () => {
    for (const build of [v9100, v910]) {
      assert.deepEqual(typesOf(inBuild(build, () => downtownDropStates(at("2019-05-22T00:00:00Z")))), [ltmVigilante, downtownDropCalendarEvent]);
      assert.deepEqual(typesOf(inBuild(build, () => downtownDropStates(at("2019-06-03T23:00:00Z")))), [ltmVigilante, downtownDropCalendarEvent]);
      assert.deepEqual(inBuild(build, () => downtownDropFlagsNow(at("2019-05-21T12:00:00Z"))), []);
      assert.deepEqual(inBuild(build, () => downtownDropFlagsNow(at("2019-06-04T12:00:00Z"))), []);
    }
    assert.deepEqual(inBuild(v901, () => downtownDropFlagsNow(at("2019-05-25T12:00:00Z"))), [], "9.01 has no schedule for them");
  });
  withConfig({ ...season9, season4Flags: { overrides: { [ltmVigilante]: "on" } } }, () => {
    assert.ok(inBuild(v910, () => activeEventFlags()).includes(ltmVigilante), "switched on, always served");
  });
  assert.deepEqual(season4Flag(ltmVigilante).builds, [6573057, 6822798]);
  assert.deepEqual(season4Flag(ltmWax).builds, [6428087, 6822798]);
  assert.deepEqual(eventCard("downtownDrop").ranges, [[6573057, 6822798]]);
  withConfig({ mode: "auto", seasonStarts: { 9: replayDaysAgo(14) } }, () => withSession(v910, "drop910", (session) => {
    setUpAthena(session);
    athenaQuestLogin(session);
    const templates = templatesOf(session);
    assert.ok(templates.includes("ChallengeBundleSchedule:bundleschedule_event_vigilanteboard"));
    assert.ok(templates.includes("ChallengeBundle:questbundle_event_vigilanteboard"));
    assert.ok(templates.includes("Quest:quest_creative_dance_other"));
  }));
});

test("the Hang Time set's style challenges come with Grind and Clutch", () => {
  assert.equal(styleSchedules.bundleschedule_styles_vigilante_male, "AthenaCharacter:cid_424_athena_commando_m_vigilante");
  assert.equal(styleSchedules.bundleschedule_styles_painter, "AthenaCharacter:cid_423_athena_commando_f_painter");
  inBuild(v910, () => {
    const schedules = athenaChallengeSchedules();
    assert.equal(schedules.bundleschedule_styles_vigilante_male.category, "ChallengeCategory.Style");
    assert.equal(schedules.bundleschedule_styles_painter.category, "ChallengeCategory.Style");
  });
});

test("9.10's modes: Update v9.10's and Content Update v9.10's rotations by their dates, Team Rumble, Season 9's on", () => {
  const dated = { ltmOriginalDates: true };
  for (const build of [v9100, v910]) {
    for (const [id, inside, outside] of [["sniperShootoutSeason9Duos", "2019-05-25", "2019-05-30"],
      ["unvaultedSeason9Squads", "2019-06-02", "2019-06-05"], ["closeEncountersSeason9Squads", "2019-05-23", "2019-05-21"],
      ["solidGoldSeason9Squads", "2019-05-30", "2019-05-25"], ["teamRumbleSeason9", "2019-07-01", "2019-05-21"]]) {
      assert.equal(hasLtm(id, build), true, id);
      assert.equal(ltmOn(id, build, {}, at(`${inside}T12:00:00Z`)), false, `${id} is off by default`);
      assert.equal(ltmOn(id, build, dated, at(`${inside}T12:00:00Z`)), true, `${id} on ${inside}`);
      assert.equal(ltmOn(id, build, dated, at(`${outside}T12:00:00Z`)), false, `${id} not on ${outside}`);
    }
    for (const id of ["fiftyFiftySeason9", "playgroundV2", "creative"]) assert.equal(ltmOn(id, build, {}, at("2019-05-30T12:00:00Z")), true, id);
    for (const id of ["triosSeason9", "oneShotSeason9Squads", "wicksBountySquads"]) assert.equal(hasLtm(id, build), true, id);
  }
  for (const id of ["sniperShootoutSeason9Duos", "unvaultedSeason9Squads", "closeEncountersSeason9Squads", "teamRumbleSeason9"]) {
    assert.equal(hasLtm(id, v901), false, `${id} isn't 9.01's`);
  }
  assert.deepEqual([40, 332, 46, 27, 280].map((id) => teamsOfPlaylist(id, v910)).map(({ maxTeamCount, maxTeamSize }) => [maxTeamCount, maxTeamSize]),
    [[100, 2], [100, 4], [100, 4], [100, 4], [2, 20]]);
  assert.equal(teamsOfPlaylist(332, v901), null);
});

test("Season 9's events run on 9.10, and its Block plays Swash-buckling Seas, then Salty Scorpion", () => {
  for (const build of [v9100, v910]) {
    const flags = activeEventFlags(build);
    for (const flag of [lobbySeason9, wargamesFlag, season9Flag, season9Phase1]) assert.ok(flags.includes(flag), flag);
    assert.equal(blockEventOf(build)?.id, "block910");
  }
  assert.equal(blockEventOf(v901)?.id, "block900", "9.01 keeps 9.00's Block");
  withConfig(season9, () => {
    assert.deepEqual(typesOf(inBuild(v910, () => blockStates(at("2019-05-20T12:00:00Z")))), [blockSlab(1)]);
    assert.deepEqual(typesOf(inBuild(v910, () => blockStates(at("2019-05-29T12:00:00Z")))), [blockSlab(2)]);
  });
  for (const id of ["season9Lobby", "wargames", "talesOfBeyond"]) assert.deepEqual(eventCard(id).ranges, [[6337466, 6822798]], id);
  assert.deepEqual(eventCard("block910").ranges, [[6573057, 6639283]]);
});

test("9.10's Wargames: Space Rocks on both builds, Hexed on Content Update v9.10's; 9.01's unchanged", () => {
  assert.deepEqual(wargamesGlobals(v9100), ["bEnableIronCity=true", "+IronCityWargameTagList=Stat.Mission.IronCity.Pods",
    "+IronCityWargameTagList=Stat.Mission.IronCity.MStorm"]);
  assert.deepEqual(wargamesGlobals(v910), ["bEnableIronCity=true", "+IronCityWargameTagList=Stat.Mission.IronCity.Pods",
    "+IronCityWargameTagList=Stat.Mission.IronCity.MStorm", "+IronCityWargameTagList=Stat.Mission.IronCity.Tiki"]);
  assert.deepEqual(wargamesGlobals(v901), ["bEnableIronCity=true", "+IronCityWargameTagList=Stat.Mission.IronCity.Pods"]);
  const [q9100, q910] = [inBuild(v9100, wargamesQuests), inBuild(v910, wargamesQuests)];
  for (const quests of [q9100, q910]) assert.ok(quests.includes("wargames_quest_wargame_meteor"));
  assert.ok(q910.includes("wargames_quest_wargame_tiki"));
  assert.equal(q9100.includes("wargames_quest_wargame_tiki"), false, "Hexed is Content Update v9.10's");
  assert.equal(q910.length, q9100.length + 5);
  const dailies = (build) => inBuild(build, () => wargamesDailyQuests("stonewood"));
  assert.ok(dailies(v910).some((id) => id.startsWith("wargames_dailyquest_tiki_")));
  assert.ok(dailies(v9100).some((id) => id.startsWith("wargames_dailyquest_meteor_")));
  assert.equal(dailies(v9100).some((id) => id.startsWith("wargames_dailyquest_tiki_")), false);
  assert.equal(inBuild(v901, wargamesQuests).includes("wargames_quest_wargame_meteor"), false);
});

test("9.10's Event Store: Rex Jonesy from Update v9.10, Fossil Southie from Content Update v9.10, beside Prehistoric Izza", () => {
  withConfig(season9, () => {
    const heroes = (build) => (inBuild(build, () => storefronts(null)).find(({ name }) => name === eventStorefront)?.catalogEntries ?? [])
      .map(({ itemGrants, prices }) => [itemGrants[0].templateId, prices[0].finalPrice]);
    const izza = ["Hero:hid_constructor_027_dinoconstructor_sr_t01", 2800];
    const rex = ["Hero:hid_commando_029_dinosoldier_sr_t01", 2800];
    const southie = ["Hero:hid_outlander_027_dinooutlander_sr_t01", 2800];
    assert.deepEqual(heroes(v910), [izza, rex, southie]);
    assert.deepEqual(heroes(v9100), [izza, rex]);
    assert.deepEqual(heroes(v901), [izza]);
  });
});

test("9.10's shop: Season 9's history with its cosmetics in, Doggo from 26 May; 9.01 never shows them", () => {
  const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 9: "2019-05-09" } };
  configureItemShop(() => shopConfig);
  try {
    const doggo = "AthenaCharacter:cid_419_athena_commando_m_pug";
    const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season9.json", import.meta.url), "utf8")).days;
    const day = history.find(({ featured, daily }) => [...featured, ...daily].some(([templateId]) => templateId === doggo));
    assert.equal(day.date, "2019-05-26");
    const offersOn = (build) => inBuild(build, () => {
      const shop = itemShopOffers(at(`${day.date}T12:00:00Z`), shopConfig);
      return [...shop.BRWeeklyStorefront, ...shop.BRDailyStorefront].map(({ templateId }) => templateId);
    });
    assert.ok(offersOn(v910).includes(doggo));
    assert.ok(offersOn(v9100).includes(doggo));
    assert.equal(offersOn(v901).includes(doggo), false);
  } finally {
    configureItemShop(null);
  }
});

// Core-Backend #440: both 9.10 builds hold 9.01's earlier seasons' playlists less the three 9.10's own rotations and Team
// Rumble run (events/buildplaylists.js); CL-6573057 plays on CL-6639283's list.
test("9.10 (both builds) offers an earlier season's mode its paks hold once the admin turns it on, never by default or Original dates", () => {
  const now = at("2019-06-01T12:00:00Z");
  const on = (modes) => ({ matchmakingModes: modes });
  withConfig(season9, () => {
    for (const build of [v9100, v910]) {
      for (const id of ["endgame", "endgame48", "endgame64", "getawaySeason8Squads", "foodFight", "foodFight16", "foodFightDeepFried"]) {
        assert.deepEqual([hasLtm(id, build), isHeldLtm(id, build), isHeldLtm(id, v851)], [true, true, false], `${id} ${build}`);
        assert.equal(ltmOn(id, build, {}, now), false, `${id} ${build} off by default`);
        assert.equal(ltmOn(id, build, on({ [id]: true }), now), true, `${id} ${build} on by its switch`);
        assert.equal(ltmOn(id, build, { ...on({ [id]: true }), ltmOriginalDates: true }, now), false, `${id} ${build}: no window`);
        assert.equal(ltmOn(id, build, { allGameModes: true }, now), true, `${id} ${build} by All game modes`);
      }
      // Close Encounters Squads and Sniper Shootout Duos are 9.10's own rotation's, so Season 8's aren't held.
      assert.deepEqual([isHeldLtm("closeEncountersSeason8Squads", build), isHeldLtm("closeEncountersSeason9Squads", build)], [false, false]);
      assert.deepEqual([playlistIdOfName("playlist_score_squads", build), playlistIdOfName("playlist_close_squad", build)], [100, 46]);
      assert.deepEqual(playlistTeamsOf(`${build}:0:NAE:playlist_final_12`, build), { maxTeamCount: 8, maxTeamSize: 12, maxSquadSize: 4 });
      for (const id of ["airRoyaleDuos", "unvaulting", "partyAtPleasantPark", "arenaSolo", "tournamentS8Solo", "iceStormSolo"]) {
        assert.equal(ltmOn(id, build, { allGameModes: true, matchmakingModes: { [id]: true } }, now), false, `${id} ${build}`);
      }
      const listed = (settings) => ltmFrontEndPlaylists(build, settings, now).map(({ name, enabled }) => [name, enabled]);
      assert.equal(listed({}).some(([name]) => name === "Playlist_Ashton_Sm"), false);
      assert.deepEqual(listed(on({ endgame: true })).find(([name]) => name === "Playlist_Ashton_Sm"), ["Playlist_Ashton_Sm", true]);
    }
  });
});

for (const [build, version] of [[v9100, "9.10"], [v910, "9.10"]]) {
  test(`9.10 CL-${build}'s lobby lists Endgame and takes its ticket once the admin turns it on (#440)`, async () => {
    const agent = `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;
    const backend = await startBackend();
    try {
      const endgameLine = async () => {
        const token = await clientToken(backend.port);
        const ini = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/cloudstorage/system/DefaultGame.ini",
          headers: { "User-Agent": agent, Authorization: `bearer ${token}` } });
        return String(ini.body ?? "").split("\r\n").find((line) => line.startsWith("+FrontEndPlaylistData=(PlaylistName=Playlist_Ashton_Sm,"));
      };
      const player = await userLogin(backend.port, `Endgame${build}`);
      const ticket = () => send({ host: "127.0.0.1", port: backend.port, method: "GET",
        path: `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
          `&bucketId=${build}:0:NAE:playlist_ashton_sm&player.platform=Windows`,
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
}

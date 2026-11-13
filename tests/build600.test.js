import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { cramSessionEventItems, cramSessionQuests } from "../src/events/cramsession2018.js";
import { cubeStates } from "../src/events/cube.js";
import { activeEventFlags, activeMiniBosses, configureEvents, cramSession2018, cubeTurnOn, isEventActive, lobbySeason6, ltmHeist,
  passiveStorms } from "../src/events/events.js";
import { eventQuests } from "../src/events/fortnitemares.js";
import { highStakesStates } from "../src/events/highstakes.js";
import { hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmOfPlaylist, ltmOn, ltmPlaylistOverrides, playlistIdOfName } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaChallengeBundles, athenaChallengeSchedules, athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { getQuest } from "../src/gamedata/quests.js";
import { dataBuild } from "../src/gamedata/read.js";
import { parseBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { createSettingsStore } from "../src/settings/store.js";
import { eventStoreEnds, eventStoreOffers, eventStorefront, weeklyStorefront } from "../src/store/eventstore.js";
import { bundledBackBlings, itemShopOffers, seasonEnd } from "../src/store/itemshop.js";
import { worldInfo } from "../src/world/theaters.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Fortnite 6.00, Season 6 ("Darkness Rises", Update v6.00, 27 September 2018): CL-4402180 ("6.00", the owner's build, on its
// own data, gamedata/4402180) and CL-4395664 ("6.00.0", the earlier one, whose paks Core has no copy of, on CL-4402180's).
const v600 = "4402180";
const v6000 = "4395664";
const v541 = "4363240";
const builds600 = [v6000, v600];
// Season 6's replay from its real first day, so the replay's dates are Epic's.
const replay = { mode: "auto", seasonStarts: { 6: "2018-09-27" } };
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const at = (iso) => new Date(iso);

test("6.00's two changelists are known, both play on CL-4402180's data, Season 6's", () => {
  assert.equal(versionOf(v600), "6.00");
  assert.equal(versionOf(v6000), "6.00.0");
  for (const build of builds600) {
    assert.equal(dataBuild(build), v600, build);
    assert.ok(buildChoices().includes(build), build);
  }
  assert.equal(allowedBuildList(["6.00"]).join(), v600);
  assert.equal(allowedBuildList(["6.00.0"]).join(), v6000);
  assert.equal(dataBuild("4380000"), v541, "a build between 5.41 and 6.00 Core doesn't know plays on 5.41's");
  // Season 6's newest data is 6.10's now (tests/build610.test.js).
  assert.equal(buildOfSeason(6), "4497486");
  assert.equal(buildOfSeason(5), v541);
  assert.equal(seasonName(6), "Season 6 (6.00 – 6.20)");
  for (const build of builds600) {
    const season = inBuild(build, athenaSeason);
    assert.deepEqual([season.seasonNumber, season.numSeasonLevels, season.numBookLevels, season.storefront], [6, 100, 100, "BRSeason6"]);
    assert.deepEqual(season.firstWinRewards, [{ quantity: 1, templateId: "AthenaGlider:umbrella_season_06" }]);
  }
  // Season 6 keeps Season 5's level and tier curves.
  assert.deepEqual(inBuild(v600, athenaSeason).bookLevels, inBuild(v541, athenaSeason).bookLevels);
});

test("6.00's Battle Pass: DJ Yonder and Calamity at once, Dire at 100, pets as back blings and lobby music", () => {
  const season = inBuild(v600, athenaSeason);
  const tier = (list, level) => list.find((entry) => entry.level === level).rewards.map(({ templateId }) => templateId);
  assert.ok(["AthenaCharacter:cid_233_athena_commando_m_fortnitedj", "AthenaCharacter:cid_237_athena_commando_f_cowgirl",
    "ChallengeBundleSchedule:season6_paid_schedule", "ChallengeBundleSchedule:season6_progressivea_schedule"].every((id) => tier(season.bookPaidRewards, 1).includes(id)));
  assert.deepEqual(tier(season.bookPaidRewards, 100), ["AthenaCharacter:cid_230_athena_commando_m_werewolf", "ChallengeBundleSchedule:season6_progressiveb_schedule"]);
  assert.deepEqual(season.grantsToEveryone, [{ quantity: 1, templateId: "ChallengeBundleSchedule:season6_free_schedule" }]);
  const cosmetics = inBuild(v600, athenaCosmetics);
  // "Pets (Battle Royale): Always have a friend watching your back when you drop in" (UAthenaPetCarrierItemDefinition, a back bling).
  assert.deepEqual(["AthenaBackpack:petcarrier_001_dog", "AthenaBackpack:petcarrier_002_chameleon", "AthenaBackpack:petcarrier_003_dragon"]
    .map((id) => [cosmetics[id].class, cosmetics[id].name]),
  [["AthenaPetCarrierItemDefinition", "Bonesy"], ["AthenaPetCarrierItemDefinition", "Camo"], ["AthenaPetCarrierItemDefinition", "Scales"]]);
  assert.equal(tier(season.bookPaidRewards, 12)[0], "AthenaBackpack:petcarrier_001_dog");
  // "Players will now have an option in the Locker to select their preferred music choice."
  assert.deepEqual(["AthenaMusicPack:musicpack_001_floss", "AthenaMusicPack:musicpack_002_spooky", "AthenaMusicPack:musicpack_003_ogremix"]
    .map((id) => cosmetics[id].name), ["Squeaky Clean", "Eerie", "OG (Remix)"]);
  assert.equal(inBuild(v541, athenaCosmetics)["AthenaBackpack:petcarrier_001_dog"], undefined, "5.41 has no pets");
});

test("6.00's challenges: ten weeks in Season6_Free_Schedule, each three free and four with the Battle Pass, and the Hunting Party", () => {
  inBuild(v600, () => {
    const free = athenaChallengeSchedules().season6_free_schedule;
    assert.equal(free.bundles.length, 10);
    assert.deepEqual(free.bundles[0], { bundle: "questbundle_s6_week_001", unlockType: "OnScheduleGranted", unlockValue: 0 });
    for (const { bundle } of free.bundles) {
      const quests = athenaChallengeBundles()[bundle].quests;
      assert.deepEqual(quests.map(({ requiresBattlePass }) => Boolean(requiresBattlePass)), [false, false, false, true, true, true, true], bundle);
    }
    assert.equal(athenaChallengeBundles().questbundle_s6_cumulative.quests.length, 10, "the Hunting Party's ten");
  });
});

test("6.00's event flags: LobbySeason6, the ticketless storms and Cram Session's Mini-Bosses; the Cube and High Stakes ended with Season 5", () => {
  for (const build of builds600) {
    assert.deepEqual(activeEventFlags(build), [passiveStorms, lobbySeason6, activeMiniBosses], build);
    assert.equal(inBuild(build, () => isEventActive(cramSession2018)), true);
  }
  assert.equal(inBuild(v541, () => isEventActive(cramSession2018)), false);
  for (const flag of [cubeTurnOn, ltmHeist, "EventFlag.RoadTrip2018", "EventFlag.Horde"]) assert.equal(season4Flag(flag).builds[1], Number(v541), flag);
  assert.deepEqual(season4Flag(lobbySeason6).builds, [Number(v6000), 4497486], "LobbySeason6 runs on to 6.20");
  withConfig(replay, () => {
    assert.deepEqual(inBuild(v600, () => cubeStates(at("2018-10-01T00:00:00Z"))), []);
    assert.deepEqual(inBuild(v600, () => highStakesStates(at("2018-10-01T00:00:00Z"))), []);
  });
});

test("6.00's modes: its own 50v50 (glider redeploy) and Playground on by default, Soaring 50's by its switch; The Getaway is gone", () => {
  const defaults = createSettingsStore(null).get();
  for (const build of builds600) {
    assert.equal(ltmOfPlaylist(50, build).id, "fiftyFiftySeason6");
    assert.equal(ltmOfPlaylist(35, build).id, "playgroundV2");
    assert.equal(ltmOn("fiftyFiftySeason6", build, defaults), true);
    assert.equal(ltmOn("playgroundV2", build, defaults), true);
    assert.equal(ltmOn("soaring50s", build, defaults), false);
    for (const id of ["getaway", "getawayDuos", "soaringSolos", "closeEncountersSeason5", "fiftyFiftySolidGold", "fiftyFiftySeason5"]) {
      assert.equal(hasLtm(id, build), false, id);
    }
    assert.deepEqual(ltmPlaylistOverrides(build, defaults), ["Playlist_Playground", "Playlist_50v50"]);
    assert.deepEqual(ltmFrontEndPlaylists(build, defaults).map(({ name, enabled }) => [name, enabled]),
      [["Playlist_Playground", true], ["Playlist_Soaring_50s", false], ["Playlist_50v50", true]]);
    for (const [name, id] of [["playlist_50v50", 50], ["playlist_playground", 35], ["playlist_defaultsolo", 2]]) {
      assert.equal(playlistIdOfName(name, build), id);
      assert.equal(parseBucket(`${build}:0:NAE:${name}`, build).playlistId, id);
    }
    assert.deepEqual(playlistTeamsOf(`${build}:0:NAE:50`, build), { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 });
  }
  assert.equal(ltmOfPlaylist(50, v541).id, "fiftyFiftySeason5");
  withConfig(replay, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    assert.equal(inOriginalWindow("playgroundV2", v600, at("2018-10-01T12:00:00Z"), dated), true, "Playground through Season 6");
  });
});

test("6.00's shop: Season 6's history from 27 September 2018, 70 days, with Airheart's, Ludwig's and Heidi's back blings", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season6.json", import.meta.url), "utf8")).days;
  assert.equal(history.length, 70);
  assert.deepEqual([history[0].date, history.at(-1).date], ["2018-09-27", "2018-12-05"]);
  const c600 = inBuild(v600, athenaCosmetics);
  // The history holds 6.01's eight, 6.02's sixteen and 6.10's eight too (tests/build601.test.js, tests/build602.test.js,
  // tests/build610.test.js); a build is shown only what its own data has.
  const c601 = inBuild("4424678", athenaCosmetics);
  const later = [...new Set(history.flatMap((day) => [...day.featured, ...day.daily]).map(([id]) => id).filter((id) => !c600[id]))];
  assert.deepEqual(later.filter((id) => c601[id]).sort(), ["AthenaCharacter:cid_223_athena_commando_m_dieselpunk", "AthenaCharacter:cid_235_athena_commando_m_scarecrow",
    "AthenaCharacter:cid_236_athena_commando_f_scarecrow", "AthenaDance:eid_tpose", "AthenaGlider:glider_id_082_scarecrow",
    "AthenaGlider:glider_id_083_darkbomber", "AthenaPickaxe:pickaxe_id_105_scarecrow", "AthenaPickaxe:pickaxe_id_106_darkbomber"], "6.01's");
  const c602 = inBuild("4461277", athenaCosmetics);
  assert.equal(later.filter((id) => !c601[id] && c602[id]).length, 16, "6.02's");
  const c610 = inBuild("4480234", athenaCosmetics);
  assert.equal(later.filter((id) => !c602[id] && c610[id]).length, 8, "6.10's");
  const c620 = inBuild("4497486", athenaCosmetics);
  assert.equal(later.filter((id) => !c610[id]).length, 16, "6.20's");
  assert.ok(later.every((id) => c620[id]), "and nothing later");
  for (const iso of ["2018-09-30T12:00:00Z", "2018-10-05T12:00:00Z", "2018-10-07T12:00:00Z", "2018-11-15T12:00:00Z"]) {
    const offers = inBuild(v600, () => itemShopOffers(at(iso), { mode: "fnbr", rotationHour: 0, seasonStarts: { 6: "2018-09-27" } }));
    assert.ok([...offers.BRWeeklyStorefront, ...offers.BRDailyStorefront].every(({ templateId }) => c600[templateId]), `6.00's own on ${iso}`);
  }
  const config = { mode: "fnbr", rotationHour: 0, seasonStarts: { 6: "2018-09-27" } };
  // 28 September 2018: Ludwig and Heidi (Oktoberfest).
  const featured = inBuild(v600, () => itemShopOffers(at("2018-09-28T12:00:00Z"), config)).BRWeeklyStorefront;
  const ludwig = featured.find(({ templateId }) => templateId === "AthenaCharacter:cid_225_athena_commando_m_octoberfest");
  assert.deepEqual(ludwig.itemGrants.map(({ templateId }) => templateId),
    ["AthenaCharacter:cid_225_athena_commando_m_octoberfest", "AthenaBackpack:bid_117_octoberfestmale"]);
  assert.equal(bundledBackBlings["AthenaCharacter:cid_224_athena_commando_f_dieselpunk"], "AthenaBackpack:bid_116_dieselpunkfemale");
  // The season's countdown is its 70 days: Season 7 began on 6 December 2018.
  assert.equal(inBuild(v600, () => seasonEnd(at("2018-10-01T12:00:00Z"), config)).toISOString(), "2018-12-06T00:00:00.000Z");
});

test("6.00's Save the World: Cram Session's quests, Mini-Boss alerts with Gold, MEGA B.A.S.E. Kyle and the Ratatat", () => {
  withConfig(replay, () => inBuild(v600, () => {
    assert.deepEqual(eventQuests(), cramSessionQuests);
    assert.ok(cramSessionQuests.every((id) => getQuest(id)));
    assert.deepEqual(getQuest("autumnquest_explorezones_1").hiddenRewards, [{ quantity: 1, templateId: "Quest:autumnquest_explorezones_2" }]);
    // Core-Backend #329: "Has repeatable quests that award Elemental PERK-UPs, RE-PERKs, and Evolution Materials", the
    // LTE_Autumn GenericQuest repeatables, each granting itself again.
    const repeatables = { genericquest_killfirehusks_repeatable: "AccountResource:reagent_alteration_ele_fire",
      genericquest_killnaturehusks_repeatable: "AccountResource:reagent_alteration_ele_nature",
      genericquest_killwaterhusks_repeatable: "AccountResource:reagent_alteration_ele_water",
      genericquest_killmistmonsters_repeatable: "AccountResource:reagent_alteration_generic" };
    for (const [questId, reward] of Object.entries(repeatables)) {
      assert.ok(eventQuests().includes(questId), questId);
      assert.deepEqual(getQuest(questId).rewards, [{ quantity: 100, templateId: reward }], questId);
      assert.deepEqual(getQuest(questId).hiddenRewards, [{ quantity: 1, templateId: `Quest:${questId}` }], questId);
    }
    assert.deepEqual(getQuest("genericquest_killminibosses_repeatable").selectableRewards.flat().map(({ templateId }) => templateId),
      ["AccountResource:reagent_c_t01", "AccountResource:reagent_c_t02", "AccountResource:reagent_c_t03"]);
    assert.ok(!eventQuests().includes("genericquest_completestormzones_repeatable"), "Road Trip's, not Cram Session's");
    const now = at("2018-09-28T12:00:00Z");
    const offers = eventStoreOffers(now);
    assert.deepEqual(offers[eventStorefront].map(({ templateId }) => templateId), cramSessionEventItems.map(({ templateId }) => templateId));
    assert.equal(getItem(cramSessionEventItems[0].templateId).name, "MEGABASE Kyle");
    assert.deepEqual(offers[weeklyStorefront].slice(0, 2).map(({ templateId }) => templateId),
      ["Schematic:sid_pistol_ratrod_sr_ore_t01", "Schematic:sid_blunt_hammer_hydraulic_vr_ore_t01"]);
    assert.equal(eventStoreEnds(now).stwEventStoreEnd.toISOString(), "2018-12-06T00:00:00.000Z");
  }));
  const info = inBuild(v600, () => worldInfo(at("2026-11-11T12:00:00Z")));
  const alerts = info.missionAlerts.flatMap(({ availableMissionAlerts }) => availableMissionAlerts);
  const miniBosses = alerts.filter(({ categoryName }) => categoryName === "MiniBossCategory");
  assert.ok(miniBosses.length > 0, "Mini-Boss alerts are active");
  for (const alert of miniBosses) {
    const items = alert.missionAlertRewards.items.map(({ itemType }) => itemType.toLowerCase());
    assert.ok(items.includes("accountresource:eventcurrency_scaling"), "Gold instead of tickets");
    assert.ok(!items.some((id) => /^(cardpack:zcp_mtx|cardpack:cardpack_(hero|worker|ranged|melee|trap|defender)|conversioncontrol:)/.test(id)),
      "no V-Bucks, heroes, schematics, survivors or transform keys");
  }
  assert.ok(alerts.some(({ categoryName }) => categoryName === "MegaAlertCategory"), "5.40's Mega Alerts run on");
});

// Core-Backend #325: "you cant matchmake into matches it just says 'Connecting to matchmaking service'" on 6.00. Its client's
// MatchmakingServiceClient is 5.41's (the same ticket query, Epic-Signed WebSocket and messages); the lobby's text shows in
// ConnectingToService and in WaitingForParty, until Queued. A 6.00 player, on either changelist, takes a ticket for Solo, its
// 50v50 and Playground, hears Connecting, Waiting and Queued at once (Playground's match is assigned at once, so before the
// server answers), and is sent to a registered 6.00 server.
function matchmakingClient(port, authorization) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/", headers: { Connection: "Upgrade", Upgrade: "websocket",
      "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"), Authorization: authorization } });
    request.on("error", reject);
    request.on("upgrade", (response, socket, head) => {
      const messages = [];
      const waiters = [];
      let buffer = Buffer.alloc(0);
      const deliver = (text) => (waiters.length ? waiters.shift()(text) : messages.push(text));
      const receive = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          let length = buffer[1] & 0x7f;
          let offset = 2;
          if (length === 126) {
            length = buffer.readUInt16BE(2);
            offset = 4;
          }
          if (buffer.length < offset + length) return;
          if ((buffer[0] & 0x0f) === 0x1) deliver(buffer.subarray(offset, offset + length).toString("utf8"));
          buffer = buffer.subarray(offset + length);
        }
      };
      receive(head);
      socket.on("data", receive);
      socket.on("close", () => {
        while (waiters.length) waiters.shift()(null);
      });
      resolve({
        send: (text) => {
          const payload = Buffer.from(text);
          const mask = crypto.randomBytes(4);
          const header = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length])
            : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
          socket.write(Buffer.concat([header, mask, Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]))]));
        },
        next: () => (messages.length ? Promise.resolve(messages.shift()) : new Promise((done) => waiters.push(done))),
        close: () => socket.destroy()
      });
    });
    request.end();
  });
}
const authorizationOf = ({ ticketType, payload, signature }) => `Epic-Signed ${ticketType} ${payload} ${signature}`;
async function nextOf(connection, name) {
  for (;;) {
    const text = await connection.next();
    if (text === null) return null;
    const message = JSON.parse(text);
    if (message.name === name || message.payload?.state === name) return message;
  }
}

test("a 6.00 player matchmakes on either changelist: Solo, 50v50 and Playground reach Queued and a 6.00 server (#325)", async () => {
  for (const build of builds600) {
    const agent = `Fortnite/++Fortnite+Release-6.00-CL-${build} Windows/10.0.19045.1.256.64bit`;
    const as = (port, urlPath, token, method = "GET", body) => {
      const text = body === undefined ? undefined : JSON.stringify(body);
      const headers = { "User-Agent": agent, Authorization: `bearer ${token}` };
      if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
      return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
    };
    const backend = await startBackend({ matchmakingGatherMs: 100 });
    const clients = [];
    try {
      const server = await userLogin(backend.port, `Server${build}`);
      for (const playlist of ["playlist_defaultsolo", "playlist_50v50", "playlist_playground"]) {
        const session = (await as(backend.port, "/fortnite/api/matchmaking/session", server.token, "POST", {
          ownerId: server.accountId, ownerName: "Core", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
          maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: build, attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NAE" }
        })).body;
        const gameserver = await matchmakingClient(backend.port, authorizationOf((await as(backend.port,
          `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent(`${build}:0:NAE:**`)}&minPlayers=1&maxPlayers=100`,
          server.token)).body));
        clients.push(gameserver);
        assert.equal(JSON.parse(await gameserver.next()).name, "Registered");
        const player = await userLogin(backend.port, `P${build}${playlist.length}`);
        const ticket = await as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
          `&bucketId=${build}:0:NAE:${playlist}&player.platform=Windows&player.option.fillTeam=true`, player.token);
        assert.equal(ticket.status, 200, `${build} ${playlist}: ${JSON.stringify(ticket.body)}`);
        const client = await matchmakingClient(backend.port, authorizationOf(ticket.body));
        clients.push(client);
        const states = [];
        for (;;) {
          const { name, payload } = JSON.parse(await client.next());
          states.push(name === "StatusUpdate" ? payload.state : name);
          if (states.at(-1) === "Queued") break;
        }
        assert.deepEqual(states, ["Connecting", "Waiting", "Queued"], `${build} ${playlist}`);
        const assign = await nextOf(gameserver, "AssignMatch");
        assert.equal(assign.payload.bucketId, `Fortnite:Fortnite:${build}:0:NAE:${playlist}`);
        gameserver.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
        const play = await nextOf(client, "Play");
        assert.deepEqual([play.payload.matchId, play.payload.sessionId], [assign.payload.matchId, session.id]);
        const found = await as(backend.port, `/fortnite/api/matchmaking/session/${session.id}`, player.token);
        assert.equal(found.status, 200);
        // The next playlist gets a server of its own.
        gameserver.close();
      }
    } finally {
      for (const client of clients) client.close();
      backend.close();
    }
  }
});

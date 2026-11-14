import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { allowedBuildList } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { seasonName, versionOf } from "../src/builds/detect.js";
import { activeEventFlags, configureEvents, fortnitemares2018, fortnitemaresPhase2, halloweenBattleBus, isEventActive, islandCrack, islandDrain, islandPoi,
  lobbySeason6, lobbySeason6Halloween, ltmFortnitemares, ltmLilKevin } from "../src/events/events.js";
import { defaultReplacements, hasLtm, inOriginalWindow, ltmFrontEndPlaylists, ltmOfPlaylist, ltmOn, playlistIdOfName } from "../src/events/ltms.js";
import { season4Flag } from "../src/events/season4flags.js";
import { athenaCosmetics, athenaLootTables, athenaSeason } from "../src/gamedata/athena.js";
import { getItem } from "../src/gamedata/items.js";
import { buildGameData, dataBuild } from "../src/gamedata/read.js";
import { botModeIds, botModeOf } from "../src/matchmaking/botmodes.js";
import { parseBucket, playlistTeamsOf } from "../src/matchmaking/service.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { settleLevel } from "../src/profiles/xp.js";
import { rewardModeOf } from "../src/services/fortnite/battleroyale.js";
import { contentPage } from "../src/services/content/pages.js";
import { epicPlaylistImages } from "../src/services/content/playlistimages.js";
import { createSettingsStore } from "../src/settings/store.js";
import { eventStoreOffers } from "../src/store/eventstore.js";
import { configureItemShop, itemShopOffers } from "../src/store/itemshop.js";
import { hasShowdown } from "../src/tournaments/showdown.js";
import { tournamentPlaylists } from "../src/tournaments/store.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Fortnite 6.30 (Update v6.30, 14 November 2018, and Content Update v6.30, 20 November; Season 6): one build here,
// CL-4573096 (its files are dated 19 November, with the Content Update's Wild West and Dynamite in its paks), on its own
// data (gamedata/4573096). Battle Royale: Food Fight (Playlist_Barrier, 2 × 24, and Playlist_Barrier_12), Wild West
// (Playlist_WW_Solo, _Duos, _Squads), the Mounted Turret, the Scavenger Pop-Up Cup's tournament playlists; Blitz! gone.
// Save the World: the new front end, whose skill and research trees are HomebaseNode items and a research curve table,
// and whose account levels reward template ids (FORT stats, Upgrade Points, schematics).
const v630 = "4573096";
const v622 = "4543176";
const replay = { mode: "auto", seasonStarts: { 6: "2018-09-27" } };
const shopConfig = { mode: "fnbr", rotationHour: 0, seasonStarts: { 6: "2018-09-27" } };
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const at = (iso) => new Date(iso);
const agentOf = (build, version = "6.30") => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "core-630-"));
const withSession = (build, name, run) => {
  const dir = tempDir();
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), name)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const asBuild = (build, version = "6.30") => (port, urlPath, token, method = "GET", body) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": agentOf(build, version), ...(token ? { Authorization: `bearer ${token}` } : {}) };
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
};

test("6.30 is known, on its own data, Season 6's newest", () => {
  assert.equal(versionOf(v630), "6.30");
  assert.equal(allowedBuildList(["6.30"]).join(), v630);
  assert.equal(dataBuild(v630), v630);
  assert.equal(dataBuild("4560000"), v622, "a build between 6.22 and 6.30 plays on 6.22's");
  assert.equal(dataBuild(v622), v622, "6.22 keeps its own data");
  assert.equal(dataBuild("4600000"), v630, "a later build Core doesn't know plays on 6.30's");
  assert.equal(buildOfSeason(6), v630);
  assert.equal(seasonName(6), "Season 6 (6.00 – 6.30)");
  assert.equal(inBuild(v630, athenaSeason).seasonNumber, 6);
});

test("6.30's Battle Royale data against 6.22's: twenty-seven cosmetics and none gone, the Mounted Turret and the Dynamite in the loot", () => {
  const [c630, c622] = [inBuild(v630, athenaCosmetics), inBuild(v622, athenaCosmetics)];
  assert.equal(Object.keys(c630).filter((id) => !c622[id]).length, 27);
  assert.deepEqual(Object.keys(c622).filter((id) => !c630[id]), []);
  for (const [id, name] of [["AthenaCharacter:cid_269_athena_commando_m_wizard", "Castor"], ["AthenaCharacter:cid_270_athena_commando_f_witch", "Elmira"],
    ["AthenaCharacter:cid_268_athena_commando_m_rockerpunk", "Riot"], ["AthenaCharacter:cid_274_athena_commando_m_feathers", "Tender Defender"],
    ["AthenaPickaxe:pickaxe_id_107_halloweentomato", "Night Slicer"], ["AthenaDance:eid_cowboydance", "Knee Slapper"], ["AthenaGlider:glider_id_098_sup", "Hyper"]]) {
    assert.equal(c630[id]?.name, name, id);
  }
  // Update v6.30's "Mounted Turret added (Legendary Trap) ... Found in Floor Loot, Supply Drops, Vending Machines"; the
  // Content Update's Dynamite is in the tables at weight 0 (Epic's hotfix gave it its weights).
  const loot = JSON.stringify(inBuild(v630, athenaLootTables));
  assert.ok(loot.includes("TID_Floor_MountedTurret_Athena") && loot.includes("Athena_TNT"));
  assert.equal(JSON.stringify(inBuild(v622, athenaLootTables)).includes("TID_Floor_MountedTurret_Athena"), false);
  assert.ok(inBuild(v630, () => getItem("Trap:tid_floor_mountedturret_athena")));
});

test("6.30's Save the World: its nodes are HomebaseNode items with levels, research is a curve table, account levels reward template ids", () => {
  const { nodes, pages } = buildGameData(v630, "homebasenodes", {});
  assert.equal(Object.keys(nodes).length, 100);
  assert.deepEqual(pages, {}, "no skill or research tree pages");
  const backpack = nodes.SkillTree_BackpackSize;
  assert.equal(backpack.displayType, "Utility");
  assert.ok(backpack.levels.length > 1);
  assert.deepEqual(backpack.levels[0].cost, [{ quantity: 1, templateId: "Token:homebasepoints" }]);
  assert.equal(backpack.levels[0].minCommanderLevel, 10);
  assert.equal(nodes.SkillTree_Airstrike.displayType, "Gadget", "unset is EHomebaseNodeType's Gadget");
  assert.deepEqual(nodes.StartNode_CommandCenter.squadSlots, [{ slot: 0, squadId: "Squad_Combat_AdventureSquadOne" }, { slot: 0, squadId: "Squad_Combat_NewHeroSquad" }]);
  for (const id of ["HomebaseNode:skilltree_buildinghealth", "HomebaseNode:questreward_evolution", "Stat:fortitude", "Stat:technology_team", "Token:upgrades_respec", "Token:research_respec"]) {
    assert.ok(inBuild(v630, () => getItem(id)), id);
  }
  assert.ok(Object.keys(buildGameData(v622, "homebasenodes", {}).pages).length > 0, "6.22's skill tree is as it was");
  const research = buildGameData(v630, "research", {});
  assert.equal(research.stats.fortitude_cost[1], 300);
  assert.equal(buildGameData(v622, "research", {}).stats, undefined);
  const levels = buildGameData(v630, "accountlevels", []);
  assert.equal(levels.length, 310);
  assert.deepEqual(levels.find(({ level }) => level === 2).rewards, [{ quantity: 3, templateId: "Stat:fortitude" }]);
  assert.deepEqual(levels.find(({ level }) => level === 1).rewards, [], "level 1's empty reward gives nothing");
});

test("a 6.30 account's level-ups grant the new rewards; 6.22's still grant Upgrade Points by asset", () => {
  withSession(v630, "level630", (session) => {
    session.profile("profile0").setStat("xp", 40_000_000);
    assert.deepEqual(settleLevel(session), [2, 3, 4, 5]);
    const held = Object.values(session.profile("profile0").profile.items).map(({ templateId, quantity }) => `${templateId} ${quantity}`);
    // One stack a stat, its quantity the stat (Epic's campaign profiles hold one Stat:fortitude with the sum).
    for (const stat of ["fortitude", "offense", "resistance", "technology"]) assert.ok(held.includes(`Stat:${stat} 3`), stat);
  });
  withSession(v622, "level622", (session) => {
    session.profile("profile0").setStat("xp", 10_000_000);
    assert.deepEqual(settleLevel(session), [2]);
    assert.ok(Object.values(session.profile("profile0").profile.items).some(({ templateId }) => templateId.toLowerCase() === "token:homebasepoints"));
  });
});

test("6.30's event flags: 6.22's but POI1; Save the World's Fortnitemares with Part 2 and the challenges run on", () => {
  const flags = activeEventFlags(v630);
  for (const flag of ["EventFlag.Fortnitemares", "EventFlag.FortnitemaresPhase1", fortnitemaresPhase2, "EventFlag.ActiveMiniBosses", ltmFortnitemares, ltmLilKevin,
    "EventFlag.PassiveStorms", lobbySeason6]) assert.ok(flags.includes(flag), flag);
  for (const flag of [islandPoi(0), islandPoi(1), lobbySeason6Halloween, halloweenBattleBus]) assert.equal(flags.includes(flag), false, flag);
  assert.ok(activeEventFlags(v622).includes(islandPoi(1)), "6.22 is as it was");
  // The switches run on to 6.30 but the Cube's end (6.30's paks have no island scripting).
  for (const flag of [lobbySeason6, lobbySeason6Halloween, halloweenBattleBus, ltmFortnitemares, ltmLilKevin, fortnitemaresPhase2]) {
    assert.equal(season4Flag(flag).builds[1], Number(v630), flag);
  }
  for (const flag of [islandPoi(0), islandPoi(1), islandCrack, islandDrain]) assert.equal(season4Flag(flag).builds[1], Number(v622), flag);
  assert.equal(inBuild(v630, () => isEventActive(fortnitemares2018)), true);
});

test("Food Fight: 6.30's Playlist_Barrier (204), two teams of 24 in squads, on by default and listed as New, its Original dates 14 to 20 November", () => {
  const defaults = createSettingsStore(null).get();
  assert.equal(defaults.matchmakingModes.foodFight, true, "on by default in the admin panel");
  assert.equal(defaults.matchmakingModes.foodFight12, false, "the 12 a side one by its switch");
  assert.equal(hasLtm("foodFight", v630), true);
  assert.equal(hasLtm("foodFight", v622), false, "6.30's alone");
  assert.equal(ltmOn("foodFight", v630, defaults), true);
  assert.equal(ltmOn("foodFight", v630, { ...defaults, matchmakingModes: { ...defaults.matchmakingModes, foodFight: false } }), false);
  assert.equal(ltmOfPlaylist(204, v630).id, "foodFight");
  assert.equal(ltmOfPlaylist(206, v630).id, "foodFight12");
  assert.equal(playlistIdOfName("playlist_barrier", v630), 204);
  assert.equal(parseBucket(`${v630}:0:NAE:playlist_barrier`, v630).playlistId, 204);
  assert.deepEqual(playlistTeamsOf(`${v630}:0:NAE:playlist_barrier`, v630), { maxTeamCount: 2, maxTeamSize: 24, maxSquadSize: 4 });
  assert.deepEqual(playlistTeamsOf(`${v630}:0:NAE:playlist_barrier_12`, v630), { maxTeamCount: 2, maxTeamSize: 12, maxSquadSize: 4 });
  assert.equal(rewardModeOf(204, v630), "squads");
  withConfig(replay, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    assert.equal(inOriginalWindow("foodFight", v630, at("2018-11-13T23:59:00Z"), dated), false);
    assert.equal(inOriginalWindow("foodFight", v630, at("2018-11-14T00:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("foodFight", v630, at("2018-11-20T00:00:00Z"), dated), false, "the Content Update's day");
  });
  assert.ok(botModeIds.includes("foodFight"));
  assert.equal(botModeOf("playlist_barrier", v630), "foodFight");
  assert.match(epicPlaylistImages.Playlist_Barrier, /BR06_LobbyTile_FoodFight-1024x512-5e1540a0a2ba0a1f663d32c60cfec3a360278672\.png$/);
  assert.equal(epicPlaylistImages.Playlist_Barrier_12, epicPlaylistImages.Playlist_Barrier);
  const tiles = contentPage(undefined, undefined, v630).playlistinformation.playlist_info.playlists;
  assert.deepEqual(tiles.find(({ playlist_name }) => playlist_name === "Playlist_Barrier"),
    { image: epicPlaylistImages.Playlist_Barrier, playlist_name: "Playlist_Barrier", special_border: "None", _type: "FortPlaylistInfo" });
});

test("Wild West: 6.30's Playlist_WW_Solo, _Duos and _Squads (900 to 902), on by default and listed as New, its Original dates 20 to 27 November", () => {
  const defaults = createSettingsStore(null).get();
  for (const [id, name, playlistId, size] of [["wildWestSolo", "Playlist_WW_Solo", 900, 1], ["wildWestDuos", "Playlist_WW_Duos", 901, 2], ["wildWestSquads", "Playlist_WW_Squads", 902, 4]]) {
    assert.equal(defaults.matchmakingModes[id], true, id);
    assert.equal(ltmOn(id, v630, defaults), true, id);
    assert.equal(hasLtm(id, v622), false, id);
    assert.equal(playlistIdOfName(name, v630), playlistId, name);
    assert.deepEqual(playlistTeamsOf(`${v630}:0:NAE:${name.toLowerCase()}`, v630), { maxTeamCount: 100, maxTeamSize: size, maxSquadSize: size }, name);
    assert.match(epicPlaylistImages[name], /BR06_ModeTile_LTM_WildWest-1024x512-f67d9d1dd2ca0b290c92b1380240429f0f257a10\.jpg$/);
  }
  assert.equal(rewardModeOf(901, v630), "duos");
  withConfig(replay, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    assert.equal(inOriginalWindow("wildWestSquads", v630, at("2018-11-19T12:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("wildWestSquads", v630, at("2018-11-20T12:00:00Z"), dated), true);
    assert.equal(inOriginalWindow("wildWestSquads", v630, at("2018-11-27T00:00:00Z"), dated), false, "Update v6.31's day");
  });
});

test("6.30's other modes: 6.22's but Blitz!, Team Terror on unless switched off, Disco Domination (32 v 32, Alt) back, the Scavenger Pop-Up Cup's tournaments", () => {
  const defaults = createSettingsStore(null).get();
  for (const id of ["blitzSeason6Solo", "blitzSeason6Duos", "blitzSeason6Squads"]) {
    assert.equal(hasLtm(id, v630), false, id);
    assert.equal(hasLtm(id, v622), true, `${id} is 6.22's still`);
  }
  for (const id of ["fiftyFiftySeason6", "playgroundV2", "teamTerror"]) assert.equal(ltmOn(id, v630, defaults), true, id);
  for (const id of ["discoDomination32", "soaring50s", "highExplosivesSeason6Solo", "showdownSolo", "discoDomination32Alt630"]) assert.equal(hasLtm(id, v630), true, id);
  assert.equal(ltmOn("discoDomination32Alt630", v630, defaults), false, "by its switch");
  assert.equal(ltmOfPlaylist(232, v630).id, "discoDomination32Alt630");
  assert.equal(hasLtm("discoDomination32Alt", v622), false, "6.22's paks have none");
  withConfig(replay, () => {
    const dated = { ltmOriginalDates: true, matchmakingModes: defaults.matchmakingModes };
    assert.equal(inOriginalWindow("teamTerror", v630, at("2018-11-10T12:00:00Z"), dated), false, "Team Terror's Original dates are 6.22's");
  });
  for (const [id, playlistId] of [["scavengerSolo", 58074], ["scavengerDuos", 58075], ["scavengerSquads", 58076]]) {
    assert.equal(ltmOfPlaylist(playlistId, v630).id, id);
    assert.equal(ltmOn(id, v630, defaults), false, "a tournament playlist is no lobby mode");
    assert.ok(tournamentPlaylists.some((entry) => entry.id === id && entry.inGame), id);
  }
  assert.equal(hasShowdown(v630), true);
  assert.deepEqual(defaultReplacements(v630, defaults), {});
  const lobby = ltmFrontEndPlaylists(v630, defaults);
  for (const name of ["Playlist_Barrier", "Playlist_WW_Solo", "Playlist_WW_Duos", "Playlist_WW_Squads", "Playlist_Deimos_50"]) {
    const entry = lobby.find((own) => own.name === name);
    assert.deepEqual([entry?.enabled, entry?.ltm.advertise], [true, "New"], name);
  }
  assert.equal(lobby.some(({ name }) => name === "Playlist_Blitz_Solo"), false);
});

test("a 6.30 client's hotfix lists Food Fight and Wild West enabled and the defaults as shipped", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "Lobby630");
    const lines = (await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/cloudstorage/system/DefaultGame.ini",
      headers: { "User-Agent": agentOf(v630), Authorization: `bearer ${token}` } })).body.toString().split("\r\n").filter((line) => line.includes("FrontEndPlaylistData"));
    for (const name of ["Playlist_Barrier", "Playlist_WW_Solo", "Playlist_WW_Duos", "Playlist_WW_Squads"]) {
      const line = lines.find((own) => own.includes(`PlaylistName=${name},`));
      assert.ok(line && line.includes("bEnabled=true") && line.includes("AdvertiseType=New"), `${name}: ${line}`);
    }
    assert.ok(lines.some((line) => line.includes("PlaylistName=Playlist_DefaultSolo,") && line.includes("bEnabled=true")), "Solo isn't replaced");
  } finally {
    await backend.close();
  }
});

test("6.30's shop: Castor and Elmira, Maki Master, Tender Defender, Taro and Nara, Riot on their days; 6.22's days are as they were", () => {
  const history = JSON.parse(fs.readFileSync(new URL("../src/store/itemshop-season6.json", import.meta.url), "utf8")).days;
  assert.equal(history.length, 70);
  const [c630, c622] = [inBuild(v630, athenaCosmetics), inBuild(v622, athenaCosmetics)];
  assert.ok(history.every((day) => [...day.featured, ...day.daily].every(([id]) => c630[id])), "only 6.30's cosmetics");
  const own = [...new Set(history.flatMap((day) => [...day.featured, ...day.daily]).map(([id]) => id).filter((id) => !c622[id]))];
  assert.equal(own.length, 16);
  const days = (id) => history.filter((day) => [...day.featured, ...day.daily].some(([entry]) => entry === id)).map(({ date }) => date.slice(5));
  assert.deepEqual(days("AthenaCharacter:cid_269_athena_commando_m_wizard"), ["11-16", "11-17"]);
  assert.deepEqual(days("AthenaPickaxe:pickaxe_id_107_halloweentomato"), ["11-15"]);
  assert.deepEqual(days("AthenaCharacter:cid_268_athena_commando_m_rockerpunk"), ["11-28"]);
  assert.deepEqual(days("AthenaGlider:glider_id_098_sup"), [], "Hyper isn't sold");
  const featured = (build, iso) => inBuild(build, () => itemShopOffers(at(iso), shopConfig)).BRWeeklyStorefront.map(({ templateId }) => templateId);
  assert.ok(featured(v630, "2018-11-16T12:00:00Z").includes("AthenaCharacter:cid_270_athena_commando_f_witch"));
  assert.equal(featured(v622, "2018-11-16T12:00:00Z").includes("AthenaCharacter:cid_270_athena_commando_f_witch"), false, "6.22 sells none of them");
});

test("6.30's Weekly Store: the Last Word, then 8-Bit Demo and the Ghost Pistol; 6.22's weeks are as they were", (t) => {
  // The weeks count on Season 6's replay, Epic's dates here (a backend started by another test leaves its own clock).
  configureItemShop(() => shopConfig);
  t.after(() => configureItemShop(null));
  const offers = (build, iso) => JSON.stringify(inBuild(build, () => eventStoreOffers(at(iso))));
  assert.ok(offers(v630, "2018-11-16T12:00:00Z").includes("Schematic:sid_pistol_revolver_singleaction_sr_ore_t01"));
  const week = offers(v630, "2018-11-23T12:00:00Z");
  assert.ok(week.includes("Hero:hid_constructor_016_m_v1_blockbuster_sr_t01") && week.includes("Schematic:sid_pistol_halloween_handcannon_sr_ore_t01"));
  assert.equal(week.includes("sid_pistol_revolver_singleaction"), false, "the Last Word's week is over");
  assert.equal(offers(v622, "2018-11-16T12:00:00Z").includes("sid_pistol_revolver_singleaction"), false);
});

// The matchmaking service's client is 6.22's: 6.30's exe adds no ticket attribute, query parameter or route the
// matchmaking uses (its strings against CL-4543176's).
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

test("a 6.30 player matchmakes into Food Fight and Wild West Squads and reaches a 6.30 server", async () => {
  const as = asBuild(v630);
  const backend = await startBackend({ matchmakingGatherMs: 100 });
  const clients = [];
  try {
    const server = await userLogin(backend.port, "Server630");
    for (const playlist of ["playlist_barrier", "playlist_ww_squads"]) {
      const session = (await as(backend.port, "/fortnite/api/matchmaking/session", server.token, "POST", {
        ownerId: server.accountId, ownerName: "Core", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
        maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: v630, attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NAE" }
      })).body;
      const gameserver = await matchmakingClient(backend.port, authorizationOf((await as(backend.port,
        `/fortnite/api/game/v2/matchmakingservice/ticket/session/${session.id}?bucketIds=${encodeURIComponent(`${v630}:0:NAE:**`)}&minPlayers=1&maxPlayers=100`,
        server.token)).body));
      clients.push(gameserver);
      assert.equal(JSON.parse(await gameserver.next()).name, "Registered");
      const player = await userLogin(backend.port, `P630${playlist.length}`);
      const ticket = await as(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
        `&bucketId=${v630}:0:NAE:${playlist}&player.platform=Windows&player.option.fillTeam=true`, player.token);
      assert.equal(ticket.status, 200, `${playlist}: ${JSON.stringify(ticket.body)}`);
      const client = await matchmakingClient(backend.port, authorizationOf(ticket.body));
      clients.push(client);
      const states = [];
      for (;;) {
        const { name, payload } = JSON.parse(await client.next());
        states.push(name === "StatusUpdate" ? payload.state : name);
        if (states.at(-1) === "Queued") break;
      }
      assert.deepEqual(states, ["Connecting", "Waiting", "Queued"], playlist);
      const assign = await nextOf(gameserver, "AssignMatch");
      assert.equal(assign.payload.bucketId, `Fortnite:Fortnite:${v630}:0:NAE:${playlist}`);
      gameserver.send(JSON.stringify({ name: "AssignMatchResult", payload: { matchId: assign.payload.matchId, result: "ready" } }));
      const play = await nextOf(client, "Play");
      assert.deepEqual([play.payload.matchId, play.payload.sessionId], [assign.payload.matchId, session.id]);
      gameserver.close();
    }
  } finally {
    for (const client of clients) client.close();
    backend.close();
  }
});

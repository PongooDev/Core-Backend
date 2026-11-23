import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { ltmFrontEndPlaylists, ltmIds, ltmOfBucketPlaylist, ltmOn, ltmSchedule, playlistIdOfName } from "../src/events/ltms.js";
import { botModeCandidates, botModeIds, botsForMode, defaultBotModes, sanitizeBotModes } from "../src/matchmaking/botmodes.js";
import { isPartyOnlyBucket, parseBucket } from "../src/matchmaking/service.js";
import { configureCreativeEarlyAccess, creativeAccessGlobals, creativeEntitled, creativePartyHosts, inCreativeEarlyAccess, earlyAccessMessage, islandsForEveryone, plotsOf, plotTemplateId, settleCreativePlots } from "../src/profiles/creative.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { contentPage, creativeAdsFor } from "../src/services/content/pages.js";
import { metaOf, parseIslandPath } from "../src/services/dss/dss.js";
import { configureItemShop } from "../src/store/itemshop.js";
import { clientToken, dedicatedServerToken, send, startBackend, userLogin } from "./helpers.js";

// 7.00's Creative (PongooDev/CoreV2#471): the lobby's Creative playlist, Update v7.00's early access, the islands of the
// creative profile, their saves on the DSS (the servers' sidecar requests), the server's two Creative commands and the hub's
// ads section.
const v700 = "4629139";
const v631 = "4573279";
const agentOf = (build, version) => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;
const agent700 = agentOf(v700, "7.00");
const agent631 = agentOf(v631, "6.31");
const dayMs = 86_400_000;
// A Season 7 replay start that puts today on the replay's day `day` (1 = 6 December 2018).
const startForDay = (day) => {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - (day - 1) * dayMs).toISOString().slice(0, 10);
};
const as = (port, token, method, url, { agent = agent700, body, headers = {} } = {}) => send({ host: "127.0.0.1", port, method, path: url,
  headers: { "User-Agent": agent, ...(token ? { Authorization: `bearer ${token}` } : {}), ...headers } }, body);
const mcp = (port, { token, accountId }, command, profileId, body = {}, route = "client", agent = agent700) => as(port, token, "POST",
  `/fortnite/api/game/v2/profile/${accountId}/${route}/${command}?profileId=${profileId}&rvn=-1`,
  { agent, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const profileOf = (response) => (response.body.profileChanges ?? []).find((change) => change.changeType === "fullProfileUpdate")?.profile;
const ticket = (port, { token, accountId }, playlist = "playlist_playgroundv2", agent = agent700) => as(port, token, "GET",
  `/fortnite/api/game/v2/matchmakingservice/ticket/player/${accountId}?partyPlayerIds=${accountId}&bucketId=${v700}:0:NAE:${playlist}`, { agent });
const withSession = (name, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-creative-"));
  try {
    return inBuild(v700, () => run(openSession(createProfileStore(dir), name), dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
// Season 7's Battle Pass bought: athena's book_purchased in Season 7.
function giveBattlePass(dataDir, accountId) {
  inBuild(v700, () => {
    const session = openSession(createProfileStore(dataDir), accountId);
    const athena = session.profile("athena");
    assert.equal(athena.profile.stats.attributes.season_num, 7);
    athena.setStat("book_purchased", true);
    session.commit();
  });
}

test("7.00's lobby lists Creative as shipped (Playlist_PlaygroundV2, New, no limited-time banner, priority 16); its tickets are their party's alone", () => {
  inBuild(v700, () => {
    const creative = ltmFrontEndPlaylists(v700, {}).find(({ name }) => name === "Playlist_PlaygroundV2");
    assert.deepEqual([creative.ltm.id, creative.enabled, creative.priority], ["creative", true, 16]);
    // A game mode always on (#375): a setting saved off before, or Original dates, changes nothing; no switch to list.
    assert.equal(ltmOn("creative", v700, { matchmakingModes: { creative: false } }), true);
    assert.equal(ltmOn("creative", v700, { ltmOriginalDates: true, matchmakingModes: { creative: false } }), true);
    assert.equal(ltmOn("creative", v631, {}), false, "where the build has it");
    assert.equal(ltmIds.includes("creative"), false);
    assert.equal(ltmSchedule({}).list.some(({ id }) => id === "creative"), false);
    const bucket = parseBucket(`${v700}:0:NAE:playlist_playgroundv2`, v700);
    assert.equal(bucket.playlistId, 35);
    assert.equal(ltmOfBucketPlaylist(bucket).id, "creative");
    assert.equal(ltmOfBucketPlaylist(parseBucket(`${v700}:0:NAE:playlist_playground`, v700)).id, "playgroundV2", "Playground keeps its own");
    assert.equal(isPartyOnlyBucket(`${v700}:0:NAE:playlist_playgroundv2`, v700), true);
    // Never bots, and no Player bots switch of its own (#375).
    assert.deepEqual(botModeCandidates("playlist_playgroundv2", v700), ["creative"]);
    assert.deepEqual(botModeCandidates("Playlist_PlaygroundV2", "unknown"), ["creative"]);
    assert.deepEqual(botModeCandidates("playlist_playground", v700), ["playgroundV2"]);
    const bots = { forcePlayerAIs: true, count: 10, fillPlayerTeams: true, modes: {} };
    assert.deepEqual([botsForMode(bots, "creative").forcePlayerAIs, botsForMode(bots, "creative").fillPlayerTeams], [false, false]);
    assert.equal(botsForMode({ ...bots, modes: { creative: true } }, "creative").forcePlayerAIs, false, "not even a saved switch");
    assert.equal(botsForMode(bots, "playgroundV2").forcePlayerAIs, true, "Playground as before");
    assert.equal(botModeIds.includes("creative"), false);
    assert.deepEqual([defaultBotModes().creative, sanitizeBotModes({ creative: true }).creative], [undefined, undefined]);
  });
  assert.equal(ltmFrontEndPlaylists(v631, {}).some(({ name }) => name === "Playlist_PlaygroundV2"), false, "6.31 has no Creative");
  assert.equal(playlistIdOfName("playlist_playgroundv2", v631), 35);
});

test("the lobby hotfix: 7.00's Creative line and the sidecar service on an Epic host for CoreRedirect (CoreV2 #485); 6.31's files as before", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    const file = async (agent, name) => (await as(backend.port, token, "GET", `/fortnite/api/cloudstorage/system/${name}`, { agent })).body;
    const game700 = await file(agent700, "DefaultGame.ini");
    assert.ok(game700.includes("+FrontEndPlaylistData=(PlaylistName=Playlist_PlaygroundV2, PlaylistAccess=(bEnabled=true, bIsDefaultPlaylist=false, " +
      "bVisibleWhenDisabled=false, AdvertiseType=New, bDisplayAsLimitedTime=false, DisplayPriority=16))"), game700);
    assert.ok(game700.includes("PlaylistName=Playlist_Playground, PlaylistAccess=(bEnabled=true, bIsDefaultPlaylist=false, bVisibleWhenDisabled=false, " +
      "AdvertiseType=Updated, bDisplayAsLimitedTime=true, DisplayPriority=15)"), "Playground as before");
    const engine700 = await file(agent700, "DefaultEngine.ini");
    assert.ok(engine700.includes("[OnlineSubsystemMcp.OnlineSidecarServiceMcp]\r\nProtocol=https\r\nDomain=mcpsidecar-public-service-prod.ol.epicgames.com\r\n"), engine700);
    assert.equal((await file(agent631, "DefaultGame.ini")).includes("Playlist_PlaygroundV2"), false);
    assert.equal((await file(agent631, "DefaultEngine.ini")).includes("OnlineSidecarServiceMcp"), false);
    assert.equal((await file(agent631, "DefaultGame.ini")).includes("CreativeModeLimitedAccess"), false, "6.31 gets no early access globals");
  } finally {
    await backend.close();
  }
});

// Core-Backend #379: 7.00's own early access notice, the "Start a server" tile locked with "Available on {Date}." and
// "Upgrade your Battle Pass to get early access now!", which UFortGlobals' three Config values turn on.
test("the lobby hotfix turns on 7.00's Creative early access notice until 13 December on the replay, its date when it opens here", async () => {
  const today = new Date();
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const early = await startBackend({ events: { seasonStarts: { 7: startForDay(3) } } });
  try {
    const game = (await as(early.port, await clientToken(early.port), "GET", "/fortnite/api/cloudstorage/system/DefaultGame.ini")).body;
    const globals = game.slice(game.indexOf("[/Script/FortniteGame.FortGlobals]"));
    // Day 3 is 8 December: the 13th is day 8, five days from today's midnight.
    assert.ok(globals.includes(`\r\nbEnableCreativeModeLimitedAccess=true\r\nbEnableCreativeModeLimitedAccessForFounders=false\r\n` +
      `CreativeModeLimitedAccessEndTime=${new Date(midnight + 5 * dayMs).toISOString()}\r\n`), globals);
    assert.ok(globals.indexOf("CreativeModeLimitedAccessEndTime") < globals.indexOf("\r\n[", 2), "in FortGlobals' own section");
  } finally {
    await early.close();
  }
  const open = await startBackend({ events: { seasonStarts: { 7: startForDay(9) } } });
  try {
    const game = (await as(open.port, await clientToken(open.port), "GET", "/fortnite/api/cloudstorage/system/DefaultGame.ini")).body;
    assert.ok(game.includes("\r\nbEnableCreativeModeLimitedAccess=false\r\n"));
    assert.equal(game.includes("CreativeModeLimitedAccessEndTime"), false);
  } finally {
    await open.close();
  }
  assert.deepEqual(creativeAccessGlobals(v631), []);
});

test("early access: four islands for a Season 7 Battle Pass owner, for everyone from 13 December 2018 on the replay, kept after", () => {
  configureItemShop({ mode: "fnbr", rotationHour: 0, seasonStarts: { 7: "2018-12-06" } });
  try {
    assert.equal(islandsForEveryone(new Date("2018-12-12T23:59:59Z")), false);
    assert.equal(islandsForEveryone(new Date("2018-12-13T00:00:00Z")), true);
    assert.equal(islandsForEveryone(new Date("2019-02-28T00:00:00Z")), false, "the replay's next cycle starts on 6 December again");
    assert.match(earlyAccessMessage(new Date("2018-12-12T12:00:00Z")), /replay is on 2018-12-12, 1 day before it/);
    withSession("earlynobp", (session) => {
      assert.equal(creativeEntitled(session, new Date("2018-12-10T12:00:00Z")), false);
      assert.equal(settleCreativePlots(session, new Date("2018-12-10T12:00:00Z")), 0);
      assert.equal(session.hasProfile("creative"), false, "nothing made");
      assert.equal(settleCreativePlots(session, new Date("2018-12-13T12:00:00Z")), 4);
      const plots = plotsOf(session.profile("creative").profile);
      assert.deepEqual(plots.map(([, item]) => [item.templateId, item.attributes.islandIndex, item.attributes.islandName]),
        [1, 2, 3, 4].map((index) => [plotTemplateId, index, ""]));
      assert.equal(settleCreativePlots(session, new Date("2018-12-14T12:00:00Z")), 0, "given once");
      assert.equal(settleCreativePlots(session, new Date("2019-03-01T12:00:00Z")), 0, "and kept");
    });
    withSession("earlybp", (session) => {
      const athena = session.profile("athena");
      athena.setStat("book_purchased", true);
      assert.equal(creativeEntitled(session, new Date("2018-12-07T12:00:00Z")), true);
      assert.equal(settleCreativePlots(session, new Date("2018-12-07T12:00:00Z")), 4);
    });
    withSession("seasonaside", (session) => {
      const athena = session.profile("athena");
      athena.profile.coreSeasons = { 7: { book_purchased: true } };
      athena.setStat("season_num", 6);
      assert.equal(creativeEntitled(session, new Date("2018-12-07T12:00:00Z")), true, "Season 7's record kept aside");
    });
  } finally {
    configureItemShop(null);
  }
});

test("early access is 7.00's alone and follows the admin panel's switch: 7.10 and Season 8 never lock the tile (#410)", () => {
  configureItemShop({ mode: "fnbr", rotationHour: 0, seasonStarts: { 7: "2018-12-06" } });
  const during = new Date("2018-12-08T12:00:00Z");
  const limitedOff = ["bEnableCreativeModeLimitedAccess=false"];
  try {
    assert.equal(inCreativeEarlyAccess(v700, during), true);
    assert.equal(creativeAccessGlobals(v700, during)[0], "bEnableCreativeModeLimitedAccess=true");
    for (const build of ["4667333", "4727874", "5203069", "5625478"]) {
      assert.equal(inCreativeEarlyAccess(build, during), false, build);
      assert.deepEqual(creativeAccessGlobals(build, during), limitedOff, build);
    }
    withSession("s8nobp", (session) => assert.equal(creativeEntitled(session, during, "5625478"), true, "a Season 8 player may play"));
    configureCreativeEarlyAccess(() => false);
    assert.equal(inCreativeEarlyAccess(v700, during), false);
    assert.deepEqual(creativeAccessGlobals(v700, during), limitedOff);
    withSession("offnobp", (session) => {
      assert.equal(creativeEntitled(session, during), true, "switch off: no early access");
      assert.equal(settleCreativePlots(session, during), 4);
    });
  } finally {
    configureCreativeEarlyAccess(() => true);
    configureItemShop(null);
  }
});

test("a 7.00 player in early access: no islands and no Creative ticket without the Battle Pass; with it, four islands and a ticket", async () => {
  const backend = await startBackend({ events: { seasonStarts: { 7: startForDay(3) } } });
  try {
    const player = await userLogin(backend.port, "CreativeNoPass");
    const before = await mcp(backend.port, player, "QueryProfile", "creative");
    assert.deepEqual(profileOf(before).items, {});
    const refused = await ticket(backend.port, player);
    assert.deepEqual([refused.status, refused.body.errorCode], [400, "errors.com.epicgames.fortnite.matchmaking_disabled"]);
    // Who was refused, why and how to get in (Core-Backend #375): the replay's day 3 is 8 December, 5 days before the 13th.
    assert.match(refused.body.errorMessage, /early access for Season 7 Battle Pass owners until 13 December 2018/);
    assert.match(refused.body.errorMessage, /replay is on 2018-12-08, 5 days before it/);
    assert.match(refused.body.errorMessage, /Buy the Season 7 Battle Pass/);
    assert.match(refused.body.errorMessage, /Season start \(day 1\), set at least 7 days back/);
    assert.equal((await ticket(backend.port, player, "playlist_playground")).status, 200, "Playground isn't Creative");

    const owner = await userLogin(backend.port, "CreativePass");
    await mcp(backend.port, owner, "QueryProfile", "athena");
    giveBattlePass(backend.dataDir, owner.accountId);
    const islands = profileOf(await mcp(backend.port, owner, "QueryProfile", "creative"));
    assert.deepEqual(Object.values(islands.items).map((item) => [item.templateId, item.attributes.islandIndex]).sort(),
      [1, 2, 3, 4].map((index) => [plotTemplateId, index]));
    assert.equal((await ticket(backend.port, owner)).status, 200);
  } finally {
    await backend.close();
  }
});

// Core-Backend #375: early access goes by the party's leader. Epic let players without the Battle Pass play on an owner's
// server; a party's Creative match is its leader's, whose ticket comes first.
test("early access by the party's leader: the first ticket of a party opens a round its other players follow for a minute", () => {
  let clock = 0;
  const hosts = creativePartyHosts({ followMs: 60_000, now: () => clock });
  const party = ["leader", "guest"];
  assert.equal(hosts.ticket("leader", party, true), null, "the leader plays on their own pass");
  assert.equal(hosts.ticket("guest", ["guest", "leader"], false), "leader", "the guest follows, whatever the list's order");
  assert.equal(hosts.ticket("stranger", ["stranger", "leader"], false), null, "another party's player doesn't");
  assert.equal(hosts.ticket("guest", ["guest"], false), null, "alone, nobody to follow");
  clock += 61_000;
  assert.equal(hosts.ticket("guest", party, false), null, "a minute on, the round is over and the guest's ticket opens one");
  assert.equal(hosts.ticket("leader", party, true), null, "an owner's ticket takes over a refused round");
  assert.equal(hosts.ticket("guest", party, false), "leader");
  const without = creativePartyHosts({ now: () => clock });
  assert.equal(without.ticket("nopass", ["nopass", "other"], false), null);
  assert.equal(without.ticket("other", ["nopass", "other"], false), null, "a leader without the pass lets nobody in");
});

test("a 7.00 player without the Battle Pass queues Creative in early access behind their party's leader who has it (#375)", async () => {
  const backend = await startBackend({ events: { seasonStarts: { 7: startForDay(3) } } });
  try {
    const leader = await userLogin(backend.port, "CreativeLeader");
    await mcp(backend.port, leader, "QueryProfile", "athena");
    giveBattlePass(backend.dataDir, leader.accountId);
    const guest = await userLogin(backend.port, "CreativeGuest");
    const partyTicket = (player) => as(backend.port, player.token, "GET", `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}` +
      `?partyPlayerIds=${leader.accountId},${guest.accountId}&bucketId=${v700}:0:NAE:playlist_playgroundv2`);
    const alone = await ticket(backend.port, guest);
    assert.equal(alone.status, 400, "alone, still early access");
    assert.match(alone.body.errorMessage, /play in a party whose leader has it/);
    assert.equal((await partyTicket(leader)).status, 200);
    const followed = await partyTicket(guest);
    assert.equal(followed.status, 200, JSON.stringify(followed.body));
    assert.deepEqual(profileOf(await mcp(backend.port, guest, "QueryProfile", "creative")).items, {}, "a guest gets no islands of their own");
  } finally {
    await backend.close();
  }
});

test("from 13 December on the replay every 7.00 player has islands and queues Creative; a matchmaking setting saved off for it is ignored (#375)", async () => {
  const backend = await startBackend({ events: { seasonStarts: { 7: startForDay(9) } } });
  try {
    const player = await userLogin(backend.port, "CreativeLate");
    const accepted = await ticket(backend.port, player);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const islands = profileOf(await mcp(backend.port, player, "QueryProfile", "creative"));
    assert.equal(Object.keys(islands.items).length, 4, "given with the ticket");
    const older = await mcp(backend.port, player, "QueryProfile", "creative", {}, "client", agent631);
    assert.deepEqual([older.status, older.body.errorCode], [400, "errors.com.epicgames.modules.profiles.invalid_profile_id"], "6.31 as before");
  } finally {
    await backend.close();
  }
  const offDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-creative-off-"));
  fs.writeFileSync(path.join(offDir, "settings.json"), JSON.stringify({ matchmakingModes: { creative: false }, matchmakingModesRevision: 1 }));
  const off = await startBackend({ dataDir: offDir, events: { seasonStarts: { 7: startForDay(9) } } });
  try {
    const player = await userLogin(off.port, "CreativeOff");
    const accepted = await ticket(off.port, player);
    assert.equal(accepted.status, 200, "always on, as Save the World and Battle Royale");
    const lobby = (await as(off.port, await clientToken(off.port), "GET", "/fortnite/api/cloudstorage/system/DefaultGame.ini")).body;
    assert.ok(lobby.includes("PlaylistName=Playlist_PlaygroundV2, PlaylistAccess=(bEnabled=true,"), "and in the lobby");
  } finally {
    await off.close();
  }
});

test("the server's Creative commands keep the last island and who may build; SetCreativePlotIslandName stays unknown", async () => {
  const backend = await startBackend({ events: { seasonStarts: { 7: startForDay(20) } } });
  try {
    const player = await userLogin(backend.port, "CreativeCommands");
    const plots = Object.keys(profileOf(await mcp(backend.port, player, "QueryProfile", "creative")).items);
    const server = { token: await dedicatedServerToken(backend.port), accountId: player.accountId };
    const used = await mcp(backend.port, server, "SetLastUsedCreativePlot", "creative", { plotItemId: plots[2] }, "dedicated_server");
    assert.equal(used.status, 200, JSON.stringify(used.body));
    const friend = "0123456789abcdef0123456789abcdef";
    const permissions = await mcp(backend.port, server, "ModifyCreativePlotPermissions", "creative",
      { permission: "Public", accountIds: [friend, friend, "not an id"] }, "dedicated_server");
    assert.equal(permissions.status, 200);
    const numbered = await mcp(backend.port, server, "ModifyCreativePlotPermissions", "creative", { permission: 0, accountIds: [] }, "dedicated_server");
    const stats = profileOf(await mcp(backend.port, player, "QueryProfile", "creative")).stats.attributes;
    assert.equal(stats.last_used_plot, plots[2]);
    assert.deepEqual(stats.creative_plot_permissions, { permission: "Private", whiteList: [] });
    assert.ok((numbered.body.profileChanges ?? []).length);
    const unknownPlot = await mcp(backend.port, server, "SetLastUsedCreativePlot", "creative", { plotItemId: "nope" }, "dedicated_server");
    assert.deepEqual([unknownPlot.status, unknownPlot.body.errorCode], [400, "errors.com.epicgames.fortnite.item_not_found"]);
    const badPermission = await mcp(backend.port, server, "ModifyCreativePlotPermissions", "creative", { permission: "Everyone" }, "dedicated_server");
    assert.equal(badPermission.status, 400);
    const fromClient = await mcp(backend.port, player, "SetLastUsedCreativePlot", "creative", { plotItemId: plots[0] });
    assert.equal(fromClient.status, 400, "a server's command");
    const named = await mcp(backend.port, player, "SetCreativePlotIslandName", "creative", { plotItemId: plots[0], islandName: "Mine" });
    assert.deepEqual([named.status, named.body.errorCode], [400, "errors.com.epicgames.fortnite.operation_not_found"]);
  } finally {
    await backend.close();
  }
});

test("7.40's SetCreativePlotMetadata (the server's, PongooDev/CoreV2#545) writes the island's title and description into its plot item", async () => {
  const backend = await startBackend({ events: { seasonStarts: { 7: startForDay(20) } } });
  try {
    const player = await userLogin(backend.port, "CreativeMetadata");
    const plots = Object.keys(profileOf(await mcp(backend.port, player, "QueryProfile", "creative")).items);
    const server = { token: await dedicatedServerToken(backend.port), accountId: player.accountId };
    const body = { plotItemId: plots[1], locale: "en", title: "My Island", tagline: "", youtubeVideoId: "", introduction: "Line one\nLine two" };
    const saved = await mcp(backend.port, server, "SetCreativePlotMetadata", "creative", body, "dedicated_server");
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.ok((saved.body.profileChanges ?? []).length, "the server's copy of the profile hears the change");
    const attributes = profileOf(await mcp(backend.port, player, "QueryProfile", "creative")).items[plots[1]].attributes;
    assert.deepEqual([attributes.title, attributes.locale, attributes.introduction, attributes.tagline, attributes.youtube_video_id],
      ["My Island", "en", "Line one\nLine two", "", ""]);
    const short = await mcp(backend.port, server, "SetCreativePlotMetadata", "creative", { ...body, title: "ab" }, "dedicated_server");
    assert.deepEqual([short.status, short.body.errorCode], [400, "errors.com.epicgames.validation.validation_failed"]);
    const unknownPlot = await mcp(backend.port, server, "SetCreativePlotMetadata", "creative", { ...body, plotItemId: "nope" }, "dedicated_server");
    assert.deepEqual([unknownPlot.status, unknownPlot.body.errorCode], [400, "errors.com.epicgames.fortnite.item_not_found"]);
    const fromClient = await mcp(backend.port, player, "SetCreativePlotMetadata", "creative", body);
    assert.equal(fromClient.status, 400, "a server's command");
  } finally {
    await backend.close();
  }
});

test("the DSS keeps an owner's islands: checkout, upload with its meta, checkin, download and restore, only for the server or the owner", async () => {
  assert.deepEqual(parseIslandPath("islands/personal/0123456789ABCDEF0123456789abcdef/7f1c-ab.island"),
    { owner: "0123456789abcdef0123456789abcdef", plotItemId: "7f1c-ab" });
  assert.equal(parseIslandPath("islands/personal/x/../y.island"), null);
  assert.deepEqual(metaOf({ headers: { "x-epic-meta-serialized-at": "2018-12-06", "x-epic-meta-bad key": "1", "content-type": "x" } }),
    { "serialized-at": "2018-12-06" });
  const backend = await startBackend({ events: { seasonStarts: { 7: startForDay(20) } } });
  try {
    const owner = await userLogin(backend.port, "IslandOwner");
    const other = await userLogin(backend.port, "IslandOther");
    const [plot, second] = Object.keys(profileOf(await mcp(backend.port, owner, "QueryProfile", "creative")).items);
    const server = await dedicatedServerToken(backend.port);
    const file = `/api/dss/v1/creative/islands/personal/${owner.accountId}/${plot}.island`;
    const dss = (token, method, url, body, headers = {}) => as(backend.port, token, method, url,
      { agent: "FortniteGame/++Fortnite+Release-7.00-CL-4629139 Windows/10.0.19045.1.256.64bit", body, headers: { "Content-Type": "application/octet-stream", ...headers } });

    assert.deepEqual([(await dss(server, "GET", file)).status, (await dss(server, "GET", file)).body.errorCode], [404, "errors.com.epicgames.dss.file_not_found"]);
    const unlocked = await dss(server, "PUT", `${file}?autolock=false`, "first");
    assert.deepEqual([unlocked.status, unlocked.body.errorCode], [409, "errors.com.epicgames.dss.file_not_checked_out"]);
    const empty = await dss(server, "POST", `${file}/checkout?pid=server-one&dl=true`);
    assert.equal(empty.status, 204, "no island yet: the lock, no body");
    const saved = await dss(server, "PUT", `${file}?autolock=false`, "first version", { "X-Epic-Meta-serialized-at": "2018.12.06-10.00.00", "X-Epic-Meta-num-actors-new": "3" });
    assert.equal(saved.status, 204);
    // The newest server takes the island over (one server per player: a crashed one never keeps it).
    const again = await dss(server, "POST", `${file}/checkout?pid=server-two&dl=true`);
    assert.deepEqual([again.status, again.body, again.headers["x-epic-meta-serialized-at"], again.headers["x-epic-meta-num-actors-new"]],
      [200, "first version", "2018.12.06-10.00.00", "3"]);
    assert.equal((await dss(server, "POST", `${file}/checkin`, "second version")).status, 204);
    const read = await dss(owner.token, "GET", file);
    assert.deepEqual([read.status, read.body, read.headers["x-epic-meta-serialized-at"]], [200, "second version", "2018.12.06-10.00.00"]);
    assert.equal((await dss(server, "POST", `${file}/checkin`)).status, 409, "checked in already");
    // Restore: the version before the last write.
    assert.equal((await dss(server, "POST", `${file}/restore?from=previous`)).status, 409, "needs a checkout");
    assert.equal((await dss(server, "POST", `${file}/checkout?pid=server-two&dl=false`)).status, 204, "free again");
    assert.equal((await dss(server, "POST", `${file}/restore?from=previous`)).status, 204);
    assert.equal((await dss(server, "GET", file)).body, "first version");
    const copy = `islands/personal/${owner.accountId}/${second}.island`;
    assert.equal((await dss(server, "POST", `${file}/restore?from=${copy}`)).status, 404, "an island never saved");
    assert.equal((await dss(server, "PUT", `${file}?autolock=true`, "x")).status, 409, "autolock while another pid holds it");
    assert.equal((await dss(server, "POST", `${file}/checkin`)).status, 204);
    assert.equal((await dss(owner.token, "PUT", `${file}?autolock=true`, "the owner's own")).status, 204);
    // Who and what.
    assert.equal((await dss(other.token, "GET", file)).status, 403);
    assert.equal((await dss(other.token, "PUT", `${file}?autolock=true`, "x")).status, 403);
    assert.equal((await dss(undefined, "GET", file)).status, 401);
    assert.equal((await dss(server, "GET", `/api/dss/v1/creative/islands/personal/${owner.accountId}/not-a-plot.island`)).status, 404);
    assert.equal((await dss(server, "GET", `/api/dss/v1/creative/islands/personal/${other.accountId}/${plot}.island`)).status, 404);
    assert.equal((await dss(server, "GET", `/api/dss/v1/fortnite/islands/personal/${owner.accountId}/${plot}.island`)).status, 404);
    const big = await dss(server, "PUT", `${file}?autolock=true`, Buffer.alloc(16 * 1024 * 1024 + 1));
    assert.deepEqual([big.status, big.body.errorCode], [413, "errors.com.epicgames.dss.file_too_large"]);
    assert.equal((await dss(server, "GET", file)).body, "the owner's own");
    assert.ok(fs.existsSync(path.join(backend.dataDir, "accounts", owner.accountId, "creative", "islands", `${plot}.island`)));
  } finally {
    await backend.close();
  }
});

test("an upload without a checkout waits until the island's checkout has gone unused for 15 minutes, then ends it", async () => {
  const backend = await startBackend({ events: { seasonStarts: { 7: startForDay(20) } } });
  try {
    const owner = await userLogin(backend.port, "IslandCrash");
    const [plot] = Object.keys(profileOf(await mcp(backend.port, owner, "QueryProfile", "creative")).items);
    const server = await dedicatedServerToken(backend.port);
    const file = `/api/dss/v1/creative/islands/personal/${owner.accountId}/${plot}.island`;
    const call = (method, url, body) => as(backend.port, server, method, url, { body, headers: { "Content-Type": "application/octet-stream" } });
    assert.equal((await call("POST", `${file}/checkout?pid=0123456789abcdef0123456789abcdef&dl=true`)).status, 204);
    assert.equal((await call("PUT", `${file}?autolock=true`, "x")).status, 409);
    const info = path.join(backend.dataDir, "accounts", owner.accountId, "creative", "islands", `${plot}.island.json`);
    const kept = JSON.parse(fs.readFileSync(info, "utf8"));
    fs.writeFileSync(info, JSON.stringify({ ...kept, lock: { ...kept.lock, at: Date.now() - 16 * 60 * 1000 } }));
    assert.equal((await call("PUT", `${file}?autolock=true`, "after the crash")).status, 204);
    assert.equal((await call("PUT", `${file}?autolock=false`, "y")).status, 409, "the checkout is over");
    assert.equal((await call("GET", file)).body, "after the crash");
  } finally {
    await backend.close();
  }
});

test("7.00's content page has the Creative hub's ads section, empty unless the host gives ads; 6.31's has none", () => {
  assert.deepEqual(contentPage(undefined, undefined, v700).creativeads.ad_info.ads, []);
  assert.equal(contentPage(undefined, undefined, v631).creativeads, undefined);
  const ads = creativeAdsFor(v700, [{ header: "Prefabs", sub_header: "New", description: "Pre-made structures", ad_type: "playset",
    ad_color_preset: "nope", image: "https://example.com/a.png", extra: 1 }, "junk"]).ad_info.ads;
  assert.deepEqual(ads, [{ header: "Prefabs", sub_header: "New", description: "Pre-made structures", creator_name: "", island_code: "",
    ad_type: "Playset", ad_color_preset: "Default", image: "https://example.com/a.png" }]);
  assert.ok(contentPage(undefined, undefined, v700, undefined, undefined, undefined, undefined, undefined,
    [{ image: "https://example.com/b.png" }])._images_.includes("https://example.com/b.png"));
});

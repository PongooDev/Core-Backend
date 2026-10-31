import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { activeEventFlags, hasEventEnded, isEventActive } from "../src/events/events.js";
import { athenaEventQuestsOf, fiftyFifty } from "../src/events/fiftyfifty.js";
import { getAthenaQuest } from "../src/gamedata/athena.js";
import { formTeams, playlistTeamsOf } from "../src/matchmaking/service.js";
import { dedicatedServerToken, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #135: 1.10's 50v50 limited-time playlist (events/fiftyfifty.js).
const v110 = "3790078";
const v191 = "3775276";
const quest = "athenaevent_fiftyfifty_playmatches";

function as(agent, port, method, urlPath, token, body) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "User-Agent": /^\d+$/.test(agent) ? `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${agent}` : agent };
  if (token) headers.Authorization = `bearer ${token}`;
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path: urlPath, headers }, text);
}
const athena = (changelist, port, { accountId, token }, name, body = {}) =>
  as(changelist, port, "POST", `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=athena&rvn=-1`, token, body);
const athenaProfile = async (changelist, port, player) => {
  const { body } = await athena(changelist, port, player, "QueryProfile");
  return [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === "athena").profileChanges[0].profile;
};
const questItems = (profile) => Object.entries(profile.items).filter(([, item]) => item.templateId === `Quest:${quest}`);
const timeline = async (changelist, port, token) => (await as(changelist, port, "GET", "/fortnite/api/calendar/v1/timeline", token)).body;

test("50v50 runs on 1.10 as the event its flag names; 1.9.1 has neither the event nor its quest", () => {
  assert.equal(fiftyFifty, "EventFlag.BR.Allow50v50");
  assert.ok(isEventActive(fiftyFifty, v110));
  assert.ok(activeEventFlags(v110).includes(fiftyFifty));
  assert.ok(!activeEventFlags(v191).includes(fiftyFifty));
  assert.ok(hasEventEnded(fiftyFifty, "3807424"));
  // Play 50v50 Matches: three matches of playlist 11's tag for 1000 season XP, 1.10's data only.
  inBuild(v110, () => {
    assert.deepEqual(athenaEventQuestsOf({ running: true }), [quest]);
    assert.deepEqual(getAthenaQuest(quest).objectives, [{ count: 3, name: "athena_event_fiftyfifty_play_matches", stat: "complete_athena_50v50" }]);
    assert.deepEqual(getAthenaQuest(quest).rewards, [{ quantity: 1000, templateId: "AccountResource:athenaseasonalxp" }]);
  });
  inBuild(v191, () => assert.deepEqual([athenaEventQuestsOf({ running: true }), athenaEventQuestsOf({ running: false })], [[], []]));
});

test("1.10's calendar turns 50v50's queue on in every region and runs its flag; 1.9.1's has no such channel", async () => {
  const backend = await startBackend();
  try {
    const { token } = await userLogin(backend.port, "FiftyCalendar");
    const channels = (await timeline(v110, backend.port, token)).channels;
    // FFortMatchmakingEventsState: the player's region's FFortMatchmakingRegionState, duos still on.
    const regions = channels["client-matchmaking"].states[0].state.region;
    for (const region of ["NA", "EU", "OCE", "BR", "ASIA", "OH", "GB", "TEST01", "TEST02"]) {
      assert.deepEqual(regions[region], { bDuosEnabled: true, bFiftyFiftyEnabled: true }, region);
    }
    assert.ok(channels["client-matchmaking"].cacheExpire);
    // 1.10's FEventRecord is {EventType, ActiveUntil}, and its client-events state carries the seasonal event manager's flags.
    const events = channels["client-events"].states[0];
    assert.deepEqual(events.activeEvents.map((event) => event.eventType), ["EventFlag.ActiveStorms", fiftyFifty]);
    assert.deepEqual(events.state.activeEventFlags, ["EventFlag.ActiveStorms", fiftyFifty]);

    const older = (await timeline(v191, backend.port, token)).channels;
    assert.equal(older["client-matchmaking"], undefined);
    assert.deepEqual(older["client-events"].states[0].activeEvents.map((event) => event.eventName), ["EventFlag.Vindertech"]);
    assert.equal(older["client-events"].states[0].state.activeEventFlags, undefined);

    // The admin panel's Seasonal Events switch takes it away with the other events.
    await as(v110, backend.port, "POST", "/admin/api/settings", null, { seasonalEvents: false });
    const off = (await timeline(v110, backend.port, token)).channels;
    assert.equal(off["client-matchmaking"], undefined);
    assert.deepEqual(off["client-events"].states[0].state.activeEventFlags, []);
  } finally {
    backend.close();
  }
});

test("50v50's parties are shared out over two even teams of up to 50, whose squads of up to 4 take turns in AssignMatch", () => {
  const teams = playlistTeamsOf("3790078:0:NA:11");
  assert.deepEqual(teams, { maxTeamCount: 2, maxTeamSize: 50, maxSquadSize: 4 });
  const party = (fill, ...players) => ({ players, fill });
  const sideOf = (assigned) => assigned.map((squad, index) => [index % 2, squad.flat()]).filter(([, players]) => players.length);
  const players = (assigned, side) => sideOf(assigned).filter(([team]) => team === side).flatMap(([, members]) => members);

  // Two solos face each other, whatever their Squad Fill; Fill solos on the same team share a squad.
  assert.deepEqual(formTeams([party(false, "a"), party(false, "b")], teams), [[["a"]], [["b"]]]);
  assert.deepEqual(formTeams([party(true, "a"), party(true, "b"), party(true, "c")], teams), [[["a"], ["c"]], [["b"]]]);
  // A trio and three No Fill solos: the solos go to the other team until it has as many, an empty team keeping the turns.
  assert.deepEqual(formTeams([party(false, "a", "b", "c"), party(false, "d"), party(false, "e"), party(false, "f")], teams),
    [[["a", "b", "c"]], [["d"]], [], [["e"]], [], [["f"]]]);
  // A full match: 50 a team, in 12 squads of 4 and one of 2 each.
  const full = Array.from({ length: 100 }, (_, index) => party(true, `p${index}`));
  const assigned = formTeams(full, teams);
  assert.equal(assigned.length, 26);
  assert.ok(assigned.every((squad) => squad.flat().length <= 4));
  assert.deepEqual([players(assigned, 0).length, players(assigned, 1).length], [50, 50]);
  // Parties of 4 that can't be split: 13 of them have no room on two teams of 50 (52 and 48 would be needed).
  assert.equal(formTeams(Array.from({ length: 13 }, (_, index) => party(false, `a${index}`, `b${index}`, `c${index}`, `d${index}`)).concat(
    Array.from({ length: 12 }, (_, index) => party(false, `e${index}`, `f${index}`, `g${index}`, `h${index}`))), { ...teams, maxTeamSize: 48 }), null);
  // A party stays on one team, and the teams stay as even as the parties allow.
  const mixed = formTeams([party(true, "a", "b"), party(false, "c", "d", "e", "f"), party(true, "g"), party(true, "h", "i", "j"), party(false, "k")], teams);
  assert.deepEqual(mixed, [[["c", "d", "e", "f"]], [["h", "i", "j"]], [["g"]], [["a", "b"]], [["k"]]]);
  for (const members of [["a", "b"], ["c", "d", "e", "f"], ["h", "i", "j"]]) {
    assert.ok([0, 1].some((side) => members.every((member) => players(mixed, side).includes(member))), members.join());
  }
  assert.ok(Math.abs(players(mixed, 0).length - players(mixed, 1).length) <= 1);
});

test("1.10's quest login gives Play 50v50 Matches; three 50v50 results from a Core gameserver complete it, and it pays 1000 XP", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "FiftyPlayer");
    const newcomer = await userLogin(backend.port, "FiftyOld");
    await athenaProfile(v110, backend.port, player);
    await athena(v110, backend.port, player, "ClientQuestLogin");
    let profile = await athenaProfile(v110, backend.port, player);
    assert.equal(questItems(profile).length, 1);
    const [[itemId, item]] = questItems(profile);
    assert.equal(item.attributes.quest_state, "Active");
    // Once: a second login doesn't give another.
    await athena(v110, backend.port, player, "ClientQuestLogin");
    assert.equal(questItems(await athenaProfile(v110, backend.port, player)).length, 1);
    // 1.9.1's data has no such quest.
    await athenaProfile(v191, backend.port, newcomer);
    await athena(v191, backend.port, newcomer, "ClientQuestLogin");
    assert.equal(questItems(await athenaProfile(v191, backend.port, newcomer)).length, 0);

    // A 1.10 gameserver's session with the player on it; its reports come from CoreV2, whose User-Agent names no build.
    const server = await userLogin(backend.port, "CoreServer1");
    const session = (await as(v110, backend.port, "POST", "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "CoreServer1", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 100, maxPrivatePlayers: 0, buildUniqueId: "1", attributes: { GAMEMODE_s: "FORTATHENA", REGION_s: "NA" }
    })).body;
    assert.equal(session.hostBuild, undefined, "the session's build stays the backend's");
    await as(v110, backend.port, "POST", `/fortnite/api/matchmaking/session/${session.id}/players`, server.token, { publicPlayers: [player.accountId], privatePlayers: [] });
    const dedicated = await dedicatedServerToken(backend.port);
    const report = (playlistId, matchId, place) => as("Core V2", backend.port, "POST", "/fortnite/api/game/v2/battleroyale/recordresults", dedicated,
      { playlistId, matchId, countWins: true, results: [{ accountId: player.accountId, place, kills: 0, secondsAlive: 30 }] });
    assert.equal((await report(2, "solo1", 30)).status, 204);
    assert.equal((await athenaProfile(v110, backend.port, player)).items[itemId].attributes.completion_athena_event_fiftyfifty_play_matches, 0,
      "a solo match isn't a 50v50 one");
    await report(11, "fifty1", 2);
    await report(11, "fifty2", 2);
    profile = await athenaProfile(v110, backend.port, player);
    assert.equal(profile.items[itemId].attributes.completion_athena_event_fiftyfifty_play_matches, 2);
    await report(11, "fifty3", 2);
    profile = await athenaProfile(v110, backend.port, player);
    assert.equal(profile.items[itemId].attributes.completion_athena_event_fiftyfifty_play_matches, 3);
    assert.equal(profile.items[itemId].attributes.quest_state, "Completed");
    // 30 s alive, no kills and a 2nd place are worth no season XP.
    assert.deepEqual([profile.stats.attributes.level, profile.stats.attributes.xp], [1, 0]);

    // Collected with the dailies (DailyQuestsPanel claims AthenaEvent after AthenaDailyQuest): 1000 XP, past levels 1 to 4.
    const claim = await athena(v110, backend.port, player, "ClaimQuestReward", { questId: itemId, selectedRewardIndex: -1 });
    assert.equal(claim.status, 200);
    profile = await athenaProfile(v110, backend.port, player);
    assert.equal(profile.items[itemId].attributes.quest_state, "Claimed");
    assert.deepEqual([profile.stats.attributes.level, profile.stats.attributes.xp], [5, 0]);
    // A claimed one is never given again.
    await athena(v110, backend.port, player, "ClientQuestLogin");
    assert.equal(questItems(await athenaProfile(v110, backend.port, player)).length, 1);
    // A 50v50 win is 300 XP and a win in the stats, but not a main mode's: no victory umbrella.
    await report(11, "fifty4", 1);
    profile = await athenaProfile(v110, backend.port, player);
    assert.equal(profile.stats.attributes.xp, 300);
    assert.equal(profile.items["AthenaGlider:solo_umbrella"], undefined);
    const stats = (await as(v110, backend.port, "GET", `/fortnite/api/stats/accountId/${player.accountId}/bulk/window/alltime`, player.token)).body;
    const stat = (name) => stats.find((entry) => entry.name === `br_${name}_pc_m0_p11`)?.value;
    assert.deepEqual([stat("placetop1"), stat("matchesplayed")], [1, 4]);
  } finally {
    backend.close();
  }
});

test("with the event off, an unfinished Play 50v50 Matches leaves the quest log; back on, it is given again", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "FiftyEnded");
    await athenaProfile(v110, backend.port, player);
    await athena(v110, backend.port, player, "ClientQuestLogin");
    assert.equal(questItems(await athenaProfile(v110, backend.port, player)).length, 1);
    await as(v110, backend.port, "POST", "/admin/api/settings", null, { seasonalEvents: false });
    await athena(v110, backend.port, player, "ClientQuestLogin");
    assert.equal(questItems(await athenaProfile(v110, backend.port, player)).length, 0);
    // Back on, it is given again.
    await as(v110, backend.port, "POST", "/admin/api/settings", null, { seasonalEvents: true });
    await athena(v110, backend.port, player, "ClientQuestLogin");
    assert.equal(questItems(await athenaProfile(v110, backend.port, player)).length, 1);
  } finally {
    backend.close();
  }
});

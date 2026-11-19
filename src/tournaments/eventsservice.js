import { regionMembers, serverRegionCodes } from "../matchmaking/regions.js";
import { eliminationsStat, eventWindowsOf, eventsServiceBuild, hasShowdown, historiesOf, placementStat, showdownEvents, showdownPlaylistOf, showdownTiers,
  teamOf, tournamentIdOf } from "./showdown.js";
import { matchWindowOf, rankRows, scoringOf } from "./store.js";

// 7.40's and 7.30's Events tab (CL-5046157 and CL-4834550, below; their exes in IDA, Epic's names from the 21.40 PDB). 7.40's
// DefaultGame.ini has none of FortMcpUtils' event URLs (tournaments/showdown.js has 6.10's), and its exe has no
// "UseEventsService" switch: UFortTournamentManager asks Epic's events service alone (FOnlineEventsServiceMcp, made in
// 0x4AAB60; DefaultEngine.ini's [OnlineSubsystemMcp.OnlineEventsServiceMcp]: ServiceName events, BasePath /api/v1, Domain
// events-public-service-live.ol.epicgames.com, which reaches this backend like Epic's other hosts: 7.30's client asked
// it here, data/logs/unknown/4834550.jsonl). Its routes, with Epic's 21.40 names:
// - DownloadUrl, GET /api/v1/events/<gameId>/download/<accountId>?region=&platform=&teamAccountIds= (Download, 0x4DA990):
//   gameId "Fortnite", the matchmaking region, "Windows" and the party's account ids joined by ",". Asked by
//   UFortTournamentManager (0x136F0D0) each time the frontend is built once ShowdownTournamentCacheExpirationHours have
//   passed (UFortUIStateWidget_Frontend 0x33D2C70 -> 0x135F3D0; Core's hotfix makes that every lobby,
//   showdownRuntimeOptions), when the region changes (0xFBD620) and after pending rewards are processed (0x1368400).
//   Download_HttpRequestComplete (0x4DB310) reads a JSON object into FEventsServiceDownload (serializer 0x54DDB0):
//   player (FEventsServicePlayer, 0x54F740: gameId, accountId, tokens, pendingPayouts, teams: {<key>: [accountIds]}),
//   events (FEventsServiceEvent, 0x54EA10: gameId, eventId, regions, regionMappings, platforms, platformMappings,
//   displayDataId, announcementTime, beginTime, endTime, eventWindows), eventWindows (FEventsServiceEventWindow, 0x54F200:
//   eventWindowId, eventTemplateId, countdownBeginTime, beginTime, endTime, round, leaderboardId, isTBD, visibility,
//   requireAllTokens, requireAnyTokens), templates (FEventsServiceEventTemplate, 0x54EE80: gameId, eventTemplateId,
//   playlistId, matchCap, scoringRules), scoringRules (FEventsServiceScoringRule, 0x54FFC0: trackedStat, matchRule,
//   rewardTiers of {keyValue, pointsEarned}, 0x54FEC0), scores (FEventsServiceTeamScore, 0x550390: gameId, eventId,
//   eventWindowId, teamId, teamAccountIds, pointsEarned, rank, percentile, pointBreakdown: {<key>: {timesAchieved,
//   pointsEarned}} (0x54FF40), sessionHistory of {sessionId, endTime, trackedStats: {<stat>: int}} (0x550300)). Times are
//   ISO 8601 strings, isTBD a bool, percentile a number, the rest ints and strings. An answer that fails or isn't a JSON
//   object changes nothing (0x13692E0 returns at once).
// - RefreshEventHistoryUrl, GET /api/v1/events/<gameId>/<eventId>/<eventWindowId>/history: in the table, but nothing in
//   7.40 asks it (no xref but the constructor's).
// - RequestLeaderboardUrl, GET /api/v1/leaderboards/<gameId>/<eventId>/<eventWindowId>/<accountId>?page=&rank=
//   &teamAccountIds= (RequestLeaderboard, 0x546D40; the manager's 0x13720D0 from the leaderboard screen, first page 0 and
//   then the next, 0x31D13E0 and 0x31BA4C0): FEventsServiceLeaderboard (0x54F330: gameId, eventId, eventWindowId, page,
//   totalPages, entries, each an FEventsServiceTeamScore). Pages are kept by window and page (0x1372900).
// - RefreshPlayerUrl, GET /api/v1/players/<gameId>/<accountId> (RefreshPlayer, 0x53F760): an FEventsServicePlayer, asked
//   by a timer after a window ends (0x136AF90 -> 0x1359B20).
// What the client does with the answer (UFortTournamentManager): the events, templates and scores are kept as served
// (0x13692E0); a template's playlistId is a playlist's name (UFortPlaylistManager::GetAthenaPlaylist, 0x10DBB10), offered
// in the lobby from a window's countdownBeginTime to its endTime; the tiles' texts are the content page entries of 6.10
// (tournamentInformationFor; 7.40's reader, 0x314AE30, has 6.10's fields and style_info_id; 🟡 that a tile takes the
// entry whose tournament_display_id is the event's displayDataId, as 6.10's did, isn't traced in 7.40's exe); the points alerts in a match
// are 6.10's (a tier at its exact keyValue, the trackedStat PLACEMENT_STAT_INDEX or TEAM_ELIMS_STAT_INDEX, matchRule never
// read: 0x338E280, 0x33A81A0); a window's score is the score whose eventId and eventWindowId are the window's and whose
// teamAccountIds are the party's, sorted on both sides (0x1357B90): its pointsEarned (GetCurrentEventScore), its
// sessionHistory's length (the matches played), its rank and its percentile ("(Top {Percentile}%)", percentile x 100,
// shown above 0: EventLeaderboardPlayerPerformance); pointBreakdown's keys are "<stat>:<keyValue>" as 6.10's
// (GetEventResultsSummary, 0x3396630). A window's visibility "public", "private" or "locked" is its eligibility in the
// details (GetEventWindowEligibility, 0x33971A0); round numbers its rounds and sessions (0x33973E0, 0x3398170). The
// leaderboard is offered for a window with a leaderboardId that is live or over, with bEnableEventLeaderboards on
// (0x33A2B00; on as shipped, showdownRuntimeOptions). A player with pendingPayouts makes the client POST ProcessPendingRewardsUrl
// (services/fortnite/events.js) and download again (0x13692E0, 0x1368400). The XMPP message
// com.epicgames.tournaments.complete is read as an FEventsServiceTeamScore that replaces the score it matches (0x1379950);
// Core's ({}) matches none, and the next lobby downloads the scores again.
//
// 7.30 (CL-4834550; its exe in IDA) asks the same service, as shipped. Its tournament manager's refresh
// (0x1359180) takes the events service when UseEventsService holds (0x15CD550: the -UseEventsService command line, else
// UFortRuntimeOptions' bUseEventsService, +0x2EC), and UFortRuntimeOptions' constructor (0x15C2BC0) sets it
// (0x15C31EC: mov byte ptr [rsi+2ECh], 1); none of 7.30's shipped config files sets it back and the launcher passes no
// such switch. 7.20's (0x1582720, +0x2D4) and 7.10's (0x1499500, +0x2E4) constructors leave it clear, and 7.00's exe has
// none. The client logs agree: 7.30's lobbies log LogOnlineEventsService "Starting download" (answered 404 before this)
// and no FortMcpUtils tournamentandhistory, 7.20's and 7.00's the FortMcpUtils request. 7.30's routes are 7.40's but the
// players one (FOnlineEventsServiceMcp, 0x49DE40: download, history, leaderboards), its shapes 7.40's but the window's
// visibility (0x540D70; serializers 0x53F930 download, 0x5412A0 player, 0x540590 event, 0x5409F0 template, 0x541B20
// scoring rule, 0x541EF0 score, 0x540E90 leaderboard), and its download's handler (0x1353D10) turns the events and their
// templates into 6.10's tournaments (0x1258940: a window's eventData from the template its eventTemplateId names,
// 0x12415F0) and the scores into 6.10's window histories (0x1258100: eventId, eventWindowId, teamAccountIds,
// pointsEarned, pointBreakdown, sessionHistory's sessionIds), reading no player. So 7.30 is served the same answers as
// 7.40 (an extra field is skipped by the reader). It has no ProcessPendingRewardsUrl.
//
// What Core serves: the tournaments 6.10 to 7.20 get through FortMcpUtils (the admin panel's in-game events, showdownEvents:
// the same events, invite-only ones only for the invited, #383), in the events service's shape, from the same store and
// the same functions (eventWindowsOf, showdownTiers, historiesOf). Each event is one event of the service and one
// template (its rules, as every window has them); each window of it (#364) an event window. 🟡 Core's own choices, where
// Epic's data isn't known: regions are Core's regions and platforms Epic's of the time, each with the one asked for (Epic's
// service filtered by them; 7.40's client reads neither for its tiles); every window is "public" (an invite-only event is
// only in its invited players' list, as on 6.10), round 0, its leaderboardId its own id; matchRule "lte" for placement and
// "gte" for eliminations (Epic's later service's; 7.40 reads none); matchCap the ruleset's counted matches (0: no cap); no
// tokens, no pending payouts (Core gives an event's prizes itself, tournaments/payouts.js) and no teams. A window's
// leaderboard is its teams by their points in it, in the contest rules' order (rankRows): the admin panel's leaderboard and
// prizes still count every window (leaderboardOf).
export const eventsGameId = "Fortnite";
export const isEventsServiceBuild = (build) => Number(build) >= eventsServiceBuild;
// FortMcpUtils' ProcessPendingRewardsUrl, new in 7.40's DefaultGame.ini (services/fortnite/events.js).
export const pendingRewardsBuild = 5046157;
// Entries on a leaderboard page (🟡 Core's size: the client asks page 0 first and the next one from the end of its list,
// 0x31D13E0 and 0x31BA4C0, taking what each holds).
export const leaderboardPageSize = 100;
// The regions a 7.40 player picks from: Core's own, not NA (North America as a whole, NAE's and NAW's group, 1.1's to 2.5's).
const regionNames = serverRegionCodes.filter((code) => regionMembers(code).length === 1);
// 🟡 Epic's platform names of early 2019 (FEventsServiceEvent.Platforms).
const platformNames = ["PS4", "XboxOne", "Switch", "Android", "IOS", "Windows", "Mac"];
const withAsked = (list, asked) => [...new Set([...list, ...(typeof asked === "string" && asked && asked.length <= 32 ? [asked] : [])])];

// FEventsServicePlayer.
export const eventsPlayerOf = (accountId, gameId = eventsGameId) => ({ gameId, accountId, tokens: [], pendingPayouts: [], teams: {} });

// An event as FEventsServiceEvent: from its announcement to its last window's end, a window for each of its times, each
// counting down from the announcement as 6.10's (tournamentOf).
function eventOf(event, gameId, { region, platform } = {}) {
  const windows = eventWindowsOf(event);
  return {
    gameId,
    eventId: tournamentIdOf(event),
    regions: withAsked(regionNames, region),
    regionMappings: {},
    platforms: withAsked(platformNames, platform),
    platformMappings: {},
    displayDataId: tournamentIdOf(event),
    announcementTime: event.createdAt,
    beginTime: event.createdAt,
    endTime: windows.at(-1).endTime,
    eventWindows: windows.map((window) => ({
      eventWindowId: window.id,
      eventTemplateId: tournamentIdOf(event),
      countdownBeginTime: Date.parse(event.createdAt) < Date.parse(window.beginTime) ? event.createdAt : window.beginTime,
      beginTime: window.beginTime,
      endTime: window.endTime,
      round: 0,
      leaderboardId: window.id,
      isTBD: false,
      visibility: "public",
      requireAllTokens: [],
      requireAnyTokens: []
    }))
  };
}

// An event's rules as FEventsServiceEventTemplate: 6.10's reward tiers (showdownTiers) on its Showdown playlist.
function templateOf(event, gameId) {
  const { placement, eliminations } = showdownTiers(event);
  const counted = scoringOf(event).countedMatches;
  return {
    gameId,
    eventTemplateId: tournamentIdOf(event),
    playlistId: showdownPlaylistOf(event).playlistName,
    matchCap: Number.isInteger(counted) ? counted : 0,
    scoringRules: [{ trackedStat: placementStat, matchRule: "lte", rewardTiers: placement },
      ...(eliminations.length ? [{ trackedStat: eliminationsStat, matchRule: "gte", rewardTiers: eliminations }] : [])]
  };
}

// A player's teams in one window of an event: historiesOf's (the points, with what they were for), with each match of it
// as a session (its id, when it was recorded, its placement and the team's eliminations).
function teamScoresOf(event, accountId, windowId) {
  const matches = event.players?.[accountId]?.matches ?? [];
  return historiesOf(event, accountId).filter((history) => history.eventWindowId === windowId).map((history) => {
    const key = history.teammateIds.join(",");
    const played = matches.filter((match) => matchWindowOf(event, match) === windowId && teamOf(accountId, match).join(",") === key);
    return { history, played };
  });
}

// A window's leaderboard: its teams (each once, however many of them played) by their points in it, ranked as the contest
// rules break ties, each as FEventsServiceTeamScore with its rank and percentile (rank / teams).
export function windowLeaderboardOf(event, windowId, gameId = eventsGameId) {
  const teams = new Map();
  for (const accountId of Object.keys(event.players ?? {})) {
    for (const { history, played } of teamScoresOf(event, accountId, windowId)) {
      const key = history.teammateIds.join(",");
      if ((teams.get(key)?.played.length ?? -1) >= played.length) continue;
      teams.set(key, { history, played });
    }
  }
  const rows = [...teams.entries()].map(([key, { history, played }]) => ({
    displayName: key,
    points: history.payload.pointsEarned,
    wins: played.filter((match) => match.place === 1).length,
    eliminations: played.reduce((total, match) => total + match.kills, 0),
    averagePlacement: played.length ? Math.round((played.reduce((total, match) => total + match.place, 0) / played.length) * 100) / 100 : null,
    history,
    played
  }));
  const ranked = rankRows(rows);
  return ranked.map(({ rank, history, played }) => ({
    gameId,
    eventId: tournamentIdOf(event),
    eventWindowId: windowId,
    teamId: "",
    teamAccountIds: history.teammateIds,
    pointsEarned: history.payload.pointsEarned,
    rank,
    percentile: rank / ranked.length,
    pointBreakdown: history.payload.pointBreakdown,
    sessionHistory: played.map((match, index) => ({
      sessionId: match.matchId ?? `${event.id}-${index + 1}`,
      endTime: match.at ?? event.createdAt,
      trackedStats: { [placementStat]: match.place, [eliminationsStat]: match.kills }
    }))
  }));
}

// A player's scores in an event: one for each window and team they played it with, from that window's leaderboard.
const scoresOf = (event, accountId, gameId) => eventWindowsOf(event)
  .flatMap(({ id }) => windowLeaderboardOf(event, id, gameId).filter((score) => score.teamAccountIds.includes(accountId)));

// DownloadUrl's answer (FEventsServiceDownload) for a player on a build: the events their build's Events tab lists for
// them (showdownEvents), one template each, and their scores. query: the request's region and platform.
export function eventsDownload(accountId, build, query = {}, now = new Date(), store = undefined, gameId = eventsGameId) {
  const events = hasShowdown(build) ? showdownEvents(build, now, store, accountId) : [];
  return {
    player: eventsPlayerOf(accountId, gameId),
    events: events.map((event) => eventOf(event, gameId, query)),
    templates: events.map((event) => templateOf(event, gameId)),
    scores: events.flatMap((event) => scoresOf(event, accountId, gameId))
  };
}

// The listed event a window is of, for a player, or null.
function listedEventOf(accountId, eventId, windowId, build, now, store) {
  const event = showdownEvents(build, now, store, accountId).find((own) => tournamentIdOf(own) === eventId);
  return event && eventWindowsOf(event).some(({ id }) => id === windowId) ? event : null;
}

// RequestLeaderboardUrl's answer (FEventsServiceLeaderboard): a page (from 0) of the window's leaderboard; without a
// page, the one holding rank (🟡: what 7.40 sends as rank isn't known, it may be 0), else the first. null for a window the
// player's list doesn't have.
export function eventsLeaderboard(accountId, eventId, windowId, build, { page, rank } = {}, now = new Date(), store = undefined, gameId = eventsGameId) {
  const event = listedEventOf(accountId, eventId, windowId, build, now, store);
  if (!event) return null;
  const entries = windowLeaderboardOf(event, windowId, gameId);
  const totalPages = Math.max(1, Math.ceil(entries.length / leaderboardPageSize));
  const asked = Number.parseInt(page, 10);
  const ranked = Number.parseInt(rank, 10);
  const index = Number.isInteger(asked) && asked >= 0 ? asked : Number.isInteger(ranked) && ranked > 0 ? Math.floor((ranked - 1) / leaderboardPageSize) : 0;
  return {
    gameId,
    eventId: tournamentIdOf(event),
    eventWindowId: windowId,
    page: index,
    totalPages,
    entries: entries.slice(index * leaderboardPageSize, (index + 1) * leaderboardPageSize)
  };
}

// RefreshEventHistoryUrl's answer (🟡 no 7.40 code asks it, so its shape is Core's): the player's scores in the window, or
// null for a window their list doesn't have.
export function eventsWindowHistory(accountId, eventId, windowId, build, now = new Date(), store = undefined, gameId = eventsGameId) {
  const event = listedEventOf(accountId, eventId, windowId, build, now, store);
  return event ? windowLeaderboardOf(event, windowId, gameId).filter((score) => score.teamAccountIds.includes(accountId)) : null;
}

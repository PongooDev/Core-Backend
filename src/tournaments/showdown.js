import { hasLtm, ltms } from "../events/ltms.js";
import { matchPoints, scoringOf, statusOf } from "./store.js";

// 6.10's in-game tournaments (CL-4464155, CL-4476098 and CL-4480234; Update v6.10, 16 October 2018): "A new 'Events' tab
// has been added along with several in-game tournaments ... Each tournament has a series of scheduled dates and times
// that the competition will be run. A carousel of all upcoming competitions and times will be available for browsing ...
// Compete over the course of several hours to earn points by eliminating multiple opponents or surviving against the
// competition ... Score enough points during any scheduled event session and you'll earn a golden pin for that
// tournament!" In the game the feature is Showdown: UFortTournamentManager, the Showdown front end
// (UI/Frontend/Showdown) and the three Showdown playlists (events/ltms.js).
//
// What CL-4480234's client does (its exe, read in IDA, and its shipped config; addresses are the dump's):
// - The tab. UFortRuntimeOptions' constructor (0x13C7880) sets bEnableShowdown, which 6.02's left clear, so 6.10 shows the
//   Events tab as shipped (EFortUIFeature::ShowShowdown, 0x2E37520). With that option clear the tab is hidden and nothing
//   is asked.
// - The list. Each time the Battle Royale front end is built and the last answer has expired (never kept after a failed
//   one; ShowdownTournamentCacheExpirationHours, 10, after a good one), the tournament manager (0x11B71F0) sends
//   FortMcpUtils' GetEventTournamentAndHistoryUrl, GET /api/game/v2/events/tournamentandhistory/<accountId>/<regionId>/
//   <platformName> (the matchmaking region's id, "NONE" without one, and the literal "WindowsClient"), and reads the
//   answer into FShowdownEventDownload by its property names, in any case (0x10F0EF0): {eventTournaments: [{tournamentId,
//   regions, platformGroups, displayDataId, announcementTime, beginTime, endTime, eventWindows: [{eventWindowId,
//   countdownBeginTime, beginTime, endTime, bIsTBD, eventData: {playlistId, scoringRules: [{trackedStat, mathRule,
//   rewardTiers: [{keyValue, pointsEarned}]}], rewardTable: [{pointsEarned, mcpTokenRewards}]}}]}], eventWindowHistories:
//   [{tournamentId, eventWindowId, matchIds, teammateIds, payload: {pointsEarned, pointBreakdown: {<stat>:<key>:
//   {timesAchieved, pointsEarned}}}}]}. Times are ISO 8601 strings. An answer that isn't such an object, or any other
//   status, leaves the tab without tournaments and is asked again at the next lobby; nothing blocks.
// - A tile is made for every tournament whose announcementTime has passed (0x304DD30); the client reads neither regions
//   nor platformGroups (Epic's service filtered by the URL's two). Its texts, colours, pictures and pin score come from
//   the content page's tournamentinformation.tournament_info.tournaments entry whose tournament_display_id is the
//   tournament's displayDataId (0x2E4B870, 0x3079990); without one the tile is bare.
// - States (0x3060750): a window is live from its beginTime to its endTime, and "participating" once a history names it.
//   The lists of live and upcoming tournaments are made once, when the answer arrives (0x1183240), by the tournaments' own
//   beginTime and endTime, and matchmaking looks only at the live ones: so a tournament here begins when it is announced,
//   and its window carries the event's start.
// - Playing. The window's eventData.playlistId is a playlist's name, one of Playlist_Showdown_Solo, _Duos and _Squads
//   (0x11A7750). The lobby turns that playlist on by itself while it is the current event's (UFortGameInstance::
//   GetPlaylistAccess, 0xE7EFA0), as long as FrontEndPlaylistData still lists it, and the Play button waits for the
//   window's beginTime and a full party (bEnforceFullSquadInUI). UFortMatchmakingV2::StartMatchmaking (0x10DDA70) then adds
//   two attributes to the ticket request, player.option.tournamentId and player.option.windowId, the tournament's and the
//   window's ids as they were served (services/matchmaking/ticket.js), and nothing else new: the bucket is the playlist's
//   as ever.
// - Scores. The client knows two tracked stats, PLACEMENT_STAT_INDEX and TEAM_ELIMS_STAT_INDEX (0x3063430), and never
//   reads mathRule. Each reward tier is a line of the rules ("Victory Royale" / "Reach Top N", "N Eliminations") and, in a
//   match, a points alert the moment the team's placement or elimination count equals its keyValue (0x304BDF0,
//   0x3072420): tiers add up. A window's score is the payload.pointsEarned of the history whose eventWindowId is the
//   window's and whose teammateIds are the party's members (0x1192530); the results summary splits pointBreakdown's keys
//   at ":" (0x3060070). The pin is unlocked once that score reaches the content entry's pin_score_requirement.
// - After a match the game server tells each player (the client RPC ClientNotifyTournamentStatsFinal, 0xC7A560), whose
//   client then sends an XMPP message of type com.epicgames.tournaments.complete to its party; on receiving one
//   (UFortTournamentManager::HandleXmppReceived, 0x11A2450) a client asks GetEventWindowHistoryUrl, GET /api/game/v2/
//   events/eventwindowhistory/<accountId>/<eventWindowId>, a JSON array of that window's histories (0x10F1AC0), and puts
//   them in place of the ones it had.
// - The game server's own report, ReportTournamentStatsUrl (POST /api/game/v2/events/reporttournamentstats, an
//   FMcpTournamentStats: tournamentId, eventWindowId, teamAccountIds, matchId, numTeamEliminations, finalTeamPlacement),
//   has no caller left in the client's exe (the dedicated server's code is compiled out of it).
//
// What Core serves. Epic's tournaments (their names, days, scoring and art) were its services' data, and none of it is in
// the build's files, so there is no schedule to replay. The tournaments are the admin panel's own (tournaments/store.js,
// its Tournaments tab): an event made on one of the three Showdown playlists is listed in the Events tab of the builds
// that have the playlist, as a tournament of one event window (its start and end; from its creation until it is ended
// when it has none), with the event's scoring as reward tiers, its name and rules as the tile's texts, and each player's
// points from the matches the game server reports (services/fortnite/battleroyale.js recordresults, by the playlist). With
// no such event the list is empty, which is what a 6.10 lobby gets by default: the tab is there, as shipped, with no
// tournament on it. Not served, for want of Epic's data: posters, tile and loading screen pictures (the tiles keep the
// client's defaults), a reward table (the client reads none) and regions or platforms (every player is offered every
// event).
export const showdownBuild = 4464155;
export const tournamentsCompleteMessage = "com.epicgames.tournaments.complete";
export const placementStat = "PLACEMENT_STAT_INDEX";
export const eliminationsStat = "TEAM_ELIMS_STAT_INDEX";
// An event that counts eliminations gives its points for each one, where the client wants a tier for every count that
// scores: one tier per elimination up to this many. A match's eliminations past it still score (the last tier's history
// entry holds them), but have no alert of their own in the match.
export const maxEliminationTiers = 20;
// How long an ended event stays in the Events tab, as a completed tournament.
const listedAfterEndMs = 14 * 24 * 60 * 60 * 1000;
// The end of an event without one: FDateTime's last day.
const noEnd = "9999-12-31T23:59:59.000Z";

// The tournament store, for work that has none at hand (the hotfix files, the content page).
let storeProvider = () => null;
export function configureShowdown(provider) {
  storeProvider = typeof provider === "function" ? provider : () => provider;
}

const showdownLtms = ltms.filter((ltm) => ltm.tournament);
// The Showdown playlist an event plays on (events/ltms.js's entry), or null for an event of another playlist.
export const showdownPlaylistOf = (event) => showdownLtms.find((ltm) => ltm.id === event?.playlist) ?? null;
export const isShowdownPlaylist = (playlistId) => showdownLtms.some((ltm) => ltm.playlistId === Number(playlistId));
// Whether a build has the Events tab.
export const hasShowdown = (build) => Number(build) >= showdownBuild && showdownLtms.some((ltm) => hasLtm(ltm.id, build));

const endOf = (event) => event.endedAt ?? event.endsAt ?? null;
// The events a build's Events tab lists now: those of a Showdown playlist the build has, until two weeks after their end,
// oldest first.
export function showdownEvents(build, now = new Date(), store = storeProvider()) {
  if (!store || !hasShowdown(build)) return [];
  return store.list().filter((event) => {
    const ltm = showdownPlaylistOf(event);
    const end = endOf(event);
    return ltm && hasLtm(ltm.id, build) && (!end || Date.parse(end) + listedAfterEndMs > now.getTime());
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// An event's ids as the client is given them: the tournament's is the event's, and its one window's the same.
export const tournamentIdOf = (event) => event.id;
export const windowIdOf = (event) => event.id;
// An event's window: from its start (its creation without one) to its end (never without one).
export const windowOf = (event) => ({ beginTime: event.startsAt ?? event.createdAt, endTime: endOf(event) ?? noEnd });

// An event's scoring as the client's reward tiers. Placement: the event's table gives a place the points of the first
// bracket it is within; a tier is earned the moment the team is that high, so each bracket's tier holds what it adds to
// the bracket below it (a team that ends in a bracket has passed every one below). Eliminations: a tier for each one.
export function showdownTiers(event) {
  const rules = scoringOf(event);
  const brackets = [...rules.placementPoints].sort((a, b) => a[0] - b[0]);
  const placement = brackets.map(([upTo, points], index) => ({ keyValue: upTo, pointsEarned: points - (brackets[index + 1]?.[1] ?? 0) }));
  const eliminations = rules.pointsPerElimination > 0
    ? Array.from({ length: maxEliminationTiers }, (_, index) => ({ keyValue: index + 1, pointsEarned: rules.pointsPerElimination })) : [];
  return { placement, eliminations };
}
const scoringRulesOf = (event) => {
  const { placement, eliminations } = showdownTiers(event);
  return [{ trackedStat: placementStat, rewardTiers: placement },
    ...(eliminations.length ? [{ trackedStat: eliminationsStat, rewardTiers: eliminations }] : [])];
};

// The tournament as FShowdownTournament. It begins when it is announced (the client's live list, above); its window has
// the event's own start.
export function tournamentOf(event) {
  const ltm = showdownPlaylistOf(event);
  const window = windowOf(event);
  return {
    tournamentId: tournamentIdOf(event),
    regions: [],
    platformGroups: [],
    displayDataId: tournamentIdOf(event),
    announcementTime: event.createdAt,
    beginTime: event.createdAt,
    endTime: window.endTime,
    eventWindows: [{
      eventWindowId: windowIdOf(event),
      countdownBeginTime: window.beginTime,
      beginTime: window.beginTime,
      endTime: window.endTime,
      bIsTBD: false,
      eventData: { playlistId: ltm.playlistName, scoringRules: scoringRulesOf(event), rewardTable: [] }
    }]
  };
}

// A player's histories in an event (FPlayerEventHistory), one for each team they played it with (alone: themselves): the
// matches' ids, the team, and the points with what they were for, "<stat>:<tier's key>" by how often the tier was earned.
export function historiesOf(event, accountId) {
  const matches = event.players?.[accountId]?.matches ?? [];
  if (!matches.length) return [];
  const rules = scoringOf(event);
  const { placement, eliminations } = showdownTiers(event);
  const teams = new Map();
  for (const match of matches) {
    const team = [...new Set([accountId, ...(Array.isArray(match.team) ? match.team : [])])].sort();
    const key = team.join(",");
    const history = teams.get(key) ?? { team, matchIds: [], points: 0, breakdown: {} };
    teams.set(key, history);
    history.matchIds.push(match.matchId ?? `${event.id}-${history.matchIds.length + 1}`);
    const add = (stat, tier, points) => {
      const entry = (history.breakdown[`${stat}:${tier.keyValue}`] ??= { timesAchieved: 0, pointsEarned: 0 });
      entry.timesAchieved += 1;
      entry.pointsEarned += points;
    };
    for (const tier of placement) if (match.place <= tier.keyValue) add(placementStat, tier, tier.pointsEarned);
    const earned = eliminations.filter((tier) => match.kills >= tier.keyValue);
    earned.forEach((tier, index) => add(eliminationsStat, tier, tier.pointsEarned
      + (index === earned.length - 1 ? rules.pointsPerElimination * Math.max(0, match.kills - maxEliminationTiers) : 0)));
    history.points += matchPoints(rules, match);
  }
  return [...teams.values()].map(({ team, matchIds, points, breakdown }) => ({
    tournamentId: tournamentIdOf(event),
    eventWindowId: windowIdOf(event),
    matchIds,
    teammateIds: team,
    payload: { pointsEarned: points, pointBreakdown: breakdown }
  }));
}

// GetEventTournamentAndHistoryUrl's answer for a player on a build.
export function tournamentAndHistory(accountId, build, now = new Date(), store = storeProvider()) {
  const events = showdownEvents(build, now, store);
  return { eventTournaments: events.map(tournamentOf), eventWindowHistories: events.flatMap((event) => historiesOf(event, accountId)) };
}

// GetEventWindowHistoryUrl's answer: the player's histories in one window, or null for a window the build isn't offered.
export function eventWindowHistory(accountId, eventWindowId, build, now = new Date(), store = storeProvider()) {
  const event = showdownEvents(build, now, store).find((own) => windowIdOf(own) === eventWindowId);
  return event ? historiesOf(event, accountId) : null;
}

const day = (iso) => new Date(iso).toISOString().slice(0, 16).replace("T", " ");
// What an event's rules read as, for its tile.
function rulesText(event) {
  const rules = scoringOf(event);
  const counted = rules.countedMatches ? `Your first ${rules.countedMatches} matches count.` : "";
  const elims = rules.pointsPerElimination > 0 ? ` and ${rules.pointsPerElimination} for each elimination` : "";
  return `Points for placement${elims}. ${counted}`.trim();
}
// The content page's tournamentinformation for a build (services/content/pages.js): an entry for each listed event,
// keyed by its displayDataId. Undefined for a build without the Events tab.
export function tournamentInformationFor(build, now = new Date(), store = storeProvider()) {
  if (!hasShowdown(build)) return undefined;
  const tournaments = showdownEvents(build, now, store).map((event) => {
    const ltm = showdownPlaylistOf(event);
    const { beginTime, endTime } = windowOf(event);
    const until = endTime === noEnd ? "until it is ended" : `to ${day(endTime)} UTC`;
    const mode = ltm.playlistName.replace("Playlist_Showdown_", "");
    return {
      tournament_display_id: tournamentIdOf(event),
      title_line_1: event.name,
      title_line_2: mode,
      schedule_info: `${day(beginTime)} UTC ${until}`,
      flavor_description: `${mode} tournament`,
      details_description: rulesText(event),
      short_format_title: event.name,
      long_format_title: `${event.name} (${mode})`,
      ...(Number.isInteger(event.pinScore) ? { pin_score_requirement: event.pinScore, pin_earned_text: "Pin earned!" } : {}),
      _type: "Tournament Display Info"
    };
  });
  return {
    _title: "tournamentinformation",
    tournament_info: { _type: "Tournaments Info", tournaments },
    _noIndex: false,
    _activeDate: "2018-10-16T08:00:00.000Z",
    lastModified: new Date(Math.max(Date.parse("2026-11-12T12:00:00.000Z"),
      ...showdownEvents(build, now, store).map((event) => Date.parse(event.endedAt ?? event.createdAt)))).toISOString(),
    _locale: "en-US"
  };
}

// A ticket for a Showdown playlist (services/matchmaking/ticket.js): the running event it queues for, or the refusal as
// Epic's service named it (the client has a text for each: 0x2EB3550). tournamentId and windowId are the ticket's
// player.option.tournamentId and player.option.windowId ("" when the client sent none: it found no live tournament, as
// before the lobby has the list). partySize is the ticket's party.
export function showdownTicket({ playlistId, tournamentId = "", windowId = "", partySize, build }, now = new Date(), store = storeProvider()) {
  const refuse = (code, message) => ({ error: { code: `errors.com.epicgames.fortnite.${code}`, message } });
  const events = showdownEvents(build, now, store).filter((event) => event.playlistId === Number(playlistId));
  const named = tournamentId ? events.find((event) => tournamentIdOf(event) === tournamentId) : null;
  if (tournamentId && !named) return refuse("invalid_tournament_id", "Tournament does not exist.");
  if (named && windowId && windowIdOf(named) !== windowId) return refuse("invalid_event_window_id", `Tournament ${tournamentId} has no event window ${windowId}.`);
  const event = named ?? events.find((own) => statusOf(own, now) === "running");
  if (!event || statusOf(event, now) !== "running") return refuse("event_window_time_invalid", "Sorry, this tournament is not currently active.");
  const ltm = showdownPlaylistOf(event);
  const teamSize = { showdownSolo: 1, showdownDuos: 2, showdownSquads: 4 }[ltm.id];
  if (partySize !== teamSize) return refuse("wrong_number_of_event_players", "You need to be in a full party for this tournament.");
  return { event };
}

// The FortRuntimeOptions lines of the hotfix (services/fortnite/cloudstorage.js) for a build with the Events tab.
// - While an in-game event is listed: ShowdownTournamentCacheExpirationHours=0, so that the lobby asks for the list each
//   time it is built instead of keeping one for ten hours: an event made, started or ended in the panel shows at the
//   player's next lobby, and the client's live list (above) is fresh when its window opens.
// - With the admin's "Hide the Events tab while it has no tournament" on (settings hideEmptyEventsTab, off by default)
//   and no event listed: bEnableShowdown=false, the option 6.02 shipped with, which hides the tab and asks nothing
//   (🟡 read in the exe, 0x2E37520 and 0x11A6100; not seen in a running client).
// Nothing otherwise: the build stays as shipped.
export function showdownRuntimeOptions(build, settingsValue, now = new Date(), store = storeProvider()) {
  if (!hasShowdown(build)) return [];
  if (showdownEvents(build, now, store).length) return ["ShowdownTournamentCacheExpirationHours=0"];
  return settingsValue?.hideEmptyEventsTab === true ? ["bEnableShowdown=false"] : [];
}

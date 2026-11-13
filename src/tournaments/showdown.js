import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasLtm, ltms } from "../events/ltms.js";
import { newsImageUrl } from "../services/content/images.js";
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
// - Pictures and colours (Core-Backend #336). The entry's reader (0x2E497A0) takes every field as a string:
//   tournament_display_id, title_line_1, title_line_2, schedule_info, poster_front_image, poster_back_image,
//   flavor_description, details_description, short_format_title, long_format_title, pin_score_requirement (a number),
//   pin_earned_text, base_color, primary_color, secondary_color, highlight_color, title_color, shadow_color,
//   background_left_color, background_right_color, background_text_color, poster_fade_color, playlist_tile_image and
//   loading_screen_image. UFortShowdownDetailView::SetTournament (0x3079990) copies the texts into its
//   FFortTournamentDisplayInfo and each colour through FColor::FromHex ("RRGGBB" or "RRGGBBAA", "#" optional; anything
//   else, a missing one too, is FColor(0, 0, 0, 0): fully transparent) and FLinearColor's sRGB conversion. It hands each
//   picture to one of its four UEpicCMSImage widgets (sub_397270): Image_PosterFront, Image_PosterBack,
//   Image_LoadingScreen, Image_PlaylistTile. An empty URL is skipped and the widget keeps its brush, which is Slate's
//   default: a plain white box. A URL is fetched by the CMS image cache (0x38D1A0): http://, https:// or file://, anything
//   else refused ("Unknown image URL protocol"), saved under the URL's last path segment (FPaths::GetCleanFilename,
//   0x1717790) and read from that file from then on, decoded by ImageWrapper (PNG or JPEG; "Invalid image format"
//   otherwise) and refused when width x height x 4 is over 10,000,000 bytes (0x38C0F0). A picture that fails stays the
//   white box too. Where each shows (the blueprints in UI/Frontend/Showdown, 6.10 and 6.20 alike):
//   - poster_front_image: ShowdownTournamentPosterFront, the Events tab's tile (ShowdownTournamentTile's
//     ShowdownDetailView_Poster), the details screen's poster (ShowdownTournamentDetails' TournamentPosterFront) and the
//     tournament's loading screen (ShowdownLoading). Its titles are title_color, its date base_color.
//   - poster_back_image: ShowdownTournamentPosterBack, the details screen's EVENT DETAILS side; titles title_color,
//     flavor and dates base_color, long title primary_color, each date entry base_color and highlight_color
//     (TournamentDateEntry), an ended one shadow_color.
//   - playlist_tile_image: ShowdownLobbyViolator, the box above SOLO / PLAY in the lobby (a 400x200 brush); its title is
//     primary_color, its box and tail shadow_color, its border highlight_color.
//   - loading_screen_image: no blueprint binds Image_LoadingScreen.
//   - The details screen: background_left_color and background_right_color (ShowdownTournamentScreen's Image_BG),
//     poster_fade_color (Image_PosterFade), background_text_color (the big title behind); the lobby's panel
//     (ShowdownLobbyPanel): primary_color, shadow_color and highlight_color.
//   So with no picture and no colour the tile, the poster, the EVENT DETAILS side and the lobby box were white and their
//   texts invisible. Core serves a colour for each and a picture for each slot a blueprint shows: the admin's (an upload
//   or a URL, the Tournaments tab) or its own (showdownImageSlots).
// - States (0x3060750): a window is live from its beginTime to its endTime, and "participating" once a history names it.
//   The lists of live and upcoming tournaments are made once, when the answer arrives (0x1183240), by the tournaments' own
//   beginTime and endTime, and matchmaking looks only at the live ones: so a tournament here begins when it is announced,
//   and its window carries the event's start.
// - The current event (Core-Backend #336). UFortTournamentManager's current event (0x118AFD0) is worked out on demand: of
//   every window of every tournament, the one not yet ended (now <= endTime) that begins first, begun or not. "Now" is the
//   client's clock put right by the MCP's server time (0x1192DA0). Everything in the lobby hangs off that one window:
//   - UFortGameInstance::GetPlaylistAccess (0xE7EFA0) asks the manager (0x11A05C0) last: the playlist the current event's
//     window names is turned on and shown (bEnabled and bVisibleWhenDisabled set), whatever FrontEndPlaylistData says, but
//     only for an entry FrontEndPlaylistData has (the shipped DefaultGame.ini and the hotfix list the three Showdown
//     playlists, off). Only one tournament playlist is on at a time: an event that began earlier and hasn't ended (one
//     with no end, say) keeps another event's playlist off until it ends.
//   - The Play widget keeps its own list of the lobby's playlists (0x2EA8670 -> 0xF2F490, FPlaylistFrontEndData), made
//     again only when the manager broadcasts (it binds three of its delegates, 0x2EAB6F0) or the party changes. The mode
//     select's "This tournament is not currently active. Check the Events tab for the schedule!"
//     (AthenaMatchmakingOptionsDisplay_v2, UpdateMatchmakingButtonsBP's PlaylistIsDisabled with bIsTournamentPlaylist,
//     0x2EC3F50) is that list not having the playlist turned on.
//   - The lobby's Showdown state (EFortLobbyType 3, which shows ShowdownLobbyViolator above PLAY and ShowdownLobbyPanel)
//     is set by the same refresh (0x2EBB350) while the current window's countdownBeginTime <= now < endTime and
//     bEnableShowdown is set.
//   - Matchmaking (0x1192A80, from StartMatchmaking) takes a live tournament's window for the playlist with
//     beginTime <= now < endTime at the moment PLAY is pressed.
//   The manager's broadcasts: the list's answer (0x11AF310, delegate +64), a window history's answer (0x11AEF80, +64), and
//   two one-shot FTimerManager timers set with each list (0x11C0D50): one at the current window's end (+88) and one at the
//   next window's beginning (+112). Both timers take the time left's seconds part (FTimespan::GetSeconds, 0 to 59), not its
//   total, so they fire within a minute of the list, not at the window's edges; neither repeats. So the lobby's state
//   is what it was at the last list or history answer. The XMPP message com.epicgames.tournaments.complete
//   (UFortTournamentManager::HandleXmppReceived, 0x11A2450) asks again, ShowdownXmppRefreshRateInSeconds (10, the
//   constructor's, 0x13C7880; 6.10 ships no DefaultRuntimeOptions.ini) after it arrives, while bEnableShowdownXmppNotify
//   (on) is: the current window's history when there is a current event (0x11B6130 -> 0x11B6F30), else the whole list.
//   What Core does about it: the window's countdownBeginTime is the event's announcement, so the lobby is in its Showdown
//   state from the first list that holds the event; the list is never kept (ShowdownTournamentCacheExpirationHours=0), so
//   each lobby asks again; and the backend sends that XMPP message to every online player of a build with the tab when an
//   event is made, ended, deleted or given pictures, and at each event's start and end (createShowdownRefresh), so the
//   lobby follows the window without a restart.
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
// tournament on it. Epic's pictures were on its CDN, not in the build: an event shows the admin's pictures, or Core's
// own, made from the build's own textures (showdownImageSlots). Not served, for want of Epic's data: a reward table (the
// client reads none) and regions or platforms (every player is offered every event).
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

// The pictures Core serves where the admin set none (Core-Backend #336). No tournament art of Epic's is in the build's
// files, so these are made from the build's own textures (6.10's paks, CL-4480234; 6.20's hold the same two). They are
// this folder's files, served at showdownImagePath, each named with its content's hash: the client's image cache keeps a
// picture by its URL's last path segment for good, so a changed picture needs a new name.
// - Showdown_PosterFront: Season 6's loading screen key art (UI/Foundation/Textures/LoadingScreens/Fort_Load_Season6,
//   2048x1024 DXT1), its middle 711x1024 (Calamity, Dire and Dusk), in the poster's shape (the tile is about 0.69 wide to
//   1 high).
// - Showdown_PosterBack: the same, darkened to 35% and blurred, behind the back's texts.
// - Showdown_PlaylistTile: the mode select's default tile picture (UI/Foundation/Textures/Tiles/
//   T_Athena_Tile_Matchmaking_Default, 1024x512 DXT1), what the game shows for a playlist that has no picture of its own.
// JPEGs, each well under the cache's 10,000,000-byte limit. loading_screen_image has no default: no screen shows it.
export const showdownImagePath = "/content/api/tournament-images";
const imageDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "images");
export const showdownImageSlots = [
  { key: "posterFront", field: "poster_front_image", label: "Poster: the Events tab's tile, the details screen and the loading screen", size: "711x1024",
    file: "Showdown_PosterFront-711x1024-480eb7bf0acb.jpg" },
  { key: "posterBack", field: "poster_back_image", label: "Poster's back: EVENT DETAILS", size: "711x1024", file: "Showdown_PosterBack-711x1024-ddb7525cbc63.jpg" },
  { key: "playlistTile", field: "playlist_tile_image", label: "Lobby box above PLAY", size: "1024x512", file: "Showdown_PlaylistTile-1024x512-a9101d96df4c.jpg" },
  { key: "loadingScreen", field: "loading_screen_image", label: "Loading screen picture (no 6.10 or 6.20 screen shows it)", size: "1920x1080", file: null }
];
// The colours every event is served (FColor::FromHex's "RRGGBB"): white titles and dates on the posters, Fortnite's
// yellow for the lobby box's title, borders and the panel's button, and the purples of Season 6's key art for the boxes,
// the details screen's background and the fade under its poster.
export const showdownColors = {
  base_color: "FFFFFF",
  primary_color: "F7FF19",
  secondary_color: "9D4DFF",
  highlight_color: "F7FF19",
  title_color: "FFFFFF",
  shadow_color: "2A1052",
  background_left_color: "1B0A3C",
  background_right_color: "5B23B4",
  background_text_color: "7B3FE4",
  poster_fade_color: "1B0A3C"
};

// Serves Core's own pictures (pages.js). Only the slots' files are served.
export function serveShowdownImage(req, res) {
  const slot = showdownImageSlots.find((entry) => entry.file && entry.file === String(req.params.name ?? ""));
  if (!slot) return res.status(404).end();
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(fs.readFileSync(path.join(imageDir, slot.file)));
}

// A slot's picture for an event: the admin's (an upload, served on origin, or another site's URL as it is), else Core's
// own on origin, else "" (no picture).
export function showdownImageUrl(event, slot, origin) {
  const value = event?.images?.[slot.key];
  if (value) return newsImageUrl(value, origin);
  return slot.file ? `${origin ?? ""}${showdownImagePath}/${slot.file}` : "";
}
// The pictures the admin set on any event (the image hosts' tunnel and the uploads kept: services/content).
export const customShowdownImages = (store = storeProvider()) => (store?.list?.() ?? []).flatMap((event) => Object.values(event.images ?? {})).filter(Boolean);

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
// the event's own start. The window's countdown begins with the announcement too (Core-Backend #336): the lobby is in its
// Showdown state (the box above PLAY counting down to the start, then to the end) from countdownBeginTime, worked out only
// when the lobby refreshes (above), so a countdown from the start itself would want a refresh at that moment.
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
      countdownBeginTime: Date.parse(event.createdAt) < Date.parse(window.beginTime) ? event.createdAt : window.beginTime,
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
// keyed by its displayDataId, with its texts, the colours (showdownColors) and its pictures (showdownImageUrl; origin is
// where the client reached the page, for the backend's own pictures). Undefined for a build without the Events tab.
export function tournamentInformationFor(build, now = new Date(), store = storeProvider(), origin = undefined) {
  if (!hasShowdown(build)) return undefined;
  const tournaments = showdownEvents(build, now, store).map((event) => {
    const ltm = showdownPlaylistOf(event);
    const { beginTime, endTime } = windowOf(event);
    const until = endTime === noEnd ? "until it is ended" : `to ${day(endTime)} UTC`;
    // 6.20's Fortnitemares ones (Playlist_Deimos_SoloShow, _DuoShow, _SquadShow) are named the Showdown ones' way.
    const mode = ltm.playlistName.replace("Playlist_Showdown_", "")
      .replace(/^Playlist_Deimos_(Solo|Duo|Squad)Show$/, (whole, size) => ({ Solo: "Solo", Duo: "Duos", Squad: "Squads" })[size]);
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
      ...showdownColors,
      ...Object.fromEntries(showdownImageSlots.map((slot) => [slot.field, showdownImageUrl(event, slot, origin)]).filter(([, url]) => url)),
      _type: "Tournament Display Info"
    };
  });
  return {
    _title: "tournamentinformation",
    tournament_info: { _type: "Tournaments Info", tournaments },
    _noIndex: false,
    _activeDate: "2018-10-16T08:00:00.000Z",
    lastModified: new Date(Math.max(Date.parse("2026-11-13T00:00:00.000Z"),
      ...showdownEvents(build, now, store).map((event) => Math.max(Date.parse(event.endedAt ?? event.createdAt), event.imagesSetAt ? Date.parse(event.imagesSetAt) : 0)))).toISOString(),
    _locale: "en-US"
  };
}

// The pictures of the listed events' entries, for the content page's _images_ (the CMS cache keeps those files).
export const showdownImagesFor = (build, now = new Date(), store = storeProvider(), origin = undefined) => (hasShowdown(build)
  ? showdownEvents(build, now, store).flatMap((event) => showdownImageSlots.map((slot) => showdownImageUrl(event, slot, origin))).filter(Boolean)
  : []);

// The event the build's client treats as current (UFortTournamentManager 0x118AFD0, above): of the listed events' windows
// not yet ended, the one that begins first (the first listed on a tie). Its playlist is the one tournament playlist the
// lobby turns on. null when there is none.
export function currentShowdownEvent(build, now = new Date(), store = storeProvider()) {
  let current = null;
  for (const event of showdownEvents(build, now, store)) {
    const { beginTime, endTime } = windowOf(event);
    if (now.getTime() > Date.parse(endTime)) continue;
    if (!current || Date.parse(beginTime) < Date.parse(windowOf(current).beginTime)) current = event;
  }
  return current;
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
  const teamSize = { showdownSolo: 1, showdownDuos: 2, showdownSquads: 4, fortnitemaresShowSolo: 1, fortnitemaresShowDuos: 2, fortnitemaresShowSquads: 4 }[ltm.id];
  if (partySize !== teamSize) return refuse("wrong_number_of_event_players", "You need to be in a full party for this tournament.");
  return { event };
}

// The FortRuntimeOptions lines of the hotfix (services/fortnite/cloudstorage.js) for a build with the Events tab.
// - ShowdownTournamentCacheExpirationHours=0, so that the lobby asks for the list each time it is built instead of
//   keeping one for ten hours (the constructor's, 0x13C7880): an event made, started or ended in the panel shows at the
//   player's next lobby, and the client's live list (above) is fresh when its window opens. Served whether or not an event
//   is listed (Core-Backend #336): the hotfix comes once, when the game starts, and an empty list kept for ten hours hid
//   an event made after that until the game restarted.
// - With the admin's "Hide the Events tab while it has no tournament" on (settings hideEmptyEventsTab, off by default)
//   and no event listed: bEnableShowdown=false, the option 6.02 shipped with, which hides the tab and asks nothing
//   (🟡 read in the exe, 0x2E37520 and 0x11A6100; not seen in a running client), in place of the line above.
export function showdownRuntimeOptions(build, settingsValue, now = new Date(), store = storeProvider()) {
  if (!hasShowdown(build)) return [];
  if (!showdownEvents(build, now, store).length && settingsValue?.hideEmptyEventsTab === true) return ["bEnableShowdown=false"];
  return ["ShowdownTournamentCacheExpirationHours=0"];
}

// Keeps the lobbies of the builds with the Events tab in step with the events (Core-Backend #336). The client's tournament
// manager asks for its list or its current window's history again ShowdownXmppRefreshRateInSeconds (10) after the XMPP
// message com.epicgames.tournaments.complete (above), and every answer refreshes the lobby: the playlist turned on, its
// Showdown state, the box above PLAY. Its own timers can't do it (they fire within a minute of each list). So the backend
// sends that message to every online player whose last request came from such a build:
// - changed(): when an event is made, ended, deleted or given pictures (admin/routes.js);
// - at each listed event's start and end, with one engine timer (setTimeout) for the next of those moments, set again
//   after it fires and after each change. A timer longer than setTimeout allows is cut short and only sets the next one.
// xmpp: the XMPP service (onlineAccounts, notify); accounts: the account store (lastBuild).
const maxTimerMs = 2 ** 31 - 1;
// The players' clocks are put right by the MCP's server time, but not to the millisecond: the message goes a second late.
const edgeMarginMs = 1000;
export function createShowdownRefresh({ store, xmpp, accounts, now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  const notifyAll = () => {
    let sent = 0;
    for (const { accountId } of xmpp?.onlineAccounts?.() ?? []) {
      const build = accounts?.get?.(accountId)?.lastBuild;
      if (!build || !hasShowdown(build)) continue;
      xmpp.notify(accountId, tournamentsCompleteMessage, {});
      sent += 1;
    }
    return sent;
  };
  // The next start or end, after at, of an event any build lists (an in-game event not ended), as epoch ms, or null.
  const nextEdge = (at) => {
    const edges = (store?.list?.() ?? []).filter((event) => showdownPlaylistOf(event) && !event.endedAt)
      .flatMap((event) => [event.startsAt, event.endsAt]).filter(Boolean).map(Date.parse).filter((time) => time > at);
    return edges.length ? Math.min(...edges) : null;
  };
  const schedule = () => {
    if (timer) clearTimer(timer);
    timer = null;
    const at = now().getTime();
    const edge = nextEdge(at);
    if (edge === null) return null;
    const delay = edge + edgeMarginMs - at;
    const crosses = delay <= maxTimerMs;
    timer = setTimer(() => {
      timer = null;
      if (crosses) notifyAll();
      schedule();
    }, Math.min(delay, maxTimerMs));
    timer?.unref?.();
    return edge;
  };
  return {
    // An event changed: every lobby asks again, and the next edge is worked out again.
    changed() {
      const sent = notifyAll();
      schedule();
      return sent;
    },
    schedule,
    notifyAll,
    stop() {
      if (timer) clearTimer(timer);
      timer = null;
    }
  };
}

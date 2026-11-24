import fs from "node:fs";
import path from "node:path";
import { versionOf } from "../builds/detect.js";
import { currentSettings, hasLtm, ltms } from "../events/ltms.js";
import { readJson, writeJson } from "../json-file.js";
import { arenaDivisionHypeValue, arenaScoringValue, defaultArenaDivisionHype, defaultArenaScoring } from "../settings/store.js";
import { eliminationsStat, placementStat, showdownColors, showdownImagePath, showdownImageSlots } from "./showdown.js";

// Season 8's Arena (Core-Backend #420). Update v8.20 (27 March 2019): "New Feature: Arena Game Mode (Solo & Duos) ... Compete
// any time and gain 'Hype' to advance to higher leagues ... Each League is broken up into several Divisions, with players
// working their way from Open League to Contender League to Champion League. Scoring will update from division to
// division, with an increasing amount of Bus Fare lost with each match at higher divisions." Its playlists are the Pop-Up
// Cups' Playlist_ShowdownAlt_Solo and _Duos (58074, 58075; 8.20's and 8.30's paks name both "Arena": bIsTournament,
// bUseMultidivisionQueues, BattleRoyaleStrategy_Showdown, ShowdownScoringHUD, the DivisionLoading screen, full parties only).
//
// The Arena is no lobby mode of FrontEndPlaylistData: it is an event of Epic's events service (tournaments/eventsservice.js),
// one event a mode with a window for each division, and the client puts its tile in the mode select itself. What the
// clients read (their exes in IDA; 8.30 CL-5793395 unless named):
// - The tile. The mode select's playlist list (0x12CB880) takes the lobby's own playlists, then, for each downloaded
//   tournament, the window the tournament manager picks for the player (0x15737C0), and adds that window's template's
//   playlist (by name, among all the client's playlists, not FrontEndPlaylistData's) while the window's countdownBeginTime
//   < now < endTime; a window whose visibility is "locked" shows locked. With no event the Arena has no tile: what 8.20 to
//   8.40 showed on Core before this.
// - A division event. 8.30 lists an event as one when one of its windows has a metadata.divisionRank (the download handler,
//   0x1586df0 at 0x15875BB); 8.20 (CL-5625478, 0x14D2610) when a window's template has a persistentScoreId (or the window
//   is in UFortRuntimeOptions' DivisionEventWindows). For a division event the player's window is the one with the highest
//   rank whose requireAllTokens the player holds every one of (0x15737C0, 0x1573F30); the rank is the window's
//   metadata.divisionRank on 8.30 and 8.40 (0x15740E0), its round on 8.20 (0x34C4B20). 0 to 2 are the Open League (I to
//   III), 3 to 5 the Contender League (IV to VI), 6 and on the Champion League (0x1574FD0: Division.Open/Contender/Champion
//   .Prefix); the number of divisions is the event's windows (0x3603C20). 8.30's and 8.40's paks have seven division badges
//   (UI/Frontend/Showdown/Materials/league, T_UI_LeagueDivision_Badge1 to 7).
// - Hype. The player's total is player.persistentScores[template.persistentScoreId] (0x1576890). The Hype a rank takes to
//   leave is cumulative: 8.30 reads the window's metadata.ThresholdToAdvanceDivision (0x1572D90), 8.20 the lowest
//   threshold of the template's payoutTable ranks of scoringType "value" with a "token" payout (0x14AEA40). A division's
//   progress bar is the Hype past the threshold below it (0x1572C70, 0x35FF360).
// - The rules screen (0x1579620): a scoring rule of PLACEMENT_STAT_INDEX shows as "Placement", TEAM_ELIMS_STAT_INDEX as
//   "Eliminations" (99 tiers shown as one "EachElimination" line, 49 as one every two) and MATCH_PLAYED_STAT as
//   "MatchEntryFee", the bus fare.
// - Matchmaking: UFortMatchmakingV2 adds player.option.tournamentId and player.option.windowId, the event's and the picked
//   window's ids, as 6.10's did (services/matchmaking/ticket.js).
//
// What Core serves. Epic's Arena data was its service's and isn't in the builds. Its ids are the ones its Season 8 data used
// (epicgames_Arena_S8_Solo and _Duos, windows Arena_S8_Division<N>_<mode>, templates eventTemplate_..., tokens
// ARENA_S8_Division<N>, persistent score Hype) and the numbers are the ones recorded for Season 8 (🟡 community records of
// Epic's data, no Epic source found): Hype to leave each division 25, 75, 125, 175, 225 and 300 (Champion League at 300);
// Solo placement 3 for a top 25, 2 more for a top 15, 2 more for a top 5 and 3 more for the win, Duos the same at top 12,
// 7, 3 and the win; 1 a team elimination; bus fare 0 in the Open League, then 2, 4, 6 and 8. Every field 8.20 and 8.30 read
// for these is served (round and metadata, payoutTable and ThresholdToAdvanceDivision), so either finds its divisions. 🟡
// Core's choices: one Hype for Solo and Duos (one persistent score and one set of division tokens, as the token names have
// no mode), never below 0; a division once reached is kept (Season 8 had no demotion: Update v8.50 called a demotion a
// visual issue), Division I asks no token; the windows run from 8.20's release with no end (Epic's ended with the season);
// bus fare is taken when the match's result is recorded (Epic took it at the bus); matchCap 0 (none).
export const arenaSeason = 8;
export const hypeScoreId = "Hype";
const modeSizes = { Solo: 1, Duos: 2 };
// Hype to leave each division, cumulative; the Champion League's is the largest int32 (it has no next division; the client
// reads the field as an int). The first six are the admin panel's Arena tab's setting (settings arenaDivisionHype, #423),
// these the defaults.
const noNextDivision = 2147483647;
export const divisionThresholds = [...defaultArenaDivisionHype, noNextDivision];
// The thresholds in force: the settings' (the defaults for none or a bad list), with the last division's.
export const divisionThresholdsOf = (settingsValue = currentSettings()) => [...arenaDivisionHypeValue(settingsValue?.arenaDivisionHype), noNextDivision];
// The scoring in force (the admin panel's Arena tab's setting arenaScoring, #423; the defaults for none or a bad one): the
// bus fare of each division, the points of a team elimination, and for each mode the placement tiers [N, points] a place of
// N or better earns, the first the win's.
export function arenaScoringOf(settingsValue = currentSettings()) {
  const scoring = arenaScoringValue(settingsValue?.arenaScoring);
  return {
    busFares: scoring.busFares,
    eliminationPoints: scoring.eliminationPoints,
    placementTiers: Object.fromEntries(Object.keys(scoring.victoryPoints).map((mode) => [mode, [[1, scoring.victoryPoints[mode]], ...scoring.placements[mode]]]))
  };
}
const defaultScoring = arenaScoringOf({ arenaScoring: defaultArenaScoring });
export const divisionBusFares = defaultScoring.busFares;
export const placementTiers = defaultScoring.placementTiers;
export const matchPlayedStat = "MATCH_PLAYED_STAT";
// The client shows 99 one-point elimination tiers as "each elimination" (0x1579620).
const eliminationTiers = 99;
const arenaBegins = "2019-03-27T00:00:00.000Z";
const noEnd = "9999-12-31T23:59:59.000Z";
// The Arena windows' length in whole hours, from 8.20's release to FDateTime's last day: every event window Core serves is
// shorter, as each begins later (tournaments/showdown.js showdownRuntimeOptions, #425).
export const arenaWindowHours = Math.floor((Date.parse(noEnd) - Date.parse(arenaBegins)) / 3600000);

export const arenaLtms = ltms.filter((ltm) => ltm.arena);
// The mode of an Arena LTM ("Solo", "Duos"), by its playlist.
const modeOf = (ltm) => ltm.playlistName.replace(/^Playlist_ShowdownAlt_/, "");
export const arenaLtmsOf = (build) => arenaLtms.filter((ltm) => hasLtm(ltm.id, build));
export const hasArena = (build) => arenaLtmsOf(build).length > 0;
// The build's Arena modes whose switch is on (matchmakingModes arenaSolo and arenaDuos, on by default; #423): a hidden mode has
// no event in the download, no tile and no ticket.
export const shownArenaLtmsOf = (build, settingsValue = currentSettings()) => arenaLtmsOf(build).filter((ltm) => settingsValue?.matchmakingModes?.[ltm.id] !== false);
export const showsArena = (build, settingsValue = currentSettings()) => shownArenaLtmsOf(build, settingsValue).length > 0;
export const isArenaPlaylist = (playlistId, build) => arenaLtmsOf(build).some((ltm) => ltm.playlistId === Number(playlistId));

export const arenaEventId = (mode) => `epicgames_Arena_S${arenaSeason}_${mode}`;
export const divisionWindowId = (mode, rank) => `Arena_S${arenaSeason}_Division${rank + 1}_${mode}`;
export const divisionTemplateId = (mode, rank) => `eventTemplate_${divisionWindowId(mode, rank)}`;
export const divisionToken = (rank) => `ARENA_S${arenaSeason}_Division${rank + 1}`;

// The division a Hype total reaches (0-based), by the thresholds alone.
export const divisionOfHype = (hype, thresholds = divisionThresholds) => thresholds.findIndex((threshold) => hype < threshold);

// A player's Arena record of the season: {hype, division (the highest reached), matches: [matchId]}. thresholds: the division
// thresholds in force (the admin panel's setting).
export function createArenaStore(dataDir, thresholds = () => divisionThresholdsOf()) {
  const dir = path.join(dataDir, "accounts");
  const file = (accountId) => path.join(dir, accountId, "arena.json");
  const empty = () => ({ hype: 0, division: 0, matches: [] });
  const load = (accountId) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(accountId))) return { seasons: {} };
    const at = file(accountId);
    return fs.existsSync(at) ? readJson(at) : { seasons: {} };
  };
  return {
    get(accountId) {
      return { ...empty(), ...(load(accountId).seasons?.[arenaSeason] ?? {}) };
    },
    // A match's Hype: its points less the division's bus fare, once a match.
    record(accountId, { matchId = null, points }) {
      const data = load(accountId);
      const season = { ...empty(), ...(data.seasons?.[arenaSeason] ?? {}) };
      if (matchId && season.matches.includes(matchId)) return null;
      season.hype = Math.max(0, season.hype + points);
      season.division = Math.max(season.division, divisionOfHype(season.hype, thresholds()));
      if (matchId) season.matches = [...season.matches.slice(-199), matchId];
      data.seasons = { ...(data.seasons ?? {}), [arenaSeason]: season };
      fs.mkdirSync(path.dirname(file(accountId)), { recursive: true });
      writeJson(file(accountId), data);
      return season;
    },
    set(accountId, hype) {
      const data = load(accountId);
      const season = { ...empty(), ...(data.seasons?.[arenaSeason] ?? {}), hype: Math.max(0, Math.floor(hype)) };
      season.division = divisionOfHype(season.hype, thresholds());
      data.seasons = { ...(data.seasons ?? {}), [arenaSeason]: season };
      fs.mkdirSync(path.dirname(file(accountId)), { recursive: true });
      writeJson(file(accountId), data);
      return season;
    },
    // Every player with a record of the season, as {accountId, hype, division, matches}.
    list() {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((accountId) => fs.existsSync(file(accountId)))
        .map((accountId) => ({ accountId, ...this.get(accountId) }));
    },
    // Back to no Hype and Division I (the matches counted stay, so a result isn't counted twice); false for no record.
    reset(accountId) {
      const data = load(accountId);
      if (!data.seasons?.[arenaSeason]) return false;
      data.seasons[arenaSeason] = { ...empty(), ...data.seasons[arenaSeason], hype: 0, division: 0 };
      writeJson(file(accountId), data);
      return true;
    },
    resetAll() {
      return this.list().filter(({ accountId }) => this.reset(accountId)).length;
    }
  };
}

// The tokens a player holds: each division they have reached past the first.
export const arenaTokensOf = (record) => Array.from({ length: Math.max(0, record?.division ?? 0) }, (_, index) => divisionToken(index + 1));

// FEventsServicePlayer's Arena part: the division tokens and the Hype.
export const arenaPlayerOf = (record) => ({ tokens: arenaTokensOf(record), persistentScores: { [hypeScoreId]: record?.hype ?? 0 } });

function scoringRulesOf(mode, rank, scoring) {
  const fare = scoring.busFares[rank];
  return [
    { trackedStat: placementStat, matchRule: "lte", rewardTiers: scoring.placementTiers[mode].map(([keyValue, pointsEarned]) => ({ keyValue, pointsEarned })) },
    { trackedStat: eliminationsStat, matchRule: "gte", rewardTiers: Array.from({ length: eliminationTiers }, (_, index) => ({ keyValue: index + 1, pointsEarned: scoring.eliminationPoints })) },
    ...(fare ? [{ trackedStat: matchPlayedStat, matchRule: "gte", rewardTiers: [{ keyValue: 1, pointsEarned: -fare }] }] : [])
  ];
}

// A division's template (FEventsServiceEventTemplate): the mode's playlist, the Hype score, the division's rules and the
// next division's token at its threshold (8.20's threshold, 0x14AEA40).
function templateOf(ltm, rank, gameId, divisionThresholds, scoring) {
  const mode = modeOf(ltm);
  const next = rank + 1 < divisionThresholds.length;
  return {
    gameId,
    eventTemplateId: divisionTemplateId(mode, rank),
    playlistId: ltm.playlistName,
    persistentScoreId: hypeScoreId,
    matchCap: 0,
    useIndividualScores: false,
    scoringRules: scoringRulesOf(mode, rank, scoring),
    payoutTable: next ? [{ scoringType: "value", rolling: false, ranks: [{ threshold: divisionThresholds[rank],
      payouts: [{ rewardType: "token", rewardMode: "standard", value: divisionToken(rank + 1), quantity: 1 }] }] }] : []
  };
}

function windowOf(ltm, rank, divisionThresholds) {
  const mode = modeOf(ltm);
  return {
    eventWindowId: divisionWindowId(mode, rank),
    eventTemplateId: divisionTemplateId(mode, rank),
    countdownBeginTime: arenaBegins,
    beginTime: arenaBegins,
    endTime: noEnd,
    round: rank,
    startingPointCount: 0,
    leaderboardId: divisionWindowId(mode, rank),
    payoutDelay: 0,
    isTBD: false,
    visibility: "public",
    requireAllTokens: rank ? [divisionToken(rank)] : [],
    requireAnyTokens: [],
    requireNoneTokensCaller: [],
    requireAllTeammatesEligible: false,
    additionalRequirements: [],
    metadata: { RoundType: "Arena", divisionRank: rank, ThresholdToAdvanceDivision: divisionThresholds[rank] }
  };
}

// The build's Arena events (FEventsServiceEvent) and their templates, for the download. regions and platforms: the
// eventsservice's own lists.
export function arenaEvents(build, { gameId, regions = [], platforms = [] }, settingsValue = currentSettings()) {
  const events = [];
  const templates = [];
  const thresholds = divisionThresholdsOf(settingsValue);
  const scoring = arenaScoringOf(settingsValue);
  for (const ltm of shownArenaLtmsOf(build, settingsValue)) {
    const mode = modeOf(ltm);
    const ranks = thresholds.map((_, rank) => rank);
    events.push({ gameId, eventId: arenaEventId(mode), regions, regionMappings: {}, platforms, platformMappings: {},
      displayDataId: arenaEventId(mode), announcementTime: arenaBegins, beginTime: arenaBegins, endTime: noEnd,
      eventWindows: ranks.map((rank) => windowOf(ltm, rank, thresholds)), metadata: {} });
    templates.push(...ranks.map((rank) => templateOf(ltm, rank, gameId, thresholds, scoring)));
  }
  return { events, templates };
}

// An Arena ticket (services/matchmaking/ticket.js): the event and window the client named must be this build's Arena of
// the playlist, the window one the player holds the tokens for, and the party the mode's size (bEnforceFullSquadInUI).
// The refusals are 6.10's codes, which the lobby has texts for.
export function arenaTicket({ playlistId, tournamentId = "", windowId = "", partySize, build, record, settingsValue = currentSettings() }) {
  const refuse = (code, message) => ({ error: { code: `errors.com.epicgames.fortnite.${code}`, message } });
  const ltm = shownArenaLtmsOf(build, settingsValue).find((entry) => entry.playlistId === Number(playlistId));
  if (!ltm) return refuse("invalid_tournament_id", "Tournament does not exist.");
  const mode = modeOf(ltm);
  if (tournamentId && tournamentId !== arenaEventId(mode)) return refuse("invalid_tournament_id", "Tournament does not exist.");
  const held = record?.division ?? 0;
  const rank = windowId ? divisionThresholds.findIndex((_, index) => divisionWindowId(mode, index) === windowId) : held;
  if (rank < 0 || rank > held) return refuse("invalid_event_window_id", `Tournament ${arenaEventId(mode)} has no event window ${windowId}.`);
  if (partySize !== modeSizes[mode]) return refuse("wrong_number_of_event_players", "You need to be in a full party for this tournament.");
  return { ltm, mode, rank };
}

// A match's Hype for a player in a division: the placement tiers reached, a point a team elimination, less the bus fare.
export function arenaMatchPoints(mode, rank, { place, teamKills }, settingsValue = currentSettings()) {
  const { placementTiers, busFares, eliminationPoints } = arenaScoringOf(settingsValue);
  const placement = placementTiers[mode].filter(([upTo]) => place <= upTo).reduce((total, [, points]) => total + points, 0);
  return placement + Math.min(Math.max(0, teamKills), eliminationTiers) * eliminationPoints - busFares[Math.min(rank, busFares.length - 1)];
}

// The mode of a build's Arena playlist, or null.
export const arenaModeOf = (playlistId, build) => {
  const ltm = arenaLtmsOf(build).find((entry) => entry.playlistId === Number(playlistId));
  return ltm ? modeOf(ltm) : null;
};

// Epic's Arena mode select tiles (Core-Backend #422): playlist_tile_image of its arena_solo and arena_duos entries on its later
// page (the Wayback Machine's capture of fortnitecontent-website-prod07's fortnite-game of 2019-10-13), Arena_ModeSelect_
// Generic_Solo4 and _Duo4. Each on Epic's CDN, checked 2026-11-24: 200, image/png, 308,136 and 413,849 bytes, the hash in
// each name the file's SHA-1. That is Season X (10.x) art: only builds from 10.00 serve it. The page has no Season 8 Arena
// entry, so 8.20 to 8.40 serve none and the game shows its default tile (🟡 Season 8's own tile isn't recorded).
export const arenaTileImages = {
  Solo: "https://cdn2.unrealengine.com/Fortnite%2Ffortnite-game%2Ftournaments%2FArena_ModeSelect_Generic_Solo4-1024x512-8a00c8b712843e0af102a7a43629f50c8987d927.png",
  Duos: "https://cdn2.unrealengine.com/Fortnite%2Ffortnite-game%2Ftournaments%2FArena_ModeSelect_Generic_Duo4-1024x512-f9fd6282b090f61754c29bb28965d15d397d78e4.png"
};

const arenaTileOf = (mode, build) => (Number.parseInt(versionOf(build) ?? "", 10) >= 10 ? arenaTileImages[mode] : undefined);

// The content page's tournamentinformation entries for the Arena events (services/content/pages.js), by their
// displayDataId: the lobby's division panel and the details screen are UFortShowdownDetailView's, whose colours come from
// the entry (FColor::FromHex; a missing one is transparent, Core-Backend #336), so each has 6.10's colours and Core's own
// pictures (tournaments/showdown.js). 🟡 Epic's Arena entries aren't recorded: the texts are the playlist's and the patch
// notes'.
export function arenaTournamentInformation(build, origin = undefined, settingsValue = currentSettings()) {
  return shownArenaLtmsOf(build, settingsValue).map((ltm) => {
    const mode = modeOf(ltm);
    return {
      tournament_display_id: arenaEventId(mode),
      title_line_1: "Arena",
      title_line_2: mode,
      schedule_info: "Compete any time",
      flavor_description: "Prove your skill in this competitive mode! During each match, you'll earn Hype by either achieving high placements or eliminating opponents. As you gain Hype, you'll compete against tougher opponents with similar skill level.",
      details_description: "Gain Hype to advance from the Open League to the Contender League to the Champion League. Scoring updates from division to division, with an increasing amount of Bus Fare lost with each match at higher divisions.",
      short_format_title: "Arena",
      long_format_title: `Arena (${mode})`,
      ...showdownColors,
      ...Object.fromEntries(showdownImageSlots.filter((slot) => slot.file).map((slot) => [slot.field, `${origin ?? ""}${showdownImagePath}/${slot.file}`])),
      ...(arenaTileOf(mode, build) ? { playlist_tile_image: arenaTileOf(mode, build) } : {}),
      _type: "Tournament Display Info"
    };
  });
}

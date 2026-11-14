import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hasLtm, ltms } from "../events/ltms.js";
import { readJson, writeJson } from "../json-file.js";
import { ipRange, maxIpRanges } from "../network.js";
import { newsImageValue } from "../services/content/images.js";

// The admin panel's Tournaments tab (Core-Backend #263): events of a tournament playlist, each keeping its players' points
// from the matches they play in it, and their leaderboard. 4.2's client has no tournament screen (the playlist's own HUD,
// CompHUD, is an empty widget), so the points and leaderboard live in the panel only. Stored in <dataDir>/tournaments.json
// as {events: {<id>: event}}, like the panel's other data (store/purchasecodes.js).
//
// The tournament playlists: 4.2's Solo Showdown (Playlist_Comp_Solo, PlaylistId 51, events/ltms.js), Battle Royale's
// first scored mode, and 6.10's three Showdown playlists (Playlist_Showdown_Solo, _Duos and _Squads, 58071 to 58073), the
// in-game tournaments' (inGame): an event of one is listed in the client's Events tab, queued from it and scored on
// screen (tournaments/showdown.js). 6.20's Fortnitemares ones (Playlist_Deimos_SoloShow, _DuoShow and _SquadShow, 59071 to
// 59073: the Showdown playlists with the Cube Monsters) are in-game ones too, and so are 6.30's Scavenger Pop-Up Cup ones
// (Playlist_ShowdownAlt_Solo, _Duos and _Squads, 58074 to 58076), 6.31's Alchemist Pop-Up Cup on the same playlists. A later build's tournament playlist goes here.
export const tournamentPlaylists = ["soloShowdown", "showdownSolo", "showdownDuos", "showdownSquads",
  "fortnitemaresShowSolo", "fortnitemaresShowDuos", "fortnitemaresShowSquads", "scavengerSolo", "scavengerDuos", "scavengerSquads"].map((id) => {
  const ltm = ltms.find((entry) => entry.id === id);
  return { id, name: ltm.name, playlistId: ltm.playlistId, builds: ltm.builds, inGame: ltm.tournament === true };
});

// Epic's Solo Showdown contest rules. Each match scores by its placement (the same table both times); only a player's
// first countedMatches matches count, not their best; a player is ranked for prizes once they've played minimumMatches;
// ties go to more wins, then more eliminations, then the better average placement.
// - May 2018 (17 to 21 May, 4.2's, the Season 4 replay's): placement only, the first 50 matches, 50 to qualify.
//   ("Solo Showdown Contest Rules", fortnite.com/news/solo-showdown-contest-rules.)
// - July 2018 (27 to 30 July, Season 5): 6 points an elimination added, the first 25 matches, 25 to qualify.
//   ("Solo Showdown Official Contest Rules - July", fortnite.com.)
const placementTable = [[1, 100], [2, 94], [3, 91], [4, 88], [5, 85], [6, 80], [7, 75], [8, 70], [9, 65], [10, 60],
  [15, 55], [20, 50], [30, 45], [40, 40], [50, 35], [75, 30], [100, 25]];
// - In-game tournaments, October 2018 (6.10's Events tab, from the Alpha Tournament of 18 October on; #427): a point for
//   each step a match reaches, the steps adding up. Placement: Top 10, Top 3 and the Victory Royale (3 points for a win);
//   eliminations: 3, 5 and 7 (3 points for 7). At most 6 points a match, and each window counts every match played in it.
//   (Press coverage of the 6.10 launch: points "begin at 3 eliminations", then "1 extra point at 5 eliminations and 7
//   eliminations", and "in 1 point increments for reaching the Top 10, the Top 3, or a Top 1 Victory Royale".) Each step
//   is one of the client's reward tiers (tournaments/showdown.js), and one point each is what its match HUD counts: the
//   running total next to the health bar adds 1 for each "+N POINTS" alert, whatever N is.
// countedMatches null: every match counts; minimumMatches 0: nobody waits to be ranked.
export const rulesets = {
  soloShowdownMay2018: { name: "Solo Showdown, May 2018 (4.2)", placementPoints: placementTable, pointsPerElimination: 0, countedMatches: 50, minimumMatches: 50 },
  soloShowdownJuly2018: { name: "Solo Showdown, July 2018", placementPoints: placementTable, pointsPerElimination: 6, countedMatches: 25, minimumMatches: 25 },
  inGameOctober2018: { name: "In-game tournament, October 2018 (6.10+: a point a step)", placementPoints: [[1, 3], [3, 2], [10, 1]], pointsPerElimination: 0,
    eliminationPoints: [[3, 1], [5, 1], [7, 1]], countedMatches: null, minimumMatches: 0 }
};
export const defaultRuleset = "soloShowdownMay2018";
// An event on an in-game tournament playlist (6.10+) made without a ruleset scores Epic's in-game way.
export const defaultInGameRuleset = "inGameOctober2018";

// A placement's points: the first bracket (up to its place) it is within; none past the table's last place.
export function placementPoints(ruleset, place) {
  return ruleset.placementPoints.find(([upTo]) => place <= upTo)?.[1] ?? 0;
}
// The elimination steps' points (eliminationPoints: [[eliminations, points], ...]): each step the match's eliminations
// reach adds its points. None without steps.
export const eliminationStepPoints = (ruleset, kills) => (ruleset.eliminationPoints ?? []).reduce((total, [atLeast, points]) => total + (kills >= atLeast ? points : 0), 0);
export const matchPoints = (ruleset, { place, kills }) => placementPoints(ruleset, place) + ruleset.pointsPerElimination * kills + eliminationStepPoints(ruleset, kills);
// Whether a player's next match still counts in an event (a ruleset without countedMatches counts every match).
export const countsAnotherMatch = (ruleset, played) => !Number.isInteger(ruleset.countedMatches) || played < ruleset.countedMatches;

// An event's custom scoring (Core-Backend #280): the admin's own placement table, points an elimination and elimination
// steps (#427), in place of its preset's (event.scoring, null for the preset's). The preset still sets the counted and
// qualifying matches.
export const maxPlace = 100;
export const maxEliminationSteps = 100;
const maxPoints = 100000;
const isWhole = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
// Checks and normalises custom scoring: {placementPoints: [[upTo, points], ...] (places 1 up, each bracket ending further
// down, up to place 100; a place past the last bracket scores none), pointsPerElimination, eliminationPoints (optional:
// [[eliminations, points], ...], from 1 elimination up, each step after the one before, up to 100; each step reached adds
// its points)}. Throws an Error with the reason.
export function validateScoring(scoring) {
  if (!scoring || typeof scoring !== "object" || Array.isArray(scoring)) throw new Error("Scoring is {placementPoints, pointsPerElimination, eliminationPoints}.");
  const table = scoring.placementPoints;
  if (!Array.isArray(table) || !table.length || table.length > maxPlace) throw new Error(`The placement table has 1 to ${maxPlace} brackets.`);
  const placementPoints = table.map((bracket, index) => {
    const [upTo, points] = Array.isArray(bracket) ? bracket : [bracket?.upTo, bracket?.points];
    if (!isWhole(upTo, 1, maxPlace)) throw new Error(`Bracket ${index + 1}'s last place is a whole number from 1 to ${maxPlace}.`);
    if (!isWhole(points, 0, maxPoints)) throw new Error(`Bracket ${index + 1}'s points are a whole number from 0 to ${maxPoints}.`);
    return [upTo, points];
  });
  placementPoints.forEach(([upTo], index) => {
    if (index && upTo <= placementPoints[index - 1][0]) throw new Error(`Bracket ${index + 1}'s last place must come after bracket ${index}'s (${placementPoints[index - 1][0]}).`);
  });
  const pointsPerElimination = scoring.pointsPerElimination ?? 0;
  if (!isWhole(pointsPerElimination, 0, maxPoints)) throw new Error(`Points an elimination are a whole number from 0 to ${maxPoints}.`);
  const steps = scoring.eliminationPoints ?? [];
  if (!Array.isArray(steps) || steps.length > maxEliminationSteps) throw new Error(`The elimination steps are a list of at most ${maxEliminationSteps}.`);
  const eliminationPoints = steps.map((step, index) => {
    const [eliminations, points] = Array.isArray(step) ? step : [step?.eliminations, step?.points];
    if (!isWhole(eliminations, 1, maxEliminationSteps)) throw new Error(`Elimination step ${index + 1}'s eliminations are a whole number from 1 to ${maxEliminationSteps}.`);
    if (!isWhole(points, 0, maxPoints)) throw new Error(`Elimination step ${index + 1}'s points are a whole number from 0 to ${maxPoints}.`);
    return [eliminations, points];
  });
  eliminationPoints.forEach(([eliminations], index) => {
    if (index && eliminations <= eliminationPoints[index - 1][0]) throw new Error(`Elimination step ${index + 1} must come after step ${index} (${eliminationPoints[index - 1][0]} eliminations).`);
  });
  return { placementPoints, pointsPerElimination, ...(eliminationPoints.length ? { eliminationPoints } : {}) };
}

// The rules an event scores by: its preset, with its custom scoring over it when it has one (in place of all the preset's
// points: custom scoring without elimination steps has none).
export function scoringOf(event) {
  const ruleset = rulesets[event.ruleset] ?? rulesets[defaultRuleset];
  return event.scoring ? { ...ruleset, eliminationPoints: [], ...event.scoring } : ruleset;
}

// An event's dedicated servers and bots (Core-Backend #282).
// servers: the gameservers that host its matches, each an IP address or CIDR range (network.js ipRange), as the
// Matchmaking tab's custom matchmaking servers are (#227). While the event runs, a match of its playlist plays only on
// one of them, and they take no other playlist's matches; empty (the default), its matches play on the normal pool.
// bots: null (the default) for the Matchmaking tab's player bots, or {enabled, count}: the event's own, for its
// playlist's matches while it runs. enabled false: no bots; true: count bots on teams of their own (0 to 100), the
// Matchmaking tab's level, health, shield, fight chance and the rest still set how they play.
export const maxBots = 100;
// Checks and normalises an event's servers. Throws an Error with the reason.
export function validateServers(servers) {
  if (servers === undefined || servers === null) return [];
  const list = typeof servers === "string" ? servers.split(/[\s,]+/).filter(Boolean) : servers;
  if (!Array.isArray(list)) throw new Error("Servers are a list of IP addresses or CIDR ranges.");
  if (list.length > maxIpRanges) throw new Error(`At most ${maxIpRanges} servers can be listed for an event.`);
  const bad = list.filter((entry) => ipRange(entry) === null);
  if (bad.length) throw new Error(`Not an IP address or CIDR range: ${bad.map(String).join(", ")}`);
  return [...new Set(list.map(ipRange))];
}
// Checks and normalises an event's bots: null for the Matchmaking tab's, else {enabled, count}. Throws an Error.
export function validateBots(bots) {
  if (bots === undefined || bots === null) return null;
  if (typeof bots !== "object" || Array.isArray(bots) || typeof bots.enabled !== "boolean") throw new Error("Bots are null (the Matchmaking tab's) or {enabled, count}.");
  const count = bots.count === undefined || bots.count === null || bots.count === "" ? 0 : Number(bots.count);
  if (!isWhole(count, 0, maxBots)) throw new Error(`The bot count is a whole number from 0 to ${maxBots}.`);
  return { enabled: bots.enabled, count };
}
// The player bots a match plays with: the Matchmaking tab's (the settings' bots), or with its playlist's running event's
// own ({enabled, count}, botsFor) over them. In the settings' shape: {forcePlayerAIs, count, fillPlayerTeams, ...}.
export function effectiveBots(general, override = null) {
  if (!override) return general ?? null;
  const base = { level: 5, startingHealth: 100, startingShield: 0, eliminationsCountForQuests: true, botFightChance: 30, ...(general ?? {}) };
  return { ...base, forcePlayerAIs: override.enabled, count: override.enabled ? override.count : 0,
    fillPlayerTeams: override.enabled && base.fillPlayerTeams === true };
}
// Whether a match plays with bots, as the warmup answer sends them (services/matchmaking/warmup.js).
export const botsOn = (bots) => (bots?.forcePlayerAIs === true && bots.count > 0) || bots?.fillPlayerTeams === true;

// An in-game event's pin (6.10's Events tab: "Score enough points during any scheduled event session and you'll earn a
// golden pin"): the points that earn it, or null for an event without one. Throws an Error with the reason.
export const maxPinScore = 1000000;
export function validatePinScore(pinScore) {
  if (pinScore === undefined || pinScore === null || pinScore === "") return null;
  const value = Number(pinScore);
  if (!isWhole(value, 1, maxPinScore)) throw new Error(`The pin score is a whole number from 1 to ${maxPinScore}.`);
  return value;
}

// An in-game event's pictures (Core-Backend #336, tournaments/showdown.js showdownImageSlots): {posterFront, posterBack,
// playlistTile, loadingScreen}, each an http(s) URL or a picture uploaded through the admin panel (services/content/
// images.js, the news pictures' store); a slot left out takes Core's own picture. Checks and merges a change into the
// current ones: a slot sent as "" or null goes back to Core's. Throws an Error with the reason.
export const imageSlotKeys = ["posterFront", "posterBack", "playlistTile", "loadingScreen"];
export function validateImages(images, current = {}, dataDir = null) {
  if (!images || typeof images !== "object" || Array.isArray(images)) throw new Error("Pictures are {posterFront, posterBack, playlistTile, loadingScreen}.");
  const next = { ...current };
  for (const [key, value] of Object.entries(images)) {
    if (!imageSlotKeys.includes(key)) throw new Error(`No picture slot ${key}.`);
    if (value === null || value === undefined || String(value).trim() === "") {
      delete next[key];
      continue;
    }
    const image = newsImageValue(value, dataDir);
    if (!image) throw new Error("A picture is an http:// or https:// URL, or an uploaded image.");
    next[key] = image;
  }
  return next;
}

// An event's prizes (Core-Backend #361, given by tournaments/payouts.js). Epic's tournaments gave theirs two ways, and an
// event's payoutTable holds rows of either:
// - "value": for reaching a number of points. 6.10's in-game tournaments carry these in their windows' eventData as
//   rewardTable: [{pointsEarned, mcpTokenRewards}] (FShowdownEventData's RewardTable of FEventReward, the SDK of 6.10 to
//   6.31): what the MCP grants a player whose window score reaches pointsEarned. The golden pin (pinScore) is one too.
// - "rank": for a final place on the leaderboard (Solo Showdown's prizes, May and July 2018: by rank among the players
//   who qualified, once the event was over; the later events service's payoutTable has the same two scoringTypes).
// A row is {scoringType, threshold (the points to reach, or the last place it pays), vbucks, items: [templateId]}: V-Bucks
// (Currency:MtxGiveaway, as the panel's other V-Bucks) and items (a Battle Royale cosmetic or another item some build
// has, as a redeem code's, friendcodes/rewards.js). A row gives something; the rows of a kind each have their own
// threshold. Nothing else of Epic's prizes (cash, hardware) is something a profile can hold.
export const payoutScoringTypes = ["value", "rank"];
export const maxPayoutRows = 50;
export const maxPayoutItems = 10;
export const maxPayoutVbucks = 1000000;
const templateIdPattern = /^[A-Za-z]+:[A-Za-z0-9_.-]{1,128}$/;
// Checks and normalises an event's prizes: [] for none. Throws an Error with the reason. (Whether each item exists in a
// build is checked by the admin routes, tournaments/payouts.js unknownPayoutItems.)
export function validatePayoutTable(table) {
  if (table === undefined || table === null) return [];
  if (!Array.isArray(table) || table.length > maxPayoutRows) throw new Error(`Prizes are a list of at most ${maxPayoutRows} rows.`);
  const rows = table.map((row, index) => {
    const name = `Prize ${index + 1}`;
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`${name} is {scoringType, threshold, vbucks, items}.`);
    if (!payoutScoringTypes.includes(row.scoringType)) throw new Error(`${name} is for points reached ("value") or a final place ("rank").`);
    const threshold = Number(row.threshold);
    const most = row.scoringType === "value" ? maxPinScore : 1000;
    if (!isWhole(threshold, 1, most)) throw new Error(`${name}'s ${row.scoringType === "value" ? "points" : "place"} is a whole number from 1 to ${most}.`);
    const vbucks = row.vbucks === undefined || row.vbucks === null || row.vbucks === "" ? 0 : Number(row.vbucks);
    if (!isWhole(vbucks, 0, maxPayoutVbucks)) throw new Error(`${name}'s V-Bucks are a whole number from 0 to ${maxPayoutVbucks}.`);
    const items = (Array.isArray(row.items) ? row.items : []).map((item) => String(item ?? "").trim()).filter(Boolean);
    if (items.length > maxPayoutItems) throw new Error(`${name} gives at most ${maxPayoutItems} items.`);
    const bad = items.find((item) => !templateIdPattern.test(item));
    if (bad) throw new Error(`${name}: ${bad} isn't an item's template id (such as AthenaCharacter:CID_028_Athena_Commando_F).`);
    if (!vbucks && !items.length) throw new Error(`${name} gives nothing: set V-Bucks or an item, or remove it.`);
    return { scoringType: row.scoringType, threshold, vbucks, items: [...new Set(items)] };
  });
  for (const type of payoutScoringTypes) {
    const thresholds = rows.filter((row) => row.scoringType === type).map((row) => row.threshold);
    if (new Set(thresholds).size !== thresholds.length) throw new Error(`Two prizes are for the same ${type === "value" ? "points" : "place"}: put their rewards in one row.`);
  }
  return rows.sort((a, b) => payoutScoringTypes.indexOf(a.scoringType) - payoutScoringTypes.indexOf(b.scoringType) || a.threshold - b.threshold);
}

const maxEvents = 100;
const maxName = 64;
const isDate = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));

// An event's leaderboard: its players by points, then wins, eliminations and average placement (lower is better), as the
// contest rules break ties. Ranks are 1 up, a tie on all four sharing one.
// Each match's points come from the event's scoring now, so a change to it rescores the matches already played.
export function leaderboardOf(event, nameOf = (accountId) => accountId) {
  const ruleset = scoringOf(event);
  const rows = Object.entries(event.players ?? {}).map(([accountId, player]) => {
    const counted = player.matches;
    const sum = (pick) => counted.reduce((total, match) => total + pick(match), 0);
    return {
      accountId,
      displayName: nameOf(accountId),
      points: sum((match) => matchPoints(ruleset, match)),
      matches: counted.length,
      wins: counted.filter((match) => match.place === 1).length,
      eliminations: sum((match) => match.kills),
      averagePlacement: counted.length ? Math.round((sum((match) => match.place) / counted.length) * 100) / 100 : null,
      qualified: counted.length >= ruleset.minimumMatches
    };
  });
  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || b.eliminations - a.eliminations
    || (a.averagePlacement ?? Infinity) - (b.averagePlacement ?? Infinity) || a.displayName.localeCompare(b.displayName));
  let rank = 0;
  return rows.map((row, index) => {
    const previous = rows[index - 1];
    if (!previous || previous.points !== row.points || previous.wins !== row.wins || previous.eliminations !== row.eliminations
      || previous.averagePlacement !== row.averagePlacement) rank = index + 1;
    return { rank, ...row };
  });
}

// Whether an event takes a match now: not ended, and within its start and end when it has them.
export function isRunning(event, now = new Date()) {
  if (event.endedAt) return false;
  if (event.startsAt && Date.parse(event.startsAt) > now.getTime()) return false;
  if (event.endsAt && Date.parse(event.endsAt) <= now.getTime()) return false;
  return true;
}
export const statusOf = (event, now = new Date()) => (event.endedAt || (event.endsAt && Date.parse(event.endsAt) <= now.getTime()) ? "ended"
  : event.startsAt && Date.parse(event.startsAt) > now.getTime() ? "scheduled" : "running");

export function createTournamentStore(dataDir) {
  const file = path.join(dataDir, "tournaments.json");
  let data = null;
  const load = () => {
    if (!data) {
      data = fs.existsSync(file) ? readJson(file) : {};
      data.events ??= {};
    }
    return data;
  };
  const save = () => writeJson(file, load());
  const get = (id) => (Object.hasOwn(load().events, id) ? load().events[id] : null);

  return {
    list() {
      return Object.values(load().events).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    get,

    // Makes an event: {name, playlist (a tournamentPlaylists id), ruleset (a rulesets key; when left out, the in-game one
    // on an in-game playlist, else defaultRuleset), scoring (custom scoring, see
    // validateScoring; optional, the preset's when left out or null), startsAt, endsAt (ISO dates, both optional: it runs
    // from now until ended), servers and bots (#282, validateServers and validateBots; optional: the normal pool and the
    // Matchmaking tab's bots), pinScore (an in-game event's pin, validatePinScore; optional), images (an in-game event's
    // pictures, validateImages; optional, Core's own where left out), payoutTable (its prizes, #361,
    // tournaments/payouts.js validatePayoutTable; optional, none)}. Throws an Error with the reason.
    create(options = {}, now = new Date()) {
      const playlist = tournamentPlaylists.find((entry) => entry.id === (options.playlist ?? tournamentPlaylists[0].id));
      if (!playlist) throw new Error(`Unknown tournament playlist ${String(options.playlist)}.`);
      const ruleset = options.ruleset ?? (playlist.inGame ? defaultInGameRuleset : defaultRuleset);
      if (!Object.hasOwn(rulesets, ruleset)) throw new Error(`Unknown scoring rules ${String(ruleset)}.`);
      const name = String(options.name ?? "").trim() || playlist.name;
      if (name.length > maxName) throw new Error(`A name is at most ${maxName} characters.`);
      for (const key of ["startsAt", "endsAt"]) {
        if (options[key] !== undefined && options[key] !== null && options[key] !== "" && !isDate(options[key])) throw new Error(`${key} isn't a date.`);
      }
      const startsAt = options.startsAt ? new Date(options.startsAt).toISOString() : null;
      const endsAt = options.endsAt ? new Date(options.endsAt).toISOString() : null;
      if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error("An event ends after it starts.");
      const scoring = options.scoring === undefined || options.scoring === null ? null : validateScoring(options.scoring);
      const servers = validateServers(options.servers);
      const bots = validateBots(options.bots);
      const pinScore = playlist.inGame ? validatePinScore(options.pinScore) : null;
      const images = playlist.inGame && options.images ? validateImages(options.images, {}, dataDir) : {};
      const payoutTable = validatePayoutTable(options.payoutTable);
      if (Object.keys(load().events).length >= maxEvents) throw new Error(`At most ${maxEvents} events are kept; delete an old one first.`);
      const event = { id: crypto.randomUUID().replaceAll("-", ""), name, playlist: playlist.id, playlistId: playlist.playlistId, ruleset,
        scoring, servers, bots, ...(playlist.inGame ? { pinScore, images } : {}), payoutTable, startsAt, endsAt, createdAt: now.toISOString(), endedAt: null, players: {} };
      load().events[event.id] = event;
      save();
      return event;
    },

    // Sets an event's custom scoring (validateScoring), or with null puts it back on its preset's. Its leaderboard
    // rescores the matches already played. Throws an Error with the reason; null when there's no such event.
    setScoring(id, scoring) {
      const event = get(id);
      if (!event) return null;
      event.scoring = scoring === null || scoring === undefined ? null : validateScoring(scoring);
      save();
      return event;
    },

    // Sets an event's prizes (Core-Backend #361, tournaments/payouts.js validatePayoutTable; [] or null for none). Prizes
    // already given stay given. Throws an Error with the reason; null when there's no such event.
    setPayoutTable(id, table, now = new Date()) {
      const event = get(id);
      if (!event) return null;
      event.payoutTable = validatePayoutTable(table);
      event.payoutsSetAt = now.toISOString();
      save();
      return event;
    },

    // Notes the prizes (tournaments/payouts.js payoutKey) given to a player, so that none is given twice. Kept apart from
    // the player's matches: a reset of the points doesn't give a prize again.
    markPaid(id, accountId, keys, now = new Date()) {
      const event = get(id);
      if (!event || !keys.length) return event;
      const paid = ((event.paid ??= {})[accountId] ??= {});
      for (const key of keys) paid[key] ??= now.toISOString();
      save();
      return event;
    },

    // Notes that an ended event's placement prizes were given (tournaments/payouts.js settleEvent).
    markSettled(id, now = new Date()) {
      const event = get(id);
      if (!event) return null;
      event.payoutsSettledAt ??= now.toISOString();
      save();
      return event;
    },

    // Sets an event's dedicated servers and bots (#282): {servers, bots}, each left as it is when not sent (see
    // validateServers, validateBots; bots null for the Matchmaking tab's). Throws an Error with the reason; null when
    // there's no such event.
    configure(id, { servers, bots } = {}) {
      const event = get(id);
      if (!event) return null;
      const next = { servers: servers === undefined ? event.servers ?? [] : validateServers(servers), bots: bots === undefined ? event.bots ?? null : validateBots(bots) };
      event.servers = next.servers;
      event.bots = next.bots;
      save();
      return event;
    },

    // Sets an in-game event's pictures (#336, validateImages: a slot "" or null back to Core's own). Throws an Error with
    // the reason; null when there's no such event.
    setImages(id, images, now = new Date()) {
      const event = get(id);
      if (!event) return null;
      if (!tournamentPlaylists.find((entry) => entry.id === event.playlist)?.inGame) throw new Error("Only an event in the game's Events tab (6.10+) has pictures.");
      event.images = validateImages(images, event.images ?? {}, dataDir);
      event.imagesSetAt = now.toISOString();
      save();
      return event;
    },

    // The dedicated servers of the running events (#282), [{playlistId, servers}], for the matchmaking service: a match
    // of one of these playlists plays only on its servers, and they take no other playlist's matches.
    runningServers(now = new Date()) {
      return Object.values(load().events).filter((event) => event.servers?.length && isRunning(event, now))
        .map((event) => ({ playlistId: event.playlistId, servers: event.servers }));
    },

    // A playlist's bots from its running event (#282): {eventId, enabled, count} of the newest running event of the
    // playlist that has bots of its own, or null for the Matchmaking tab's.
    botsFor(playlistId, now = new Date()) {
      const event = Object.values(load().events).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find((entry) => entry.playlistId === Number(playlistId) && entry.bots && isRunning(entry, now));
      return event ? { eventId: event.id, ...event.bots } : null;
    },

    // Ends an event now: it takes no more matches and its leaderboard is final.
    end(id, now = new Date()) {
      const event = get(id);
      if (!event) return null;
      if (!event.endedAt) {
        event.endedAt = now.toISOString();
        save();
      }
      return event;
    },

    // Clears an event's points: every player's matches go, and it carries on (an ended event stays ended).
    reset(id) {
      const event = get(id);
      if (!event) return null;
      event.players = {};
      save();
      return event;
    },

    remove(id) {
      if (!get(id)) return false;
      delete load().events[id];
      save();
      return true;
    },

    // A player's match result (services/fortnite/battleroyale.js recordresults): it scores in every running event of the
    // match's playlist (on a build that has it, when the match's build is known), up to the event's counted matches.
    // A report sent again for the same match (CoreV2's matchId) doesn't count twice. Returns the points it scored, by event.
    // team: the accounts the player played the match with, themselves among them (an in-game event's history names
    // them; kills are then the team's). only: one event's id, for a report that names its event.
    recordResult(accountId, playlistId, { place, kills, matchId = null, build = null, team = null, only = null }, now = new Date()) {
      const scored = [];
      for (const event of Object.values(load().events)) {
        if (event.playlistId !== Number(playlistId) || !isRunning(event, now) || (only !== null && event.id !== only)) continue;
        if (build && !hasLtm(event.playlist, build)) continue;
        const ruleset = scoringOf(event);
        const player = (event.players[accountId] ??= { matches: [] });
        if (matchId && player.matches.some((match) => match.matchId === matchId)) continue;
        if (!countsAnotherMatch(ruleset, player.matches.length)) continue;
        const points = matchPoints(ruleset, { place, kills });
        player.matches.push({ matchId, place, kills, points, ...(Array.isArray(team) && team.length > 1 ? { team: [...team] } : {}), at: now.toISOString() });
        scored.push({ eventId: event.id, points });
      }
      if (scored.length) save();
      return scored;
    }
  };
}

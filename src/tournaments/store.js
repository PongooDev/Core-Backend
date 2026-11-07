import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hasLtm, ltms } from "../events/ltms.js";
import { readJson, writeJson } from "../json-file.js";

// The admin panel's Tournaments tab (Core-Backend #263): events of a tournament playlist, each keeping its players' points
// from the matches they play in it, and their leaderboard. 4.2's client has no tournament screen (the playlist's own HUD,
// CompHUD, is an empty widget), so the points and leaderboard live in the panel only. Stored in <dataDir>/tournaments.json
// as {events: {<id>: event}}, like the panel's other data (store/purchasecodes.js).
//
// The tournament playlists: 4.2's Solo Showdown (Playlist_Comp_Solo, PlaylistId 51, events/ltms.js), Battle Royale's
// first scored mode. A later build's tournament playlist goes here.
export const tournamentPlaylists = ["soloShowdown"].map((id) => {
  const ltm = ltms.find((entry) => entry.id === id);
  return { id, name: ltm.name, playlistId: ltm.playlistId, builds: ltm.builds };
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
export const rulesets = {
  soloShowdownMay2018: { name: "Solo Showdown, May 2018 (4.2)", placementPoints: placementTable, pointsPerElimination: 0, countedMatches: 50, minimumMatches: 50 },
  soloShowdownJuly2018: { name: "Solo Showdown, July 2018", placementPoints: placementTable, pointsPerElimination: 6, countedMatches: 25, minimumMatches: 25 }
};
export const defaultRuleset = "soloShowdownMay2018";

// A placement's points: the first bracket (up to its place) it is within; none past the table's last place.
export function placementPoints(ruleset, place) {
  return ruleset.placementPoints.find(([upTo]) => place <= upTo)?.[1] ?? 0;
}
export const matchPoints = (ruleset, { place, kills }) => placementPoints(ruleset, place) + ruleset.pointsPerElimination * kills;

// An event's custom scoring (Core-Backend #280): the admin's own placement table and points an elimination, in place of
// its preset's (event.scoring, null for the preset's). The preset still sets the counted and qualifying matches.
export const maxPlace = 100;
const maxPoints = 100000;
const isWhole = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
// Checks and normalises custom scoring: {placementPoints: [[upTo, points], ...] (places 1 up, each bracket ending further
// down, up to place 100; a place past the last bracket scores none), pointsPerElimination}. Throws an Error with the reason.
export function validateScoring(scoring) {
  if (!scoring || typeof scoring !== "object" || Array.isArray(scoring)) throw new Error("Scoring is {placementPoints, pointsPerElimination}.");
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
  return { placementPoints, pointsPerElimination };
}

// The rules an event scores by: its preset, with its custom scoring over it when it has one.
export function scoringOf(event) {
  const ruleset = rulesets[event.ruleset] ?? rulesets[defaultRuleset];
  return event.scoring ? { ...ruleset, ...event.scoring } : ruleset;
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

    // Makes an event: {name, playlist (a tournamentPlaylists id), ruleset (a rulesets key), scoring (custom scoring, see
    // validateScoring; optional, the preset's when left out or null), startsAt, endsAt (ISO dates, both optional: it runs
    // from now until ended)}. Throws an Error with the reason.
    create(options = {}, now = new Date()) {
      const playlist = tournamentPlaylists.find((entry) => entry.id === (options.playlist ?? tournamentPlaylists[0].id));
      if (!playlist) throw new Error(`Unknown tournament playlist ${String(options.playlist)}.`);
      const ruleset = options.ruleset ?? defaultRuleset;
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
      if (Object.keys(load().events).length >= maxEvents) throw new Error(`At most ${maxEvents} events are kept; delete an old one first.`);
      const event = { id: crypto.randomUUID().replaceAll("-", ""), name, playlist: playlist.id, playlistId: playlist.playlistId, ruleset,
        scoring, startsAt, endsAt, createdAt: now.toISOString(), endedAt: null, players: {} };
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
    recordResult(accountId, playlistId, { place, kills, matchId = null, build = null }, now = new Date()) {
      const scored = [];
      for (const event of Object.values(load().events)) {
        if (event.playlistId !== Number(playlistId) || !isRunning(event, now)) continue;
        if (build && !hasLtm(event.playlist, build)) continue;
        const ruleset = scoringOf(event);
        const player = (event.players[accountId] ??= { matches: [] });
        if (matchId && player.matches.some((match) => match.matchId === matchId)) continue;
        if (player.matches.length >= ruleset.countedMatches) continue;
        const points = matchPoints(ruleset, { place, kills });
        player.matches.push({ matchId, place, kills, points, at: now.toISOString() });
        scored.push({ eventId: event.id, points });
      }
      if (scored.length) save();
      return scored;
    }
  };
}

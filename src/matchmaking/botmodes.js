import { ltmIds, ltmOfPlaylist, playlistIdOfName } from "../events/ltms.js";
import { effectiveBots } from "../tournaments/store.js";

// The game modes the player bots play in (Core-Backend #352): the admin panel's Player bots card turns them on or off by
// mode, as its Battle Royale Game Modes list has them (the default Solo, Duos and Squads, then every LTM of
// events/ltms.js), in the settings' bots.modes: {<mode id>: boolean}. Every mode is on by default, as the bots were in
// every mode before the setting; a settings file from before it, and a mode added to Core later, keep them on. A match
// of a mode that is off plays without the panel's bots: the warmup answer (services/matchmaking/warmup.js) sends none,
// as with Force player AIs and Fill players' teams with bots both off. A tournament event's own bots (#282) are its own
// switch and win over this one, as they win over the rest of the panel's.
const defaultModeOfPlaylist = { 2: "solo", 10: "duo", 9: "squad" };
export const botModeIds = ["solo", "duo", "squad", ...ltmIds];
const known = new Set(botModeIds);

export const defaultBotModes = () => Object.fromEntries(botModeIds.map((id) => [id, true]));

// Each mode's switch: the given one when it is a boolean, else the current one (on unless it is false).
export function sanitizeBotModes(input, current = null) {
  const given = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return Object.fromEntries(botModeIds.map((id) => [id, typeof given[id] === "boolean" ? given[id] : current?.[id] !== false]));
}

// Each mode's own bot count (Core-Backend #352: "a different number of ais for each game mode"), in the settings'
// bots.modeCounts: {<mode id>: 0 to 100}. A mode without one plays with the shared count (bots.count), as every mode did
// before. Given: a whole number from 0 to 100 sets it, null or "" clears it, anything else keeps the current one. Only
// the count is per mode; the level, health, shield, fight chance and "Fill players' teams with bots" stay shared.
export const maxModeBots = 100;
export function sanitizeBotModeCounts(input, current = null) {
  const given = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const counts = {};
  for (const id of botModeIds) {
    const value = Object.hasOwn(given, id) ? given[id] : undefined;
    const number = typeof value === "string" && value.trim() ? Number(value) : value;
    if (value === null || value === "") continue;
    if (Number.isInteger(number) && number >= 0 && number <= maxModeBots) counts[id] = number;
    else if (Number.isInteger(current?.[id])) counts[id] = current[id];
  }
  return counts;
}

// Each mode's "Fill the lobby with bots" (Core-Backend #352: once the real players have joined, bots fill the match's
// remaining places up to its size), in the settings' bots.fillLobby: {<mode id>: true}. Off in every mode by default, so a
// settings file from before it plays as it did. Given: a boolean sets a mode's, anything else keeps the current one; only
// the modes it is on in are kept.
export function sanitizeBotFillLobby(input, current = null) {
  const given = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const fill = {};
  for (const id of botModeIds) {
    if (typeof given[id] === "boolean" ? given[id] : current?.[id] === true) fill[id] = true;
  }
  return fill;
}

// The mode of a match's playlist on a build: the default modes by their ids (Playlist_DefaultSolo/Duo/Squad, 2, 10 and 9),
// an LTM's by events/ltms.js (the build's, as 3.5.1 gave some ids to other modes). The playlist is its id (a number, or
// its digits) or, from 4.4's buckets and 5.30's game mode, its PlaylistName. null for a playlist Core doesn't know.
export function botModeOf(playlist, build) {
  if (playlist === null || playlist === undefined || playlist === "") return null;
  const number = Number(playlist);
  const playlistId = Number.isInteger(number) && number > 0 ? number : playlistIdOfName(String(playlist), build);
  if (!Number.isInteger(playlistId) || playlistId <= 0) return null;
  if (Object.hasOwn(defaultModeOfPlaylist, playlistId)) return defaultModeOfPlaylist[playlistId];
  const id = ltmOfPlaylist(playlistId, build)?.id ?? null;
  return id && known.has(id) ? id : null;
}

// Whether the panel's bots play in a mode: on unless its switch is off. A match whose mode isn't known (no playlist yet,
// or one Core has no mode for) keeps them, as before the setting.
export const botsInMode = (bots, mode) => mode === null || mode === undefined || bots?.modes?.[mode] !== false;

// The bots a match of the mode plays with, in the settings' shape: in a mode that is off, Force player AIs and Fill
// players' teams with bots are off; in one that fills its lobby, Force player AIs with the most bots a match takes; in one
// with a count of its own, that count.
// Filling the lobby asks the gameserver for 100 bots and leaves the rest to its cap (CoreV2 CoreAthenaBotManager
// WantedBotCount), the one place that knows the match: bots = min(asked, MatchCapacity - connected players - bots on
// players' teams), MatchCapacity being the playlist's MaxPlayers (100; Team Terror's 64, Food Fight's 48, Playground's 4),
// in whole teams of the playlist's team size and never more teams than no player is on. It re-checks it every frame until
// the bus leaves and takes out the surplus (RemoveSurplusBots), so a player who connects later (a late party, or one still
// loading in) takes a bot's place and the match never goes past its size; the bots come in once a player is connected.
// The backend can't count it alone: it knows the players it placed, not the playlist's team size, the players connected
// or the bots on their teams. A gameserver from before the setting caps the same way (CoreV2 #256; at 100 before 3.5's
// playlist MaxPlayers).
export function botsForMode(bots, mode) {
  if (!bots) return null;
  if (!botsInMode(bots, mode)) return { ...bots, forcePlayerAIs: false, fillPlayerTeams: false };
  if (mode !== null && mode !== undefined && bots.fillLobby?.[mode] === true) return { ...bots, forcePlayerAIs: true, count: maxModeBots };
  const own = mode === null || mode === undefined ? undefined : bots.modeCounts?.[mode];
  return Number.isInteger(own) ? { ...bots, count: own } : bots;
}

// The bots a match plays with: its tournament event's own ({enabled, count}, tournaments/store.js botsFor) over the panel's
// when it has them, else the panel's in the match's mode.
// A match with a custom matchmaking key (#186) plays without the panel's bots (#352) while "No bots in custom matchmaking
// matches" (bots.noCustomMatchBots) is on, its default: Force player AIs, the count, team filling and lobby filling off.
// A tournament event's own bots win over it, as over the rest of the panel's; a match without a key is unchanged.
export const noBotsInCustomMatch = (bots, customKey) => !!customKey && bots?.noCustomMatchBots !== false;
export function matchBots(general, event, mode, customKey = null) {
  if (event) return effectiveBots(general, event);
  if (general && noBotsInCustomMatch(general, customKey)) return { ...general, forcePlayerAIs: false, count: 0, fillPlayerTeams: false, fillLobby: {} };
  return botsForMode(general, mode);
}

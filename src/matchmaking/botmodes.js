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
// players' teams with bots are off.
export function botsForMode(bots, mode) {
  if (!bots || botsInMode(bots, mode)) return bots ?? null;
  return { ...bots, forcePlayerAIs: false, fillPlayerTeams: false };
}

// The bots a match plays with: its tournament event's own ({enabled, count}, tournaments/store.js botsFor) over the panel's
// when it has them, else the panel's in the match's mode.
export const matchBots = (general, event, mode) => (event ? effectiveBots(general, event) : botsForMode(general, mode));

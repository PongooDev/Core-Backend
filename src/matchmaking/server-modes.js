import { versionOf } from "../builds/detect.js";
import { ltmOfBucketPlaylist, ltms } from "../events/ltms.js";
import { inIpRanges, ipRange, normalizeAddress } from "../network.js";

// Server game modes (Core-Backend #227): which game modes each gameserver hosts, so one backend can run, say, a Creative
// server, a Solo server and a Save the World server side by side (Core-Launcher #20's Creative-only servers are such a
// rule). It is Core's own: Epic's matchmaking had its own pools per playlist, which nothing in the game asks a backend for.
//
// The admin panel's Matchmaking tab keeps a list of rules, [{ address, port, modes }]: a server's IP or CIDR range
// (network.js ipRange), the server's game port or null for any, and the modes it hosts. A server matches a rule when the
// IP its session was registered from (sessions.js sourceAddress, as the region hosting IPs and custom matchmaking servers
// see it; this PC's servers come from 127.0.0.1) is in the rule's range and, when the rule names a port, its session's
// serverPort is that port (the launcher's servers on one PC share an IP and differ by port). A server that matches one or
// more rules hosts only their modes; a server no rule matches hosts any mode, as before.
//
// A mode is one of:
// - "battleRoyale": every Battle Royale playlist but Creative.
// - "solo", "duo", "squad": the default playlists, Playlist_DefaultSolo, _Duo and _Squad (2, 10 and 9).
// - "playground": Playlist_Playground (4.2's Playground and 5.10's to 7.00's Playground v2, 35).
// - "creative": 7.00's Creative, Playlist_PlaygroundV2 (35 too).
// - "saveTheWorld": Save the World's missions, which find their server with the session search (sessions.js), not the
//   matchmaking service.
// - a limited-time mode: its playlist's name ("Playlist_50v50"), which covers every build's playlist of that name, or for
//   one with no playlist asset (before 3.5.1) its id in events/ltms.js ("fiftyFifty", 1.10's 50v50).
// - any other playlist, by its name ("Playlist_Barrier") or its PlaylistId ("204", which every playlist with that id
//   matches, Playground's and Creative's 35 alike).
// A Battle Royale match's playlist comes from its bucket: up to 4.2 the bucket gives the playlist's id, from 4.4 its name
// (service.js parseBucket), and each is resolved on the party's build (events/ltms.js ltmOfBucketPlaylist), so a rule holds
// on every build.
export const maxServerModeRules = 64;
const maxModes = 128;

export const battleRoyaleMode = "battleRoyale";
export const saveTheWorldMode = "saveTheWorld";
const defaultPlaylists = {
  solo: { id: 2, name: "Playlist_DefaultSolo", label: "Solo" },
  duo: { id: 10, name: "Playlist_DefaultDuo", label: "Duos" },
  squad: { id: 9, name: "Playlist_DefaultSquad", label: "Squads" }
};
const namedModes = { playground: "Playlist_Playground", creative: "Playlist_PlaygroundV2" };
const creativeName = namedModes.creative.toLowerCase();
const modeAliases = {
  battleroyale: battleRoyaleMode, br: battleRoyaleMode, savetheworld: saveTheWorldMode, stw: saveTheWorldMode,
  solo: "solo", solos: "solo", duo: "duo", duos: "duo", squad: "squad", squads: "squad", playground: "playground", creative: "creative"
};
// A playlist's name as a rule keeps it: a mode's key for the default playlists, Playground and Creative.
const keyOfPlaylistName = new Map([
  ...Object.entries(defaultPlaylists).map(([key, playlist]) => [playlist.name.toLowerCase(), key]),
  ...Object.entries(namedModes).map(([key, name]) => [name.toLowerCase(), key])
]);
const knownPlaylistNames = new Map(ltms.filter((ltm) => ltm.playlistName).map((ltm) => [ltm.playlistName.toLowerCase(), ltm.playlistName]));
const ltmById = new Map(ltms.map((ltm) => [ltm.id.toLowerCase(), ltm]));
const canonicalName = (name) => keyOfPlaylistName.get(name.toLowerCase()) ?? knownPlaylistNames.get(name.toLowerCase()) ?? name;

// A mode as a rule keeps it (above), from what the panel or a config file gives: a mode's key in any case ("Duos" and
// "stw" too), a limited-time mode's id, a playlist's name or a PlaylistId; null for anything else.
export function serverModeOf(value) {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const lower = text.toLowerCase();
  if (Object.hasOwn(modeAliases, lower)) return modeAliases[lower];
  if (/^\d{1,9}$/.test(text)) return String(Number(text));
  if (/^playlist_[a-z0-9_]{1,80}$/i.test(text)) return canonicalName(text);
  const ltm = ltmById.get(lower);
  if (ltm) return ltm.playlistName ? canonicalName(ltm.playlistName) : ltm.id;
  return null;
}

// A rule's server: "203.0.113.7", "203.0.113.0/24", "203.0.113.7:7777" or "[2001:db8::7]:7777" (the address's port is
// the rule's unless the rule names one itself), as { range (null when it isn't one), port (null for any, NaN when it
// isn't one) }.
function splitServer(address, port) {
  const text = typeof address === "string" ? address.trim() : "";
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(text);
  const withPort = !bracketed && /^([^:/]+):(\d+)$/.exec(text);
  const given = port === undefined || port === null || port === "" ? (bracketed?.[2] ?? withPort?.[2] ?? null) : port;
  const number = given === null ? null : Number(given);
  // ::1 is this PC, as a session's IP is kept (sessions.js sourceAddress: 127.0.0.1).
  return { range: ipRange(normalizeAddress(bracketed ? bracketed[1] : withPort ? withPort[1] : text)),
    port: number === null || (Number.isInteger(number) && number >= 1 && number <= 65535) ? number : NaN };
}
const serverOf = (address, port) => {
  const { range, port: number } = splitServer(address, port);
  return range === null || Number.isNaN(number) ? null : { address: range, port: number };
};

// What a sent rule gets wrong, for the admin panel's error, or null.
export function serverModeRuleProblem(entry) {
  const address = entry?.address;
  const { range, port } = splitServer(address, entry?.port);
  if (range === null) return `Not an IP address or CIDR range: ${String(address ?? "")}`;
  if (Number.isNaN(port)) return `Not a port (1 to 65535): ${String(entry?.port ?? address)}`;
  const modes = Array.isArray(entry?.modes) ? entry.modes : [];
  if (!modes.length) return `Pick at least one game mode for ${String(address)}`;
  if (modes.length > maxModes) return `At most ${maxModes} game modes can be listed for one server`;
  const unknown = modes.find((mode) => serverModeOf(mode) === null);
  if (unknown !== undefined) return `Not a game mode, playlist name or playlist id: ${String(unknown)}`;
  return null;
}

// The rules kept from a saved or sent list: the valid ones (each mode once, as serverModeOf keeps it), up to
// maxServerModeRules; undefined when it isn't a list.
export function serverModeRules(list) {
  if (!Array.isArray(list)) return undefined;
  const kept = [];
  for (const entry of list) {
    const server = serverOf(entry?.address, entry?.port);
    const modes = [...new Set((Array.isArray(entry?.modes) ? entry.modes : []).map(serverModeOf).filter(Boolean))].slice(0, maxModes);
    if (server === null || !modes.length) continue;
    kept.push({ ...server, modes });
    if (kept.length >= maxServerModeRules) break;
  }
  return kept;
}

// The playlist of a Battle Royale bucket (service.js parseBucket's { playlistId, playlistName }) on a build: { mode (a
// default playlist's key), ltm (its events/ltms.js id), name (lowercased), id }.
export function bucketPlaylist({ playlistId = null, playlistName = null } = {}, build = null) {
  const named = playlistName ? String(playlistName).toLowerCase() : null;
  const known = Object.entries(defaultPlaylists).find(([, playlist]) => (named ? playlist.name.toLowerCase() === named : playlist.id === playlistId));
  if (known) return { mode: known[0], ltm: null, name: known[1].name.toLowerCase(), id: known[1].id };
  const ltm = ltmOfBucketPlaylist({ playlistId, playlistName }, build ?? undefined);
  return { mode: null, ltm: ltm?.id ?? null, name: named ?? ltm?.playlistName?.toLowerCase() ?? null, id: playlistId ?? null };
}
// Save the World's: no playlist.
export const saveTheWorldPlaylist = Object.freeze({ mode: saveTheWorldMode, ltm: null, name: null, id: null });

// Whether a rule's mode takes a playlist (bucketPlaylist's, or saveTheWorldPlaylist).
function takes(mode, playlist) {
  if (mode === saveTheWorldMode) return playlist.mode === saveTheWorldMode;
  if (playlist.mode === saveTheWorldMode) return false;
  if (mode === battleRoyaleMode) return playlist.name !== creativeName;
  if (Object.hasOwn(defaultPlaylists, mode)) return playlist.mode === mode;
  if (Object.hasOwn(namedModes, mode)) return playlist.name === namedModes[mode].toLowerCase();
  if (/^\d+$/.test(mode)) return playlist.id === Number(mode);
  if (/^playlist_/i.test(mode)) return playlist.name === mode.toLowerCase();
  return playlist.ltm === mode;
}

const rulesOf = (list) => (Array.isArray(list) ? list : []);
// The modes the rules give a server at this address and game port, each once, or null when no rule names the server
// (it hosts any mode).
export function serverModesOf(address, port, list) {
  const matching = rulesOf(list).filter((rule) => inIpRanges(address, [rule.address]) && (rule.port === null || rule.port === undefined || rule.port === Number(port)));
  return matching.length ? [...new Set(matching.flatMap((rule) => rule.modes))] : null;
}

// Whether a server at this address and game port may host a playlist.
export function serverHosts(address, port, playlist, list) {
  const modes = serverModesOf(address, port, list);
  return modes === null || modes.some((mode) => takes(mode, playlist));
}

// The admin panel's choices: the game modes, then each limited-time mode's playlist (its name's, across builds) or, for
// one with no playlist asset, the mode itself. [{ value, label, detail, group }].
const boundText = (bound) => (typeof bound === "number" ? versionOf(bound) ?? String(bound) : String(bound));
const buildsText = (entries) => {
  const first = boundText(entries[0].builds[0]);
  const last = boundText(entries.at(-1).builds[1]);
  return first === last ? first : `${first} – ${last}`;
};
// One name for a playlist several builds name differently: the words they all start with, cut before a parenthesis,
// and the team size they all end with ("Sniper Shootout (Solo)" for "Sniper Shootout v2 (Solo)" and "Sniper Shootout
// (Season 7, Solo)"); the first name when they share no word, the name itself when there is one.
function sharedName(names) {
  if (names.length === 1) return names[0];
  const words = names.map((name) => name.split(" "));
  const shared = [];
  for (let index = 0; words.every((list) => index < list.length && list[index] === words[0][index]); index++) shared.push(words[0][index]);
  const open = shared.findIndex((word) => word.startsWith("("));
  const text = (open >= 0 ? shared.slice(0, open) : shared).join(" ").replace(/[\s,;:(-]+$/, "");
  if (!text) return names[0];
  const sizes = names.map((name) => /[(\s,](Solo|Duos?|Squads?)\)$/.exec(name)?.[1] ?? null);
  return sizes[0] && sizes.every((size) => size === sizes[0]) ? `${text} (${sizes[0]})` : text;
}
let optionCache = null;
export function serverModeOptions() {
  if (optionCache) return optionCache;
  const of = (key) => ltms.filter((ltm) => ltm.playlistName?.toLowerCase() === namedModes[key].toLowerCase());
  const options = [
    { value: battleRoyaleMode, label: "Battle Royale", detail: "Every Battle Royale mode but Creative", group: "Game modes" },
    ...Object.entries(defaultPlaylists).map(([value, playlist]) => ({ value, label: playlist.label, detail: `${playlist.name}, ${playlist.id}`, group: "Game modes" })),
    { value: "playground", label: "Playground", detail: `${namedModes.playground} · ${buildsText(of("playground"))}`, group: "Game modes" },
    { value: "creative", label: "Creative", detail: `${namedModes.creative} · ${buildsText(of("creative"))}`, group: "Game modes" },
    { value: saveTheWorldMode, label: "Save the World", detail: "Its missions' servers (the session search)", group: "Game modes" }
  ];
  const groups = new Map();
  for (const ltm of ltms) {
    const value = ltm.playlistName ? canonicalName(ltm.playlistName) : ltm.id;
    if (Object.hasOwn(namedModes, value) || Object.hasOwn(defaultPlaylists, value)) continue;
    groups.set(value, [...(groups.get(value) ?? []), ltm]);
  }
  const limited = [...groups].map(([value, entries]) => ({ value, label: sharedName([...new Set(entries.map((ltm) => ltm.name))]),
    builds: buildsText(entries), detail: [entries[0].playlistName, buildsText(entries)].filter(Boolean).join(" · "), group: "Limited-time modes" }));
  // Two playlists with one name (1.10's 50v50 and 3.5.1's Playlist_50v50) are told apart by their builds, then by their
  // playlist's name.
  const distinguish = (suffix) => {
    const counts = new Map();
    for (const option of limited) counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
    for (const option of limited) {
      if (counts.get(option.label) > 1) option.label = `${option.label} (${suffix(option)})`;
    }
  };
  distinguish((option) => option.builds);
  distinguish((option) => option.value);
  for (const option of limited) delete option.builds;
  optionCache = [...options, ...limited];
  return optionCache;
}

// A mode's name for the panel and the console: its choice's label, a playlist id as "Playlist 204", a name as it is.
export function serverModeLabel(mode) {
  const option = serverModeOptions().find((entry) => entry.value === mode);
  if (option) return option.label;
  return /^\d+$/.test(String(mode)) ? `Playlist ${mode}` : String(mode);
}

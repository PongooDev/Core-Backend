import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";
import { defaultHostingIps, hostingIp, hostingIps } from "../network.js";
import { defaultBattlePass, sanitizeBattlePass } from "../battlepass/season1.js";
import { defaultContentUpdates, sanitizeContentUpdates } from "../events/contentupdates.js";
import { defaultMeteorStrikePhase, sanitizeMeteorStrike } from "../events/meteorstrike.js";
import { regionHostingIps, regionList } from "../matchmaking/regions.js";
import { customMatchServers } from "../matchmaking/custom-servers.js";
import { allowedBuildList } from "../builds/allowed.js";
import { battleRoyaleSeasons } from "../builds/detect.js";

// The Battle Royale modes a region's server limits (serverLimits) count, each 0 (no limit) by default.
const limitModes = ["solo", "duo", "squad", "fiftyFifty", "shootingTest", "highExplosives", "sneakySilencers", "sniperShootout",
  "speedyStorm", "takeToTheSkies", "lotsaLoot", "blitz", "fiveByTwenty", "highJump", "useItOrLoseIt", "steadyStorm", "solidGold", "skySupply", "shotguns",
  "blitzSolo", "blitzDuo"];
const noLimits = () => Object.fromEntries(limitModes.map((mode) => [mode, 0]));

// 3.5.1's (CL-4000805) own LTMs (events/ltms.js), whose switches the matchmaking modes keep beside the others'.
const playlistAssetLtms = ["fiftyFiftyV2", "highExplosivesSolo", "highExplosivesSquads", "sniperShootoutSolo", "sniperShootoutDuos",
  "sniperShootoutSquads", "skySupplyDuos", "skySupplySquads", "solidGoldSolo", "impactSolo", "impactDuos", "impactSquads",
  // 4.1's (CL-4053532) Infinity Gauntlet, its new mode, on there whatever its switch.
  "infinityGauntlet",
  // Season 4's modes of 4.2 on (Core-Backend #258): 4.2's (CL-4072250) Solo Showdown, Close Encounters (Squads, Solo, Duos)
  // and Solid Gold v2 Duos; the later ones for when Core has those builds.
  "soloShowdown", "closeEncounters", "closeEncountersSolo", "closeEncountersDuos", "solidGoldDuos", "blitzV2", "sniperShootoutV3",
  "teamsOf20V2", "playground"];
// Close Encounters' original date (Core-Backend #258, events/ltms.js): the whole of 25 May 2018, or one hour of it (0 to 23,
// on the season replay's clock), as Epic ran it.
export function closeEncountersValue(input, current = { wholeDay: true, hour: 0 }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ...current };
  const hour = Number(input.hour);
  return { wholeDay: typeof input.wholeDay === "boolean" ? input.wholeDay : current.wholeDay !== false,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : current.hour ?? 0 };
}

// Every Battle Royale season's start, unset. Each season Core knows has one (builds/detect.js): a season left out was never
// kept, so a season anchored to its first served day (Season 4 on 4.0, until this) started again on every day it was
// asked about, its shop stuck on its first day and its featured countdown at the whole season (72 days).
const defaultSeasonStarts = () => Object.fromEntries(battleRoyaleSeasons.map(({ season }) => [String(season), null]));

const defaults = {
  requirePassword: false,
  allowRegistration: true,
  // Whether the portal and the admin panel show cosmetics' pictures, loaded from fortnite-api.com (portal/images.js; #249).
  showItemImages: true,
  allowAutoRegistration: true,
  // Whether the seasonal events (events/events.js) run on the builds that shipped them (the admin panel's switch).
  seasonalEvents: true,
  // V-Bucks for Battle Royale matches (Core-Backend #100, #124, services/fortnite/battleroyale.js): off unless turned on,
  // then battleRoyaleRewards' amounts for each of solo, duos, squads and 50v50 (rewardModes): perKill for each kill, perWin
  // for a win (place 1) and placements, [{top, vbucks}], of which a place gets the best one it is within, not their
  // sum. Nothing by default.
  battleRoyaleVbucks: false,
  battleRoyaleRewards: null,
  // The Store tab's V-Bucks packs (Core-Backend #223, store/currency.js): a simulated real-money purchase that gives the
  // pack's V-Bucks for free. On by default: the issue asked for them, and the admin panel can already give any amount.
  vbuckPacks: true,
  // How those offers are paid (Core-Backend #248, services/fortnite/purchase.js): "free", the purchase page's Complete purchase
  // button, or "code", a purchase code (store/purchasecodes.js) the page asks for and the admin panel hands out.
  purchaseMode: "free",
  // Storm Shield structure limits (Core-Backend #115, services/fortnite/structurelimit.js): how many player-built
  // pieces and traps a Storm Shield holds before building is refused (its game state's MaxPlayerStructures, 3000 in
  // the game). structureLimit is every Storm Shield's (null: the game's own), and structureLimits holds a Storm
  // Shield's own (stonewood, plankerton, cannyValley, twinePeaks), which wins over it. CoreV2's gameserver asks for its
  // Storm Shield's when the zone loads and again while it runs.
  structureLimit: null,
  structureLimits: {},
  // Who may use cheats on a Core gameserver (CoreV2 #138, services/fortnite/cheats.js): "everyone" (every player, as
  // since CoreV2 #65), "admins" (only the accounts in cheatAccounts, by account id or display name) or "off". The
  // gameserver asks for each player before it runs their "cheat" command, and again every 30 seconds.
  cheats: "everyone",
  cheatAccounts: [],
  // Battle Royale's matchmaking waits (Core-Backend #122, matchmaking/service.js and services/matchmaking/warmup.js):
  // how long a match forming on a free gameserver takes in more parties before it is assigned (the ETA the queue counts
  // down), how long the warmup island lasts before the bus leaves on a CoreV2 gameserver (null: the game's own), and
  // whether a match takes more parties during its warmup (late joining, CoreV2's gameserver opening it). And whether a
  // player whose region has no server at all plays in another region (Core-Backend #121) or waits for one of theirs
  // (#123: off, matchmaking/service.js and the session search, matchmaking/sessions.js). The warmup is 120 s by default
  // (CoreV2 #256): the gameserver brings player bots in one at a time, at most one every 0.5 s, up to 20 s before the
  // bus, so a full lobby of 99 bots needs about 50 s of it once the first player is on the island, with room to spare.
  // A settings file keeps the length it saved (null too: the game's).
  matchmakingGatherSeconds: 10,
  warmupSeconds: 120,
  lateJoin: false,
  regionFallback: true,
  // Battle Royale player bots (CoreV2 #233): Core's backport of Epic's player bots, for builds without native ones (every
  // build before 8.30). Off by default. fillPlayerTeams ("Fill players' teams with bots") puts bots in the empty places on
  // the teams of players whose party fills, in duos and squads; unlike forcePlayerAIs it isn't tied to the backport.
  bots: { forcePlayerAIs: false, count: 0, level: 5, startingHealth: 100, startingShield: 0, eliminationsCountForQuests: true, botFightChance: 30, fillPlayerTeams: false },
  // 1.7.2 to 2.4.2's match start countdown (Core-Backend #160, matchmaking/service.js showsMatchStart): while a match
  // forms, the matchmaking panel shows "Match starting in 0:25... / Players Connected: 4", as Epic's service had it.
  matchStartCountdown: true,
  // The seconds the countdown adds for a forming match's players to reach the island from Play (#167): 0 to 120.
  matchStartBufferSeconds: 25,
  // Season 3's Twitch Prime pack (Core-Backend #229, profiles/athena.js twitchPrimeCosmetics): the Sub Commander outfit and
  // the Slipstream glider, given to a player whose athena profile loads on a 3.x build. Off by default.
  twitchPrimePack: false,
  // The server regions (Core-Backend #142, matchmaking/regions.js servedRegions): a server whose region (its -McpRegion)
  // is one of these takes the players of all of them, each match still in its own region. [] (or one region): every
  // server takes only its own region's. A single region's code, as a string, is taken as that one region.
  serverRegions: [],
  // Trusted Hosting IPs (Core-Backend #125, network.js allowsHosting): other PCs whose gameservers may host for this
  // backend, each an IP address. This PC (loopback) always may; nobody else unless listed.
  allowedHostingIps: defaultHostingIps,
  // Each region's hosting IPs (Core-Backend #227, matchmaking/regions.js regionAllowsAddress): { EU: ["203.0.113.0/24"] },
  // the IPs and CIDR ranges a gameserver hosting for the region must come from. A region left out takes any IP.
  regionHostingIps: {},
  // Custom matchmaking servers (#227, matchmaking/custom-servers.js): [{ address, keys, accounts }], gameservers kept for
  // custom matchmaking keys' matches and never used for public ones. customMatchFallback: whether a custom match with
  // servers of its own plays on a public server when none of its own is free (off: it waits for one).
  customMatchServers: [],
  customMatchFallback: false,
  // The builds that may use this backend (Core-Backend #164, builds/allowed.js): null for all of them, else their
  // changelists and "other" for builds Core doesn't know. A refused build's version check answers HARD_UPDATE, and its
  // logins and matchmaking tickets are refused; gameservers are exempt.
  allowedBuilds: null,
  defaultFoundersAccess: true,
  // Admin from other devices (Core-Backend #134, admin/local.js createAdminGate): off, the admin panel answers only this PC.
  // On, a device an admin credential allows may sign in. Only this PC can switch it.
  remoteAdmin: false,
  // Full customizable events configuration (Core-Backend #66, #129, events/events.js)
  events: {
    mode: "auto", // "auto" | "force_fortnitemares" | "force_mutantstorms" | "force_winter2017" | "custom" | "off"
    customFlags: [],
    hexsylvaniaGates: "standard", // "standard" | "open"
    candyMultiplier: 1.0,
    stormAlertQuota: 10,
    stormTicketMultiplier: 1.0,
    candyPerLlama: 500,
    autoConvertCandy: true,
    snowflakePerLlama: 1000,
    autoConvertStormTickets: true,
    rotationHour: 0,
    weeklyDurationDays: 7,
    customSeasonEnd: null,
    // Each season's replay start, its day 1 ("YYYY-MM-DD", store/itemshop.js seasonStart): Season 2's is set the first
    // day the backend serves it, and Season 3's and 4's; null is the default start.
    seasonStarts: defaultSeasonStarts(),
    calendarCacheMinutes: 60,
    // Season 2's content updates (events/contentupdates.js): "season" by their dates on its replay, or "all"; and
    // per-update "on" / "off" overrides.
    contentUpdates: defaultContentUpdates,
    // 3.6's Season 3 finale (events/meteorstrike.js): "none", "broadcast", "meteors" or "impact".
    meteorStrike: defaultMeteorStrikePhase
  },
  battlepass: defaultBattlePass,
  matchmakingModes: {
    solo: true,
    duo: true,
    squad: true,
    fiftyFifty: true,
    // The event queues' limited-time modes (events/ltms.js; Shooting Test #1, events/shootingtest.js): off until an admin
    // turns them on.
    shootingTest: false,
    highExplosives: false,
    sneakySilencers: false,
    sniperShootout: false,
    // The event queues Epic never ran in Seasons 1 and 2 (Core-Backend #191), off too.
    speedyStorm: false,
    takeToTheSkies: false,
    lotsaLoot: false,
    blitz: false,
    // 3.0's new playlists (Season 3), off too.
    fiveByTwenty: false,
    highJump: false,
    useItOrLoseIt: false,
    steadyStorm: false,
    solidGold: false,
    skySupply: false,
    shotguns: false,
    // 3.1's Blitz children (Blitz Solo and Duo), off too.
    blitzSolo: false,
    blitzDuo: false,
    // 3.5.1's own playlists (FortPlaylistAthena assets), off too but 50v50 v2, 3.5.1's and 3.5.2's new mode, on there whatever
    // its switch.
    ...Object.fromEntries(playlistAssetLtms.map((id) => [id, false]))
  },
  // The LTMs' original dates (Core-Backend #190, events/ltms.js): on, each runs only in its original window on the
  // season's replay and on the builds Epic ran it on, whatever matchmakingModes says of it.
  ltmOriginalDates: false,
  // Close Encounters with Original dates on (Core-Backend #258): its whole day, or the hour of it chosen.
  ltmCloseEncounters: { wholeDay: true, hour: 0 },
  // Season 3's weekly challenges all at once (Core-Backend #207, profiles/challenges.js), not a week at a time on the
  // season's replay.
  challengesAllUnlocked: false,
  // How each season's weekly challenges unlock (Core-Backend #219, profiles/challenges.js challengeUnlock), by season:
  // {season3: {mode: "original" | "interval" | "manual", startDate, intervalDays, manualWeeks, weeksAvailable}}. A
  // season without one keeps its original dates (or challengesAllUnlocked).
  challengeUnlock: {},
  serverLimits: { NA: noLimits(), EU: noLimits(), OCE: noLimits(), BR: noLimits(), ASIA: noLimits() }
};

export const defaultMatchmakingModes = defaults.matchmakingModes;
export const defaultServerLimits = defaults.serverLimits;
export const defaultWarmupSeconds = defaults.warmupSeconds;

export function sanitizeMatchmakingModes(input, current = defaultMatchmakingModes) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return JSON.parse(JSON.stringify(current));
  return {
    solo: typeof input.solo === "boolean" ? input.solo : (current.solo !== false),
    duo: typeof input.duo === "boolean" ? input.duo : (current.duo !== false),
    squad: typeof input.squad === "boolean" ? input.squad : (current.squad !== false),
    fiftyFifty: typeof input.fiftyFifty === "boolean" ? input.fiftyFifty : (current.fiftyFifty !== false),
    shootingTest: typeof input.shootingTest === "boolean" ? input.shootingTest : (current.shootingTest === true),
    highExplosives: typeof input.highExplosives === "boolean" ? input.highExplosives : (current.highExplosives === true),
    sneakySilencers: typeof input.sneakySilencers === "boolean" ? input.sneakySilencers : (current.sneakySilencers === true),
    sniperShootout: typeof input.sniperShootout === "boolean" ? input.sniperShootout : (current.sniperShootout === true),
    ...Object.fromEntries(["speedyStorm", "takeToTheSkies", "lotsaLoot", "blitz", "fiveByTwenty", "highJump", "useItOrLoseIt", "steadyStorm", "solidGold",
      "skySupply", "shotguns", "blitzSolo", "blitzDuo", ...playlistAssetLtms].map((id) =>
      [id, typeof input[id] === "boolean" ? input[id] : (current[id] === true)]))
  };
}

export function sanitizeServerLimits(input, current = defaultServerLimits) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return JSON.parse(JSON.stringify(current));
  const result = JSON.parse(JSON.stringify(current));
  const regions = ["NA", "EU", "OCE", "BR", "ASIA"];
  for (const r of regions) {
    if (input[r] && typeof input[r] === "object" && !Array.isArray(input[r])) {
      result[r] = result[r] || noLimits();
      for (const m of limitModes) {
        if (input[r][m] !== undefined) {
          const val = Number(input[r][m]);
          result[r][m] = (Number.isInteger(val) && val >= 0 && val <= 1000) ? val : 0;
        }
      }
    }
  }
  return result;
}

export const defaultEvents = defaults.events;

export const eventModes = ["auto", "force_fortnitemares", "force_mutantstorms", "force_winter2017", "custom", "off"];

function sanitizeEvents(input, current = defaults.events) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return JSON.parse(JSON.stringify(current));
  const result = JSON.parse(JSON.stringify(current));

  if (typeof input.mode === "string" && eventModes.includes(input.mode.trim().toLowerCase())) {
    result.mode = input.mode.trim().toLowerCase();
  }

  if (Array.isArray(input.customFlags)) {
    const seen = new Set();
    const flags = [];
    for (const flag of input.customFlags) {
      const trimmed = typeof flag === "string" ? flag.trim() : "";
      if (trimmed && trimmed.length <= 64 && !seen.has(trimmed.toLowerCase())) {
        seen.add(trimmed.toLowerCase());
        flags.push(trimmed);
      }
    }
    result.customFlags = flags;
  }

  if (typeof input.hexsylvaniaGates === "string") {
    const gateMode = input.hexsylvaniaGates.trim().toLowerCase();
    if (gateMode === "standard" || gateMode === "open") result.hexsylvaniaGates = gateMode;
  }

  if (input.candyMultiplier !== undefined) {
    const num = Number(input.candyMultiplier);
    if (!isNaN(num) && num >= 0.1 && num <= 10.0) result.candyMultiplier = Math.round(num * 100) / 100;
  }

  if (input.stormAlertQuota !== undefined) {
    const num = Number(input.stormAlertQuota);
    if (Number.isInteger(num) && num >= 1 && num <= 999) result.stormAlertQuota = num;
  }

  if (input.stormTicketMultiplier !== undefined) {
    const num = Number(input.stormTicketMultiplier);
    if (!isNaN(num) && num >= 0.1 && num <= 10.0) result.stormTicketMultiplier = Math.round(num * 100) / 100;
  }

  if (input.candyPerLlama !== undefined) {
    const num = Number(input.candyPerLlama);
    if (Number.isInteger(num) && num >= 100 && num <= 5000) result.candyPerLlama = num;
  }

  if (typeof input.autoConvertCandy === "boolean") {
    result.autoConvertCandy = input.autoConvertCandy;
  }

  if (input.snowflakePerLlama !== undefined) {
    const num = Number(input.snowflakePerLlama);
    if (Number.isInteger(num) && num >= 100 && num <= 5000) result.snowflakePerLlama = num;
  }

  if (typeof input.autoConvertStormTickets === "boolean") {
    result.autoConvertStormTickets = input.autoConvertStormTickets;
  }

  if (input.rotationHour !== undefined) {
    const num = Number(input.rotationHour);
    if (Number.isInteger(num) && num >= 0 && num <= 23) result.rotationHour = num;
  }

  if (input.weeklyDurationDays !== undefined) {
    const num = Number(input.weeklyDurationDays);
    if (Number.isInteger(num) && num >= 1 && num <= 30) result.weeklyDurationDays = num;
  }

  if (input.customSeasonEnd !== undefined) {
    if (input.customSeasonEnd === null || input.customSeasonEnd === "") {
      result.customSeasonEnd = null;
    } else if (typeof input.customSeasonEnd === "string") {
      const parsed = Date.parse(input.customSeasonEnd);
      if (!isNaN(parsed)) result.customSeasonEnd = new Date(parsed).toISOString();
    }
  }

  if (input.seasonStarts && typeof input.seasonStarts === "object" && !Array.isArray(input.seasonStarts)) {
    result.seasonStarts = { ...defaultSeasonStarts(), ...(result.seasonStarts ?? {}) };
    for (const season of Object.keys(defaultSeasonStarts())) {
      const value = input.seasonStarts[season];
      if (value === null || value === "") result.seasonStarts[season] = null;
      else if (typeof value === "string" && !isNaN(Date.parse(value))) result.seasonStarts[season] = new Date(Date.parse(value)).toISOString().slice(0, 10);
    }
  }

  if (input.contentUpdates !== undefined) {
    result.contentUpdates = sanitizeContentUpdates(input.contentUpdates, result.contentUpdates ?? defaultContentUpdates);
  }

  if (input.calendarCacheMinutes !== undefined) {
    const num = Number(input.calendarCacheMinutes);
    if (Number.isInteger(num) && num >= 5 && num <= 120) result.calendarCacheMinutes = num;
  }

  if (input.meteorStrike !== undefined) result.meteorStrike = sanitizeMeteorStrike(input.meteorStrike, result.meteorStrike ?? defaultMeteorStrikePhase);

  return result;
}

// Who may cheat: the modes, and how long one entry of cheatAccounts may be.
export const cheatModes = ["everyone", "admins", "off"];
const maxCheatAccount = 64;
const cheatMode = (value) => (typeof value === "string" && cheatModes.includes(value.trim().toLowerCase()) ? value.trim().toLowerCase() : undefined);

// cheatAccounts: account ids or display names, trimmed, without blanks or the same one twice (in any case); undefined
// when it isn't a list.
function cheatAccounts(list) {
  if (!Array.isArray(list)) return undefined;
  const seen = new Set();
  const result = [];
  for (const entry of list) {
    const name = typeof entry === "string" ? entry.trim() : "";
    if (!name || name.length > maxCheatAccount || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    result.push(name);
  }
  return result;
}

// The Storm Shields by their outpost item (UFortZoneTheme CloudSaveItemDefinition, OutpostCore_PvE_01..04).
export const stormShields = {
  stonewood: "Outpost:outpostcore_pve_01",
  plankerton: "Outpost:outpostcore_pve_02",
  cannyValley: "Outpost:outpostcore_pve_03",
  twinePeaks: "Outpost:outpostcore_pve_04"
};

// A structure limit: a whole number from 1 to maxStructureLimit, null for none (blank clears it), or undefined for
// anything else.
export const maxStructureLimit = 100000;
// challengeUnlock's seasons (Core-Backend #219): each given season's settings over its current ones. The weeks are held
// to the season's own count where they're used (profiles/challenges.js challengeUnlock).
const challengeModeNames = ["original", "interval", "manual"];
function challengeUnlockValue(input, current = {}) {
  if (!input || typeof input !== "object") return current;
  const result = { ...current };
  for (const [key, value] of Object.entries(input)) {
    if (!/^season\d+$/.test(key) || !value || typeof value !== "object") continue;
    const entry = { ...(current[key] ?? {}) };
    if (challengeModeNames.includes(value.mode)) entry.mode = value.mode;
    if (typeof value.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.startDate) && !Number.isNaN(Date.parse(`${value.startDate}T00:00:00Z`))) entry.startDate = value.startDate;
    const whole = (name, low, high) => {
      const num = Number(value[name]);
      if (value[name] !== undefined && value[name] !== null && Number.isInteger(num) && num >= low && num <= high) entry[name] = num;
    };
    whole("intervalDays", 1, 60);
    whole("manualWeeks", 0, 52);
    whole("weeksAvailable", 1, 52);
    result[key] = entry;
  }
  return result;
}

// The mode select tiles' pictures (Core-Backend #260, services/content/playlistimages.js): {playlistName: image}, each a
// non-empty string the admin route checked (an http(s) URL or an upload). undefined when there are none.
function playlistImageMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([playlistName, image]) => /^Playlist_\w{1,64}$/.test(playlistName)
    && typeof image === "string" && image.trim() && image.length <= 2048).map(([playlistName, image]) => [playlistName, image.trim()]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function structureLimitValue(value) {
  if (value === null || (typeof value === "string" && !value.trim())) return null;
  const limit = typeof value === "string" ? Number(value) : value;
  return Number.isInteger(limit) && limit >= 1 && limit <= maxStructureLimit ? limit : undefined;
}

// The Storm Shields' own limits in limits, over current: a valid one is set, null or blank removes it, anything else
// (or a name that isn't a Storm Shield) is ignored.
function structureLimits(limits, current = {}) {
  const result = { ...current };
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) return result;
  for (const name of Object.keys(stormShields)) {
    if (!(name in limits)) continue;
    const limit = structureLimitValue(limits[name]);
    if (limit === null) delete result[name];
    else if (limit !== undefined) result[name] = limit;
  }
  return result;
}

// The matchmaking waits: a gather time from 0 to maxGatherSeconds, a warmup from minWarmupSeconds to maxWarmupSeconds
// or null for the game's own (blank clears it), undefined for anything else.
export const maxGatherSeconds = 300;
export const minWarmupSeconds = 10;
export const maxWarmupSeconds = 1800;
function gatherSeconds(value) {
  const seconds = typeof value === "string" && value.trim() ? Number(value) : value;
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= maxGatherSeconds ? seconds : undefined;
}
export const maxMatchStartBufferSeconds = 120;
function matchStartBufferValue(value) {
  const seconds = typeof value === "string" && value.trim() ? Number(value) : value;
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= maxMatchStartBufferSeconds ? seconds : undefined;
}
// The player bots (CoreV2 #233): each field on its own, an invalid one keeping its previous value (base).
function botInteger(value, min, max, base) {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  return Number.isInteger(number) && number >= min && number <= max ? number : base;
}
function botsValue(value, base) {
  const given = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    forcePlayerAIs: typeof given.forcePlayerAIs === "boolean" ? given.forcePlayerAIs : base.forcePlayerAIs,
    count: botInteger(given.count, 0, 100, base.count),
    level: botInteger(given.level, 1, 10, base.level),
    startingHealth: botInteger(given.startingHealth, 1, 100, base.startingHealth),
    startingShield: botInteger(given.startingShield, 0, 100, base.startingShield),
    eliminationsCountForQuests: typeof given.eliminationsCountForQuests === "boolean" ? given.eliminationsCountForQuests : base.eliminationsCountForQuests,
    // The percent chance a bot takes on another bot it sees (CoreV2 #233); the gameserver doubles it late in a match.
    botFightChance: botInteger(given.botFightChance, 0, 100, base.botFightChance),
    // Bots on the teams of players whose party fills (CoreV2 #233), on or off whatever forcePlayerAIs is.
    fillPlayerTeams: typeof given.fillPlayerTeams === "boolean" ? given.fillPlayerTeams : base.fillPlayerTeams
  };
}
function warmupSecondsValue(value) {
  if (value === null || (typeof value === "string" && !value.trim())) return null;
  const seconds = typeof value === "string" ? Number(value) : value;
  return Number.isInteger(seconds) && seconds >= minWarmupSeconds && seconds <= maxWarmupSeconds ? seconds : undefined;
}

// A reward amount: a whole number of V-Bucks from 0 to maxReward, or undefined for anything else.
export const maxReward = 100000;
function rewardAmount(value) {
  const amount = typeof value === "string" && value.trim() ? Number(value) : value;
  return Number.isInteger(amount) && amount >= 0 && amount <= maxReward ? amount : undefined;
}

// The Battle Royale modes that pay V-Bucks, by their playlist: the stats' main playlists (stats/store.js) and 1.10's
// 50v50 (events/fiftyfifty.js), whose two teams place 1st and 2nd; no other playlist pays. A placement tier is "top"
// places 1 to maxPlacementTop, at most maxPlacementTiers of them a mode.
export const rewardModes = { solo: 2, duos: 10, squads: 9, fiftyFifty: 11 };
export const maxPlacementTop = 100;
export const maxPlacementTiers = 10;
const noRewards = () => Object.fromEntries(Object.keys(rewardModes).map((mode) => [mode, { perKill: 0, perWin: 0, placements: [] }]));

// A mode's placement tiers: whole places and amounts, one tier a place (the last given wins), from the best place
// down, without the ones that pay nothing; undefined when it isn't a list or anything in it is out of range, so a
// mistyped tier doesn't quietly drop.
function placementTiers(list) {
  if (!Array.isArray(list) || list.length > maxPlacementTiers) return undefined;
  const tiers = new Map();
  for (const tier of list) {
    const top = typeof tier?.top === "string" && tier.top.trim() ? Number(tier.top) : tier?.top;
    const vbucks = rewardAmount(tier?.vbucks);
    if (!Number.isInteger(top) || top < 1 || top > maxPlacementTop || vbucks === undefined) return undefined;
    tiers.set(top, vbucks);
  }
  return [...tiers].filter(([, vbucks]) => vbucks > 0).sort(([a], [b]) => a - b).map(([top, vbucks]) => ({ top, vbucks }));
}

// battleRoyaleRewards' amounts over current: each mode's perKill, perWin and placements are set when valid and kept
// otherwise.
function battleRoyaleRewards(rewards, current = noRewards()) {
  const result = JSON.parse(JSON.stringify(current));
  if (!rewards || typeof rewards !== "object" || Array.isArray(rewards)) return result;
  for (const mode of Object.keys(rewardModes)) {
    const given = rewards[mode];
    if (!given || typeof given !== "object") continue;
    for (const key of ["perKill", "perWin"]) result[mode][key] = rewardAmount(given[key]) ?? result[mode][key];
    result[mode].placements = placementTiers(given.placements) ?? result[mode].placements;
  }
  return result;
}

// #100's amounts, one kill and win amount for every playlist (vbucksPerKill, vbucksPerWin), as the same for each mode:
// what a settings.json from before #124 that had them on, or a config.json that still names them, means.
function legacyRewards(source, current) {
  const amounts = {};
  for (const [key, name] of [["vbucksPerKill", "perKill"], ["vbucksPerWin", "perWin"]]) {
    const amount = rewardAmount(source[key]);
    if (amount !== undefined) amounts[name] = amount;
  }
  return Object.keys(amounts).length
    ? battleRoyaleRewards(Object.fromEntries(Object.keys(rewardModes).map((mode) => [mode, amounts])), current)
    : current;
}

export function createSettingsStore(dataDir) {
  const file = dataDir && path.join(dataDir, "settings.json");
  const settings = {
    ...defaults,
    allowedHostingIps: [...defaults.allowedHostingIps],
    battleRoyaleRewards: noRewards(),
    events: JSON.parse(JSON.stringify(defaults.events)),
    battlepass: JSON.parse(JSON.stringify(defaults.battlepass)),
    matchmakingModes: JSON.parse(JSON.stringify(defaults.matchmakingModes)),
    serverLimits: JSON.parse(JSON.stringify(defaults.serverLimits)),
    bots: { ...defaults.bots }
  };

  if (file && fs.existsSync(file)) {
    try {
      const loaded = readJson(file);
      Object.assign(settings, loaded);
      if (typeof loaded.battleRoyaleVbucks !== "boolean") settings.battleRoyaleVbucks = defaults.battleRoyaleVbucks;
      if (typeof loaded.battleRoyaleNewsEnabled === "boolean") settings.battleRoyaleNewsEnabled = loaded.battleRoyaleNewsEnabled;
      if (typeof loaded.loginMessageEnabled === "boolean") settings.loginMessageEnabled = loaded.loginMessageEnabled;
      if (typeof loaded.defaultFoundersAccess === "boolean") settings.defaultFoundersAccess = loaded.defaultFoundersAccess;
      if (typeof loaded.remoteAdmin === "boolean") settings.remoteAdmin = loaded.remoteAdmin;
      if (typeof loaded.ltmOriginalDates !== "boolean") settings.ltmOriginalDates = defaults.ltmOriginalDates;
      settings.ltmCloseEncounters = closeEncountersValue(loaded.ltmCloseEncounters, defaults.ltmCloseEncounters);
      if (typeof loaded.challengesAllUnlocked !== "boolean") settings.challengesAllUnlocked = defaults.challengesAllUnlocked;
      settings.challengeUnlock = challengeUnlockValue(loaded.challengeUnlock, {});
      if (loaded.matchmakingModes && typeof loaded.matchmakingModes === "object") {
        settings.matchmakingModes = sanitizeMatchmakingModes(loaded.matchmakingModes, defaults.matchmakingModes);
      }
      if (loaded.serverLimits && typeof loaded.serverLimits === "object") {
        settings.serverLimits = sanitizeServerLimits(loaded.serverLimits, defaults.serverLimits);
      }
      // Before #124 the amounts were #100's, which kept paying only where they were turned on.
      settings.battleRoyaleRewards = loaded.battleRoyaleRewards && typeof loaded.battleRoyaleRewards === "object"
        ? battleRoyaleRewards(loaded.battleRoyaleRewards)
        : loaded.battleRoyaleVbucks === true ? legacyRewards(loaded, noRewards()) : noRewards();
      delete settings.vbucksPerKill;
      delete settings.vbucksPerWin;
      settings.structureLimit = structureLimitValue(loaded.structureLimit) ?? null;
      settings.structureLimits = structureLimits(loaded.structureLimits);
      settings.cheats = cheatMode(loaded.cheats) ?? defaults.cheats;
      settings.cheatAccounts = cheatAccounts(loaded.cheatAccounts) ?? [];
      settings.matchmakingGatherSeconds = gatherSeconds(loaded.matchmakingGatherSeconds) ?? defaults.matchmakingGatherSeconds;
      // A blank (null) length saved stays the game's; one missing or out of range is the default.
      const warmup = warmupSecondsValue(loaded.warmupSeconds);
      settings.warmupSeconds = warmup === undefined ? defaults.warmupSeconds : warmup;
      settings.lateJoin = loaded.lateJoin === true;
      settings.bots = botsValue(loaded.bots, defaults.bots);
      settings.regionFallback = loaded.regionFallback !== false;
      settings.vbuckPacks = loaded.vbuckPacks !== false;
      settings.purchaseMode = loaded.purchaseMode === "code" ? "code" : "free";
      settings.twitchPrimePack = loaded.twitchPrimePack === true;
      settings.matchStartCountdown = loaded.matchStartCountdown !== false;
      settings.matchStartBufferSeconds = matchStartBufferValue(loaded.matchStartBufferSeconds) ?? defaults.matchStartBufferSeconds;
      settings.serverRegions = regionList(loaded.serverRegions ?? loaded.serverRegion) ?? [];
      delete settings.serverRegion;
      settings.allowedHostingIps = hostingIps(loaded.allowedHostingIps) ?? [...defaults.allowedHostingIps];
      settings.regionHostingIps = regionHostingIps(loaded.regionHostingIps) ?? {};
      settings.customMatchServers = customMatchServers(loaded.customMatchServers) ?? [];
      settings.customMatchFallback = loaded.customMatchFallback === true;
      settings.allowedBuilds = allowedBuildList(loaded.allowedBuilds) ?? null;
      if (loaded.battleRoyaleNews && typeof loaded.battleRoyaleNews === "object") {
        settings.battleRoyaleNews = {
          title: String(loaded.battleRoyaleNews.title ?? ""),
          body: String(loaded.battleRoyaleNews.body ?? ""),
          image: String(loaded.battleRoyaleNews.image ?? "")
        };
      }
      const loadedPlaylistImages = playlistImageMap(loaded.playlistImages);
      if (loadedPlaylistImages) settings.playlistImages = loadedPlaylistImages;
      if (loaded.lobbyNotice && typeof loaded.lobbyNotice === "object") {
        settings.lobbyNotice = {
          enabled: loaded.lobbyNotice.enabled === true,
          title: String(loaded.lobbyNotice.title ?? ""),
          body: String(loaded.lobbyNotice.body ?? "")
        };
      }
      if (loaded.loginMessage && typeof loaded.loginMessage === "object") {
        settings.loginMessage = {
          title: String(loaded.loginMessage.title ?? ""),
          body: String(loaded.loginMessage.body ?? "")
        };
      }
      if (loaded.subgameSelect && typeof loaded.subgameSelect === "object") {
        const stw = loaded.subgameSelect.saveTheWorld && typeof loaded.subgameSelect.saveTheWorld === "object" ? {
          title: String(loaded.subgameSelect.saveTheWorld.title ?? ""),
          body: String(loaded.subgameSelect.saveTheWorld.body ?? "")
        } : undefined;
        const br = loaded.subgameSelect.battleRoyale && typeof loaded.subgameSelect.battleRoyale === "object" ? {
          title: String(loaded.subgameSelect.battleRoyale.title ?? ""),
          body: String(loaded.subgameSelect.battleRoyale.body ?? "")
        } : undefined;
        if (stw || br) settings.subgameSelect = { saveTheWorld: stw, battleRoyale: br };
      }
      if (loaded.itemShop && typeof loaded.itemShop === "object") {
        settings.itemShop = {
          mode: ["fnbr", "random", "custom"].includes(loaded.itemShop.mode) ? loaded.itemShop.mode : "fnbr",
          rotationHour: Number.isInteger(loaded.itemShop.rotationHour) && loaded.itemShop.rotationHour >= 0 && loaded.itemShop.rotationHour <= 23 ? loaded.itemShop.rotationHour : 0,
          weeklyDurationDays: Number.isInteger(loaded.itemShop.weeklyDurationDays) && loaded.itemShop.weeklyDurationDays >= 1 && loaded.itemShop.weeklyDurationDays <= 30 ? loaded.itemShop.weeklyDurationDays : 7,
          custom: loaded.itemShop.custom && typeof loaded.itemShop.custom === "object" ? {
            featured: Array.isArray(loaded.itemShop.custom.featured) ? loaded.itemShop.custom.featured : [],
            daily: Array.isArray(loaded.itemShop.custom.daily) ? loaded.itemShop.custom.daily : []
          } : undefined,
          random: loaded.itemShop.random && typeof loaded.itemShop.random === "object" ? {
            seed: String(loaded.itemShop.random.seed ?? "core_shop_seed_0"),
            rerolledAt: loaded.itemShop.random.rerolledAt ? String(loaded.itemShop.random.rerolledAt) : undefined
          } : undefined
        };
      }
      settings.events = sanitizeEvents(loaded.events, defaults.events);
      settings.battlepass = sanitizeBattlePass(loaded.battlepass, defaults.battlepass);
      if (loaded.seasonalEvents === false && !loaded.events?.mode) {
        settings.events.mode = "off";
      }
    } catch {
      // Corrupt file falls back to defaults
    }
  }

  function save() {
    if (file) writeJson(file, settings);
  }

  return {
    get() {
      return {
        ...settings,
        defaultFoundersAccess: settings.defaultFoundersAccess !== false,
        remoteAdmin: settings.remoteAdmin === true,
        allowedHostingIps: [...(settings.allowedHostingIps ?? defaults.allowedHostingIps)],
        regionHostingIps: JSON.parse(JSON.stringify(settings.regionHostingIps ?? {})),
        customMatchServers: JSON.parse(JSON.stringify(settings.customMatchServers ?? [])),
        customMatchFallback: settings.customMatchFallback === true,
        allowedBuilds: settings.allowedBuilds ? [...settings.allowedBuilds] : null,
        structureLimits: { ...settings.structureLimits },
        battleRoyaleRewards: JSON.parse(JSON.stringify(settings.battleRoyaleRewards)),
        cheatAccounts: [...settings.cheatAccounts],
        battleRoyaleNewsEnabled: typeof settings.battleRoyaleNewsEnabled === "boolean" ? settings.battleRoyaleNewsEnabled : undefined,
        battleRoyaleNews: settings.battleRoyaleNews ? { ...settings.battleRoyaleNews } : undefined,
        loginMessage: settings.loginMessage ? { ...settings.loginMessage } : undefined,
        lobbyNotice: settings.lobbyNotice ? { ...settings.lobbyNotice } : undefined,
        playlistImages: settings.playlistImages ? { ...settings.playlistImages } : undefined,
        subgameSelect: settings.subgameSelect ? JSON.parse(JSON.stringify(settings.subgameSelect)) : undefined,
        itemShop: settings.itemShop ? JSON.parse(JSON.stringify(settings.itemShop)) : { mode: "fnbr", rotationHour: 0, weeklyDurationDays: 7 },
        events: JSON.parse(JSON.stringify(settings.events ?? defaults.events)),
        battlepass: JSON.parse(JSON.stringify(settings.battlepass ?? defaults.battlepass)),
        challengeUnlock: JSON.parse(JSON.stringify(settings.challengeUnlock ?? {}))
      };
    },

    update(partial = {}) {
      if (typeof partial.requirePassword === "boolean") settings.requirePassword = partial.requirePassword;
      if (typeof partial.allowRegistration === "boolean") settings.allowRegistration = partial.allowRegistration;
      if (typeof partial.showItemImages === "boolean") settings.showItemImages = partial.showItemImages;
      if (typeof partial.allowAutoRegistration === "boolean") settings.allowAutoRegistration = partial.allowAutoRegistration;
      if (partial.battlepass && typeof partial.battlepass === "object") {
        settings.battlepass = sanitizeBattlePass(partial.battlepass, settings.battlepass ?? defaults.battlepass);
      }
      if (partial.events && typeof partial.events === "object") {
        settings.events = sanitizeEvents(partial.events, settings.events ?? defaults.events);
        settings.seasonalEvents = settings.events.mode !== "off";
        if (settings.itemShop) {
          if (settings.events.rotationHour !== undefined) settings.itemShop.rotationHour = settings.events.rotationHour;
          if (settings.events.weeklyDurationDays !== undefined) settings.itemShop.weeklyDurationDays = settings.events.weeklyDurationDays;
        }
      }
      if (typeof partial.seasonalEvents === "boolean") {
        settings.seasonalEvents = partial.seasonalEvents;
        if (!partial.events) {
          settings.events = settings.events ?? JSON.parse(JSON.stringify(defaults.events));
          if (partial.seasonalEvents === false && settings.events.mode !== "off") settings.events.mode = "off";
          else if (partial.seasonalEvents === true && settings.events.mode === "off") settings.events.mode = "auto";
        }
      }
      if (typeof partial.defaultFoundersAccess === "boolean") {
        settings.defaultFoundersAccess = partial.defaultFoundersAccess;
      } else if (partial.defaultFoundersAccess === null) {
        delete settings.defaultFoundersAccess;
      }
      if (typeof partial.battleRoyaleVbucks === "boolean") settings.battleRoyaleVbucks = partial.battleRoyaleVbucks;
      if (typeof partial.remoteAdmin === "boolean") settings.remoteAdmin = partial.remoteAdmin;
      if (typeof partial.battleRoyaleNewsEnabled === "boolean") {
        settings.battleRoyaleNewsEnabled = partial.battleRoyaleNewsEnabled;
      } else if (partial.battleRoyaleNewsEnabled === null) {
        delete settings.battleRoyaleNewsEnabled;
      }
      if (typeof partial.loginMessageEnabled === "boolean") {
        settings.loginMessageEnabled = partial.loginMessageEnabled;
      } else if (partial.loginMessageEnabled === null) {
        delete settings.loginMessageEnabled;
      }
      settings.battleRoyaleRewards = battleRoyaleRewards(partial.battleRoyaleRewards, legacyRewards(partial, settings.battleRoyaleRewards));
      const structureLimit = structureLimitValue(partial.structureLimit);
      if (partial.structureLimit !== undefined && structureLimit !== undefined) settings.structureLimit = structureLimit;
      settings.structureLimits = structureLimits(partial.structureLimits, settings.structureLimits);
      settings.cheats = cheatMode(partial.cheats) ?? settings.cheats;
      settings.cheatAccounts = cheatAccounts(partial.cheatAccounts) ?? settings.cheatAccounts;
      settings.matchmakingGatherSeconds = gatherSeconds(partial.matchmakingGatherSeconds) ?? settings.matchmakingGatherSeconds;
      const warmup = warmupSecondsValue(partial.warmupSeconds);
      if (partial.warmupSeconds !== undefined && warmup !== undefined) settings.warmupSeconds = warmup;
      if (typeof partial.lateJoin === "boolean") settings.lateJoin = partial.lateJoin;
      if (partial.bots !== undefined) settings.bots = botsValue(partial.bots, settings.bots);
      if (typeof partial.ltmOriginalDates === "boolean") settings.ltmOriginalDates = partial.ltmOriginalDates;
      if (partial.ltmCloseEncounters !== undefined) settings.ltmCloseEncounters = closeEncountersValue(partial.ltmCloseEncounters, settings.ltmCloseEncounters);
      if (typeof partial.challengesAllUnlocked === "boolean") settings.challengesAllUnlocked = partial.challengesAllUnlocked;
      settings.challengeUnlock = challengeUnlockValue(partial.challengeUnlock, settings.challengeUnlock ?? {});
      if (typeof partial.regionFallback === "boolean") settings.regionFallback = partial.regionFallback;
      if (typeof partial.vbuckPacks === "boolean") settings.vbuckPacks = partial.vbuckPacks;
      if (partial.purchaseMode === "free" || partial.purchaseMode === "code") settings.purchaseMode = partial.purchaseMode;
      if (typeof partial.twitchPrimePack === "boolean") settings.twitchPrimePack = partial.twitchPrimePack;
      if (typeof partial.matchStartCountdown === "boolean") settings.matchStartCountdown = partial.matchStartCountdown;
      settings.matchStartBufferSeconds = matchStartBufferValue(partial.matchStartBufferSeconds) ?? settings.matchStartBufferSeconds;
      settings.serverRegions = regionList(partial.serverRegions ?? partial.serverRegion) ?? settings.serverRegions;
      if (partial.matchmakingModes && typeof partial.matchmakingModes === "object") {
        settings.matchmakingModes = sanitizeMatchmakingModes(partial.matchmakingModes, settings.matchmakingModes);
      }
      if (partial.serverLimits && typeof partial.serverLimits === "object") {
        settings.serverLimits = sanitizeServerLimits(partial.serverLimits, settings.serverLimits);
      }
      settings.allowedHostingIps = hostingIps(partial.allowedHostingIps) ?? settings.allowedHostingIps;
      settings.regionHostingIps = regionHostingIps(partial.regionHostingIps) ?? settings.regionHostingIps;
      settings.customMatchServers = customMatchServers(partial.customMatchServers) ?? settings.customMatchServers;
      if (typeof partial.customMatchFallback === "boolean") settings.customMatchFallback = partial.customMatchFallback;
      const builds = allowedBuildList(partial.allowedBuilds);
      if (partial.allowedBuilds !== undefined && builds !== undefined) settings.allowedBuilds = builds;
      if (partial.battleRoyaleNews && typeof partial.battleRoyaleNews === "object") {
        settings.battleRoyaleNews = {
          title: String(partial.battleRoyaleNews.title ?? ""),
          body: String(partial.battleRoyaleNews.body ?? ""),
          image: String(partial.battleRoyaleNews.image ?? "")
        };
      } else if (partial.battleRoyaleNews === null) {
        delete settings.battleRoyaleNews;
      }
      if (partial.playlistImages === null) {
        delete settings.playlistImages;
      } else if (partial.playlistImages !== undefined) {
        const images = playlistImageMap(partial.playlistImages);
        if (images) settings.playlistImages = images;
        else delete settings.playlistImages;
      }
      if (partial.lobbyNotice && typeof partial.lobbyNotice === "object") {
        settings.lobbyNotice = {
          enabled: partial.lobbyNotice.enabled === true,
          title: String(partial.lobbyNotice.title ?? ""),
          body: String(partial.lobbyNotice.body ?? "")
        };
      } else if (partial.lobbyNotice === null) {
        delete settings.lobbyNotice;
      }
      if (partial.loginMessage && typeof partial.loginMessage === "object") {
        settings.loginMessage = {
          title: String(partial.loginMessage.title ?? ""),
          body: String(partial.loginMessage.body ?? "")
        };
      } else if (partial.loginMessage === null) {
        delete settings.loginMessage;
      }
      if (partial.subgameSelect && typeof partial.subgameSelect === "object") {
        const currentSub = settings.subgameSelect ?? {};
        const stw = partial.subgameSelect.saveTheWorld !== undefined
          ? (partial.subgameSelect.saveTheWorld && typeof partial.subgameSelect.saveTheWorld === "object" ? {
            title: String(partial.subgameSelect.saveTheWorld.title ?? ""),
            body: String(partial.subgameSelect.saveTheWorld.body ?? "")
          } : undefined)
          : currentSub.saveTheWorld;
        const br = partial.subgameSelect.battleRoyale !== undefined
          ? (partial.subgameSelect.battleRoyale && typeof partial.subgameSelect.battleRoyale === "object" ? {
            title: String(partial.subgameSelect.battleRoyale.title ?? ""),
            body: String(partial.subgameSelect.battleRoyale.body ?? "")
          } : undefined)
          : currentSub.battleRoyale;
        if (stw || br) {
          settings.subgameSelect = { saveTheWorld: stw, battleRoyale: br };
        } else {
          delete settings.subgameSelect;
        }
      } else if (partial.subgameSelect === null) {
        delete settings.subgameSelect;
      }
      if (partial.itemShop && typeof partial.itemShop === "object") {
        const currentShop = settings.itemShop ?? { mode: "fnbr", rotationHour: 0, weeklyDurationDays: 7 };
        const mode = ["fnbr", "random", "custom"].includes(partial.itemShop.mode) ? partial.itemShop.mode : currentShop.mode;
        const rotationHour = partial.itemShop.rotationHour !== undefined
          ? (Number.isInteger(Number(partial.itemShop.rotationHour)) && Number(partial.itemShop.rotationHour) >= 0 && Number(partial.itemShop.rotationHour) <= 23 ? Number(partial.itemShop.rotationHour) : 0)
          : (currentShop.rotationHour ?? 0);
        const weeklyDurationDays = partial.itemShop.weeklyDurationDays !== undefined
          ? (Number.isInteger(Number(partial.itemShop.weeklyDurationDays)) && Number(partial.itemShop.weeklyDurationDays) >= 1 && Number(partial.itemShop.weeklyDurationDays) <= 30 ? Number(partial.itemShop.weeklyDurationDays) : 7)
          : (currentShop.weeklyDurationDays ?? 7);

        settings.itemShop = {
          mode,
          rotationHour,
          weeklyDurationDays,
          custom: partial.itemShop.custom !== undefined ? (partial.itemShop.custom ? {
            featured: Array.isArray(partial.itemShop.custom.featured) ? partial.itemShop.custom.featured : [],
            daily: Array.isArray(partial.itemShop.custom.daily) ? partial.itemShop.custom.daily : []
          } : undefined) : currentShop.custom,
          random: partial.itemShop.random !== undefined ? (partial.itemShop.random ? {
            seed: String(partial.itemShop.random.seed ?? "core_shop_seed_0"),
            rerolledAt: partial.itemShop.random.rerolledAt ? String(partial.itemShop.random.rerolledAt) : new Date().toISOString()
          } : undefined) : currentShop.random
        };
      } else if (partial.itemShop === null) {
        delete settings.itemShop;
      }
      save();
      return this.get();
    },

    // Adds one IP address to the Trusted Hosting IPs; anything else (or a full list) changes nothing.
    addHostingIp(ip) {
      const address = hostingIp(ip);
      if (!address) return this.get();
      settings.allowedHostingIps = hostingIps([...(settings.allowedHostingIps ?? defaults.allowedHostingIps), address]);
      save();
      return this.get();
    },

    removeHostingIp(ip) {
      if (typeof ip !== "string") return this.get();
      const address = hostingIp(ip) ?? ip.trim();
      settings.allowedHostingIps = (settings.allowedHostingIps ?? defaults.allowedHostingIps).filter((item) => item !== address);
      save();
      return this.get();
    },

    // Keeps the day a season's replay started (store/itemshop.js seasonStart), touching nothing else in events.
    recordSeasonStart(season, date) {
      const events = settings.events ?? JSON.parse(JSON.stringify(defaults.events));
      settings.events = { ...events, seasonStarts: sanitizeEvents({ seasonStarts: { [season]: date } }, events).seasonStarts };
      save();
    }
  };
}

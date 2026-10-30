import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";
import { defaultHostingIps, hostingIp, hostingIps } from "../network.js";

const defaults = {
  requirePassword: false,
  allowRegistration: true,
  allowAutoRegistration: true,
  // Whether the seasonal events (events/events.js) run on the builds that shipped them (the admin panel's switch).
  seasonalEvents: true,
  // V-Bucks for Battle Royale matches (Core-Backend #100, #124, services/fortnite/battleroyale.js): off unless turned on,
  // then battleRoyaleRewards' amounts for each of solo, duos and squads (rewardModes): perKill for each kill, perWin
  // for a win (place 1) and placements, [{top, vbucks}], of which a place gets the best one it is within, not their
  // sum. Nothing by default.
  battleRoyaleVbucks: false,
  battleRoyaleRewards: null,
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
  // (#123: off, matchmaking/service.js and the session search, matchmaking/sessions.js).
  matchmakingGatherSeconds: 10,
  warmupSeconds: null,
  lateJoin: false,
  regionFallback: true,
  // Trusted Hosting IPs (Core-Backend #125, network.js allowsHosting): other PCs whose gameservers may host for this
  // backend, each an IP address. This PC (loopback) always may; nobody else unless listed.
  allowedHostingIps: defaultHostingIps,
  defaultFoundersAccess: true
};

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

// The Battle Royale modes that pay V-Bucks, by their playlist (the stats' main playlists, stats/store.js); a
// limited-time playlist pays nothing. A placement tier is "top" places 1 to maxPlacementTop, at most
// maxPlacementTiers of them a mode.
export const rewardModes = { solo: 2, duos: 10, squads: 9 };
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
  const settings = { ...defaults, allowedHostingIps: [...defaults.allowedHostingIps], battleRoyaleRewards: noRewards() };

  if (file && fs.existsSync(file)) {
    try {
      const loaded = readJson(file);
      Object.assign(settings, loaded);
      if (typeof loaded.battleRoyaleVbucks !== "boolean") settings.battleRoyaleVbucks = defaults.battleRoyaleVbucks;
      if (typeof loaded.loginMessageEnabled === "boolean") settings.loginMessageEnabled = loaded.loginMessageEnabled;
      if (typeof loaded.defaultFoundersAccess === "boolean") settings.defaultFoundersAccess = loaded.defaultFoundersAccess;
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
      settings.warmupSeconds = warmupSecondsValue(loaded.warmupSeconds) ?? null;
      settings.lateJoin = loaded.lateJoin === true;
      settings.regionFallback = loaded.regionFallback !== false;
      settings.allowedHostingIps = hostingIps(loaded.allowedHostingIps) ?? [...defaults.allowedHostingIps];
      if (loaded.battleRoyaleNews && typeof loaded.battleRoyaleNews === "object") {
        settings.battleRoyaleNews = {
          title: String(loaded.battleRoyaleNews.title ?? ""),
          body: String(loaded.battleRoyaleNews.body ?? "")
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
        allowedHostingIps: [...(settings.allowedHostingIps ?? defaults.allowedHostingIps)],
        structureLimits: { ...settings.structureLimits },
        battleRoyaleRewards: JSON.parse(JSON.stringify(settings.battleRoyaleRewards)),
        cheatAccounts: [...settings.cheatAccounts],
        battleRoyaleNews: settings.battleRoyaleNews ? { ...settings.battleRoyaleNews } : undefined,
        loginMessage: settings.loginMessage ? { ...settings.loginMessage } : undefined,
        subgameSelect: settings.subgameSelect ? JSON.parse(JSON.stringify(settings.subgameSelect)) : undefined,
        itemShop: settings.itemShop ? JSON.parse(JSON.stringify(settings.itemShop)) : { mode: "fnbr", rotationHour: 0, weeklyDurationDays: 7 }
      };
    },

    update(partial = {}) {
      if (typeof partial.requirePassword === "boolean") settings.requirePassword = partial.requirePassword;
      if (typeof partial.allowRegistration === "boolean") settings.allowRegistration = partial.allowRegistration;
      if (typeof partial.allowAutoRegistration === "boolean") settings.allowAutoRegistration = partial.allowAutoRegistration;
      if (typeof partial.seasonalEvents === "boolean") settings.seasonalEvents = partial.seasonalEvents;
      if (typeof partial.defaultFoundersAccess === "boolean") {
        settings.defaultFoundersAccess = partial.defaultFoundersAccess;
      } else if (partial.defaultFoundersAccess === null) {
        delete settings.defaultFoundersAccess;
      }
      if (typeof partial.battleRoyaleVbucks === "boolean") settings.battleRoyaleVbucks = partial.battleRoyaleVbucks;
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
      if (typeof partial.regionFallback === "boolean") settings.regionFallback = partial.regionFallback;
      settings.allowedHostingIps = hostingIps(partial.allowedHostingIps) ?? settings.allowedHostingIps;
      if (partial.battleRoyaleNews && typeof partial.battleRoyaleNews === "object") {
        settings.battleRoyaleNews = {
          title: String(partial.battleRoyaleNews.title ?? ""),
          body: String(partial.battleRoyaleNews.body ?? "")
        };
      } else if (partial.battleRoyaleNews === null) {
        delete settings.battleRoyaleNews;
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
    }
  };
}

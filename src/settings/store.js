import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";

const defaults = {
  requirePassword: false,
  allowRegistration: true,
  allowAutoRegistration: true,
  // Whether the seasonal events (events/events.js) run on the builds that shipped them (the admin panel's switch).
  seasonalEvents: true,
  // V-Bucks for Battle Royale kills and wins (Core-Backend #100, services/fortnite/battleroyale.js): off unless turned on,
  // then vbucksPerKill for each kill and vbucksPerWin for a win (place 1) in any Battle Royale playlist.
  battleRoyaleVbucks: false,
  vbucksPerKill: 50,
  vbucksPerWin: 500,
  allowedHostingIps: ["127.0.0.1", "::1"],
  loginMessageEnabled: true
};

// A reward amount: a whole number of V-Bucks from 0 to maxReward, or undefined for anything else.
const maxReward = 100000;
function rewardAmount(value) {
  const amount = typeof value === "string" && value.trim() ? Number(value) : value;
  return Number.isInteger(amount) && amount >= 0 && amount <= maxReward ? amount : undefined;
}

export function createSettingsStore(dataDir) {
  const file = dataDir && path.join(dataDir, "settings.json");
  const settings = { ...defaults, allowedHostingIps: [...defaults.allowedHostingIps] };

  if (file && fs.existsSync(file)) {
    try {
      const loaded = readJson(file);
      Object.assign(settings, loaded);
      if (typeof loaded.battleRoyaleVbucks !== "boolean") settings.battleRoyaleVbucks = defaults.battleRoyaleVbucks;
      if (typeof loaded.loginMessageEnabled === "boolean") settings.loginMessageEnabled = loaded.loginMessageEnabled;
      for (const key of ["vbucksPerKill", "vbucksPerWin"]) settings[key] = rewardAmount(loaded[key]) ?? defaults[key];
      if (Array.isArray(loaded.allowedHostingIps)) {
        settings.allowedHostingIps = [...loaded.allowedHostingIps];
      }
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
        loginMessageEnabled: settings.loginMessageEnabled !== false,
        allowedHostingIps: [...(settings.allowedHostingIps ?? defaults.allowedHostingIps)],
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
      if (typeof partial.battleRoyaleVbucks === "boolean") settings.battleRoyaleVbucks = partial.battleRoyaleVbucks;
      if (typeof partial.loginMessageEnabled === "boolean") {
        settings.loginMessageEnabled = partial.loginMessageEnabled;
      } else if (partial.loginMessageEnabled === null) {
        delete settings.loginMessageEnabled;
      }
      for (const key of ["vbucksPerKill", "vbucksPerWin"]) {
        const amount = rewardAmount(partial[key]);
        if (amount !== undefined) settings[key] = amount;
      }
      if (Array.isArray(partial.allowedHostingIps)) {
        settings.allowedHostingIps = [...new Set(partial.allowedHostingIps.filter((ip) => typeof ip === "string" && ip.trim()))];
      }
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

    addHostingIp(ip) {
      if (typeof ip !== "string" || !ip.trim()) return this.get();
      const list = new Set(settings.allowedHostingIps ?? defaults.allowedHostingIps);
      list.add(ip.trim());
      settings.allowedHostingIps = [...list];
      save();
      return this.get();
    },

    removeHostingIp(ip) {
      if (typeof ip !== "string") return this.get();
      const trimmed = ip.trim();
      const list = (settings.allowedHostingIps ?? defaults.allowedHostingIps).filter((item) => item !== trimmed);
      settings.allowedHostingIps = list;
      save();
      return this.get();
    }
  };
}

import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";

const defaults = {
  requirePassword: false,
  allowRegistration: true,
  allowAutoRegistration: true,
  // Whether the seasonal events (events/events.js) run on the builds that shipped them (the admin panel's switch).
  seasonalEvents: true,
  allowedHostingIps: ["127.0.0.1", "::1"]
};

export function createSettingsStore(dataDir) {
  const file = dataDir && path.join(dataDir, "settings.json");
  const settings = { ...defaults, allowedHostingIps: [...defaults.allowedHostingIps] };

  if (file && fs.existsSync(file)) {
    try {
      const loaded = readJson(file);
      Object.assign(settings, loaded);
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
        allowedHostingIps: [...(settings.allowedHostingIps ?? defaults.allowedHostingIps)],
        battleRoyaleNews: settings.battleRoyaleNews ? { ...settings.battleRoyaleNews } : undefined,
        loginMessage: settings.loginMessage ? { ...settings.loginMessage } : undefined,
        itemShop: settings.itemShop ? JSON.parse(JSON.stringify(settings.itemShop)) : { mode: "fnbr", rotationHour: 0, weeklyDurationDays: 7 }
      };
    },

    update(partial = {}) {
      if (typeof partial.requirePassword === "boolean") settings.requirePassword = partial.requirePassword;
      if (typeof partial.allowRegistration === "boolean") settings.allowRegistration = partial.allowRegistration;
      if (typeof partial.allowAutoRegistration === "boolean") settings.allowAutoRegistration = partial.allowAutoRegistration;
      if (typeof partial.seasonalEvents === "boolean") settings.seasonalEvents = partial.seasonalEvents;
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

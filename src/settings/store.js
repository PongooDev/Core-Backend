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
          custom: loaded.itemShop.custom && typeof loaded.itemShop.custom === "object" ? {
            featured: Array.isArray(loaded.itemShop.custom.featured) ? loaded.itemShop.custom.featured : [],
            daily: Array.isArray(loaded.itemShop.custom.daily) ? loaded.itemShop.custom.daily : []
          } : undefined,
          random: loaded.itemShop.random && typeof loaded.itemShop.random === "object" ? {
            featured: Array.isArray(loaded.itemShop.random.featured) ? loaded.itemShop.random.featured : [],
            daily: Array.isArray(loaded.itemShop.random.daily) ? loaded.itemShop.random.daily : [],
            generatedAt: loaded.itemShop.random.generatedAt
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
        itemShop: settings.itemShop ? JSON.parse(JSON.stringify(settings.itemShop)) : { mode: "fnbr" }
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
        const mode = ["fnbr", "random", "custom"].includes(partial.itemShop.mode) ? partial.itemShop.mode : (settings.itemShop?.mode ?? "fnbr");
        settings.itemShop = {
          mode,
          custom: partial.itemShop.custom !== undefined ? (partial.itemShop.custom ? {
            featured: Array.isArray(partial.itemShop.custom.featured) ? partial.itemShop.custom.featured : [],
            daily: Array.isArray(partial.itemShop.custom.daily) ? partial.itemShop.custom.daily : []
          } : undefined) : settings.itemShop?.custom,
          random: partial.itemShop.random !== undefined ? (partial.itemShop.random ? {
            featured: Array.isArray(partial.itemShop.random.featured) ? partial.itemShop.random.featured : [],
            daily: Array.isArray(partial.itemShop.random.daily) ? partial.itemShop.random.daily : [],
            generatedAt: partial.itemShop.random.generatedAt
          } : undefined) : settings.itemShop?.random
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

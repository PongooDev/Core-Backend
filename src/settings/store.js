import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";

const defaults = {
  requirePassword: false,
  allowRegistration: true,
  allowAutoRegistration: true
};

export function createSettingsStore(dataDir) {
  const file = dataDir && path.join(dataDir, "settings.json");
  const settings = { ...defaults };

  if (file && fs.existsSync(file)) {
    try {
      Object.assign(settings, readJson(file));
    } catch {
      // Corrupt file falls back to defaults
    }
  }

  function save() {
    if (file) writeJson(file, settings);
  }

  return {
    get() {
      return { ...settings };
    },

    update(partial = {}) {
      if (typeof partial.requirePassword === "boolean") settings.requirePassword = partial.requirePassword;
      if (typeof partial.allowRegistration === "boolean") settings.allowRegistration = partial.allowRegistration;
      if (typeof partial.allowAutoRegistration === "boolean") settings.allowAutoRegistration = partial.allowAutoRegistration;
      save();
      return { ...settings };
    }
  };
}

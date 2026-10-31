import { athenaCosmetics } from "../gamedata/athena.js";

export const defaultMilestones = [
  { templateId: "AthenaGlider:glider_id_001", name: "Aerial Assault One", type: "Glider", seasonLevel: 5, price: 500 },
  { templateId: "AthenaCharacter:cid_017_athena_commando_m", name: "Aerial Assault Trooper", type: "Outfit", seasonLevel: 15, price: 1200 },
  { templateId: "AthenaCharacter:cid_028_athena_commando_f", name: "Renegade Raider", type: "Outfit", seasonLevel: 20, price: 1200 },
  { templateId: "AthenaPickaxe:pickaxe_lockjaw", name: "Raider's Revenge", type: "Pickaxe", seasonLevel: 35, price: 1500 }
];

export const defaultBattlePass = {
  season: 1,
  levelRequirementsEnabled: true,
  xpMultiplier: 1.0,
  maxSeasonLevel: 100,
  milestones: [
    { templateId: "AthenaGlider:glider_id_001", seasonLevel: 5, price: 500 },
    { templateId: "AthenaCharacter:cid_017_athena_commando_m", seasonLevel: 15, price: 1200 },
    { templateId: "AthenaCharacter:cid_028_athena_commando_f", seasonLevel: 20, price: 1200 },
    { templateId: "AthenaPickaxe:pickaxe_lockjaw", seasonLevel: 35, price: 1500 }
  ]
};

export function sanitizeBattlePass(input, current = defaultBattlePass) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return JSON.parse(JSON.stringify(current));
  const result = JSON.parse(JSON.stringify(current));

  result.season = 1;

  if (typeof input.levelRequirementsEnabled === "boolean") {
    result.levelRequirementsEnabled = input.levelRequirementsEnabled;
  }

  if (input.xpMultiplier !== undefined) {
    const num = Number(input.xpMultiplier);
    if (!isNaN(num) && num >= 0.1 && num <= 10.0) {
      result.xpMultiplier = Math.round(num * 100) / 100;
    }
  }

  if (input.maxSeasonLevel !== undefined) {
    const num = Number(input.maxSeasonLevel);
    if (Number.isInteger(num) && num >= 10 && num <= 1000) {
      result.maxSeasonLevel = num;
    }
  }

  if (Array.isArray(input.milestones)) {
    const sanitized = [];
    const seen = new Set();
    const maxLvl = result.maxSeasonLevel ?? 100;

    for (const item of input.milestones) {
      if (!item || typeof item !== "object") continue;
      const templateId = typeof item.templateId === "string" ? item.templateId.trim() : "";
      if (!templateId || !templateId.toLowerCase().startsWith("athena") || seen.has(templateId.toLowerCase())) continue;

      const seasonLevel = Number(item.seasonLevel ?? item.level ?? 1);
      const price = Number(item.price ?? 0);

      sanitized.push({
        templateId,
        seasonLevel: Number.isInteger(seasonLevel) ? Math.max(1, Math.min(maxLvl, seasonLevel)) : 1,
        price: Number.isInteger(price) ? Math.max(0, Math.min(100000, price)) : 0
      });
      seen.add(templateId.toLowerCase());
    }

    if (sanitized.length > 0) {
      result.milestones = sanitized;
    }
  }

  return result;
}

let battlepassConfigProvider = null;

export function configureBattlePass(provider) {
  battlepassConfigProvider = typeof provider === "function" ? provider : () => provider;
}

export function currentBattlePassConfig() {
  return (battlepassConfigProvider ? battlepassConfigProvider() : null) ?? defaultBattlePass;
}

export function enrichedMilestones(config = currentBattlePassConfig()) {
  const cosmetics = athenaCosmetics();
  const milestones = Array.isArray(config.milestones) && config.milestones.length > 0
    ? config.milestones
    : defaultBattlePass.milestones;

  return milestones.map((m) => {
    const cosmetic = cosmetics[m.templateId] || {};
    const defaultMeta = defaultMilestones.find((d) => d.templateId.toLowerCase() === m.templateId.toLowerCase());
    const type = cosmetic.type || defaultMeta?.type || m.templateId.split(":")[0].replace("Athena", "") || "Item";
    const name = defaultMeta?.name || (cosmetic.name ? cosmetic.name.trim() : m.templateId.split(":")[1]);
    const rarity = cosmetic.rarity || "Rare";

    return {
      templateId: m.templateId,
      name,
      type,
      rarity,
      seasonLevel: m.seasonLevel,
      price: m.price,
      unlockedLevel: config.levelRequirementsEnabled === false ? 1 : m.seasonLevel
    };
  });
}

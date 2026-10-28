import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentBuild } from "../builds/context.js";
import { athenaCosmetics } from "../gamedata/athena.js";

// Battle Royale's item shop (Core-Backend #69). 1.8's lobby Store tab is AthenaDirectAcquisitionScreen
// (UFortDirectAcquisitionWidgetBase), whose StorefrontNames are ["BRWeeklyStorefront", "BRDailyStorefront"]: the first
// storefront's offers become the large tiles (GenerateOfferWidget: LargeTile when the storefront is StorefrontNames[0]),
// the other's the small ones, two rows of them. Its countdowns: the daily one is the catalog's expiration
// (GetDailyStoreEndDate 0x2E7C840: the catalog's expiry less the server time); the weekly one is the event calendar's
// (GetWeeklyStoreEndDate 0x2E82B70: WeeklyStoreEnd, +0x18 of the client-events channel's FFortClientEventsState
// {SeasonId, SeasonEnd, WeeklyStoreEnd} that sub_70EEC0 registers, less the server time; sub_70C170), so
// services/fortnite/calendar.js sends weeklyStoreEnd. Without it the end is zero and the weekly countdown shows 0:00.
// 1.7.2 has no Battle Royale store (no FortDirectAcquisition classes), nor does anything before 1.8.
//
// An offer is a FCatalogOffer whose first item grant is the cosmetic: the tile shows its LargePreviewImage, rarity, name
// and type (no displayAssetPath: HasDisplayAsset is false; no title, so the name and type are the item definition's:
// store/catalog.js offerJson) and its MtxCurrency price in V-Bucks. The offer's title here is only for messages. Offers carry no
// requirements: the client leaves out every offer whose requirements fail (0x3C52200 with the store's flags), where an
// owned item should show as owned (UFortMcpContext::IsOwned 0x710D00, the offer's grants held in athena or profile0:
// the tile's OwnedSwitcher; the details screen then shows "owned" and offers no purchase).
//
// What is on sale by default is Epic's own shop of Season 1 (1.8 to 1.10), day by day from 30 October to 13 December 2017, as
// fnbr.co recorded it (itemshop.json: the featured items, then the daily ones, with their V-Buck prices; every item is in
// 1.8's game data). The shop replays that history in a 45-day cycle. Admins can also switch the shop to local randomized
// generation or a fully customized shop via the admin panel.
const historyFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "itemshop.json");
const history = JSON.parse(fs.readFileSync(historyFile, "utf8")).days;
const firstDay = Date.parse(`${history[0].date}T00:00:00Z`);
const dayMs = 24 * 60 * 60 * 1000;

const firstBuild = 3724489;
export const hasItemShop = (changelist = currentBuild()) => Number(changelist) >= firstBuild;

let shopConfigProvider = null;

export function configureItemShop(provider) {
  shopConfigProvider = typeof provider === "function" ? provider : () => provider;
}

export function currentShopConfig() {
  return (shopConfigProvider ? shopConfigProvider() : null) ?? { mode: "fnbr" };
}

// Determines the cosmetic type label ("Outfit", "Harvesting Tool", "Glider")
export function cosmeticType(cosmeticClass) {
  if (cosmeticClass === "AthenaCharacterItemDefinition") return "Outfit";
  if (cosmeticClass === "AthenaPickaxeItemDefinition") return "Harvesting Tool";
  if (cosmeticClass === "AthenaGliderItemDefinition") return "Glider";
  return "Cosmetic";
}

const rarityMap = {
  Handmade: { code: "c", label: "Common" },
  Ordinary: { code: "uc", label: "Uncommon" },
  Sturdy: { code: "r", label: "Rare" },
  Quality: { code: "vr", label: "Epic" },
  Fine: { code: "sr", label: "Legendary" }
};

export function cosmeticRarity(rarityProp) {
  return rarityMap[rarityProp] ?? { code: "uc", label: "Uncommon" };
}

export function defaultPriceFor(cosmetic) {
  if (!cosmetic) return 800;
  const isChar = cosmetic.class === "AthenaCharacterItemDefinition";
  const { code } = cosmeticRarity(cosmetic.rarity);
  if (isChar) {
    if (code === "sr") return 2000;
    if (code === "vr") return 1500;
    if (code === "r") return 1200;
    return 800;
  }
  if (code === "sr") return 1500;
  if (code === "vr") return 1200;
  if (code === "r") return 800;
  return 500;
}

// Returns list of all eligible cosmetics in 1.8 that can appear in the item shop
export function eligibleCosmetics() {
  const cosmetics = athenaCosmetics();
  const allowedClasses = [
    "AthenaCharacterItemDefinition",
    "AthenaPickaxeItemDefinition",
    "AthenaGliderItemDefinition"
  ];
  return Object.entries(cosmetics)
    .filter(([id, c]) => {
      if (!allowedClasses.includes(c.class)) return false;
      const lower = id.toLowerCase();
      if (lower.includes("_default") || lower.includes("defaultpickaxe")) return false;
      if (lower.includes("umbrella")) return false;
      return true;
    })
    .map(([templateId, c]) => {
      const { code, label } = cosmeticRarity(c.rarity);
      return {
        templateId,
        name: c.name.trim(),
        class: c.class,
        type: cosmeticType(c.class),
        rarity: label,
        rarityCode: code,
        defaultPrice: defaultPriceFor(c)
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Generate a randomized shop: 2 featured items, 4 to 6 daily items
export function generateRandomShop(now = new Date()) {
  const eligible = eligibleCosmetics();
  if (!eligible.length) return { featured: [], daily: [], generatedAt: now.toISOString() };

  const characters = eligible.filter((i) => i.class === "AthenaCharacterItemDefinition");
  const gear = eligible.filter((i) => i.class !== "AthenaCharacterItemDefinition");

  const featured = [];
  const used = new Set();

  function pickRandom(pool) {
    const available = pool.filter((item) => !used.has(item.templateId));
    if (!available.length) return null;
    const choice = available[Math.floor(Math.random() * available.length)];
    used.add(choice.templateId);
    return choice;
  }

  // Pick 2 featured (prefer characters, or mix of character and gear)
  const f1 = pickRandom(characters) || pickRandom(eligible);
  if (f1) featured.push([f1.templateId, f1.defaultPrice]);
  const f2 = pickRandom(Math.random() > 0.5 ? gear : characters) || pickRandom(eligible);
  if (f2) featured.push([f2.templateId, f2.defaultPrice]);

  // Pick 4 to 6 daily items
  const daily = [];
  const dailyCount = 4 + Math.floor(Math.random() * 3); // 4, 5, or 6
  for (let i = 0; i < dailyCount; i++) {
    const item = pickRandom(eligible);
    if (!item) break;
    daily.push([item.templateId, item.defaultPrice]);
  }

  return {
    featured,
    daily,
    generatedAt: now.toISOString()
  };
}

// The recorded day the UTC day of now shows in fnbr history.
export function shopDay(now = new Date()) {
  const days = Math.floor((now.getTime() - firstDay) / dayMs);
  return history[((days % history.length) + history.length) % history.length];
}

// When the shop next changes: the next UTC midnight.
export function nextRotation(now = new Date()) {
  return new Date(Math.floor(now.getTime() / dayMs) * dayMs + dayMs);
}

// When the featured (weekly) items next change: the first UTC midnight from now whose recorded day features other items.
// Epic's featured pair lasted a week (Sunday to Saturday from 5 November); the cycle's first and last weeks are shorter.
const featuredOf = (day) => JSON.stringify(day.featured.map(([templateId]) => templateId));
export function weeklyStoreEnd(now = new Date(), overrideConfig = null) {
  const config = overrideConfig ?? currentShopConfig();
  if (config.mode === "custom" || config.mode === "random") {
    const midnight = Math.floor(now.getTime() / dayMs) * dayMs;
    const dayOfWeek = new Date(midnight).getUTCDay(); // 0 is Sunday
    const daysUntilSunday = (7 - dayOfWeek) % 7 || 7;
    return new Date(midnight + daysUntilSunday * dayMs);
  }
  const today = featuredOf(shopDay(now));
  const midnight = Math.floor(now.getTime() / dayMs) * dayMs;
  for (let days = 1; days < history.length; days++) {
    if (featuredOf(shopDay(new Date(midnight + days * dayMs))) !== today) return new Date(midnight + days * dayMs);
  }
  return new Date(midnight + history.length * dayMs);
}

const offerIdOf = (templateId) => `core_br_${templateId.split(":")[1].toLowerCase()}`;

// The day's offers by storefront, those the requesting build has the cosmetic for.
export function itemShopOffers(now = new Date(), overrideConfig = null) {
  if (!hasItemShop()) return { BRWeeklyStorefront: [], BRDailyStorefront: [] };
  const cosmetics = athenaCosmetics();
  const config = overrideConfig ?? currentShopConfig();

  const toOffers = (entries) => entries
    .filter(([templateId]) => cosmetics[templateId])
    .map(([templateId, price]) => {
      const cosmetic = cosmetics[templateId];
      const validPrice = Number(price) > 0 ? Number(price) : defaultPriceFor(cosmetic);
      return {
        offerId: offerIdOf(templateId),
        templateId,
        title: cosmetic.name.trim(),
        currencyType: "MtxCurrency",
        currencySubType: "",
        price: validPrice,
        athena: true
      };
    });

  if (config.mode === "custom" && config.custom) {
    const feat = Array.isArray(config.custom.featured) ? config.custom.featured : [];
    const daily = Array.isArray(config.custom.daily) ? config.custom.daily : [];
    return {
      BRWeeklyStorefront: toOffers(feat),
      BRDailyStorefront: toOffers(daily)
    };
  }

  if (config.mode === "random" && config.random) {
    const feat = Array.isArray(config.random.featured) ? config.random.featured : [];
    const daily = Array.isArray(config.random.daily) ? config.random.daily : [];
    if (feat.length || daily.length) {
      return {
        BRWeeklyStorefront: toOffers(feat),
        BRDailyStorefront: toOffers(daily)
      };
    }
  }

  const day = shopDay(now);
  return {
    BRWeeklyStorefront: toOffers(day.featured),
    BRDailyStorefront: toOffers(day.daily)
  };
}

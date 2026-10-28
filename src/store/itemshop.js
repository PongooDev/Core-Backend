import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentBuild } from "../builds/context.js";
import { athenaCosmetics } from "../gamedata/athena.js";
import { isNonShopCosmetic } from "../profiles/athena.js";

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
// What is on sale is Epic's own shop of Season 1 (1.8 to 1.10), day by day from 30 October to 13 December 2017, as
// fnbr.co recorded it (itemshop.json: the featured items, then the daily ones, with their V-Buck prices; every item is in
// 1.8's game data). The prices are what the shop charged that day, not fnbr.co's (today's): the Fortnite Wiki's Item Shop
// History pages for those days agree with fnbr.co's except for Skull Trooper, 1,200 V-Bucks in 2017 (1,500 since its
// 2018 return; the reporter's 2017 footage on #69 shows 1,200 too), and Pink Flamingo from 3 to 9 December, 1,200 there
// but 1,500 in November and on every other source (🟡: kept at 1,500). The shop replays that history in a 45-day cycle: day 0 is 30 October 2017, and each UTC day since
// then shows the recorded day it falls on, modulo 45 (Core's choice). It changes at UTC midnight, as Epic's did.
// Admins can also configure the shop via the admin panel (mode: "fnbr" | "random" | "custom", Core-Backend #69).
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

// Returns list of all eligible cosmetics in 1.8 that can appear in the item shop,
// excluding starters, chase rewards, victory umbrellas and recruit outfits (Core-Backend #69).
export function eligibleCosmetics() {
  const cosmetics = athenaCosmetics();
  const allowedClasses = [
    "AthenaCharacterItemDefinition",
    "AthenaPickaxeItemDefinition",
    "AthenaGliderItemDefinition"
  ];
  return Object.entries(cosmetics)
    .filter(([id, c]) => allowedClasses.includes(c.class) && c.rarity !== "Handmade" && !isNonShopCosmetic(id))
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

function createPrng(seedStr) {
  let hash = crypto.createHash("sha256").update(String(seedStr)).digest();
  let offset = 0;
  return function nextFloat() {
    if (offset + 4 > hash.length) {
      hash = crypto.createHash("sha256").update(hash).digest();
      offset = 0;
    }
    const val = hash.readUInt32BE(offset);
    offset += 4;
    return val / 0x100000000;
  };
}

// Generate a deterministic randomized shop: 2 featured items (weekly), 6 daily items (daily)
export function generateRandomShop(now = new Date(), overrideConfig = null) {
  const eligible = eligibleCosmetics();
  if (!eligible.length) return { featured: [], daily: [], generatedAt: now.toISOString() };

  const config = overrideConfig ?? currentShopConfig();
  const seed = config?.random?.seed ?? "core_shop_seed_0";
  const rotationHour = Math.max(0, Math.min(23, Number(config?.rotationHour ?? 0)));
  const weeklyDays = Math.max(1, Math.min(30, Number(config?.weeklyDurationDays ?? 7)));

  // Daily offset adjusted for rotation hour
  const adjustedTime = now.getTime() - rotationHour * 60 * 60 * 1000;
  const dayKey = new Date(adjustedTime).toISOString().slice(0, 10);
  const dayNumber = Math.floor(adjustedTime / dayMs);
  const weekNumber = Math.floor((dayNumber + 4) / weeklyDays);

  const characters = eligible.filter((i) => i.class === "AthenaCharacterItemDefinition");
  const gear = eligible.filter((i) => i.class !== "AthenaCharacterItemDefinition");

  const featured = [];
  const used = new Set();

  function pick(pool, rng) {
    const available = pool.filter((item) => !used.has(item.templateId));
    if (!available.length) return null;
    const choice = available[Math.floor(rng() * available.length)];
    used.add(choice.templateId);
    return choice;
  }

  // 1. Featured items (2 items), seeded weekly
  const featRng = createPrng(`${seed}:featured:${weekNumber}`);
  const f1 = pick(characters, featRng) || pick(eligible, featRng);
  if (f1) featured.push([f1.templateId, f1.defaultPrice]);
  const f2 = pick(featRng() > 0.5 ? gear : characters, featRng) || pick(eligible, featRng);
  if (f2) featured.push([f2.templateId, f2.defaultPrice]);

  // 2. Daily items (6 items), seeded daily and distinct from featured
  const dailyRng = createPrng(`${seed}:daily:${dayKey}`);
  const daily = [];
  for (let i = 0; i < 6; i++) {
    const item = pick(eligible, dailyRng);
    if (!item) break;
    daily.push([item.templateId, item.defaultPrice]);
  }

  return {
    featured,
    daily,
    generatedAt: now.toISOString()
  };
}

// The recorded day the UTC day of now shows in fnbr history (adjusted for rotation hour).
export function shopDay(now = new Date(), overrideConfig = null) {
  const config = overrideConfig ?? currentShopConfig();
  const rotationHour = Math.max(0, Math.min(23, Number(config?.rotationHour ?? 0)));
  const adjustedTime = now.getTime() - rotationHour * 60 * 60 * 1000;
  const days = Math.floor((adjustedTime - firstDay) / dayMs);
  return history[((days % history.length) + history.length) % history.length];
}

// When the shop next changes: the next rotation hour UTC.
export function nextRotation(now = new Date(), overrideConfig = null) {
  const config = overrideConfig ?? currentShopConfig();
  const rotationHour = Math.max(0, Math.min(23, Number(config?.rotationHour ?? 0)));
  const todayRotation = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), rotationHour, 0, 0, 0));
  if (now.getTime() < todayRotation.getTime()) return todayRotation;
  return new Date(todayRotation.getTime() + dayMs);
}

// When the featured (weekly) items next change, at the rotation hour: in history mode, the first day from now whose
// recorded day features other items (Epic's pair lasted a week, Sunday to Saturday from 5 November; the cycle's first and
// last weeks are shorter); in random and custom mode, the end of the weeklyDurationDays-day period generateRandomShop
// seeds the featured pair by.
const featuredOf = (day) => JSON.stringify(day.featured.map(([templateId]) => templateId));
export function weeklyStoreEnd(now = new Date(), overrideConfig = null) {
  const config = overrideConfig ?? currentShopConfig();
  const rotationMs = Math.max(0, Math.min(23, Number(config?.rotationHour ?? 0))) * 60 * 60 * 1000;
  const dayNumber = Math.floor((now.getTime() - rotationMs) / dayMs);
  const dayStart = (day) => new Date(day * dayMs + rotationMs);

  if (config.mode === "custom" || config.mode === "random") {
    const weeklyDays = Math.max(1, Math.min(30, Number(config?.weeklyDurationDays ?? 7)));
    const weekNumber = Math.floor((dayNumber + 4) / weeklyDays);
    return dayStart((weekNumber + 1) * weeklyDays - 4);
  }

  const today = featuredOf(shopDay(now, config));
  for (let days = 1; days < history.length; days++) {
    if (featuredOf(shopDay(dayStart(dayNumber + days), config)) !== today) return dayStart(dayNumber + days);
  }
  return dayStart(dayNumber + history.length);
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

  if (config.mode === "random") {
    const random = generateRandomShop(now, config);
    return {
      BRWeeklyStorefront: toOffers(random.featured),
      BRDailyStorefront: toOffers(random.daily)
    };
  }

  const day = shopDay(now, config);
  return {
    BRWeeklyStorefront: toOffers(day.featured),
    BRDailyStorefront: toOffers(day.daily)
  };
}

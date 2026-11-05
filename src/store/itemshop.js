import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { starSaleOffer } from "../battlepass/season2.js";
import { currentBuild } from "../builds/context.js";
import { currentEventsConfig } from "../events/events.js";
import { athenaCosmetics, athenaDisplayAssets, athenaSeason } from "../gamedata/athena.js";
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
// An offer is a FCatalogOffer whose first item grant is the cosmetic: the tile shows its art, rarity, name and type (no
// title, so the name and type are the item definition's: store/catalog.js offerJson) and its MtxCurrency price in
// V-Bucks. The art is the offer's display asset's TileImage when it has one, else the cosmetic's LargePreviewImage (the
// locker icon): AthenaDirectAcquisitionOfferWidget's OfferSet asks the offer info HasDisplayAsset (0x2E37EA0: its
// UFortMtxOfferData at +0x40 is set) and then shows GetTileImage (0x2E2EA30). The store loads every offer's
// displayAssetPath (FCatalogOffer +0x190) as a soft object path (sub_2EAC960, RequestAsyncLoad) and gives an offer the
// loaded FortMtxOfferData whose path name is its displayAssetPath, compared case-insensitively (sub_2E845F0 →
// sub_2E7C980), so the path must name the object: "/Game/Catalog/DisplayAssets/DA_X.DA_X" (Core-Backend #99). The
// offer's title here is only for messages. Offers carry no requirements: the client leaves out every offer whose
// requirements fail (0x3C52200 with the store's flags), where an owned item should show as owned
// (UFortMcpContext::IsOwned 0x710D00, the offer's grants held in athena or profile0: the tile's OwnedSwitcher; the
// details screen then shows "owned" and offers no purchase).
//
// What is on sale is Epic's own shop of Season 1 (1.8 to 1.10), day by day from 30 October to 13 December 2017, as
// fnbr.co recorded it (itemshop.json: the featured items, then the daily ones, with their V-Buck prices; every item is in
// 1.8's game data). The prices are what the shop charged that day, not fnbr.co's (today's): the Fortnite Wiki's Item Shop
// History pages for those days agree with fnbr.co's except for Skull Trooper, 1,200 V-Bucks in 2017 (1,500 since its
// 2018 return; the reporter's 2017 footage on #69 shows 1,200 too), and Pink Flamingo from 3 to 9 December, 1,200 there
// but 1,500 in November and on every other source (🟡: kept at 1,500). The shop replays that history in a 45-day cycle: day 0 is 30 October 2017, and each UTC day since
// then shows the recorded day it falls on, modulo 45 (Core's choice). It changes at UTC midnight, as Epic's did.
// Admins can also configure the shop via the admin panel (mode: "fnbr" | "random" | "custom", Core-Backend #69).
//
// 1.11, 2.1, 2.2, 2.3, 2.4, 2.4.2 and 2.5 are Season 2, and have its own shop (Core-Backend #150): Epic's of Season 2, day by day from its first day, 14
// December 2017, to its last, 21 February 2018 (itemshop-season2.json), replayed the same way in a 70-day cycle, but from
// its own start (seasonStart below), so that it opens on 14 December's shop and plays forward in order. Its items and prices are the Fortnite Wiki's Item Shop History pages' (what the shop charged that day;
// fnbr.co's per-day pages show today's prices, e.g. Brite Bomber 1,800 where it was 1,200), with fnbr.co's list
// checked against it; where the two lists differ (14 and 31 December, 31 January) the wiki's is kept, and 8 February,
// changed during the day, is its first shop ("Part 1"). The wiki has Half Shell at 1,200 on 11 January, 800 on every
// other day and on fnbr.co (🟡: kept at 800). The season ran into the 2.x builds, so their new cosmetics (Alpine Ace,
// Mogul Master, Love Ranger, Cuddle Team Leader, Wukong, Chomp Jr., ...) are left out, as are Battle Pass Tiers; on the
// days Epic featured only those, the featured section is empty.
//
// 3.0 is Season 3, and has its own shop: Epic's of Season 3, day by day from its first day, 22 February 2018, to its
// last, 30 April 2018 (itemshop-season3.json), replayed in a 68-day cycle from its own start, as Season 2's. Its items
// and prices are the Fortnite Wiki's Item Shop History pages' alone (🟡: fnbr.co wasn't checked against it), each item
// of a cycling tile listed, Alpine Ace's and Mogul Master's country styles too, the items of one tile marked as such
// (tileOf below: 3.0 shows them in one tile, cycling, as Epic's did; Core-Backend #217). Season 2's history has no such
// tile: none of its wiki tiles held two of the cosmetics it lists, so its shops are as they were. The
// season ran on to 3.6 (3.3, CL-3942182, adds no cosmetic: only the rarity of three of 3.2's): 3.2's (CL-3935073: Power Chord, Sgt. Green Clover, Highland Warrior, Battle Hound, their gliders,
// pickaxes and emotes) and 3.1's (CL-3915963) cosmetics are in on the days Epic sold them (Rex, Burnout, Radiant and
// Brilliant Striker, Empire Axe, Pick Squeak, Tactical Spade, Make It Rain, Flippin' Sexy, Reanimated; a build sees only
// those its data has, so 3.0's shop is as it was), and so are 3.5.1's (CL-4000805: 3.4's and 3.5's Raven, Rabbit Raider,
// Bunny Brawler, Dark Vanguard, Leviathan, Tricera Ops, Tomatohead, Cipher, Midnight Ops, Whiplash, their gliders,
// pickaxes and emotes, from 30 March); the ones no build Core has (Steelsight, Brite Gunner...) and Battle Pass Tiers are
// left out. A build's season is its athena data's seasonNumber, Season 1 without one.
const readHistory = (file) => {
  const days = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), file), "utf8")).days;
  return { days, firstDay: Date.parse(`${days[0].date}T00:00:00Z`) };
};
const seasonHistories = { 1: readHistory("itemshop.json"), 2: readHistory("itemshop-season2.json"),
  3: readHistory("itemshop-season3.json") };
export const seasonOfBuild = () => athenaSeason()?.seasonNumber ?? 1;
const historyOf = (season) => seasonHistories[season] ?? seasonHistories[1];
// The first day of a season's history (ms, UTC): Season 3's is 22 February 2018, Epic's first day of the season.
export const seasonHistoryStart = (season) => historyOf(season).firstDay;
const dayMs = 24 * 60 * 60 * 1000;
const rotationMsOf = (config) => Math.max(0, Math.min(23, Number(config?.rotationHour ?? 0))) * 60 * 60 * 1000;

// The UTC day (at the rotation hour) a season's replay starts on, its day 1: the admin's seasonStarts[season] (events
// config, "YYYY-MM-DD") if set. Without one, Season 2 starts on the day the backend first serves it, which is then kept
// in the settings (configureSeasonStarts' recorder), so that 1.11's shop opens on Season 2's first shop and its countdown
// shows the season's full 70 days, as the reporter asked on #150; resetting it in the admin panel starts it again on the
// next day it is served. Season 1 keeps its history's own first day, 30 October 2017, on the shared clock (Core's
// choice: its replay and countdown have run that way since the shop was added, every running server is somewhere in its
// cycle, and re-anchoring it would jump their shops and countdowns), unless an admin sets its start too. With no
// recorder (no settings store), Season 2 also keeps its history's first day. Season 3 starts the same way, on the day
// 3.0 is first served.
const anchoredSeasons = [2, 3];
let seasonStartRecorder = null;
let recordSeasonStarts = true;
export function configureSeasonStarts(recorder) {
  seasonStartRecorder = typeof recorder === "function" ? recorder : null;
}
// The admin panel's previews: a season not started yet shows as starting today, without starting it.
export function withoutSeasonStartRecording(fn) {
  const was = recordSeasonStarts;
  recordSeasonStarts = false;
  try {
    return fn();
  } finally {
    recordSeasonStarts = was;
  }
}
export function seasonStart(season = seasonOfBuild(), now = new Date(), overrideConfig = null) {
  const config = overrideConfig ?? currentShopConfig();
  const set = config?.seasonStarts?.[season] ?? currentEventsConfig()?.seasonStarts?.[season];
  const parsed = set ? Date.parse(`${String(set).slice(0, 10)}T00:00:00Z`) : NaN;
  if (!isNaN(parsed)) return parsed;
  if (!anchoredSeasons.includes(Number(season)) || !seasonStartRecorder) return historyOf(season).firstDay;
  const today = Math.floor((now.getTime() - rotationMsOf(config)) / dayMs) * dayMs;
  if (recordSeasonStarts) seasonStartRecorder(Number(season), new Date(today).toISOString().slice(0, 10));
  return today;
}

const firstBuild = 3724489;
export const hasItemShop = (changelist = currentBuild()) => Number(changelist) >= firstBuild;

let shopConfigProvider = null;

export function configureItemShop(provider) {
  shopConfigProvider = typeof provider === "function" ? provider : () => provider;
}

export function currentShopConfig() {
  return (shopConfigProvider ? shopConfigProvider() : null) ?? { mode: "fnbr" };
}

// Every cosmetic the item shop has sold (Core-Backend #163, the admin panel's Give all item shop cosmetics), each template
// id once: history, what each season's history sold (Season 1's itemshop.json, Season 2's itemshop-season2.json), featured
// and daily; custom, what the admin's custom shop lists (config.custom, kept whichever mode is on). Not the random shop's
// picks (any eligible cosmetic, never a record of a sale) nor the Season Shop's level-locked items (store/seasonshop.js).
export function soldCosmeticIds(config = currentShopConfig()) {
  const listed = (...lists) => [...new Map(lists.flatMap((list) => (Array.isArray(list) ? list : []))
    .map((entry) => (Array.isArray(entry) ? entry[0] : entry)).filter((id) => typeof id === "string" && id.trim())
    .map((id) => [id.trim().toLowerCase(), id.trim()])).values()];
  return {
    history: listed(...Object.values(seasonHistories).flatMap(({ days }) => days.flatMap((day) => [day.featured, day.daily]))),
    custom: listed(config?.custom?.featured, config?.custom?.daily)
  };
}

// The type a cosmetic's tile and the admin panel show ("Outfit", "Harvesting Tool", "Glider"…), by its item definition
// class, in the locker's order. A class not listed is named from its template type (AthenaFoo:… → "Foo").
const cosmeticTypes = {
  AthenaCharacterItemDefinition: "Outfit",
  AthenaBackpackItemDefinition: "Back Bling",
  AthenaPickaxeItemDefinition: "Harvesting Tool",
  AthenaGliderItemDefinition: "Glider",
  AthenaSkyDiveContrailItemDefinition: "Contrail",
  AthenaDanceItemDefinition: "Emote",
  AthenaConsumableEmoteItemDefinition: "Consumable Emote",
  AthenaVictoryPoseItemDefinition: "Victory Pose",
  AthenaSprayItemDefinition: "Spray",
  AthenaEmojiItemDefinition: "Emoticon",
  AthenaToyItemDefinition: "Toy",
  AthenaHatItemDefinition: "Hat",
  AthenaItemWrapDefinition: "Wrap",
  AthenaMusicPackItemDefinition: "Music",
  AthenaPetCarrierItemDefinition: "Pet",
  AthenaLoadingScreenItemDefinition: "Loading Screen",
  AthenaBattleBusItemDefinition: "Battle Bus"
};
export const cosmeticTypeOrder = Object.values(cosmeticTypes);

export function cosmeticType(cosmeticClass, templateId = "") {
  const type = String(templateId).split(":")[0].replace(/^Athena/i, "");
  return cosmeticTypes[cosmeticClass] ?? (type ? type.replace(/([a-z])([A-Z])/g, "$1 $2") : "Cosmetic");
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

// The recorded day the UTC day of now shows in the season's history (adjusted for rotation hour).
export function shopDay(now = new Date(), overrideConfig = null, season = seasonOfBuild()) {
  const { days: history } = historyOf(season);
  const config = overrideConfig ?? currentShopConfig();
  const firstDay = seasonStart(season, now, config);
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
export function weeklyStoreEnd(now = new Date(), overrideConfig = null, season = seasonOfBuild()) {
  const config = overrideConfig ?? currentShopConfig();
  const rotationMs = Math.max(0, Math.min(23, Number(config?.rotationHour ?? 0))) * 60 * 60 * 1000;
  const dayNumber = Math.floor((now.getTime() - rotationMs) / dayMs);
  const dayStart = (day) => new Date(day * dayMs + rotationMs);

  if (config.mode === "custom" || config.mode === "random") {
    const weeklyDays = Math.max(1, Math.min(30, Number(config?.weeklyDurationDays ?? 7)));
    const weekNumber = Math.floor((dayNumber + 4) / weeklyDays);
    return dayStart((weekNumber + 1) * weeklyDays - 4);
  }

  const { days: history } = historyOf(season);
  const today = featuredOf(shopDay(now, config, season));
  for (let days = 1; days < history.length; days++) {
    if (featuredOf(shopDay(dayStart(dayNumber + days), config, season)) !== today) return dayStart(dayNumber + days);
  }
  return dayStart(dayNumber + history.length);
}

// When the season ends, for the Season Shop's and 1.11's Battle Pass tab's countdowns (store/seasonshop.js,
// services/fortnite/calendar.js): the end of the build's season on Epic's own schedule, replayed on the shop's clock
// (UTC days at the rotation hour, from seasonStart), which is the end of the season's shop history's cycle, so that the countdown and the
// shop start over together (Core-Backend #149, Core's choice: each cycle is the season again at its original length, so
// the countdown reads as it did on that day of the season, then resets, as the shop's replay does). Season 1 (1.8 to
// 1.10) is its history's 45 days, 30 October to its last day, 13 December 2017 (the season began on 25 October, before
// the shop's first recorded day). Season 2 (1.11 to 2.5) ran from 14 December 2017 to its last day, 21 February 2018 (Season 3
// launched on 22 February): 70 days. Season 3 (3.0 on) ran from 22 February to its last day, 30 April 2018 (Season 4
// launched on 1 May): 68 days. An admin's customSeasonEnd overrides them all, in every shop mode.
export function seasonEnd(now = new Date(), overrideConfig = null, season = seasonOfBuild()) {
  const custom = overrideConfig?.customSeasonEnd ?? currentEventsConfig()?.customSeasonEnd;
  if (custom) {
    const parsed = new Date(custom);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  const config = overrideConfig ?? currentShopConfig();
  const rotationMs = Math.max(0, Math.min(23, Number(config?.rotationHour ?? 0))) * 60 * 60 * 1000;
  const { days: history } = historyOf(season);
  const firstDay = seasonStart(season, now, config);
  const days = Math.floor((now.getTime() - rotationMs - firstDay) / dayMs);
  const cycle = Math.floor(days / history.length);
  return new Date(firstDay + (cycle + 1) * history.length * dayMs + rotationMs);
}

// The moment of Epic's season now stands for on the season's replay (UTC, from seasonStart at the rotation hour, cycling
// with the shop's history): Season 2's day 1 is 14 December 2017, so day 6 at 13:00 is 19 December 2017 13:00 GMT. The
// content updates of a season run on it (events/contentupdates.js).
export function seasonMoment(now = new Date(), overrideConfig = null, season = seasonOfBuild()) {
  const config = overrideConfig ?? currentShopConfig();
  const { days: history, firstDay: historyFirstDay } = historyOf(season);
  const cycle = history.length * dayMs;
  const elapsed = now.getTime() - rotationMsOf(config) - seasonStart(season, now, config);
  return new Date(historyFirstDay + ((elapsed % cycle) + cycle) % cycle);
}

// When the season's replay next stands at a moment of Epic's season (a Date or ms, UTC): the countdown to something that
// happened on that day of the season, e.g. an event's end (store/eventstore.js). Never now: a moment just passed comes
// round again a cycle later.
export function nextReplayOf(moment, now = new Date(), overrideConfig = null, season = seasonOfBuild()) {
  const cycle = historyOf(season).days.length * dayMs;
  const ahead = ((new Date(moment).getTime() - seasonMoment(now, overrideConfig, season).getTime()) % cycle + cycle) % cycle;
  return new Date(now.getTime() + (ahead || cycle));
}

const offerIdOf = (templateId) =>`core_br_${templateId.split(":")[1].toLowerCase()}`;

// The featured items' shop art: the display asset (FortMtxOfferData with Battle Royale tile art) the extractor matched to
// the cosmetic by its names (gamedata/athena.json displayAssets, tools/extractor), by object path, so each build's are
// found without a list here. A cosmetic with none keeps the locker icon. Only the featured (weekly) storefront's offers
// carry one, as the assets' names (DA_Featured_...) say, in every build (Core-Backend #220): the offer widget
// (AthenaDirectAcquisitionOfferWidget's OfferSet, 2.5's and 3.0's alike) shows a display asset's TileImage on any tile
// that has one (HasDisplayAsset, GetTileImage), and otherwise loads the item's LargePreviewImage, its locker icon. The
// TileImage is the featured tile's tall art (UpdateStyle_Sizing: a LargeTile is 384x608, a daily one 256x292), so a
// daily tile given one showed the weekly art cropped, where Epic's daily tiles showed the locker icon. 1.11 to 3.0 gave
// the daily offers theirs too (Core-Backend #145), which #220 undid.
export function featuredDisplayAsset(templateId) {
  return athenaDisplayAssets()[templateId] ?? "";
}

// A shop entry's tile ({tile, banner}, its third element: itemshop-season3.json, an admin's custom shop): the items of
// one tile share an offer category, and its callout is the offers' BannerOverride (store/catalog.js offerJson). From
// 2.4.2 (CL-3870737; 2.5 and 3.0 too) the shop puts the offers of one category in one tile: AthenaDirectAcquisitionScreen's
// GenerateOfferWidget takes the offer's GetFortStoreOfferCategory (0x28F7620 in 3.0 → sub_2746FE0: the FCatalogOffer's
// Categories[0], +0x88) and, when a tile of that category was made already (its CategorizedOfferWidgets map, both
// storefronts' tiles together), adds the offer to that tile (UFortDirectAcquisitionOfferWidgetBase::AddOffer, its
// GroupedOffers) instead of making a new one. A tile of two or more offers shows "{Num} of {Count}" and moves on to the
// next offer every 3 seconds (AthenaDirectAcquisitionOfferWidget's OfferCarousel timer), and its details screen pages
// through them (SetPagedItems), as Epic's tiles cycled through Alpine Ace's country styles in Season 3 (Core-Backend #217).
// The banner is GetBannerOverrideTag (0x28F7100 → sub_27435D0: the offer's metaInfo "BannerOverride", 0x7BCA80 matching
// keys case-insensitively), a key of AthenaDirectAcquisitionOffer_SpecialBanner's BannerOverrides (PickYourStyle "Pick
// Your Style!", CollectTheSet "Collect the Set!", Back "It's Back!"...). The client before 2.4.2 has neither (no
// GroupedOffers nor GetBannerOverrideTag in its FortniteUI), so it makes each offer its own tile, as before. The category
// names a tile by its number of the day, "Panel 01" (🟡: as Epic's catalogs named theirs), so the numbers are the day's,
// featured and daily together.
const tileOf = (tile) => {
  const number = Math.floor(Number(tile?.tile));
  const banner = typeof tile?.banner === "string" && /^[A-Za-z]+$/.test(tile.banner) ? tile.banner : "";
  return { ...(number > 0 ? { category: `Panel ${String(number).padStart(2, "0")}` } : {}), ...(banner ? { banner } : {}) };
};

// Outfits Epic's shop sold with a back bling of their own (3.1, CL-3915963: Rex, CID_093_Athena_Commando_M_Dinosaur, "Comes
// with the Scaly Back Bling", BID_031_Dinosaur). The outfit's hero wears no back bling part, so the pairing is the
// catalog's, which isn't in the paks (🟡: from the Fortnite Wiki's Rex page); the offer grants both, as Epic's did.
// 3.2 (CL-3935073) adds Power Chord with Six String (BID_034_RockerPunk) and Highland Warrior with Buckler (BID_035_Scathach), as the
// wiki's pages name them ("bundled_with"); Battle Hound's Crested Cape is not in 3.2's paks. 3.5.1 (CL-4000805) adds 3.4's and
// 3.5's, as the wiki's pages name them: Raven's Iron Cage, Rabbit Raider's Hard Boiled, Bunny Brawler's Eggshell, Dark
// Vanguard's Dark Void, Leviathan's Fish Tank, Tricera Ops' Hatchling and Tomatohead's Special Delivery, and Royale Flags
// (BID_040_Wukong, "bundled_with Wukong", from 28 March 2018) with 2.5's Wukong, on builds whose data has the back bling.
export const bundledBackBlings = {
  "AthenaCharacter:cid_093_athena_commando_m_dinosaur": "AthenaBackpack:bid_031_dinosaur",
  "AthenaCharacter:cid_097_athena_commando_f_rockerpunk": "AthenaBackpack:bid_034_rockerpunk",
  "AthenaCharacter:cid_099_athena_commando_f_scathach": "AthenaBackpack:bid_035_scathach",
  "AthenaCharacter:cid_102_athena_commando_m_raven": "AthenaBackpack:bid_036_raven",
  "AthenaCharacter:cid_103_athena_commando_m_bunny": "AthenaBackpack:bid_037_bunnymale",
  "AthenaCharacter:cid_104_athena_commando_f_bunny": "AthenaBackpack:bid_038_bunnyfemale",
  "AthenaCharacter:cid_105_athena_commando_f_spaceblack": "AthenaBackpack:bid_039_spaceblackfemale",
  "AthenaCharacter:cid_107_athena_commando_f_pajamaparty": "AthenaBackpack:bid_041_pajamaparty",
  "AthenaCharacter:cid_108_athena_commando_m_fishhead": "AthenaBackpack:bid_042_fishhead",
  "AthenaCharacter:cid_109_athena_commando_m_pizza": "AthenaBackpack:bid_043_pizza",
  "AthenaCharacter:cid_071_athena_commando_m_wukong": "AthenaBackpack:bid_040_wukong"
};

// The day's offers by storefront, those the requesting build has the cosmetic for. Never a cosmetic the shop doesn't sell
// (profiles/athena.js isNonShopCosmetic): any season's Battle Pass rewards, chase rewards, umbrellas, starters
// (Core-Backend #222), whichever list names it: the season's history, the random shop or the admin's custom shop.
export function itemShopOffers(now = new Date(), overrideConfig = null) {
  if (!hasItemShop()) return { BRWeeklyStorefront: [], BRDailyStorefront: [] };
  const cosmetics = athenaCosmetics();
  const config = overrideConfig ?? currentShopConfig();

  const toOffers = (entries, featured = false) => entries
    .filter(([templateId]) => cosmetics[templateId] && !isNonShopCosmetic(templateId))
    .map(([templateId, price, tile]) => {
      const cosmetic = cosmetics[templateId];
      const validPrice = Number(price) > 0 ? Number(price) : defaultPriceFor(cosmetic);
      const backBling = bundledBackBlings[templateId];
      return {
        ...(backBling && cosmetics[backBling] ? { itemGrants: [{ templateId, quantity: 1 }, { templateId: backBling, quantity: 1 }] } : {}),
        offerId: offerIdOf(templateId),
        templateId,
        title: cosmetic.name.trim(),
        currencyType: "MtxCurrency",
        currencySubType: "",
        price: validPrice,
        displayAssetPath: featured ? featuredDisplayAsset(templateId) : "",
        athena: true,
        ...tileOf(tile)
      };
    });

  if (config.mode === "custom" && config.custom) {
    const feat = Array.isArray(config.custom.featured) ? config.custom.featured : [];
    const daily = Array.isArray(config.custom.daily) ? config.custom.daily : [];
    return {
      BRWeeklyStorefront: toOffers(feat, true),
      BRDailyStorefront: toOffers(daily)
    };
  }

  if (config.mode === "random") {
    const random = generateRandomShop(now, config);
    return {
      BRWeeklyStorefront: toOffers(random.featured, true),
      BRDailyStorefront: toOffers(random.daily)
    };
  }

  // 2.2's Battle Pass tier sale, on its days (battlepass/season2.js).
  const day = shopDay(now, config);
  const sale = starSaleOffer(day.date);
  return {
    BRWeeklyStorefront: [...toOffers(day.featured, true), ...(sale ? [sale] : [])],
    BRDailyStorefront: toOffers(day.daily)
  };
}

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
// An offer is a FCatalogOffer whose first item grant is the cosmetic: the tile shows its LargePreviewImage, rarity and
// name (no displayAssetPath: HasDisplayAsset is false) and its MtxCurrency price in V-Bucks. Offers carry no
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
const historyFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "itemshop.json");
const history = JSON.parse(fs.readFileSync(historyFile, "utf8")).days;
const firstDay = Date.parse(`${history[0].date}T00:00:00Z`);
const dayMs = 24 * 60 * 60 * 1000;

const firstBuild = 3724489;
export const hasItemShop = (changelist = currentBuild()) => Number(changelist) >= firstBuild;

// The recorded day the UTC day of now shows.
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
export function weeklyStoreEnd(now = new Date()) {
  const today = featuredOf(shopDay(now));
  const midnight = Math.floor(now.getTime() / dayMs) * dayMs;
  for (let days = 1; days < history.length; days++) {
    if (featuredOf(shopDay(new Date(midnight + days * dayMs))) !== today) return new Date(midnight + days * dayMs);
  }
  return new Date(midnight + history.length * dayMs);
}

const offerIdOf = (templateId) => `core_br_${templateId.split(":")[1].toLowerCase()}`;

// The day's offers by storefront, those the requesting build has the cosmetic for.
export function itemShopOffers(now = new Date()) {
  if (!hasItemShop()) return { BRWeeklyStorefront: [], BRDailyStorefront: [] };
  const cosmetics = athenaCosmetics();
  const offers = (entries) => entries.filter(([templateId]) => cosmetics[templateId]).map(([templateId, price]) => ({
    offerId: offerIdOf(templateId), templateId, title: cosmetics[templateId].name.trim(), currencyType: "MtxCurrency", currencySubType: "", price,
    athena: true
  }));
  const day = shopDay(now);
  return { BRWeeklyStorefront: offers(day.featured), BRDailyStorefront: offers(day.daily) };
}

import { athenaCosmetics, athenaSeason } from "../gamedata/athena.js";
import { getItem } from "../gamedata/items.js";
import { currentBattlePassConfig } from "./season1.js";

// Season 2's Battle Pass (1.11, CL-3807424; Core-Backend #145). 1.11's Battle Pass tab is AthenaSeasonTab
// (USeasonPassScreenBase, a UFortDirectAcquisitionWidgetBase): its offers are the season's storefront's (AthenaSeason2's
// SeasonStorefront, "BRSeason2"), and the first one the tab is given (GenerateOfferWidget keeps the first valid offer as
// SeasonCatalogOffer) is what its Purchase button buys, through AthenaDirectAcquisitionMTXDetails, the item shop's
// purchase screen: "Purchase the {ItemName} to claim all the rewards you've earned", the offer's name. Without an offer
// the button says "Purchase currently unavailible." Its tiers are bought in AthenaSeasonLevelConfirmationModal, which
// buys the catalog offer F86AC2ED4B3EA4B2D65EF1B2629572A0 (its BuyTierOfferID) once per tier, 1 to 10 at a time
// (MaxExtraLevelsYouCanBuyInOneGo 9, the purchase quantity), showing 150 V-Bucks a tier (GetVBuckPrice) and "GET
// V-BUCKS" once the player can't pay for one.
//
// The offers are the season's storefront's, Epic's prices: the Battle Pass for 950 V-Bucks and the Battle Pass Bundle
// (the Battle Pass and 25 tiers) for 2,800, its display asset DA_BR_Season2_BattlePass (FortMtxOfferData, its details
// art T-BattlePass-Season2), and the tier offer for 150 V-Bucks a tier under the id the client buys. The pass comes first,
// for the tab. Each grants nothing itself (no item grants): buying one sets the athena profile's Battle Pass stats
// (profiles/seasons.js), and an owned pass leaves the storefront, as the tab then shows the tiers to buy instead.
// The admin panel's Battle Pass tab sets the pass and bundle prices (battlepass.season2); a tier's is the client's.
//
// The purchase screen (Core-Backend #156) shows the offer's own texts: its Title over its ShortDescription ("BATTLE PASS",
// "SEASON 2"), its Description below, and the regular price struck through beside the final one (1,800, 950). The pass's
// are Epic's BRSeason2 offer's, C3BA14F04F4D56FC1D490F8011B56553 (BR.Season2.BattlePass.01: "Season 2: Dec 14 - Feb 20",
// what the pass gives at once and what it unlocks, regularPrice 1,800 and finalPrice 950 PercentOff), and the tier's
// Epic's F86AC2ED4B3EA4B2D65EF1B2629572A0 (BR.Season2.SingleTier.01, "Battle Pass Level", "Get great rewards now!").
// Epic's Season 2 storefront had no bundle offer of its own (its offer texts have one from Season 3: "Battle Bundle",
// "Battle pass + 25 tiers!"); Core's bundle takes Season 3's form with what Season 2's pass and its first 25 tiers give
// (🟡 Core's text: tiers 1 to 26 of AthenaSeason2's BookXpSchedulePaid and BookXpScheduleFree).
//
// Season 3's Battle Pass (3.0, CL-3901517) is AthenaSeason3's: 100 tiers, the BRSeason3 storefront, its own display
// assets (DA_BR_Season3_BattlePass, and DA_BR_Season3_BattlePassWithLevels for the bundle, "Battle pass + 25 tiers!"),
// at Epic's prices, 950 and 2,800 V-Bucks. Its tier 1 Battle Pass rewards give the weekly challenges
// (ChallengeBundleSchedule:season3_challenge_schedule, profiles/challenges.js) in place of Season 2's daily one.
// AthenaSeason3 names a tier offer of its own (BattlePassLevelOfferID E2D7975EFEC54A45900D8D9A6D9D273C) while 3.0's
// AthenaSeasonLevelConfirmationModal still has Season 2's BuyTierOfferID: the storefront's tier offer is the season's,
// and a purchase of either id buys tiers. The offers' texts are Core's (🟡: Epic's Season 3 catalog isn't at hand), in
// Season 2's form, from what AthenaSeason3's pass and its first 26 tiers give, and the pass's offer id is Core's.
// The admin panel's Battle Pass tab sets each season's pass and bundle prices (battlepass.season2, battlepass.season3).
export const tierOfferId = "F86AC2ED4B3EA4B2D65EF1B2629572A0";
export const tierPrice = 150;
export const bundleTiers = 25;

export const defaultSeasonTwo = { battlePassPrice: 950, bundlePrice: 2800 };
// Each season's default prices: Season 3's are Season 2's.
export const defaultSeasonPrices = { 2: defaultSeasonTwo, 3: { battlePassPrice: 950, bundlePrice: 2800 } };

export function sanitizeSeasonPrices(input, current, defaults = defaultSeasonTwo) {
  const result = { ...defaults, ...(current ?? {}) };
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  for (const key of Object.keys(defaults)) {
    const value = Number(input[key]);
    if (input[key] !== undefined && Number.isInteger(value) && value >= 0 && value <= 100000) result[key] = value;
  }
  return result;
}
export const sanitizeSeasonTwo = (input, current = defaultSeasonTwo) => sanitizeSeasonPrices(input, current, defaultSeasonTwo);

// A season's Battle Pass prices (battlepass.season<n>).
export const seasonPassConfig = (season) => sanitizeSeasonPrices(currentBattlePassConfig()?.[`season${season}`], undefined,
  defaultSeasonPrices[season] ?? defaultSeasonTwo);
export const seasonTwoConfig = () => seasonPassConfig(2);

export const battlePassOfferId = "C3BA14F04F4D56FC1D490F8011B56553";
const passRegularPrice = 1800;
const passDescription = [
  "Season 2: Dec 14 - Feb 20", "",
  "Instantly get these items valued at over 2000 V-Bucks.",
  "  • Blue Squire Outfit", "  • 50% Bonus Season Match XP", "  • 10% Bonus Season Friend Match XP", "  • Extra Battle Pass Daily Challenge", "",
  "Play to level up your Battle Pass, unlocking up to 65+ rewards worth 12,000 V-Bucks (typically takes 75 to 150 hours of play). Want it all faster? You can use V-Bucks to buy levels any time!",
  "  • Black Knight plus 2 other outfits", "  • 3 Harvesting Tools", "  • 2 Gliders", "  • 1000 V-Bucks", "  • 60% Bonus Season Match XP",
  "  • 20% Bonus Season Friend Match XP", "  • 2 Animated Emotes", "  • 13 2D Emotes", "  • and more!"
].join("\r\n");
const bundleDescription = [
  "Season 2: Dec 14 - Feb 20", "",
  `Instantly get the Battle Pass and ${bundleTiers} tiers.`,
  "  • Blue Squire Outfit", "  • Royale Knight Outfit", "  • Pulse Axe Harvesting Tool", "  • Get Down! Glider", "  • 2 Animated Emotes",
  "  • 500 V-Bucks", "  • 70% Bonus Season Match XP", "  • 20% Bonus Season Friend Match XP", "  • Extra Battle Pass Daily Challenge", "  • and more!", "",
  "Play to level up your Battle Pass the rest of the way, up to the Black Knight at tier 70. Want it all faster? You can use V-Bucks to buy levels any time!"
].join("\r\n");
const season3PassDescription = [
  "Season 3: Feb 22 - Apr 30", "",
  "Instantly get these items:",
  "  • Mission Specialist Outfit", "  • 50% Bonus Season Match XP", "  • 10% Bonus Season Friend Match XP", "  • Exclusive Weekly Challenges", "",
  "Play to level up your Battle Pass, unlocking up to 100 tiers of rewards (typically takes 75 to 150 hours of play). Want it all faster? You can use V-Bucks to buy levels any time!",
  "  • The Reaper plus 4 other outfits", "  • 2 Harvesting Tools", "  • 2 Gliders", "  • 2 Back Blings", "  • 5 Contrails", "  • 1300 V-Bucks",
  "  • 70% Bonus Season Match XP", "  • 30% Bonus Season Friend Match XP", "  • 3 Emotes", "  • 17 Emoticons", "  • and more!"
].join("\r\n");
const season3BundleDescription = [
  "Season 3: Feb 22 - Apr 30", "",
  `Instantly get the Battle Pass and ${bundleTiers} tiers.`,
  "  • Mission Specialist Outfit", "  • Rust Lord Outfit", "  • Sawtooth Harvesting Tool", "  • Rainbow Rider Glider", "  • Precision Back Bling",
  "  • 400 V-Bucks", "  • 70% Bonus Season Match XP", "  • 20% Bonus Season Friend Match XP", "  • Exclusive Weekly Challenges", "  • and more!", "",
  "Play to level up your Battle Pass the rest of the way, up to The Reaper at tier 100. Want it all faster? You can use V-Bucks to buy levels any time!"
].join("\r\n");
const seasonTexts = {
  2: { passOfferId: battlePassOfferId, pass: passDescription, bundle: bundleDescription, bundleAsset: "BattlePass" },
  3: { passOfferId: "core_br_season3_battlepass", pass: season3PassDescription, bundle: season3BundleDescription, bundleAsset: "BattlePassWithLevels" }
};

// The season's tier offer id: AthenaSeason3's BattlePassLevelOfferID from Season 3, else the modal's.
const seasonTierOfferId = (season) => season.battlePassLevelOfferId || tierOfferId;

const seasonOffers = () => {
  const season = athenaSeason();
  if (!season) return [];
  const { battlePassPrice, bundlePrice } = seasonPassConfig(season.seasonNumber);
  const texts = seasonTexts[season.seasonNumber] ?? seasonTexts[2];
  const name = `Season ${season.seasonNumber}`;
  const asset = (kind) => `/Game/Catalog/DisplayAssets/DA_BR_Season${season.seasonNumber}_${kind}.DA_BR_Season${season.seasonNumber}_${kind}`;
  const offer = (fields) => ({ currencyType: "MtxCurrency", currencySubType: "", itemGrants: [], storefront: season.storefront, ...fields });
  return [
    offer({ offerId: texts.passOfferId, devName: `BR.Season${season.seasonNumber}.BattlePass.01`, battlePass: "pass",
      title: "Battle Pass", shortDescription: name, description: texts.pass,
      price: battlePassPrice, regularPrice: Math.max(battlePassPrice, passRegularPrice), displayAssetPath: asset("BattlePass") }),
    offer({ offerId: `core_br_season${season.seasonNumber}_battlebundle`, devName: `BR.Season${season.seasonNumber}.BattleBundle.01`, battlePass: "bundle",
      title: "Battle Bundle", shortDescription: `Battle pass + ${bundleTiers} tiers!`, description: texts.bundle,
      price: bundlePrice, displayAssetPath: asset(texts.bundleAsset) }),
    offer({ offerId: seasonTierOfferId(season), devName: `BR.Season${season.seasonNumber}.SingleTier.01`, battlePass: "tier",
      title: "Battle Pass Level", shortDescription: "Get great rewards now!", description: "Get great rewards now!", price: tierPrice, displayAssetPath: "" })
  ];
};

// 2.2's (CL-3841827) tier sale: "Buy ten Battle Pass tiers for the price of six with this special bundle in the store.
// On sale now for a limited time!" 2.2's paks add its item, Token:AthenaBattlePassStarSale_S2 ("Battle Pass Tiers", "10
// tiers (100 stars)", "In celebration of the map update, a special limited time offer on 10 tiers (100 stars) to advance
// your Battle Pass"), and its tile, DA_Featured_AthenaBattlePassStarSale_S2. Epic's item shop featured it for 900 V-Bucks
// (1,500 struck through) from 14 to 24 January and from 15 to 20 February 2018 (the Fortnite Wiki's Item Shop History
// pages), so Season 2's replay features it on those days (store/itemshop.js), on a build whose data has the token. Epic's
// grant was the token, which its servers turned into the tiers; Core gives the ten tiers at once, as ten of the tier
// offer would, and they need no Battle Pass, as the tiers don't. 2.3 (CL-3847564) keeps the token and the sale, and its
// notes fix it: "Players can no longer purchase the Battle Pass x10 Tier bundle when at or above Battle Pass tier 65";
// Core sells no tiers past the last (PurchaseCatalogEntry: ten tiers need ten left), which already holds at tier 61.
// 2.4 (CL-3858292), 2.4.2 (CL-3870737) and 2.5 (CL-3889387) keep the token and the sale too.
export const starSaleToken = "Token:athenabattlepassstarsale_s2";
const starSaleTiers = 10;
const starSaleDays = [["2018-01-14", "2018-01-24"], ["2018-02-15", "2018-02-20"]];

// The sale's offer on a day of Season 2's history ("2018-01-18"), or null.
export function starSaleOffer(date) {
  const season = athenaSeason();
  const token = getItem(starSaleToken);
  if (!season || !token || !starSaleDays.some(([first, last]) => date >= first && date <= last)) return null;
  return {
    offerId: `core_br_season${season.seasonNumber}_starsale`, devName: `BR.Season${season.seasonNumber}.TierSale.01`, templateId: starSaleToken,
    battlePass: "tier", tiers: starSaleTiers, currencyType: "MtxCurrency", currencySubType: "",
    title: "Battle Pass Tiers", shortDescription: `${starSaleTiers} tiers (${starSaleTiers * 10} stars)`,
    description: `In celebration of the map update, a special limited time offer on ${starSaleTiers} tiers (${starSaleTiers * 10} stars) to advance your Battle Pass`,
    price: 6 * tierPrice, regularPrice: starSaleTiers * tierPrice,
    displayAssetPath: "/Game/Catalog/DisplayAssets/DA_Featured_AthenaBattlePassStarSale_S2.DA_Featured_AthenaBattlePassStarSale_S2",
    itemGrants: [{ templateId: starSaleToken, quantity: 1 }]
  };
}

// The season's storefront offers for a player (ownsPass: their book_purchased): the pass and bundle until it is bought,
// the tiers always.
export const battlePassOffers = ({ ownsPass = false } = {}) => seasonOffers()
  .filter((offer) => offer.battlePass === "tier" || !ownsPass);

// Every Battle Pass offer, owned or not, for a purchase.
export const anyBattlePassOffer = (offerId) => seasonOffers().find((offer) => offer.offerId === offerId)
  ?? (offerId === tierOfferId ? seasonOffers().find((offer) => offer.battlePass === "tier") : undefined);

// The admin panel's view of the season's tiers: each tier's free and Battle Pass rewards, by name.
export function seasonTiers() {
  const season = athenaSeason();
  if (!season) return [];
  const cosmetics = athenaCosmetics();
  const named = (rewards) => rewards.map(({ templateId, quantity }) => ({
    templateId, quantity, name: (cosmetics[templateId]?.name ?? getItem(templateId)?.name)?.trim() || templateId.split(":")[1]
  }));
  const at = (schedule, tier) => named(schedule.find(({ level }) => level === tier)?.rewards ?? []);
  return Array.from({ length: season.numBookLevels }, (_, index) => index + 1)
    .map((tier) => ({ tier, free: at(season.bookFreeRewards, tier), paid: at(season.bookPaidRewards, tier) }));
}

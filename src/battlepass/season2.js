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
export const tierOfferId = "F86AC2ED4B3EA4B2D65EF1B2629572A0";
export const tierPrice = 150;
export const bundleTiers = 25;

export const defaultSeasonTwo = { battlePassPrice: 950, bundlePrice: 2800 };

export function sanitizeSeasonTwo(input, current = defaultSeasonTwo) {
  const result = { ...defaultSeasonTwo, ...current };
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  for (const key of Object.keys(defaultSeasonTwo)) {
    const value = Number(input[key]);
    if (input[key] !== undefined && Number.isInteger(value) && value >= 0 && value <= 100000) result[key] = value;
  }
  return result;
}

export const seasonTwoConfig = () => sanitizeSeasonTwo(currentBattlePassConfig()?.season2);

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

const seasonOffers = () => {
  const season = athenaSeason();
  if (!season) return [];
  const { battlePassPrice, bundlePrice } = seasonTwoConfig();
  const name = `Season ${season.seasonNumber}`;
  const displayAssetPath = `/Game/Catalog/DisplayAssets/DA_BR_Season${season.seasonNumber}_BattlePass.DA_BR_Season${season.seasonNumber}_BattlePass`;
  const offer = (fields) => ({ currencyType: "MtxCurrency", currencySubType: "", itemGrants: [], storefront: season.storefront, ...fields });
  return [
    offer({ offerId: battlePassOfferId, devName: `BR.Season${season.seasonNumber}.BattlePass.01`, battlePass: "pass",
      title: "Battle Pass", shortDescription: name, description: passDescription,
      price: battlePassPrice, regularPrice: Math.max(battlePassPrice, passRegularPrice), displayAssetPath }),
    offer({ offerId: `core_br_season${season.seasonNumber}_battlebundle`, devName: `BR.Season${season.seasonNumber}.BattleBundle.01`, battlePass: "bundle",
      title: "Battle Bundle", shortDescription: `Battle pass + ${bundleTiers} tiers!`, description: bundleDescription,
      price: bundlePrice, displayAssetPath }),
    offer({ offerId: tierOfferId, devName: `BR.Season${season.seasonNumber}.SingleTier.01`, battlePass: "tier",
      title: "Battle Pass Level", shortDescription: "Get great rewards now!", description: "Get great rewards now!", price: tierPrice, displayAssetPath: "" })
  ];
};

// The season's storefront offers for a player (ownsPass: their book_purchased): the pass and bundle until it is bought,
// the tiers always.
export const battlePassOffers = ({ ownsPass = false } = {}) => seasonOffers()
  .filter((offer) => offer.battlePass === "tier" || !ownsPass);

// Every Battle Pass offer, owned or not, for a purchase.
export const anyBattlePassOffer = (offerId) => seasonOffers().find((offer) => offer.offerId === offerId);

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

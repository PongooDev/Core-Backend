import { currentBuild } from "../builds/context.js";
import { athenaCosmetics } from "../gamedata/athena.js";
import { featuredDisplayAsset } from "./itemshop.js";
import { currentBattlePassConfig, defaultMilestones } from "../battlepass/season1.js";

// Battle Royale's Season Shop, from 1.8.2 (CL-3741772): "Unlock the ability to purchase new items as you level up each
// season!" The lobby's Season Shop tab is AthenaSeasonDirectAcquisitionScreen (UFortDirectAcquisitionWidgetBase), whose
// StorefrontNames are ["BRSeasonStorefront"]. Its GenerateOfferWidget puts the first two offers in the small tile grid
// (SmallTileGP, one column of two) and every later one in the large tile row (LargeTile is set once the grid holds two);
// its countdown is GetSeasonStoreEndDate (execGetSeasonStoreEndDate 0x31B1480 → 0x2E95870: the client-events state's
// SeasonEnd, +0x10, less the server time; the weekly one, 0x2E976C0, reads +0x18), so the calendar sends seasonEnd.
// 1.8 and 1.8.1 have the tab too, but theirs is a placeholder: its StorefrontNames are ["dsfhasdj"], it shows
// "SEASON STORE COMING SOON" when that storefront has no offers, and their offer info has no requirement natives (no
// HasRequirement, IsLockedByRequirement or GetSeasonStoreEndDate in either binary). Core gives them nothing there.
//
// An offer's season level is its metaInfo "season_level" (FCatalogOffer +0x10 MetaInfo, FCatalogKeyValue {key, value},
// looked up case-insensitively and read with wtoi: 0x3C72FE0, 0x3C72F60). UFortDirectAcquisitionOfferInfo
// IsLockedByRequirement (0x2E4DF80) locks an offer while it is above the athena profile's "level" stat (the player
// controller's AthenaProfile, +0x21B0; 0x424C90), or its "season_wins" above the season's wins. HasRequirement
// (0x2E4B5E0) gives the tile and details screen the text "Season Level {0}" (DirectAcquisitionOffer.SeasonLevelReq). A
// locked tile shows "LOCKED", a lock and that text; the details screen's purchase button says "LOCKED" and is disabled
// (AthenaDirectAcquisitionOfferDetailsWidget SetupPrice). An owned item shows as owned (UFortMcpContext IsOwned, the
// tile's and details screen's OwnedSwitcher), so the offers carry no requirements, which would hide it instead
// (store/itemshop.js). PurchaseCatalogEntry refuses an offer above the player's season level all the same.
//
// Season One's items and levels are the patch notes'. The game data holds no prices (the display assets are art only);
// these are what the 2017 Season Shop charged, per the Fortnite Wiki's item pages and the coverage of their 2024 return
// to the OG Season Shop at the same prices: Aerial Assault One 500 V-Bucks, Aerial Assault Trooper and Renegade Raider
// 1,200, Raider's Revenge 1,500 (🟡: not from the game). They are in level order, as the 2017 shop laid them out
// (Core-Backend #112's reference screenshot): Aerial Assault One and Aerial Assault Trooper in the two small tiles, top
// to bottom, then Renegade Raider and Raider's Revenge in the large ones. Every one shows its featured art, the display
// asset the extractor matched to it (DA_Featured_GliderMiG, whose tile T-Featured-Glider-001 is Aerial Assault One's
// despite its name; DA_Featured_SMaleHID017, DA_Featured_SFemaleHID028, DA_Featured_PickaxeLockjaw).
export const firstSeasonShopBuild = 3741772;
export const hasSeasonShop = (changelist = currentBuild()) => Number(changelist) >= firstSeasonShopBuild;
export const seasonStorefront = "BRSeasonStorefront";

const seasonOne = [
  { templateId: "AthenaGlider:glider_id_001", seasonLevel: 5, price: 500 },
  { templateId: "AthenaCharacter:cid_017_athena_commando_m", seasonLevel: 15, price: 1200 },
  { templateId: "AthenaCharacter:cid_028_athena_commando_f", seasonLevel: 20, price: 1200 },
  { templateId: "AthenaPickaxe:pickaxe_lockjaw", seasonLevel: 35, price: 1500 }
];

// The Season Shop's offers, those the requesting build has the cosmetic for; none before 1.8.2.
export function seasonShopOffers() {
  if (!hasSeasonShop()) return [];
  const cosmetics = athenaCosmetics();
  const bpConfig = currentBattlePassConfig();
  const milestones = Array.isArray(bpConfig.milestones) && bpConfig.milestones.length > 0
    ? bpConfig.milestones
    : defaultMilestones;
  const requireLevel = bpConfig.levelRequirementsEnabled !== false;

  return milestones.filter(({ templateId }) => cosmetics[templateId]).map(({ templateId, seasonLevel, price }) => ({
    offerId: `core_season_${templateId.split(":")[1].toLowerCase()}`,
    templateId,
    title: cosmetics[templateId].name.trim(),
    currencyType: "MtxCurrency",
    currencySubType: "",
    price: Number.isInteger(price) ? price : 0,
    seasonLevel: requireLevel ? seasonLevel : 1,
    displayAssetPath: featuredDisplayAsset(templateId),
    athena: true
  }));
}

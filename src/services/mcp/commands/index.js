import { activateConsumable } from "./ActivateConsumable.js";
import { convertLegacyAlterations, respecAlteration, upgradeAlteration } from "./Alterations.js";
import { assignWorkerToSquad } from "./AssignWorkerToSquad.js";
import { assignWorkerToSquadBatch } from "./AssignWorkerToSquadBatch.js";
import { bulkEquipBattleRoyaleCustomization } from "./BulkEquipBattleRoyaleCustomization.js";
import { claimCollectedResources } from "./ClaimCollectedResources.js";
import { claimDifficultyIncreaseRewards } from "./ClaimDifficultyIncreaseRewards.js";
import { claimImportFriendsReward } from "./ClaimImportFriendsReward.js";
import { claimLoginReward } from "./ClaimLoginReward.js";
import { claimMfaEnabled } from "./ClaimMfaEnabled.js";
import { claimMissionAlertRewards } from "./ClaimMissionAlertRewards.js";
import { claimQuestReward } from "./ClaimQuestReward.js";
import { craftWorldItem } from "./CraftWorldItem.js";
import { createOrUpgradeOutpostItem } from "./CreateOrUpgradeOutpostItem.js";
import { destroyWorldItems } from "./DestroyWorldItems.js";
import { disassembleWorldItems } from "./DisassembleWorldItems.js";
import { equipBattleRoyaleCustomization } from "./EquipBattleRoyaleCustomization.js";
import { clientQuestLoginFromClient } from "./ClientQuestLogin.js";
import { claimCollectionBookPageRewards, claimCollectionBookRewards, convertSlottedItem, researchItemFromCollectionBook, slotItemInCollectionBook, unslotItemFromCollectionBook, upgradeSlottedItem } from "./CollectionBook.js";
import { fortRerollDailyQuest } from "./FortRerollDailyQuest.js";
import { getMcpTimeForLogin } from "./GetMcpTimeForLogin.js";
import { giftCatalogEntry } from "./GiftCatalogEntry.js";
import { incrementNamedCounterStat } from "./IncrementNamedCounterStat.js";
import { issueFriendCode } from "./IssueFriendCode.js";
import { setHeroModeLoadout, setModeLoadout } from "./Loadouts.js";
import { markItemSeen } from "./MarkItemSeen.js";
import { markNewQuestNotificationSent } from "./MarkNewQuestNotificationSent.js";
import { modifyQuickbar } from "./ModifyQuickbar.js";
import { openCardPack } from "./OpenCardPack.js";
import { openCardPackBatch } from "./OpenCardPackBatch.js";
import { purchaseCatalogEntry } from "./PurchaseCatalogEntry.js";
import { purchaseHomebaseNode } from "./PurchaseHomebaseNode.js";
import { purchaseOrUpgradeHomebaseNode } from "./PurchaseOrUpgradeHomebaseNode.js";
import { purchaseResearchStatUpgrade } from "./PurchaseResearchStatUpgrade.js";
import { queryProfile } from "./QueryProfile.js";
import { refundMtxPurchase } from "./RefundMtxPurchase.js";
import { abandonExpeditionCommand, collectExpeditionCommand, refreshExpeditions, startExpeditionCommand } from "./RefreshExpeditions.js";
import { requestEventFlags } from "./RequestEventFlags.js";
import { respecResearch } from "./RespecResearch.js";
import { respecUpgrades } from "./RespecUpgrades.js";
import { setAffiliateName } from "./SetAffiliateName.js";
import { setBansViewed } from "./SetBansViewed.js";
import { removeGiftBox } from "./RemoveGiftBox.js";
import { setBattleRoyaleBanner } from "./SetBattleRoyaleBanner.js";
import { setDefaultHeroSquad } from "./SetDefaultHeroSquad.js";
import { setGameplayStats } from "./SetGameplayStats.js";
import { setHomebaseBanner } from "./SetHomebaseBanner.js";
import { setHomebaseMeta } from "./SetHomebaseMeta.js";
import { setHomebaseName } from "./SetHomebaseName.js";
import { setItemFavoriteStatus, setItemFavoriteStatusBatch } from "./SetItemFavoriteStatus.js";
import { setMtxPlatform } from "./SetMtxPlatform.js";
import { setPinnedQuests } from "./SetPinnedQuests.js";
import { setReceiveGiftsEnabled } from "./SetReceiveGiftsEnabled.js";
import { skipTutorial } from "./SkipTutorial.js";
import { storageTransfer } from "./StorageTransfer.js";
import { transmogItem } from "./TransmogItem.js";
import { unassignAllSquads } from "./UnassignAllSquads.js";
import { updateQuestClientObjectives } from "./UpdateQuestClientObjectives.js";
import { verifyRealMoneyPurchase } from "./VerifyRealMoneyPurchase.js";
import { convertItemCommand, recycleItemBatchCommand, recycleItemCommand, upgradeItemCommand, upgradeItemRarityCommand } from "./Upgrades.js";

// Client commands the builds register (their SDKs list the UFunction) that Core doesn't answer, because no player can
// send them and what Epic's service did with them isn't in the client. A command's generated wrapper reads a static FName
// made from its name (FindFunctionChecked + ProcessEvent); where nothing but the FName's initialiser references it, the
// linker dropped the wrapper and no code in that exe can send the command. Read in the exes of 27 builds from 1.1 to
// 6.02 (CL-4461277: the FNames at 0x5388A88 to 0x5388BC0; 6.01's read the same):
// - UnloadWarehouse {resourceTypes}, UnslotAllWorkers {buildingIds}, UpdateBuildingLevelAndRating {buildingId,
//   lastBuildingLevel, lastBuildingRating} (in 1.1 already, for homebase buildings no shipped profile has): no wrapper in
//   any of them.
// - EquipCampaignCustomization {slotName, itemToSlot, indexWithinSlot} (in 3.0, CL-3901517, and not in 2.2; 2.3 to 2.5
//   weren't read): no wrapper in any of them.
// - EquipCharCosmetic {characterId, cosmeticId, typeId} (in 1.1 already): 1.1's one sender is the cheat manager's
//   McpEquipCharCosmetic; the wrapper stays to 4.0 and is gone from 4.2.
// - ApplyAlteration {targetItemId, alterationItemId} (in 1.1 already): sent by UFortMcpContext::ApplyAlteration (6.02
//   0x10712D0, Blueprint callable, with the ids of a UFortAlterableItem and a UFortAlterationItem) and, to 4.0, by a
//   second caller, in 1.1 the cheat manager's McpApplyAlteration. No file of 6.02's paks names the function (13 of its 14
//   paks; pakchunk1000's key is unknown), so no Blueprint there calls it, and it takes an Alteration account item, which
//   nothing gives: Core's perks are ids on their schematic (profiles/alterations.js), and 4.2's Perk Recombobulator has
//   its own commands (Alterations.js). Which slot it filled and what it used up was the service's.
// Each is told "Unknown command" (errors.com.epicgames.fortnite.operation_not_found, HTTP 400) and logged with the
// build's unknown requests, as before.
export const clientCommands = {
  AbandonExpedition: abandonExpeditionCommand,
  ActivateConsumable: activateConsumable,
  AssignWorkerToSquad: assignWorkerToSquad,
  AssignWorkerToSquadBatch: assignWorkerToSquadBatch,
  BulkEquipBattleRoyaleCustomization: bulkEquipBattleRoyaleCustomization,
  ClaimCollectionBookPageRewards: claimCollectionBookPageRewards,
  ClaimCollectionBookRewards: claimCollectionBookRewards,
  ClaimCollectedResources: claimCollectedResources,
  ClaimDifficultyIncreaseRewards: claimDifficultyIncreaseRewards,
  ClaimImportFriendsReward: claimImportFriendsReward,
  ClaimLoginReward: claimLoginReward,
  ClaimMfaEnabled: claimMfaEnabled,
  ClaimMissionAlertRewards: claimMissionAlertRewards,
  ClaimQuestReward: claimQuestReward,
  ClientQuestLogin: clientQuestLoginFromClient,
  CollectExpedition: collectExpeditionCommand,
  ConvertItem: convertItemCommand,
  ConvertLegacyAlterations: convertLegacyAlterations,
  ConvertSlottedItem: convertSlottedItem,
  CraftWorldItem: craftWorldItem,
  CreateOrUpgradeOutpostItem: createOrUpgradeOutpostItem,
  DestroyWorldItems: destroyWorldItems,
  DisassembleWorldItems: disassembleWorldItems,
  EquipBattleRoyaleCustomization: equipBattleRoyaleCustomization,
  FortRerollDailyQuest: fortRerollDailyQuest,
  GetMcpTimeForLogin: getMcpTimeForLogin,
  GiftCatalogEntry: giftCatalogEntry,
  IncrementNamedCounterStat: incrementNamedCounterStat,
  IssueFriendCode: issueFriendCode,
  MarkItemSeen: markItemSeen,
  MarkNewQuestNotificationSent: markNewQuestNotificationSent,
  ModifyQuickbar: modifyQuickbar,
  OpenCardPack: openCardPack,
  OpenCardPackBatch: openCardPackBatch,
  PurchaseCatalogEntry: purchaseCatalogEntry,
  PurchaseHomebaseNode: purchaseHomebaseNode,
  PurchaseOrUpgradeHomebaseNode: purchaseOrUpgradeHomebaseNode,
  PurchaseResearchStatUpgrade: purchaseResearchStatUpgrade,
  QueryProfile: queryProfile,
  RecycleItem: recycleItemCommand,
  RecycleItemBatch: recycleItemBatchCommand,
  RefreshExpeditions: refreshExpeditions,
  RefundMtxPurchase: refundMtxPurchase,
  ResearchItemFromCollectionBook: researchItemFromCollectionBook,
  RespecAlteration: respecAlteration,
  RespecResearch: respecResearch,
  RespecUpgrades: respecUpgrades,
  RemoveGiftBox: removeGiftBox,
  RequestEventFlags: requestEventFlags,
  SetAffiliateName: setAffiliateName,
  SetBansViewed: setBansViewed,
  SetBattleRoyaleBanner: setBattleRoyaleBanner,
  SetDefaultHeroSquad: setDefaultHeroSquad,
  SetGameplayStats: setGameplayStats,
  SetHeroModeLoadout: setHeroModeLoadout,
  SetHomebaseBanner: setHomebaseBanner,
  SetHomebaseMeta: setHomebaseMeta,
  SetHomebaseName: setHomebaseName,
  SetItemFavoriteStatus: setItemFavoriteStatus,
  SetItemFavoriteStatusBatch: setItemFavoriteStatusBatch,
  SetModeLoadout: setModeLoadout,
  SetMtxPlatform: setMtxPlatform,
  SetPinnedQuests: setPinnedQuests,
  SetReceiveGiftsEnabled: setReceiveGiftsEnabled,
  SkipTutorial: skipTutorial,
  // Twitch broadcaster links aren't kept.
  TwitchUpdateBroadcasterRegistration: () => {},
  SlotItemInCollectionBook: slotItemInCollectionBook,
  StartExpedition: startExpeditionCommand,
  StorageTransfer: storageTransfer,
  TransmogItem: transmogItem,
  UnassignAllSquads: unassignAllSquads,
  UnslotItemFromCollectionBook: unslotItemFromCollectionBook,
  UpdateQuestClientObjectives: updateQuestClientObjectives,
  UpgradeAlteration: upgradeAlteration,
  UpgradeItem: upgradeItemCommand,
  UpgradeItemRarity: upgradeItemRarityCommand,
  UpgradeSlottedItem: upgradeSlottedItem,
  VerifyRealMoneyPurchase: verifyRealMoneyPurchase
};

export const adminCommands = {
  DevSkipTutorial: skipTutorial
};

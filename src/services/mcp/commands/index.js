import { activateConsumable } from "./ActivateConsumable.js";
import { assignWorkerToSquad } from "./AssignWorkerToSquad.js";
import { assignWorkerToSquadBatch } from "./AssignWorkerToSquadBatch.js";
import { bulkEquipBattleRoyaleCustomization } from "./BulkEquipBattleRoyaleCustomization.js";
import { claimCollectedResources } from "./ClaimCollectedResources.js";
import { claimDifficultyIncreaseRewards } from "./ClaimDifficultyIncreaseRewards.js";
import { claimImportFriendsReward } from "./ClaimImportFriendsReward.js";
import { claimLoginReward } from "./ClaimLoginReward.js";
import { claimMissionAlertRewards } from "./ClaimMissionAlertRewards.js";
import { claimQuestReward } from "./ClaimQuestReward.js";
import { craftWorldItem } from "./CraftWorldItem.js";
import { createOrUpgradeOutpostItem } from "./CreateOrUpgradeOutpostItem.js";
import { destroyWorldItems } from "./DestroyWorldItems.js";
import { disassembleWorldItems } from "./DisassembleWorldItems.js";
import { equipBattleRoyaleCustomization } from "./EquipBattleRoyaleCustomization.js";
import { clientQuestLogin } from "./ClientQuestLogin.js";
import { claimCollectionBookPageRewards, claimCollectionBookRewards, convertSlottedItem, slotItemInCollectionBook, upgradeSlottedItem } from "./CollectionBook.js";
import { fortRerollDailyQuest } from "./FortRerollDailyQuest.js";
import { getMcpTimeForLogin } from "./GetMcpTimeForLogin.js";
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
import { queryProfile } from "./QueryProfile.js";
import { refundMtxPurchase } from "./RefundMtxPurchase.js";
import { abandonExpeditionCommand, collectExpeditionCommand, refreshExpeditions, startExpeditionCommand } from "./RefreshExpeditions.js";
import { requestEventFlags } from "./RequestEventFlags.js";
import { removeGiftBox } from "./RemoveGiftBox.js";
import { setBattleRoyaleBanner } from "./SetBattleRoyaleBanner.js";
import { setDefaultHeroSquad } from "./SetDefaultHeroSquad.js";
import { setGameplayStats } from "./SetGameplayStats.js";
import { setHomebaseBanner } from "./SetHomebaseBanner.js";
import { setHomebaseMeta } from "./SetHomebaseMeta.js";
import { setHomebaseName } from "./SetHomebaseName.js";
import { setItemFavoriteStatus } from "./SetItemFavoriteStatus.js";
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
  ClaimMissionAlertRewards: claimMissionAlertRewards,
  ClaimQuestReward: claimQuestReward,
  ClientQuestLogin: clientQuestLogin,
  CollectExpedition: collectExpeditionCommand,
  ConvertItem: convertItemCommand,
  ConvertSlottedItem: convertSlottedItem,
  CraftWorldItem: craftWorldItem,
  CreateOrUpgradeOutpostItem: createOrUpgradeOutpostItem,
  DestroyWorldItems: destroyWorldItems,
  DisassembleWorldItems: disassembleWorldItems,
  EquipBattleRoyaleCustomization: equipBattleRoyaleCustomization,
  FortRerollDailyQuest: fortRerollDailyQuest,
  GetMcpTimeForLogin: getMcpTimeForLogin,
  IncrementNamedCounterStat: incrementNamedCounterStat,
  IssueFriendCode: issueFriendCode,
  MarkItemSeen: markItemSeen,
  MarkNewQuestNotificationSent: markNewQuestNotificationSent,
  ModifyQuickbar: modifyQuickbar,
  OpenCardPack: openCardPack,
  OpenCardPackBatch: openCardPackBatch,
  PurchaseCatalogEntry: purchaseCatalogEntry,
  PurchaseHomebaseNode: purchaseHomebaseNode,
  QueryProfile: queryProfile,
  RecycleItem: recycleItemCommand,
  RecycleItemBatch: recycleItemBatchCommand,
  RefreshExpeditions: refreshExpeditions,
  RefundMtxPurchase: refundMtxPurchase,
  RemoveGiftBox: removeGiftBox,
  RequestEventFlags: requestEventFlags,
  SetBattleRoyaleBanner: setBattleRoyaleBanner,
  SetDefaultHeroSquad: setDefaultHeroSquad,
  SetGameplayStats: setGameplayStats,
  SetHeroModeLoadout: setHeroModeLoadout,
  SetHomebaseBanner: setHomebaseBanner,
  SetHomebaseMeta: setHomebaseMeta,
  SetHomebaseName: setHomebaseName,
  SetItemFavoriteStatus: setItemFavoriteStatus,
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
  UpdateQuestClientObjectives: updateQuestClientObjectives,
  UpgradeItem: upgradeItemCommand,
  UpgradeItemRarity: upgradeItemRarityCommand,
  UpgradeSlottedItem: upgradeSlottedItem,
  VerifyRealMoneyPurchase: verifyRealMoneyPurchase
};

export const adminCommands = {
  DevSkipTutorial: skipTutorial
};

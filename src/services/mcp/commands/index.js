import { activateConsumable } from "./ActivateConsumable.js";
import { assignWorkerToSquad } from "./AssignWorkerToSquad.js";
import { assignWorkerToSquadBatch } from "./AssignWorkerToSquadBatch.js";
import { claimCollectedResources } from "./ClaimCollectedResources.js";
import { claimLoginReward } from "./ClaimLoginReward.js";
import { claimMissionAlertRewards } from "./ClaimMissionAlertRewards.js";
import { claimQuestReward } from "./ClaimQuestReward.js";
import { createOrUpgradeOutpostItem } from "./CreateOrUpgradeOutpostItem.js";
import { clientQuestLogin } from "./ClientQuestLogin.js";
import { claimCollectionBookPageRewards, claimCollectionBookRewards, convertSlottedItem, slotItemInCollectionBook, upgradeSlottedItem } from "./CollectionBook.js";
import { fortRerollDailyQuest } from "./FortRerollDailyQuest.js";
import { getMcpTimeForLogin } from "./GetMcpTimeForLogin.js";
import { issueFriendCode } from "./IssueFriendCode.js";
import { setHeroModeLoadout, setModeLoadout } from "./Loadouts.js";
import { markItemSeen } from "./MarkItemSeen.js";
import { markNewQuestNotificationSent } from "./MarkNewQuestNotificationSent.js";
import { openCardPack } from "./OpenCardPack.js";
import { openCardPackBatch } from "./OpenCardPackBatch.js";
import { purchaseCatalogEntry } from "./PurchaseCatalogEntry.js";
import { purchaseHomebaseNode } from "./PurchaseHomebaseNode.js";
import { queryProfile } from "./QueryProfile.js";
import { abandonExpeditionCommand, collectExpeditionCommand, refreshExpeditions, startExpeditionCommand } from "./RefreshExpeditions.js";
import { setDefaultHeroSquad } from "./SetDefaultHeroSquad.js";
import { setGameplayStats } from "./SetGameplayStats.js";
import { setHomebaseBanner } from "./SetHomebaseBanner.js";
import { setHomebaseMeta } from "./SetHomebaseMeta.js";
import { setHomebaseName } from "./SetHomebaseName.js";
import { setItemFavoriteStatus } from "./SetItemFavoriteStatus.js";
import { setMtxPlatform } from "./SetMtxPlatform.js";
import { setPinnedQuests } from "./SetPinnedQuests.js";
import { skipTutorial } from "./SkipTutorial.js";
import { transmogItem } from "./TransmogItem.js";
import { unassignAllSquads } from "./UnassignAllSquads.js";
import { updateQuestClientObjectives } from "./UpdateQuestClientObjectives.js";
import { convertItemCommand, recycleItemBatchCommand, recycleItemCommand, upgradeItemCommand } from "./Upgrades.js";

export const clientCommands = {
  AbandonExpedition: abandonExpeditionCommand,
  ActivateConsumable: activateConsumable,
  AssignWorkerToSquad: assignWorkerToSquad,
  AssignWorkerToSquadBatch: assignWorkerToSquadBatch,
  ClaimCollectionBookPageRewards: claimCollectionBookPageRewards,
  ClaimCollectionBookRewards: claimCollectionBookRewards,
  ClaimCollectedResources: claimCollectedResources,
  ClaimLoginReward: claimLoginReward,
  ClaimMissionAlertRewards: claimMissionAlertRewards,
  ClaimQuestReward: claimQuestReward,
  ClientQuestLogin: clientQuestLogin,
  CollectExpedition: collectExpeditionCommand,
  ConvertItem: convertItemCommand,
  ConvertSlottedItem: convertSlottedItem,
  CreateOrUpgradeOutpostItem: createOrUpgradeOutpostItem,
  FortRerollDailyQuest: fortRerollDailyQuest,
  GetMcpTimeForLogin: getMcpTimeForLogin,
  IssueFriendCode: issueFriendCode,
  MarkItemSeen: markItemSeen,
  MarkNewQuestNotificationSent: markNewQuestNotificationSent,
  OpenCardPack: openCardPack,
  OpenCardPackBatch: openCardPackBatch,
  PurchaseCatalogEntry: purchaseCatalogEntry,
  PurchaseHomebaseNode: purchaseHomebaseNode,
  QueryProfile: queryProfile,
  RecycleItem: recycleItemCommand,
  RecycleItemBatch: recycleItemBatchCommand,
  RefreshExpeditions: refreshExpeditions,
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
  SkipTutorial: skipTutorial,
  // Twitch broadcaster links aren't kept.
  TwitchUpdateBroadcasterRegistration: () => {},
  SlotItemInCollectionBook: slotItemInCollectionBook,
  StartExpedition: startExpeditionCommand,
  TransmogItem: transmogItem,
  UnassignAllSquads: unassignAllSquads,
  UpdateQuestClientObjectives: updateQuestClientObjectives,
  UpgradeItem: upgradeItemCommand,
  UpgradeSlottedItem: upgradeSlottedItem
};

export const adminCommands = {
  DevSkipTutorial: skipTutorial
};

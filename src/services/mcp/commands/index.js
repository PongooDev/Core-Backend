import { assignWorkerToSquad } from "./AssignWorkerToSquad.js";
import { assignWorkerToSquadBatch } from "./AssignWorkerToSquadBatch.js";
import { claimLoginReward } from "./ClaimLoginReward.js";
import { claimQuestReward } from "./ClaimQuestReward.js";
import { clientQuestLogin } from "./ClientQuestLogin.js";
import { fortRerollDailyQuest } from "./FortRerollDailyQuest.js";
import { getMcpTimeForLogin } from "./GetMcpTimeForLogin.js";
import { setHeroModeLoadout, setModeLoadout } from "./Loadouts.js";
import { markItemSeen } from "./MarkItemSeen.js";
import { markNewQuestNotificationSent } from "./MarkNewQuestNotificationSent.js";
import { openCardPack } from "./OpenCardPack.js";
import { openCardPackBatch } from "./OpenCardPackBatch.js";
import { purchaseCatalogEntry } from "./PurchaseCatalogEntry.js";
import { purchaseHomebaseNode } from "./PurchaseHomebaseNode.js";
import { queryProfile } from "./QueryProfile.js";
import { refreshExpeditions } from "./RefreshExpeditions.js";
import { setDefaultHeroSquad } from "./SetDefaultHeroSquad.js";
import { setGameplayStats } from "./SetGameplayStats.js";
import { setHomebaseBanner } from "./SetHomebaseBanner.js";
import { setHomebaseMeta } from "./SetHomebaseMeta.js";
import { setHomebaseName } from "./SetHomebaseName.js";
import { setItemFavoriteStatus } from "./SetItemFavoriteStatus.js";
import { setMtxPlatform } from "./SetMtxPlatform.js";
import { setPinnedQuests } from "./SetPinnedQuests.js";
import { skipTutorial } from "./SkipTutorial.js";
import { unassignAllSquads } from "./UnassignAllSquads.js";
import { updateQuestClientObjectives } from "./UpdateQuestClientObjectives.js";
import { convertItemCommand, recycleItemBatchCommand, recycleItemCommand, upgradeItemCommand } from "./Upgrades.js";

export const clientCommands = {
  AssignWorkerToSquad: assignWorkerToSquad,
  AssignWorkerToSquadBatch: assignWorkerToSquadBatch,
  ClaimLoginReward: claimLoginReward,
  ClaimQuestReward: claimQuestReward,
  ClientQuestLogin: clientQuestLogin,
  ConvertItem: convertItemCommand,
  FortRerollDailyQuest: fortRerollDailyQuest,
  GetMcpTimeForLogin: getMcpTimeForLogin,
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
  UnassignAllSquads: unassignAllSquads,
  UpdateQuestClientObjectives: updateQuestClientObjectives,
  UpgradeItem: upgradeItemCommand
};

export const adminCommands = {
  DevSkipTutorial: skipTutorial
};

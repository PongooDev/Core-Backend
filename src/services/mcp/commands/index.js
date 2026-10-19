import { assignWorkerToSquad } from "./AssignWorkerToSquad.js";
import { assignWorkerToSquadBatch } from "./AssignWorkerToSquadBatch.js";
import { claimLoginReward } from "./ClaimLoginReward.js";
import { claimQuestReward } from "./ClaimQuestReward.js";
import { clientQuestLogin } from "./ClientQuestLogin.js";
import { getMcpTimeForLogin } from "./GetMcpTimeForLogin.js";
import { markItemSeen } from "./MarkItemSeen.js";
import { markNewQuestNotificationSent } from "./MarkNewQuestNotificationSent.js";
import { openCardPack } from "./OpenCardPack.js";
import { openCardPackBatch } from "./OpenCardPackBatch.js";
import { purchaseHomebaseNode } from "./PurchaseHomebaseNode.js";
import { queryProfile } from "./QueryProfile.js";
import { refreshExpeditions } from "./RefreshExpeditions.js";
import { setDefaultHeroSquad } from "./SetDefaultHeroSquad.js";
import { setHomebaseName } from "./SetHomebaseName.js";
import { setItemFavoriteStatus } from "./SetItemFavoriteStatus.js";
import { setPinnedQuests } from "./SetPinnedQuests.js";
import { skipTutorial } from "./SkipTutorial.js";
import { unassignAllSquads } from "./UnassignAllSquads.js";
import { updateQuestClientObjectives } from "./UpdateQuestClientObjectives.js";

export const clientCommands = {
  AssignWorkerToSquad: assignWorkerToSquad,
  AssignWorkerToSquadBatch: assignWorkerToSquadBatch,
  ClaimLoginReward: claimLoginReward,
  ClaimQuestReward: claimQuestReward,
  ClientQuestLogin: clientQuestLogin,
  GetMcpTimeForLogin: getMcpTimeForLogin,
  MarkItemSeen: markItemSeen,
  MarkNewQuestNotificationSent: markNewQuestNotificationSent,
  OpenCardPack: openCardPack,
  OpenCardPackBatch: openCardPackBatch,
  PurchaseHomebaseNode: purchaseHomebaseNode,
  QueryProfile: queryProfile,
  RefreshExpeditions: refreshExpeditions,
  SetDefaultHeroSquad: setDefaultHeroSquad,
  SetHomebaseName: setHomebaseName,
  SetItemFavoriteStatus: setItemFavoriteStatus,
  SetPinnedQuests: setPinnedQuests,
  SkipTutorial: skipTutorial,
  UnassignAllSquads: unassignAllSquads,
  UpdateQuestClientObjectives: updateQuestClientObjectives
};

export const adminCommands = {
  DevSkipTutorial: skipTutorial
};

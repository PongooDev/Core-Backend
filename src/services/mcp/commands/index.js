import { claimLoginReward } from "./ClaimLoginReward.js";
import { clientQuestLogin } from "./ClientQuestLogin.js";
import { getMcpTimeForLogin } from "./GetMcpTimeForLogin.js";
import { markItemSeen } from "./MarkItemSeen.js";
import { markNewQuestNotificationSent } from "./MarkNewQuestNotificationSent.js";
import { queryProfile } from "./QueryProfile.js";
import { refreshExpeditions } from "./RefreshExpeditions.js";
import { setHomebaseName } from "./SetHomebaseName.js";
import { setItemFavoriteStatus } from "./SetItemFavoriteStatus.js";
import { skipTutorial } from "./SkipTutorial.js";
import { updateQuestClientObjectives } from "./UpdateQuestClientObjectives.js";

export const clientCommands = {
  ClaimLoginReward: claimLoginReward,
  ClientQuestLogin: clientQuestLogin,
  GetMcpTimeForLogin: getMcpTimeForLogin,
  MarkItemSeen: markItemSeen,
  MarkNewQuestNotificationSent: markNewQuestNotificationSent,
  QueryProfile: queryProfile,
  RefreshExpeditions: refreshExpeditions,
  SetHomebaseName: setHomebaseName,
  SetItemFavoriteStatus: setItemFavoriteStatus,
  SkipTutorial: skipTutorial,
  UpdateQuestClientObjectives: updateQuestClientObjectives
};

export const adminCommands = {
  DevSkipTutorial: skipTutorial
};

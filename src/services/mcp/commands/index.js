import { clientQuestLogin } from "./ClientQuestLogin.js";
import { getMcpTimeForLogin } from "./GetMcpTimeForLogin.js";
import { markItemSeen } from "./MarkItemSeen.js";
import { markNewQuestNotificationSent } from "./MarkNewQuestNotificationSent.js";
import { queryProfile } from "./QueryProfile.js";
import { refreshExpeditions } from "./RefreshExpeditions.js";
import { skipTutorial } from "./SkipTutorial.js";
import { updateQuestClientObjectives } from "./UpdateQuestClientObjectives.js";

export const clientCommands = {
  ClientQuestLogin: clientQuestLogin,
  GetMcpTimeForLogin: getMcpTimeForLogin,
  MarkItemSeen: markItemSeen,
  MarkNewQuestNotificationSent: markNewQuestNotificationSent,
  QueryProfile: queryProfile,
  RefreshExpeditions: refreshExpeditions,
  SkipTutorial: skipTutorial,
  UpdateQuestClientObjectives: updateQuestClientObjectives
};

export const adminCommands = {
  DevSkipTutorial: skipTutorial
};

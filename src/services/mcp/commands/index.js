import { clientQuestLogin } from "./ClientQuestLogin.js";
import { getMcpTimeForLogin } from "./GetMcpTimeForLogin.js";
import { queryProfile } from "./QueryProfile.js";
import { refreshExpeditions } from "./RefreshExpeditions.js";

export const clientCommands = {
  ClientQuestLogin: clientQuestLogin,
  GetMcpTimeForLogin: getMcpTimeForLogin,
  QueryProfile: queryProfile,
  RefreshExpeditions: refreshExpeditions
};

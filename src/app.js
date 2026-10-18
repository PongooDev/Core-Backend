import express from "express";
import { createAccountStore } from "./accounts/store.js";
import { createTokenStore } from "./accounts/tokens.js";
import { createProfileStore } from "./profiles/store.js";
import { requestLog, unknownRoute } from "./log.js";
import { originForm } from "./proxy.js";
import { oauthRoutes } from "./services/account/oauth.js";
import { publicAccountRoutes } from "./services/account/public.js";
import { datarouterRoutes } from "./services/datarouter/data.js";
import { eulaRoutes } from "./services/eulatracking/agreements.js";
import { accessRoutes } from "./services/fortnite/access.js";
import { chatRoutes } from "./services/fortnite/chat.js";
import { cloudStorageRoutes, userCloudStorageRoutes } from "./services/fortnite/cloudstorage.js";
import { friendCodeRoutes } from "./services/fortnite/friendcodes.js";
import { receiptRoutes } from "./services/fortnite/receipts.js";
import { storefrontRoutes } from "./services/fortnite/storefront.js";
import { versionRoutes } from "./services/fortnite/version.js";
import { worldRoutes } from "./services/fortnite/world.js";
import { friendsRoutes } from "./services/friends/lists.js";
import { lightswitchRoutes } from "./services/lightswitch/status.js";
import { sessionRoutes } from "./services/matchmaking/sessions.js";
import { profileRoutes } from "./services/mcp/profile.js";

export function createApp(config) {
  const context = {
    accounts: createAccountStore(config.dataDir),
    tokens: createTokenStore(),
    profiles: createProfileStore(config.dataDir),
    dataDir: config.dataDir
  };

  const app = express();
  app.disable("x-powered-by");

  app.use(originForm);
  if (config.requestLog !== false) app.use(requestLog);
  app.use(userCloudStorageRoutes(context));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use(oauthRoutes(context));
  app.use(publicAccountRoutes(context));
  app.use(lightswitchRoutes(context));
  app.use(versionRoutes(context));
  app.use(cloudStorageRoutes(context));
  app.use(eulaRoutes(context));
  app.use(accessRoutes(context));
  app.use(profileRoutes(context));
  app.use(worldRoutes(context));
  app.use(receiptRoutes(context));
  app.use(sessionRoutes(context));
  app.use(storefrontRoutes(context));
  app.use(chatRoutes(context));
  app.use(friendCodeRoutes(context));
  app.use(friendsRoutes(context));
  app.use(datarouterRoutes(context));

  app.use(unknownRoute(config.dataDir));
  return app;
}

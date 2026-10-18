import express from "express";
import { createAccountStore } from "./accounts/store.js";
import { createTokenStore } from "./accounts/tokens.js";
import { requestLog, unknownRoute } from "./log.js";
import { originForm } from "./proxy.js";
import { oauthRoutes } from "./services/account/oauth.js";
import { publicAccountRoutes } from "./services/account/public.js";
import { eulaRoutes } from "./services/eulatracking/agreements.js";
import { accessRoutes } from "./services/fortnite/access.js";
import { cloudStorageRoutes, userCloudStorageRoutes } from "./services/fortnite/cloudstorage.js";
import { versionRoutes } from "./services/fortnite/version.js";
import { lightswitchRoutes } from "./services/lightswitch/status.js";

export function createApp(config) {
  const context = {
    accounts: createAccountStore(config.dataDir),
    tokens: createTokenStore(),
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

  app.use(unknownRoute(config.dataDir));
  return app;
}

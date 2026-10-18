import express from "express";
import { createAccountStore } from "./accounts/store.js";
import { createTokenStore } from "./accounts/tokens.js";
import { requestLog, unknownRoute } from "./log.js";
import { originForm } from "./proxy.js";
import { oauthRoutes } from "./services/account/oauth.js";
import { cloudStorageRoutes } from "./services/fortnite/cloudstorage.js";
import { versionRoutes } from "./services/fortnite/version.js";
import { lightswitchRoutes } from "./services/lightswitch/status.js";

export function createApp(config) {
  const context = {
    accounts: createAccountStore(config.dataDir),
    tokens: createTokenStore()
  };

  const app = express();
  app.disable("x-powered-by");

  app.use(originForm);
  app.use(requestLog);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use(oauthRoutes(context));
  app.use(lightswitchRoutes(context));
  app.use(versionRoutes(context));
  app.use(cloudStorageRoutes(context));

  app.use(unknownRoute(config.dataDir));
  return app;
}

import express from "express";
import { requestLog, unknownRoute } from "./log.js";

export function createApp(config) {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestLog);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use(unknownRoute(config.dataDir));
  return app;
}

import express from "express";

export function datarouterRoutes() {
  const router = express.Router();

  router.post("/datarouter/api/v1/public/data", (req, res) => {
    res.status(204).end();
  });

  return router;
}

import express from "express";
import { requireAuth } from "../../accounts/auth.js";

// The front end's Send Feedback (1.7.2, sub_2CF38D0) posts a multipart form: feedbacktype, displayname, email,
// accountid, engineversion, platform, gamebackend, gamename, subgamename, subject, feedbackbody, and a screenshot
// (image/jpg), the zipped client log and the hardware survey. Core keeps none of it and answers that it arrived.
export function feedbackRoutes({ tokens }) {
  const router = express.Router();

  router.post("/fortnite/api/feedback/:kind", requireAuth(tokens), (req, res) => {
    req.resume();
    res.status(204).end();
  });

  return router;
}

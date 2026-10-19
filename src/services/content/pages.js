import express from "express";

// The EpicContentService page ([EpicContentService] in DefaultGame.ini), fetched before login. The CMS cache
// (CMSURLCache.cpp, sub_3620130) needs a JSON object, reads lastModified as an ISO 8601 date ("Invalid last modified
// date %s. Assuming new" otherwise) and precaches the _images_ array. Pages for UEpicCMSScreenBase screens would sit
// under their TileSetFieldName with a "layout", but no CMS screen is cooked into this build, so there are none.
const page = { _title: "Fortnite Game", lastModified: "2026-10-19T00:00:00.000Z", _images_: [] };

export function contentRoutes() {
  const router = express.Router();

  router.get("/content/api/pages/fortnite-game", (req, res) => res.json(page));

  return router;
}

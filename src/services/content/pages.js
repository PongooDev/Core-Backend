import express from "express";

// The EpicContentService page ([EpicContentService] in DefaultGame.ini), fetched before login. The CMS cache
// (CMSURLCache.cpp, sub_3620130) needs a JSON object, reads lastModified as an ISO 8601 date ("Invalid last modified
// date %s. Assuming new" otherwise) and precaches the _images_ array. Pages for UEpicCMSScreenBase screens would sit
// under their TileSetFieldName with a "layout", but no CMS screen is cooked into this build, so there are none.
//
// Battle Royale's lobby news box (1.7.2 AthenaNews, UFortAthenaNewsWidget::GetText 0x30E1870 → 0x2E2B3F0) reads
// battleRoyaleNews.news from this page: message {title, body}, and the bodies of the region_messages and
// platform_messages entries ({region | platform, message}) that match the player (Core-Backend #61). Without it the box
// was empty. The host can set its own in config.json: "battleRoyaleNews": {"title": ..., "body": ...}.
export const defaultBattleRoyaleNews = {
  title: "Battle Royale - 1.7.2",
  body: "Welcome to Battle Royale on Core!"
};

export function contentPage(news = defaultBattleRoyaleNews) {
  const message = {
    title: String(news?.title ?? defaultBattleRoyaleNews.title),
    body: String(news?.body ?? defaultBattleRoyaleNews.body)
  };
  return {
    _title: "Fortnite Game",
    lastModified: "2026-10-27T00:00:00.000Z",
    _images_: [],
    battleRoyaleNews: { news: { message, region_messages: [], platform_messages: [] } }
  };
}

export function contentRoutes(context, config = {}) {
  const router = express.Router();
  const page = contentPage(config.battleRoyaleNews);

  router.get("/content/api/pages/fortnite-game", (req, res) => res.json(page));

  return router;
}

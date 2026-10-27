import express from "express";

// The EpicContentService page ([EpicContentService] in DefaultGame.ini), fetched before login. The CMS cache
// (CMSURLCache.cpp, sub_3620130) needs a JSON object, reads lastModified as an ISO 8601 date ("Invalid last modified
// date %s. Assuming new" otherwise) and precaches the _images_ array. Pages for UEpicCMSScreenBase screens would sit
// under their TileSetFieldName with a "layout", but no CMS screen is cooked into this build, so there are none.
//
// Battle Royale's lobby news box (1.7.2 AthenaNews, UFortAthenaNewsWidget::GetText 0x30E1870 → 0x2E2B3F0) reads
// battleRoyaleNews.news from this page: message {title, body}, and the bodies of the region_messages and
// platform_messages entries ({region | platform, message}) that match the player (Core-Backend #61). Without it the box
// was empty. The login screen's message box (the patch notes; 0x3021680) reads loginmessage.loginmessage.message
// {title, body}. The host can set either in config.json: "battleRoyaleNews" / "loginMessage": {"title": ..., "body": ...}.
// The mode select screen's descriptions next to Save the World and Battle Royale (0x3018C70 body, 0x301A360 title, both
// through 0x30184B0) read subgameselectdata.{saveTheWorld | battleRoyale}.message {title, body} (Core-Backend #63);
// saveTheWorldUnowned is for players without Save the World, whom Core doesn't have.
export const defaultBattleRoyaleNews = {
  title: "Battle Royale - 1.7.2",
  body: "Welcome to Battle Royale on Core!"
};

export const defaultLoginMessage = {
  title: "v1.7.2",
  body: "Welcome to Fortnite on Core!"
};

const saveTheWorldSelect = { message: { title: "Co-op PvE", body: "Cooperative PvE storm-fighting adventure!" } };

export const subgameSelectData = {
  saveTheWorld: saveTheWorldSelect,
  saveTheWorldUnowned: saveTheWorldSelect,
  battleRoyale: { message: { title: "100 Player PvP", body: "100 Player PvP Battle Royale.\n\nPvE progress does not affect Battle Royale." } }
};

const messageOf = (configured, fallback) => ({
  title: String(configured?.title ?? fallback.title),
  body: String(configured?.body ?? fallback.body)
});

export function contentPage(news = defaultBattleRoyaleNews, loginMessage = defaultLoginMessage) {
  return {
    _title: "Fortnite Game",
    lastModified: "2026-10-27T12:00:00.000Z",
    _images_: [],
    battleRoyaleNews: { news: { message: messageOf(news, defaultBattleRoyaleNews), region_messages: [], platform_messages: [] } },
    loginmessage: { loginmessage: { message: messageOf(loginMessage, defaultLoginMessage) } },
    subgameselectdata: subgameSelectData
  };
}

export function contentRoutes(context, config = {}) {
  const router = express.Router();
  const page = contentPage(config.battleRoyaleNews, config.loginMessage);

  router.get("/content/api/pages/fortnite-game", (req, res) => res.json(page));

  return router;
}

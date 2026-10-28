import express from "express";
import { getBuild, versionOf } from "../../builds/detect.js";

// The EpicContentService page ([EpicContentService] in DefaultGame.ini), fetched before login. The CMS cache
// (CMSURLCache.cpp, sub_3620130) needs a JSON object, reads lastModified as an ISO 8601 date ("Invalid last modified
// date %s. Assuming new" otherwise) and precaches the _images_ array. Pages for UEpicCMSScreenBase screens would sit
// under their TileSetFieldName with a "layout", but no CMS screen is cooked into this build, so there are none.
//
// Battle Royale's lobby news box (1.7.2 AthenaNews, UFortAthenaNewsWidget::GetText 0x30E1870 → 0x2E2B3F0) reads
// battleRoyaleNews.news from this page: message {title, body}, and the bodies of the region_messages and
// platform_messages entries ({region | platform, message}) that match the player (Core-Backend #61). Without it the box
// was empty. The login screen's message box (the patch notes; 0x3021680) reads loginmessage.loginmessage.message
// {title, body}. The host can set either in config.json: "battleRoyaleNews" / "loginMessage": {"title": ..., "body": ...};
// "{version}" in either becomes the version of the build asking (its User-Agent's changelist), as the defaults show it
// (Core-Backend #68: 1.8 said 1.7.2).
// The mode select screen's descriptions next to Save the World and Battle Royale (0x3018C70 body, 0x301A360 title, both
// through 0x30184B0) read subgameselectdata.{saveTheWorld | battleRoyale}.message {title, body} (Core-Backend #63);
// saveTheWorldUnowned is for players without Save the World, whom Core doesn't have. The title is the short line in the
// red tag beside the Save the World button (SubgameSelectScreen InitializeShortDescriptions: PVEDescriptionText from
// GetShortDescription(Campaign), the tag hidden when it's empty), the body the longer description below. Save the World
// was discounted while 1.8 to 1.8.2 were live (October and November 2017), and their tag said "ON SALE NOW - LIMITED
// TIME!" (Core-Backend #93); other builds keep "Co-op PvE".
export const defaultBattleRoyaleNews = {
  title: "Battle Royale - {version}",
  body: "Welcome to Battle Royale on Core!"
};

export const defaultLoginMessage = {
  title: "v{version}",
  body: "Welcome to Fortnite on Core!"
};

const saveTheWorldSelect = { message: { title: "Co-op PvE", body: "Cooperative PvE storm-fighting adventure!" } };

export const subgameSelectData = {
  saveTheWorld: saveTheWorldSelect,
  saveTheWorldUnowned: saveTheWorldSelect,
  battleRoyale: { message: { title: "100 Player PvP", body: "100 Player PvP Battle Royale.\n\nPvE progress does not affect Battle Royale." } }
};

const saleBuilds = { first: 3724489, last: 3741772 };
const saveTheWorldOnSale = { message: { ...saveTheWorldSelect.message, title: "ON SALE NOW - LIMITED TIME!" } };
export function subgameSelectFor(changelist) {
  const number = Number(changelist);
  if (!(number >= saleBuilds.first && number <= saleBuilds.last)) return subgameSelectData;
  return { ...subgameSelectData, saveTheWorld: saveTheWorldOnSale, saveTheWorldUnowned: saveTheWorldOnSale };
}

// A build Core doesn't know shows its changelist ("CL-3757339", without the "v"), and a request naming none "Core".
function messageOf(configured, fallback, changelist) {
  const version = versionOf(changelist);
  const label = version ?? (/^\d+$/.test(changelist ?? "") ? `CL-${changelist}` : "Core");
  const text = (value) => String(value).replaceAll("v{version}", version ? `v${version}` : label).replaceAll("{version}", label);
  return { title: text(configured?.title ?? fallback.title), body: text(configured?.body ?? fallback.body) };
}

export function contentPage(news = defaultBattleRoyaleNews, loginMessage = defaultLoginMessage, changelist = undefined) {
  return {
    _title: "Fortnite Game",
    lastModified: "2026-10-27T16:30:00.000Z",
    _images_: [],
    battleRoyaleNews: { news: { message: messageOf(news, defaultBattleRoyaleNews, changelist), region_messages: [], platform_messages: [] } },
    loginmessage: { loginmessage: { message: messageOf(loginMessage, defaultLoginMessage, changelist) } },
    subgameselectdata: subgameSelectFor(changelist)
  };
}

export function contentRoutes(context, config = {}) {
  const router = express.Router();
  router.get("/content/api/pages/fortnite-game", (req, res) => {
    const settings = context?.settings?.get?.() ?? {};
    const news = settings.battleRoyaleNews ?? config.battleRoyaleNews ?? defaultBattleRoyaleNews;
    const loginMessage = settings.loginMessage ?? config.loginMessage ?? defaultLoginMessage;
    res.json(contentPage(news, loginMessage, getBuild(req)));
  });

  return router;
}

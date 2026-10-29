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
// tag beside the Save the World button (SubgameSelectScreen InitializeShortDescriptions: PVEDescriptionText from
// GetShortDescription(Campaign)), the body the longer description below. Save the World was discounted while 1.8 to
// 1.8.2 were live (October and November 2017), with a sale tag per build (saleTitles below; Core-Backend #93, #110);
// other builds keep "Co-op PvE".
// The tag's colour is cooked into the widget, not served: 1.8's PVEDescriptionBorder is a Border whose brush is the red
// M-NPVP-Notification material (designer text "On sale!"), but 1.8.1 (CL-3729133) re-cooked it as a CommonBorder on
// M-Gradient-Backing, the same blue strip as PVPDescriptionBorder, and doesn't ship M-NPVP-Notification at all. Its
// blueprint only sets the tag's text, so no field here can make 1.8.1's tag red (Core-Backend #103).
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

// Each Fortnitemares build's own tags (Core-Backend #93, #110): 1.8's "ON SALE NOW - LIMITED TIME!", and 1.8.1's
// "40% OFF - LIMITED TIME!" with Battle Royale's "New PVP!" (the reporter's 1.8.1 footage), and 1.8.2's plain "Co-op PvE"
// (the sale over) with "New PVP!" (#111).
const saleTitles = {
  3724489: { saveTheWorld: "ON SALE NOW - LIMITED TIME!" },
  3729133: { saveTheWorld: "40% OFF - LIMITED TIME!", battleRoyale: "New PVP!" },
  3741772: { battleRoyale: "New PVP!" }
};
const titled = (select, title) => (title ? { message: { ...select.message, title } } : select);
export function subgameSelectFor(changelist) {
  const titles = saleTitles[Number(changelist)];
  if (!titles) return subgameSelectData;
  const saveTheWorld = titled(saveTheWorldSelect, titles.saveTheWorld);
  return { saveTheWorld, saveTheWorldUnowned: saveTheWorld, battleRoyale: titled(subgameSelectData.battleRoyale, titles.battleRoyale) };
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

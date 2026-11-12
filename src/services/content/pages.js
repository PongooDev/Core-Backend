import { tournamentInformationFor } from "../../tournaments/showdown.js";
import express from "express";
import { inBuild } from "../../builds/context.js";
import { getBuild, versionOf } from "../../builds/detect.js";
import { athenaSeason } from "../../gamedata/athena.js";
import { newsImageOrigin, newsImagePath, newsImageUrl, serveNewsImage } from "./images.js";
import { playlistImagesFor, playlistInformationFor } from "./playlistimages.js";

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
// 1.9 (CL-3757339) reads the news box from an array instead (UCMSContext::GetLatestNews 0x2DF8480 → 0x2E147E0):
// battleRoyaleNews.news.messages[], each {title, body, image} (0x2DDAA80), then the region_messages and
// platform_messages entries' whole message the same way; it no longer reads news.message, so 1.9 showed an empty News
// tab (Core-Backend #117). UFortAthenaNewsWidget (0x2EC3D60 → 0x2ED5C20) shows the first three, collapsing an empty
// title or body and an image the CMS cache hasn't precached. Builds before 1.9 get news.message alone, as before; a
// build Core doesn't know that is newer than 1.9 gets the array.
// The message's image (Core-Backend #215) is the admin panel's "image": another site's picture URL, or an upload the
// backend serves itself (images.js), handed out on the address the client asked for this page on. It is listed in
// _images_ too, which the CMS cache keeps. Builds before 1.9 have no image in their news box and get none. The login
// message and Save the World's survivalmessage read title and body alone (1.9: 0x3121F55, 0x2FE6908), so they have none.
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
// 2.2 (CL-3841827) empties the Save the World tag for players who own Save the World, whatever this page says: its
// InitializeShortDescriptions still sets PVEDescriptionTextNormal to GetShortDescription(Campaign), then, when the
// FortGlobalUIContext's CanPlay(Campaign) is true, shows SwitcherStW's first slot and sets PVEDescriptionTextNormal to
// GetEmptyText. Only players without Save the World see the tag's text (or its sale slot). 2.1 (CL-3825894) and older
// have no such branch and show the text to everyone. Every Core account owns Save the World, so on 2.2 the tag is the
// empty strip its blueprint cooks (PVEDescriptionBorderNormal: M-Gradient-Backing, 32x6 padding), as Epic's 2.2 showed
// owners. Battle Royale's tag and the description below the buttons (GetFullDescription) are read as before.
export const defaultBattleRoyaleNews = {
  title: "Battle Royale - {version}",
  body: "Welcome to Battle Royale on Core!"
};

// Save the World's "New Updates" popup (the message of the day) read nothing on any build, so it showed its header and art
// with no text (Core-Backend #234): the page had no survivalmessage and no savetheworldnews. Every client from 1.x to 3.2
// reads survivalmessage.overrideablemessage.message {title, body} (3.2's strings: "survivalmessage", "overrideablemessage",
// "message", "title", "body"); 2.5 and later also name "savetheworldnews", which Epic serves as news.messages[], each
// {title, body, image, hidden}. Core serves both, from the host's "saveTheWorldNews": {"title": ..., "body": ...} or this.
export const defaultSaveTheWorldNews = {
  title: "Welcome to Save the World",
  body: "Welcome, Commander, to Save the World on Core!"
};

export const defaultLoginMessage = {
  title: "v{version}",
  body: "Welcome to Fortnite on Core!"
};

const saveTheWorldSelect = { message: { title: "Co-op PvE", body: "Cooperative PvE storm-fighting adventure!" } };

export const defaultSubgameSelect = {
  saveTheWorld: {
    title: "Co-op PvE",
    body: "Cooperative PvE storm-fighting adventure!"
  },
  battleRoyale: {
    title: "100 Player PvP",
    body: "100 Player PvP Battle Royale.\n\nPvE progress does not affect Battle Royale."
  }
};

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

// The mode select screen's key art, the picture beside the buttons (Core-Backend #331). From 5.30 the screen takes it from
// this page: 5.30's, 5.40's and 6.00's SubgameSelectScreen have the event OnSubGameImageLoadedFromCMS (5.21's and older
// don't). On construct (6.00 CL-4395664 sub_3009350) the native screen asks for Battle Royale's and Save the World's
// pictures (sub_30043F0). It reads subgameselectdata.{battleRoyale | saveTheWorld}.message.image: sub_2FF8F10 names the
// key, adding "Unowned" for a player without Save the World, and sub_2FF8B80 reads the field. The CMS image cache then
// downloads the picture and hands it to OnSubGameImageLoadedFromCMS. The blueprint keeps it in SubGameCMSTexture, and
// SetCMSTextureToKeyArt sets it as the key art material's GameMode_BR or GameMode_STW. With no image the material keeps its
// cooked picture. 6.00 still cooks Season 5's (UI/Login/SubGameSelect/Textures/T_BR_Right_S5a: Drift and Ragnarok),
// because Epic gave Season 6's from the page. So 6.00's mode select showed Season 5's characters. 6.01 (CL-4424678) still
// cooks that picture, and its SubgameSelectScreen is 6.00's byte for byte, so it takes Season 6's from the page too. 6.02's
// (CL-4461277) picture and screen are 6.01's byte for byte.
// Epic's Season 6 picture is BR06_In-Game_Mode-Select (Calamity, DJ Yonder and Bonesy, the Battle Pass of 27 September
// 2018). It is still on Epic's CDN under fortnite-game/subgameselect/ (checked 2026-11-11: GET answers 200 with the
// 1920x1080 JPEG, and the hash in its name is the file's SHA-1). The only copy of Epic's page found (the Neon backend's)
// names it, on a mirror, for battleRoyale. That copy has a second BR06_In-Game_Mode-Select, with
// ...0966cb19586efe754abcb74e3e7caea764086ef8 (Shogun). Shogun reached the shop on 18 November 2018, so that picture is
// a later one of the season's, not 6.00's.
// A season's picture goes to the builds whose game data is that season's (AthenaSeason). Seasons 1 to 5 have none: their
// builds before 5.30 don't read the field, and 5.30 to 5.41 cook Season 5's own picture. Save the World keeps its cooked
// picture, as no Epic picture for it was found.
const subgameSelectCdn = "https://cdn2.unrealengine.com/Fortnite/fortnite-game/subgameselect";
export const subgameSelectImages = {
  6: { battleRoyale: `${subgameSelectCdn}/BR06_In-Game_Mode-Select-1920x1080-4c0975cfecd29167b1c2ddf5d916fafbdcaa0f6c.jpg` }
};

// The Battle Royale season of a build's game data (Cert's, season 1, for a request naming no build).
const seasonOfBuild = (changelist) => inBuild(changelist === undefined ? undefined : String(changelist),
  () => athenaSeason()?.seasonNumber ?? 1);

export const subgameSelectImagesFor = (changelist) => subgameSelectImages[seasonOfBuild(changelist)] ?? {};

// A build Core doesn't know shows its changelist ("CL-3807424", without the "v"), and a request naming none "Core".
function messageOf(configured, fallback, changelist) {
  const version = versionOf(changelist);
  const label = version ?? (/^\d+$/.test(changelist ?? "") ? `CL-${changelist}` : "Core");
  const text = (value) => String(value).replaceAll("v{version}", version ? `v${version}` : label).replaceAll("{version}", label);
  return { title: text(configured?.title ?? fallback.title), body: text(configured?.body ?? fallback.body) };
}

export function subgameSelectFor(changelist, configured = undefined) {
  const titles = saleTitles[Number(changelist)];
  const defaultStwTitle = titles?.saveTheWorld ?? saveTheWorldSelect.message.title;
  const defaultStwBody = saveTheWorldSelect.message.body;
  const defaultBrTitle = titles?.battleRoyale ?? subgameSelectData.battleRoyale.message.title;
  const defaultBrBody = subgameSelectData.battleRoyale.message.body;

  // A field left blank in the panel keeps the build's own text, so setting only a title doesn't empty the description.
  const filled = (text) => (text ? { title: text.title || undefined, body: text.body || undefined } : undefined);
  const stw = messageOf(filled(configured?.saveTheWorld), { title: defaultStwTitle, body: defaultStwBody }, changelist);
  const br = messageOf(filled(configured?.battleRoyale), { title: defaultBrTitle, body: defaultBrBody }, changelist);
  const images = subgameSelectImagesFor(changelist);
  if (images.battleRoyale) br.image = images.battleRoyale;

  return {
    saveTheWorld: { message: stw },
    saveTheWorldUnowned: { message: stw },
    battleRoyale: { message: br }
  };
}

// The first build that reads battleRoyaleNews.news.messages[] (Core-Backend #117).
export const newsMessagesBuild = 3757339;

const readsNewsMessages = (changelist) => /^\d+$/.test(changelist ?? "") && Number(changelist) >= newsMessagesBuild;

export function battleRoyaleNewsFor(news, changelist, imageOrigin = undefined) {
  if (!news) {
    if (readsNewsMessages(changelist)) {
      return { news: { messages: [], region_messages: [], platform_messages: [] } };
    }
    return { news: { region_messages: [], platform_messages: [] } };
  }
  const message = messageOf(news, defaultBattleRoyaleNews, changelist);
  if (readsNewsMessages(changelist)) {
    const image = newsImageUrl(news.image, imageOrigin);
    return { news: { messages: [{ ...message, image }], region_messages: [], platform_messages: [] } };
  }
  return { news: { message, region_messages: [], platform_messages: [] } };
}

export function saveTheWorldNewsFor(configured, changelist) {
  const message = messageOf(configured, defaultSaveTheWorldNews, changelist);
  return {
    survivalmessage: {
      _title: "survivalmessage",
      overrideablemessage: { _type: "CommonUI Simple Message", message: { _type: "CommonUI Simple Message Base", ...message } },
      _activeDate: "2017-08-25T20:35:56.304Z",
      lastModified: "2026-10-27T16:30:00.000Z",
      _locale: "en-US",
      _templateName: "FortniteGameMOTD"
    },
    savetheworldnews: {
      _title: "SaveTheWorldNews",
      news: { _type: "Save The World News", messages: [{ _type: "CommonUI Simple Message Base", ...message, hidden: false, spotlight: false }] },
      alwaysShow: false,
      _activeDate: "2017-08-25T20:35:56.304Z",
      lastModified: "2026-10-27T16:30:00.000Z",
      _locale: "en-US",
      _templateName: "FortniteGameMOTD"
    }
  };
}

// The lobby's notice box, the yellow-headed warning above the PLAY button (Core-Backend #256): the page's emergencynotice
// section, news.messages[] of {hidden, title, body, spotlight}. Off (or never set), the section carries no message; a
// notice turned off after being written stays in the list with hidden: true, as Epic's own page keeps a withdrawn one.
// Every build 1.1 to 4.0 gets the same section; the later emergencynoticev2 shape belongs to builds Core doesn't support.
export function emergencyNoticeFor(notice, changelist) {
  const message = notice && (notice.title || notice.body)
    ? { _type: "CommonUI Simple Message Base", ...messageOf(notice, { title: "", body: "" }, changelist), hidden: notice.enabled !== true, spotlight: false }
    : undefined;
  return {
    _title: "emergencynotice",
    news: { _type: "Battle Royale News", messages: message ? [message] : [] },
    _activeDate: "2017-08-25T20:35:56.304Z",
    lastModified: "2026-10-27T16:30:00.000Z",
    _locale: "en-US"
  };
}

// (the Events tab's tournaments: tournaments/showdown.js tournamentInformationFor)
export function contentPage(news = defaultBattleRoyaleNews, loginMessage = defaultLoginMessage, changelist = undefined, subgameSelect = undefined,
  imageOrigin = undefined, saveTheWorldNews = undefined, lobbyNotice = undefined, playlistImages = undefined) {
  const battleRoyaleNews = battleRoyaleNewsFor(news, changelist, imageOrigin);
  // The mode select tiles (playlistimages.js): 4.0's to 5.30's playlistimages (Core-Backend #260, #319) and 5.40's
  // playlistinformation (#321), whose pictures the CMS cache keeps as the news one.
  const playlistimages = playlistImagesFor(changelist, playlistImages, imageOrigin);
  const playlistinformation = playlistInformationFor(changelist, playlistImages, imageOrigin);
  const subgameselectdata = subgameSelectFor(changelist, subgameSelect);
  const tournamentinformation = tournamentInformationFor(changelist);
  const page = {
    _title: "Fortnite Game",
    lastModified: "2026-10-27T16:30:00.000Z",
    _images_: [...new Set([...(battleRoyaleNews.news.messages ?? []).map((message) => message.image),
      ...(playlistimages?.playlistimages.images ?? []).map((entry) => entry.image),
      ...(playlistinformation?.playlist_info.playlists ?? []).map((entry) => entry.image),
      ...Object.values(subgameselectdata).map((entry) => entry.message.image)].filter(Boolean))],
    battleRoyaleNews,
    subgameselectdata,
    emergencynotice: emergencyNoticeFor(lobbyNotice, changelist),
    ...saveTheWorldNewsFor(saveTheWorldNews, changelist),
    ...(playlistimages ? { playlistimages } : {}),
    ...(playlistinformation ? { playlistinformation } : {}),
    // 6.10's Events tab: its tournaments' texts (tournaments/showdown.js).
    ...(tournamentinformation ? { tournamentinformation } : {})
  };
  if (loginMessage) {
    page.loginmessage = { loginmessage: { message: messageOf(loginMessage, defaultLoginMessage, changelist) } };
  }
  return page;
}

export function contentRoutes(context, config = {}) {
  const router = express.Router();
  router.get("/content/api/pages/fortnite-game", (req, res) => {
    const settings = context?.settings?.get?.() ?? {};
    const brNewsEnabled = (typeof settings.battleRoyaleNewsEnabled === "boolean")
      ? settings.battleRoyaleNewsEnabled
      : (typeof config.battleRoyaleNewsEnabled === "boolean"
        ? config.battleRoyaleNewsEnabled
        : (config.battleRoyaleNews !== false));
    const news = brNewsEnabled ? (settings.battleRoyaleNews ?? config.battleRoyaleNews ?? defaultBattleRoyaleNews) : null;
    const loginMessageEnabled = (typeof settings.loginMessageEnabled === "boolean")
      ? settings.loginMessageEnabled
      : (typeof config.loginMessageEnabled === "boolean"
        ? config.loginMessageEnabled
        : (config.loginMessage !== false));
    const loginMessage = loginMessageEnabled ? (settings.loginMessage ?? config.loginMessage ?? defaultLoginMessage) : null;
    const subgameSelect = settings.subgameSelect ?? config.subgameSelect;
    res.json(contentPage(news, loginMessage, getBuild(req), subgameSelect, newsImageOrigin(req), settings.saveTheWorldNews ?? config.saveTheWorldNews,
      settings.lobbyNotice ?? config.lobbyNotice, settings.playlistImages ?? config.playlistImages));
  });
  router.get(`${newsImagePath}/:name`, serveNewsImage(context?.dataDir ?? config.dataDir));

  return router;
}

import { ltms } from "../../events/ltms.js";
import { newsImageUrl } from "./images.js";

// The mode select screen's tile pictures (Core-Backend #260). 4.0 (CL-4039451) gives each tile of the Battle Royale mode
// select (AthenaMatchmakingTile, its native UFortAthenaMatchmakingTile's GameModeImage: a UEpicCMSImage) the picture the
// content page names for its playlist: the page's playlistimages section, playlistimages.images[], each
// {playlistname, image} (4.0's and 4.1's exe have the strings "playlistimages", "images", "playlistname" and "image"; 3.6's
// and older have none). A playlist the page doesn't name keeps the blueprint's one default picture (SetDefaultImage), the
// same for every mode, which is what every 4.0 tile showed. Older builds' tiles have no CMS image and get no section.
// 5.0 to 5.30 read the same section (Core-Backend #319: 5.30's reader is sub_2DBB420), and the tile (sub_2DBB250) takes the
// entry whose playlistname is its playlist's PlaylistName (UFortPlaylist +0x38): the data asset's PlaylistName, not its
// asset name, so Sniper Shootout's squads are Playlist_Snipers, as the asset Playlist_Snipers_Squads names itself.
//
// 5.40 (CL-4352937) reads playlistinformation instead (Core-Backend #321), as 8.30 does; its exe has no "playlistimages".
// UCMSContext::GetLatestAthenaPlaylistData (5.40 0x2FC4570 -> 0x2D65480) reads frontend_matchmaking_header_style,
// frontend_matchmaking_header_text and playlist_info.playlists[], each entry (0x2D64010) into FAthenaPlaylistEntry
// {PlaylistName: playlist_name, Description: description, Violator: violator, Image: image, SpecialBorderId:
// special_border, an EFortMatchmakingTileStyle: None, Special or HighStakes}. The mode select (UFortAthenaMatchmakingOptions,
// 0x2DADB50) hands each tile the entry with its playlist's PlaylistName (UFortAthenaMatchmakingTile CMSPlaylistEntry,
// +0x8C8), and the tile shows its image, violator and border; with no section, every tile, the default modes' too, kept
// the default picture. Core sends what Epic's page did for these playlists: the picture and the border, no description and
// no violator, so the tile keeps the playlist's own text.
//
// Epic's own pictures are still on its CDN (checked 2026-11-11: GET answers 200 with the PNG or JPEG, and the hash in each
// name is the file's SHA-1), under cdn2.unrealengine.com/Fortnite/fortnite-game/playlisttiles/, as Epic's 2018 pages named
// them (playlistimages entries of type PlaylistImageEntry): the default modes' BR_LobbyTileArt_*, Season 4's BR04_LTM_* and
// Season 5's BR05_* tiles. Season 5's are those of Epic's playlistimages section of 28 August 2018, the day Score Royale
// ended (a copy of Epic's page is LawinServer's responses/contentpages.json, that section's lastModified
// 2018-08-28T15:50:37.174Z): Score Royale, Steady Storm, Fly Explosives, Soaring 50's, and Solid Gold's tile for 50v50 Solid
// Gold (Playlist_50v50SAU) and Solid Gold's duos. Core serves their URLs and ships none. A client on -httpproxy sends the
// download to the backend too, which tunnels Epic's image CDN and the admin's picture hosts to the real site (imagehosts.js);
// before it did, it answered them itself, with a 404.
// High Explosives', Close Encounters', Solo Showdown's and Final Fight's are the tiles Epic's later page (its
// playlistinformation, same copy) names for them. The Getaway's (Playlist_Bling_*) is that page's tile for the same
// playlists, High Stakes' (the mode's return under that name), with its HighStakes border: 5.40's own tile of September 2018
// is neither on Epic's CDN nor in any copy of its pages that could be found. 5.41's Soaring Solos, Duos and Squads
// (Playlist_Soaring_Solo, _Duos, _Squads) take Soaring 50's tile, as that later page names it for all three. Sky Supply and Impact never ran (Epic made no
// tile for either), so they keep the default picture unless the host sets one.
// The admin panel's News page sets a playlist's own picture (settings playlistImages {playlistName: image}): an http(s) URL
// or a PNG/JPEG uploaded as the news pictures are (images.js), served here.
export const playlistImagesBuild = 4039451;
// The first build that reads playlistinformation, not playlistimages: 5.40 (5.41's and 6.00's exes read it too; 6.00's
// LTMs, 50v50, Playground and Soaring 50's, keep their Season 5 tiles). 6.01's exe (CL-4424678) reads it as well
// (playlist_info and special_border at 0x2DDFE50 and 0x2DDE880, no "playlistimages"); its Playlist_Disco, Update v6.02's
// Disco Domination, has the tile Epic's later page names for it, BR06_LobbyTile_LTM_DiscoDomination (on Epic's CDN,
// checked 2026-11-12: 200, the hash in its name the file's SHA-1).
export const playlistInformationBuild = 4352937;

const cdn = "https://cdn2.unrealengine.com/Fortnite/fortnite-game";
const soloTile = `${cdn}/playlisttiles/BR_LobbyTileArt_Solo-512x512-24446ea2a54612c5604ecf0e30475b4dec81c3bc.png`;
const duoTile = `${cdn}/playlisttiles/BR_LobbyTileArt_Duo-512x512-5dea8dfae97bddcd4e204dd47bfb245d3f68fc7b.png`;
const squadTile = `${cdn}/playlisttiles/BR_LobbyTileArt_Squad-512x512-5225ec6ca3265611957834c2c549754fe1778449.png`;
const fiftyTile = `${cdn}/playlisttiles/LTM_50v50-1024x512-788bf1a67426f54307c4296123ac2d3ff8cc0d6c.png`;
const teamsOf20Tile = `${cdn}/playlisttiles/BR04_LTM_5x20-1024x512-451b402db5751c25a1e7616930c5ae37d8b20710.png`;
const blitzTile = `${cdn}/playlisttiles/BR04_LTM_Blitz-1024x512-98c63417095442c210177ee9b5f3463d0003cd5a.png`;
const solidGoldTile = `${cdn}/playlisttiles/BR04_LTM_SolidGold-1024x512-36e202c36d3ef3bd151a97c060401d33ac6f549a.png`;
const sniperTile = `${cdn}/playlisttiles/BR04_LTM_SniperShootout-1024x512-bcaf8004961e4e374d0603813f840f4b575d230b.jpg`;
const gauntletTile = `${cdn}/playlisttiles/BR04_LTM_Gauntlet-1024x512-a0dca279534a121957275bcdb0b42042d8a010fd.png`;
const playgroundTile = `${cdn}/playlisttiles/BR_LTM-Tile_Playground-1024x512-53db8a4b5fb41251af279eaf923bc00ecbc17792.jpg`;
const highExplosivesTile = `${cdn}/playlistinformation/BR_LTM_HighExplosives-1024x512-4afc4219531db710e56f3b038e7cd84ca2be7675.jpg`;
const closeEncountersTile = `${cdn}/playlisttiles/BR04_LTM_CloseEncounters-1024x512-e617b7603adb59353ba81ed392174859c0c6807b.jpg`;
const soloShowdownTile = `${cdn}/playlisttiles/BR04_LTM_SoloShowdown-1024x512-0f522b0881adebfe241c6527f03c9140f70b88a7.png`;
const finalFightTile = `${cdn}/playlisttiles/LTM_Tile_FinalFight-1024x576-5af82788940faeef422ad204aaa241e36e7c9c56.jpg`;
const flyExplosivesTile = `${cdn}/playlisttiles/BR05_LTM_FlyExplosives-1024x512-6283e3392b3aa44794dac64423b22606f8773503.png`;
const steadyStormTile = `${cdn}/playlisttiles/BR05_LobbyTile_LTM-Steady-Storm-1024x512-f38e603ed9c80b6210a25c4737d3d8b675b8d28e.jpg`;
const soaringFiftiesTile = `${cdn}/playlisttiles/BR05_LTM_Soaring50s-1024x512-80762dcc260cc959c11dac2ca2f6ae176eb63ef3.jpg`;
const scoreRoyaleTile = `${cdn}/playlisttiles/BR05_LobbyTile_LTM_ScoreRoyale-1024x512-b608aaf7840cdf6b7a702c5cbe1848a2247516d6.jpg`;
const highStakesTile = `${cdn}/playlistinformation/08BR_HighStakes_ModeTile-1024x512-741e576e8ae2e30c256ff3508011760ace890711.jpg`;
const discoDominationTile = `${cdn}/playlistinformation/BR06_LobbyTile_LTM_DiscoDomination-1024x512-c79f07de78d8283656fcf4d1ee757f880911d775.jpg`;

// Epic's picture of each playlist, by PlaylistName.
export const epicPlaylistImages = {
  Playlist_DefaultSolo: soloTile,
  Playlist_DefaultDuo: duoTile,
  Playlist_DefaultSquad: squadTile,
  Playlist_50v50: fiftyTile,
  Playlist_5x20: teamsOf20Tile,
  Playlist_Blitz_Squad: blitzTile,
  Playlist_Blitz_Solo: blitzTile,
  Playlist_Blitz_Duos: blitzTile,
  Playlist_SolidGold_Squads: solidGoldTile,
  Playlist_SolidGold_Solo: solidGoldTile,
  Playlist_SolidGold_Duos: solidGoldTile,
  Playlist_Snipers_Solo: sniperTile,
  Playlist_Snipers_Duos: sniperTile,
  Playlist_Snipers: sniperTile,
  Playlist_HighExplosives_Solo: highExplosivesTile,
  Playlist_HighExplosives_Squads: highExplosivesTile,
  Playlist_Carmine: gauntletTile,
  Playlist_Comp_Solo: soloShowdownTile,
  Playlist_Close_Squad: closeEncountersTile,
  Playlist_Close_Solo: closeEncountersTile,
  Playlist_Close_Duos: closeEncountersTile,
  Playlist_Playground: playgroundTile,
  Playlist_Final_20: finalFightTile,
  Playlist_Final_12: finalFightTile,
  Playlist_FlyExplosives_Squads: flyExplosivesTile,
  Playlist_FlyExplosives_Solo: flyExplosivesTile,
  Playlist_FlyExplosives_Duos: flyExplosivesTile,
  Playlist_Steady_Solo: steadyStormTile,
  Playlist_Steady_Duos: steadyStormTile,
  Playlist_Steady_Squads: steadyStormTile,
  Playlist_Soaring_50s: soaringFiftiesTile,
  Playlist_Score_Solo: scoreRoyaleTile,
  Playlist_Score_Duos: scoreRoyaleTile,
  Playlist_Score_Squads: scoreRoyaleTile,
  Playlist_50v50SAU: solidGoldTile,
  Playlist_Bling_Squads: highStakesTile,
  Playlist_Bling_Duos: highStakesTile,
  Playlist_Bling_Solo: highStakesTile,
  Playlist_Soaring_Solo: soaringFiftiesTile,
  Playlist_Soaring_Duos: soaringFiftiesTile,
  Playlist_Soaring_Squads: soaringFiftiesTile,
  Playlist_Disco: discoDominationTile
};

// The border Epic's page gave a playlist's tile (playlistinformation special_border, 5.40 on): The Getaway's High Stakes one.
export const playlistBorders = {
  Playlist_Bling_Squads: "HighStakes",
  Playlist_Bling_Duos: "HighStakes",
  Playlist_Bling_Solo: "HighStakes"
};

const defaultModes = [
  { playlistName: "Playlist_DefaultSolo", name: "Solo" },
  { playlistName: "Playlist_DefaultDuo", name: "Duos" },
  { playlistName: "Playlist_DefaultSquad", name: "Squads" }
];

// A build range's last bound reaches 4.0: a changelist from 4.0 on, or a version (every one events/ltms.js names past its
// changelists is 4.2 or later).
const reachesPlaylistImages = (bound) => typeof bound !== "number" || bound >= playlistImagesBuild;

// Every playlist a build that reads playlistimages or playlistinformation has: the default modes and the LTMs of 4.0 on
// (events/ltms.js), each once, as {playlistName, name, epic} (epic: Epic's picture, or null).
export const playlistImageModes = () => {
  const seen = new Set();
  return [...defaultModes, ...ltms.filter((ltm) => ltm.playlistName && reachesPlaylistImages(ltm.builds[1]))
    .map((ltm) => ({ playlistName: ltm.playlistName, name: ltm.name }))]
    .filter(({ playlistName }) => !seen.has(playlistName) && seen.add(playlistName))
    .map((mode) => ({ ...mode, epic: epicPlaylistImages[mode.playlistName] ?? null }));
};

const changelistOf = (changelist) => (/^\d+$/.test(changelist ?? "") ? Number(changelist) : NaN);
export const readsPlaylistImages = (changelist) =>
  changelistOf(changelist) >= playlistImagesBuild && changelistOf(changelist) < playlistInformationBuild;
export const readsPlaylistInformation = (changelist) => changelistOf(changelist) >= playlistInformationBuild;

// The host's picture of a playlist when it has one, else Epic's: the URL the client is handed (an upload under origin).
export function playlistImageOf(playlistName, custom = {}, origin = undefined) {
  const own = custom?.[playlistName];
  if (typeof own === "string" && own) return newsImageUrl(own, origin);
  return epicPlaylistImages[playlistName] ?? "";
}

// The content page's playlistimages section for the requesting build (4.0 to 5.30), or undefined for one that doesn't
// read it.
export function playlistImagesFor(changelist, custom = {}, origin = undefined) {
  if (!readsPlaylistImages(changelist)) return undefined;
  const images = playlistImageModes()
    .map(({ playlistName }) => ({ image: playlistImageOf(playlistName, custom, origin), _type: "PlaylistImageEntry", playlistname: playlistName }))
    .filter((entry) => entry.image);
  return {
    _title: "playlistimages",
    playlistimages: { images, _type: "PlaylistImageList" },
    _activeDate: "2018-05-01T00:00:00.000Z",
    lastModified: "2026-11-11T12:00:00.000Z",
    _locale: "en-US"
  };
}

// The content page's playlistinformation section for the requesting build (5.40 on), or undefined for one that doesn't
// read it: Epic's shape, each playlist with a picture as {image, playlist_name, special_border, _type}.
export function playlistInformationFor(changelist, custom = {}, origin = undefined) {
  if (!readsPlaylistInformation(changelist)) return undefined;
  const playlists = playlistImageModes()
    .map(({ playlistName }) => ({ image: playlistImageOf(playlistName, custom, origin), playlist_name: playlistName,
      special_border: playlistBorders[playlistName] ?? "None", _type: "FortPlaylistInfo" }))
    .filter((entry) => entry.image);
  return {
    frontend_matchmaking_header_style: "None",
    _title: "playlistinformation",
    frontend_matchmaking_header_text: "",
    playlist_info: { _type: "Playlist Information", playlists },
    _noIndex: false,
    _activeDate: "2018-04-25T15:05:39.956Z",
    lastModified: "2026-11-11T12:00:00.000Z",
    _locale: "en-US"
  };
}

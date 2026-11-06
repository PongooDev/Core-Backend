import { ltms } from "../../events/ltms.js";
import { newsImageUrl } from "./images.js";

// The mode select screen's tile pictures (Core-Backend #260). 4.0 (CL-4039451) gives each tile of the Battle Royale mode
// select (AthenaMatchmakingTile, its native UFortAthenaMatchmakingTile's GameModeImage: a UEpicCMSImage) the picture the
// content page names for its playlist: the page's playlistimages section, playlistimages.images[], each
// {playlistname, image} (4.0's and 4.1's exe have the strings "playlistimages", "images", "playlistname" and "image"; 3.6's
// and older have none, and 8.30's reads playlistinformation instead). A playlist the page doesn't name keeps the
// blueprint's one default picture (SetDefaultImage), the same for every mode, which is what every 4.0 tile showed. Older
// builds' tiles have no CMS image and get no section.
//
// Epic's own pictures are still on its CDN (checked 2026-11-06: HEAD and GET answer 200 with the PNG or JPEG), under
// cdn2.unrealengine.com/Fortnite/fortnite-game/playlisttiles/, as Epic's 2018 pages named them (playlistimages entries of
// type PlaylistImageEntry): the default modes' BR_LobbyTileArt_* and Season 4's BR04_LTM_* tiles. Core serves their URLs
// and ships none. A client on -httpproxy sends the download to the backend too, which tunnels Epic's image CDN and the
// admin's picture hosts to the real site (imagehosts.js); before it did, it answered them itself, with a 404.
// High Explosives' is the tile Epic's later pages used for it (playlistinformation/BR_LTM_HighExplosives); Sky Supply and
// Impact have no tile of Epic's that could be found, so they keep the default picture unless the host sets one.
// The admin panel's News page sets a playlist's own picture (settings playlistImages {playlistName: image}): an http(s) URL
// or a PNG/JPEG uploaded as the news pictures are (images.js), served here.
export const playlistImagesBuild = 4039451;

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
  Playlist_Snipers_Solo: sniperTile,
  Playlist_Snipers_Duos: sniperTile,
  Playlist_Snipers: sniperTile,
  Playlist_HighExplosives_Solo: highExplosivesTile,
  Playlist_HighExplosives_Squads: highExplosivesTile,
  Playlist_Carmine: gauntletTile,
  Playlist_Playground: playgroundTile
};

const defaultModes = [
  { playlistName: "Playlist_DefaultSolo", name: "Solo" },
  { playlistName: "Playlist_DefaultDuo", name: "Duos" },
  { playlistName: "Playlist_DefaultSquad", name: "Squads" }
];

// A build range's last bound reaches 4.0: a changelist from 4.0 on, or a version (every one events/ltms.js names past its
// changelists is 4.2 or later).
const reachesPlaylistImages = (bound) => typeof bound !== "number" || bound >= playlistImagesBuild;

// Every playlist a build that reads playlistimages has: the default modes and the LTMs of 4.0 on (events/ltms.js), each
// once, as {playlistName, name, epic} (epic: Epic's picture, or null).
export const playlistImageModes = () => {
  const seen = new Set();
  return [...defaultModes, ...ltms.filter((ltm) => ltm.playlistName && reachesPlaylistImages(ltm.builds[1]))
    .map((ltm) => ({ playlistName: ltm.playlistName, name: ltm.name }))]
    .filter(({ playlistName }) => !seen.has(playlistName) && seen.add(playlistName))
    .map((mode) => ({ ...mode, epic: epicPlaylistImages[mode.playlistName] ?? null }));
};

export const readsPlaylistImages = (changelist) => /^\d+$/.test(changelist ?? "") && Number(changelist) >= playlistImagesBuild;

// The host's picture of a playlist when it has one, else Epic's: the URL the client is handed (an upload under origin).
export function playlistImageOf(playlistName, custom = {}, origin = undefined) {
  const own = custom?.[playlistName];
  if (typeof own === "string" && own) return newsImageUrl(own, origin);
  return epicPlaylistImages[playlistName] ?? "";
}

// The content page's playlistimages section for the requesting build, or undefined for one that doesn't read it.
export function playlistImagesFor(changelist, custom = {}, origin = undefined) {
  if (!readsPlaylistImages(changelist)) return undefined;
  const images = playlistImageModes()
    .map(({ playlistName }) => ({ image: playlistImageOf(playlistName, custom, origin), _type: "PlaylistImageEntry", playlistname: playlistName }))
    .filter((entry) => entry.image);
  return {
    _title: "playlistimages",
    playlistimages: { images, _type: "PlaylistImageList" },
    _activeDate: "2018-05-01T00:00:00.000Z",
    lastModified: "2026-11-06T12:00:00.000Z",
    _locale: "en-US"
  };
}

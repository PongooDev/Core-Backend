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
// checked 2026-11-12: 200, the hash in its name the file's SHA-1). 6.02's exe (CL-4461277) has the same two names and no
// new one (its strings against 6.01's), and its Playlist_Disco_32, the 32 a side Disco Domination, takes the mode's tile.
// 6.10's exe (CL-4480234) keeps both names too; its two further Disco Dominations (Playlist_Disco_40, Playlist_Disco_Alt)
// take the mode's tile, and its tournaments have a page of their own, tournamentinformation (tournaments/showdown.js),
// whose playlist_tile_image Core has no picture for. 6.20's exe (CL-4497486) keeps the same names and adds none (its strings
// against 6.10's); its Playlist_Disco_40_Alt and _32_Alt take the mode's tile, and its Fortnitemares playlists
// (Playlist_Deimos_Solo, _Duo, _Squad) take the tiles Epic's later page names for them (Core-Backend #348; before, they
// had none and showed no picture): BR06_Fortnitemares_In-GamePlaylist_1024x512 Solo, Duos and Squads, one each (Deadfire
// on purple; on Epic's CDN, checked 2026-11-13: 200, image/jpeg, the hash in each name the file's SHA-1), as that page
// (LawinServer's contentpages.json copy, lastModified 2019-10-29) lists them, with no border. 6.21's
// exe (CL-4526925) keeps the same names and adds none (its strings against 6.20's), and adds no playlist. Its new content
// section, koreancafe (FCmsJsonMessages.KoreanCafe: {_title, __locale, cafe_info: {cafes: [{korean_cafe, korean_cafe_header,
// korean_cafe_description}]}}), is read only by UCMSContext::GetLatestPCBInfo (0x2EAFDE0: the whole page converted into
// FCmsJsonMessages, the result not checked) for the Korean PC bang panel (UFortPCBInfoPannel); without it the panel's data
// is empty, so Core serves none. The news, the playlists and the tournaments are read as on 6.20. 6.22's exe (CL-4543176)
// keeps the same names (its strings against 6.21's). Its Team Terror (Playlist_Deimos_50) has the tile Epic's later page
// names for it, playlist_name "playlist_deimos_50" (the tile's FName compare ignores case),
// BR06_In-GamePlaylist_TeamTerror_1024x512 (on Epic's CDN, checked 2026-11-14: 200, image/jpeg, 481,922 bytes, the hash
// in its name the file's SHA-1), with no border. 6.30's exe (CL-4573096) keeps the same names (playlistinformation,
// playlist_info, special_border, tournamentinformation; its strings against 6.22's). Its Food Fight (Playlist_Barrier and
// Playlist_Barrier_12) has the tile Epic's later page names for Playlist_Barrier_12, BR06_LobbyTile_FoodFight (the page's
// Playlist_Barrier_16 tile, BR_LTM_FoodFight16, is a later season's), and its Wild West (Playlist_WW_Solo, _Duos and
// _Squads) the Season 6 tile that page names for Playlist_WW_Duos, BR06_ModeTile_LTM_WildWest (its Solo and Squads have a
// later rerun's BR_LTM_WildWest there); both on Epic's CDN, checked 2026-11-14: 200, image/png and image/jpeg, 489,196 and
// 330,155 bytes, the hash in each name the file's SHA-1; no border. Its Disco Domination (32 v 32, Alt) takes the mode's
// tile, as 6.20's did (the page's BR_LTM_HolidayDisco is a later season's). 6.31's exe (CL-4573279) keeps the same names
// (its strings against 6.30's). Its Team Rumble (Playlist_Respawn_24) has the Season 6 tile Epic's later page names for it,
// BR06_ModeTile_TDM (on Epic's CDN, checked 2026-11-14: 200, image/jpeg, 477,366 bytes, the hash in its name the file's
// SHA-1), with no border. 7.00's exe (CL-4629139) keeps the same names (playlistinformation, playlist_info, special_border,
// tournamentinformation; its strings against 6.31's) and adds one section, creativeads (Creative's hub: pages.js
// creativeAdsFor). Its Season 7 playlists take the tiles Epic's later page names for them (LawinServer's contentpages.json copy,
// lastModified 2019-11-01; every URL on Epic's CDN, checked 2026-11-16: 200, image/jpeg, the hash in each name the file's
// SHA-1), no border: Playlist_Classic_Squads the Unvaulted tile, BR_LTM_Unvaulted (526,103 bytes; its Solo and Duos take it
// too), Playlist_Vamp_Squad the Siphon tile, BR_LTM_Siphon (2,339,610 bytes; its Solo and Duo too). Its Close Encounters,
// Sniper Shootout, High Explosives, Soaring, Disco Domination, Team Rumble, 50v50 and Playground keep the tiles above. No
// Season 7 tile for the default modes was found either.
// The default modes' tiles (Core-Backend #354 asked for each season's own). Seasons 1 to 3 (before 4.0) read no tile from
// the page: their tiles are the client's. From 4.0 the tile's own picture is one texture for every mode
// (UI/Foundation/Textures/Tiles/T_Athena_Tile_Matchmaking_Default, 6.21's paks), so a mode's art is the page's. Every copy of
// Epic's pages found names BR_LobbyTileArt_Solo, _Duo and _Squad (playlisttiles, 512x512) for the three, the Season 4 to 6
// pages' and later ones' alike (LawinServer's and other backends' copies, the Wayback Machine's captures of the CDN's
// playlisttiles and playlistinformation folders, searched 2026-11-14): no BR04_, BR05_ or BR06_ default-mode tile is in any
// of them. The first season tiles for the default modes there are Season X's and 11's (playlistinformation/v94/
// 10BR_Launch_ModeTiles_* and 11BR_Launch_ModeTiles_*, still on the CDN), for builds Core doesn't run. So Seasons 4 to 6 keep
// Epic's BR_LobbyTileArt, and the admin panel's News page sets a season's own picture for any mode.
// Season 7 the same (#354 again, for 7.00, searched 2026-11-16): 7.00's and 7.10's paks have no tile of their own for any
// mode (UI/Foundation/Textures/Tiles still holds only T_Athena_Tile_Matchmaking_Default; the playlist assets name only their
// 64-pixel MissionIcon), the Wayback Machine has no capture of Epic's content page between December 2018 and October 2019
// (fortnitecontent-website-prod07's first is 2019-10-13; fortnite-public-service-prod11 has none), and its captures of the
// CDN's playlistinformation, playlisttiles and subgameselect folders (and every other fortnite-game folder's BR07 or
// ModeTile files) hold Season 7 tiles for limited time modes only (BR07_14-DoF_Social, BR07_ModeTile_*), none for Solo,
// Duos or Squads; nor do the community copies of Epic's pages (LawinServer and its forks, Neon, Neodyme's asset index,
// Reload, Aura, Neonite's per-season library, which starts at Season X). So 7.00 keeps BR_LobbyTileArt too. The 14 Days of
// Fortnite's playlists (7.10's, not 7.00's) have Epic's tiles on that later page (BR07_14-DoF_Social for Playlist_33,
// BR_LTM_Barebones, _Slide, _OneShot, _GroundGame, _SneakySilencers, _CloseEncounters50s, _HighExplosives50s,
// _FoodFight16; each checked on the CDN 2026-11-16: 200, image/jpeg, the hash in its name the file's SHA-1); they come in
// with 7.10's LTMs (below), as every picture here is a playlist some build's LTM names, and so do the 14 Days' Holiday
// Disco (BR_LTM_HolidayDisco) and Wild West (BR_LTM_WildWest), checked the same way, on 7.10's page only.
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
const fortnitemaresSoloTile = `${cdn}/playlistinformation/BR06_Fortnitemares_In-GamePlaylist_1024x512_-Solo-1024x512-7e7fe76e48beb3a06da0592cb26e412265986e4d.jpg`;
const fortnitemaresDuosTile = `${cdn}/playlistinformation/BR06_Fortnitemares_In-GamePlaylist_1024x512_Duos-1024x512-1eadb7cfab62c9eb5c90c65577c676d5d0bb15c2.jpg`;
const fortnitemaresSquadsTile = `${cdn}/playlistinformation/BR06_Fortnitemares_In-GamePlaylist_1024x512_Squads-1024x512-783a0812f6acf1f5931c8015e6ad13c0b76c5a9c.jpg`;
const teamTerrorTile = `${cdn}/playlistinformation/BR06_In-GamePlaylist_TeamTerror-1024x512-310430bdaf1b1dd0ecb4d3b180bb6409b7ff6e27.jpg`;
const discoDominationTile = `${cdn}/playlistinformation/BR06_LobbyTile_LTM_DiscoDomination-1024x512-c79f07de78d8283656fcf4d1ee757f880911d775.jpg`;
const foodFightTile = `${cdn}/playlistinformation/BR06_LobbyTile_FoodFight-1024x512-5e1540a0a2ba0a1f663d32c60cfec3a360278672.png`;
const wildWestTile = `${cdn}/playlistinformation/BR06_ModeTile_LTM_WildWest-1024x512-f67d9d1dd2ca0b290c92b1380240429f0f257a10.jpg`;
const teamRumbleTile = `${cdn}/playlistinformation/BR06_ModeTile_TDM-1024x512-878ba9f92deb153ec85f2bcbce925e185344290e.jpg`;
const unvaultedTile = `${cdn}/playlistinformation/BR_LTM_Unvaulted-1024x512-d3cbe3c4a756190279af4ce98773d6599f7aab4f.jpg`;
const siphonTile = `${cdn}/playlistinformation/BR_LTM_Siphon-1024x512-66cb27084be50387682989b50a01dbc9e42f5a5d.jpg`;
// 7.10's (CL-4667333) 14 Days of Fortnite tiles, from the same later page (each on Epic's CDN, checked 2026-11-16: 200,
// image/jpeg, the hash in each name the file's SHA-1): Teams of 33's BR07_14-DoF_Social (560,784 bytes), and the BR_LTM_
// set Unvaulted's and Siphon's belong to: Barebones (275,328), Slide (146,738), Ground Game (327,861), Sneaky Silencers
// (395,165), One Shot (429,759), High Explosives 50's (192,574), Close Encounters 50's (246,657), Food Fight 16
// (400,783), Holiday Disco (2,620,828) and Wild West (374,293).
const teamsOf33Tile = `${cdn}/playlistinformation/BR07_14-DoF_Social-1024x512-5fa7dd4752d1f0cc1a101f09cb170d0f5b2a31cf.jpg`;
const barebonesTile = `${cdn}/playlistinformation/BR_LTM_Barebones-1024x512-4a29337febb04e9043d57c9e61afe849f8a9e9c7.jpg`;
const slideTile = `${cdn}/playlistinformation/BR_LTM_Slide-1024x512-189625349e80dc81e225691aa952ffd280996058.jpg`;
const groundGameTile = `${cdn}/playlistinformation/BR_LTM_GroundGame-1024x512-37a4d1d335b4c9427bdc672db0f335f4df813874.jpg`;
const sneakySilencersTile = `${cdn}/playlistinformation/BR_LTM_SneakySilencers-1024x512-1669e2eeddca63b61e9b94cc19c3ec502fd33f29.jpg`;
const oneShotTile = `${cdn}/playlistinformation/BR_LTM_OneShot-1024x512-9914c2c88b21f72f9628681e0cbcd20bb7311a3f.jpg`;
// 8.20's (CL-5625478) Floor is Lava and Going Green, the tiles Epic's later page (the same copy) names for them, each on
// Epic's CDN (checked 2026-11-23: 200, image/jpeg, the hash in each name the file's SHA-1; 548,342 and 296,023 bytes).
// That page names Slide's tile for Slide's duos too.
const floorIsLavaTile = `${cdn}/playlistinformation/08BR_LTM_FloorIsLava_ModeTile-1024x512-f1af4cd98c7ff0ce4058f4e3b65a853641d0a35e.jpg`;
const goingGreenTile = `${cdn}/playlistinformation/08BR_LTM_SolidGreen_ModeTile_Squads-1024x512-f0d931472907d54ffaa52ef81f78bf9d5fcfaa2d.jpg`;
const highExplosives50sTile = `${cdn}/playlistinformation/BR_LTM_HighExplosives50s-1024x512-3a8d44af3c2718b5aaaaebbd4627258a657bf0bf.jpg`;
const closeEncounters50sTile = `${cdn}/playlistinformation/BR_LTM_CloseEncounters50s-1024x512-03dcc058e1bec3e853b3ee20594128805223b5a3.jpg`;
const foodFight16Tile = `${cdn}/playlistinformation/BR_LTM_FoodFight16-1024x512-309538a1b961b5ab0c22417ab34170cc302bbab8.jpg`;
const holidayDiscoTile = `${cdn}/playlistinformation/BR_LTM_HolidayDisco-1024x512-684bd4b41613e59d895a477389515a8b4878da6a.jpg`;
const wildWest14DaysTile = `${cdn}/playlistinformation/BR_LTM_WildWest-1024x512-42779242a5a73d654332d9d0afe0983f9d8401d0.jpg`;
// 7.20's (CL-4727874) Ice Storm tiles, BR07_ModeTile_WinterDeimos_*, from the same later page (each on Epic's CDN, checked
// 2026-11-17: 200, image/jpeg, the hash in each name the file's SHA-1): Solo (200,506 bytes), Duos (266,521) and Squads
// (325,013). Its One Shot and Sniper Shootout have their tiles above.
const iceStormSoloTile = `${cdn}/playlistinformation/BR07_ModeTile_WinterDeimos_Solo-1024x512-5c759fe60ec85988f35c729b5fb6a7993d8dbb58.jpg`;
const iceStormDuosTile = `${cdn}/playlistinformation/BR07_ModeTile_WinterDeimos_Duos_-1024x512-84315aac8d1fcfb840deba46c4dafda8e9005b2a.jpg`;
const iceStormSquadsTile = `${cdn}/playlistinformation/BR07_ModeTile_WinterDeimos_Squads-1024x512-cf4323aa9c2cfd027484cf4da14544128e3d4c7e.jpg`;
// 7.40's (CL-5046157) modes, from the same later page, which names one tile for each mode's playlists (each on Epic's CDN,
// checked 2026-11-19: 200, image/jpeg, the hash in each name the file's SHA-1): Love Shot's BR07_ModeTile_LTM_LoveShot_v2
// (362,936 bytes), Sword Fight's BR07_ModeTile_LTM_InfinityBlade_v2 (129,987), Catch!'s BR07_ModeTile_LTM_CatchSquads
// (248,858) and Driftin's BR07_ModeTile_LTM_Drifting50s_Powder (398,266).
const loveShotTile = `${cdn}/playlistinformation/BR07_ModeTile_LTM_LoveShot_v2-1024x512-cd7b917157be2472bebc3db3b125e9b20174c748.jpg`;
const swordFightTile = `${cdn}/playlistinformation/BR07_ModeTile_LTM_InfinityBlade_v2-1024x512-475608c25c288f7d5c884eeebc47fb565f6f5803.jpg`;
const catchTile = `${cdn}/playlistinformation/BR07_ModeTile_LTM_CatchSquads-1024x512-7289222d56b08ef8de20c7187af2670496dca3df.jpg`;
const driftinTile = `${cdn}/playlistinformation/BR07_ModeTile_LTM_Drifting50s_Powder-1024x512-5fb24cfd4d83e4cd3a3589b126313beba9cc69a7.jpg`;
// 7.00's (CL-4629139) Creative, Playlist_PlaygroundV2 (events/ltms.js's `creative`, PongooDev/CoreV2#471), on 7.00 to 7.40:
// the Battle Royale mode select's Creative tile is an AthenaMatchmakingTile like every other mode's, so it shows the
// playlistinformation entry with its PlaylistName. Core's page had none for it, so the tile kept the blueprint's picture
// (GameModeImage's brush, T_Athena_Tile_Matchmaking_Default: 7.40's AthenaMatchmakingTile; SetDefaultImage shows it), the
// generic one every mode without a tile has. T_Creative_Right, which 7.00 to 7.40 also cook (UI/Login/SubGameSelect/
// Textures), is the subgame select screen's Creative key art (SubgameSelectScreen's ShowCreativeImage), not this tile's.
// Epic's later page (LawinServer's contentpages.json copy, its playlistinformation lastModified 2019-10-29) names
// CM_LobbyTileArt for Playlist_PlaygroundV2 (Creative's launch art: a builder with the phone beside a tower, planes and a
// quad), with no special_border, so no border; on Epic's CDN, checked 2026-11-19: 200, image/jpeg, 527,504 bytes, the hash
// in its name the file's SHA-1. 7.30's (CL-4834550) NFL Rumble (Playlist_Omaha) has that page's
// BR07_ModeTile_NFL_TeamRumble (a Patriots and a Rams player; 200, image/jpeg, 312,367 bytes, its SHA-1 the hash), no
// border. 7.30's Party at Pleasant Park (Playlist_Music_Highest) keeps the default picture: that page names the Showtime
// playlists only for later live events that reused them (Playlist_Music_Highest, _Higher, _Med and _Low Season 9's
// 09BR_RobotFight_ModeTile, the Monster against the Mech; _High Season X's 10BR_In-Game_Farewell_ModeTile), and no Showtime
// tile of Epic's is in any copy of its pages found or in the Wayback Machine's captures of the CDN's fortnite-game folders
// (searched 2026-11-19: playlistinformation's Season 7 files are the BR07_ ones here and CM_LobbyTileArt).
const creativeTile = `${cdn}/playlistinformation/CM_LobbyTileArt-1024x512-fbcd48db36552ccb1ab4021b722ea29d515377cc.jpg`;
const nflRumbleTile = `${cdn}/playlistinformation/BR07_ModeTile_NFL_TeamRumble-1024x512-6facfc07214965dc2211d703904607a30c68d08a.jpg`;
// 8.40's (CL-6005771) Air Royale and Food Fight: Deep Fried (Core-Backend #422), the tiles Epic's later page (the Wayback
// Machine's capture of fortnitecontent-website-prod07's fortnite-game of 2019-10-13, its playlistinformation) names for
// them: 08BR_AirRoyale_Mode-Tile for Playlist_Goose_Solo, _Squads and _Duos_24 (the page has no entry for _Duos, the one 8.40
// serves; it is the same mode, so it takes the mode's tile) and EN_08BR_DeepFried_Mode_Tile for Playlist_Barrier_16_B_Lava;
// no border. Each on Epic's CDN, checked 2026-11-24: 200, image/jpeg, 393,691 and 378,140 bytes, the hash in each name the
// file's SHA-1.
const airRoyaleTile = `${cdn}/playlistinformation/08BR_AirRoyale_Mode-Tile-1024x512-e071f542b7e0ce2cfc34c208e14604815b76439c.jpg`;
const deepFriedTile = `${cdn}/playlistinformation/EN_08BR_DeepFried_Mode_Tile-1024x512-227979fa27053f858066a1a47d68b55f792fded1.jpg`;
// 8.50's (CL-6058028) Endgame: the same page names 08BR_LTM_Endgame_InGame_Mode-Tile for Playlist_Ashton_Sm, the one 8.50
// serves; _Md and _Lg are the same mode, so they take it too. No border. On Epic's CDN, checked 2026-11-24: 200, image/jpeg,
// 818,679 bytes, the hash in its name the file's SHA-1.
const endgameTile = `${cdn}/playlistinformation/08BR_LTM_Endgame_InGame_Mode-Tile-1024x512-03bb0dc121ae8b2dcd27b8b386670737093d0c83.jpg`;

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
  Playlist_Disco: discoDominationTile,
  Playlist_Disco_32: discoDominationTile,
  Playlist_Disco_40: discoDominationTile,
  Playlist_Disco_Alt: discoDominationTile,
  Playlist_Disco_40_Alt: discoDominationTile,
  Playlist_Disco_32_Alt: discoDominationTile,
  Playlist_Deimos_Solo: fortnitemaresSoloTile,
  Playlist_Deimos_Duo: fortnitemaresDuosTile,
  Playlist_Deimos_Squad: fortnitemaresSquadsTile,
  Playlist_Deimos_50: teamTerrorTile,
  Playlist_Barrier: foodFightTile,
  Playlist_Barrier_12: foodFightTile,
  Playlist_WW_Solo: wildWestTile,
  Playlist_WW_Duos: wildWestTile,
  Playlist_WW_Squads: wildWestTile,
  Playlist_Respawn_24: teamRumbleTile,
  Playlist_Classic_Solo: unvaultedTile,
  Playlist_Classic_Duos: unvaultedTile,
  Playlist_Classic_Squads: unvaultedTile,
  Playlist_Vamp_Solo: siphonTile,
  Playlist_Vamp_Duo: siphonTile,
  Playlist_Vamp_Squad: siphonTile,
  // 7.10's 14 Days of Fortnite playlists (above, events/ltms.js's 7.10 modes), new to Core: only 7.10's page lists them.
  Playlist_33: teamsOf33Tile,
  Playlist_Hard_Squads: barebonesTile,
  Playlist_Slide_Solo: slideTile,
  Playlist_Ground_Squads: groundGameTile,
  Playlist_Sneaky_Solo: sneakySilencersTile,
  Playlist_Low_Squads: oneShotTile,
  Playlist_50v50HE: highExplosives50sTile,
  Playlist_Close_50: closeEncounters50sTile,
  Playlist_Barrier_16: foodFight16Tile,
  Playlist_Deimos_Solo_Winter: iceStormSoloTile,
  Playlist_Deimos_Duo_Winter: iceStormDuosTile,
  Playlist_Deimos_Squad_Winter: iceStormSquadsTile,
  Playlist_Love_Solo: loveShotTile,
  Playlist_Love_Duos: loveShotTile,
  Playlist_Love_Squads: loveShotTile,
  Playlist_Sword_Solo: swordFightTile,
  Playlist_Sword_Duos: swordFightTile,
  Playlist_Sword_Squads: swordFightTile,
  Playlist_Toss_Solo: catchTile,
  Playlist_Toss_Duos: catchTile,
  Playlist_Toss_Squads: catchTile,
  Playlist_Hover: driftinTile,
  Playlist_Hover_64: driftinTile,
  Playlist_Hover_48: driftinTile,
  // 8.20's (above): Floor is Lava's three, Going Green's squads (Playlist_Green_Squads' PlaylistName) and Slide's duos.
  Playlist_Fill_Solo: floorIsLavaTile,
  Playlist_Fill_Duos: floorIsLavaTile,
  Playlist_Fill_Squads: floorIsLavaTile,
  Playlist_Green_Squad: goingGreenTile,
  Playlist_Slide_Duos: slideTile,
  // 7.00's to 7.40's Creative and 7.30's NFL Rumble (above): only the pages of the builds that have them list them.
  Playlist_PlaygroundV2: creativeTile,
  Playlist_Omaha: nflRumbleTile,
  // 8.40's Air Royale and Deep Fried (above).
  Playlist_Goose_Duos: airRoyaleTile,
  Playlist_Barrier_16_B_Lava: deepFriedTile,
  // 8.50's Endgame (above).
  Playlist_Ashton_Sm: endgameTile,
  Playlist_Ashton_Md: endgameTile,
  Playlist_Ashton_Lg: endgameTile
};
// The 14 Days of Fortnite's own tiles for playlists an earlier build's page already shows with another (7.10, CL-4667333,
// and later): Disco Domination's holiday rerun (Playlist_Disco_32_Alt, BR_LTM_HolidayDisco) and Wild West's Squads
// (BR_LTM_WildWest, which the later page names for it). 6.30's to 7.00's pages keep 6.30's tiles for them.
const epicPlaylistImagesFrom710 = {
  Playlist_Disco_32_Alt: holidayDiscoTile,
  Playlist_WW_Squads: wildWest14DaysTile
};
const playlistImages710Build = 4667333;
// Epic's picture of a playlist on a build's page (any build's for none).
export const epicPlaylistImageOf = (playlistName, changelist = undefined) =>
  (changelistOf(changelist) >= playlistImages710Build ? epicPlaylistImagesFrom710[playlistName] : undefined) ?? epicPlaylistImages[playlistName] ?? null;

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
// (events/ltms.js), each once, as {playlistName, name, epic} (epic: Epic's picture, or null). The LTMs first in 7.00
// (CL-4629139) or later are on the pages of those builds only, so an earlier build's page stays as it was (it never had
// their playlists); the admin panel (no changelist) lists them all.
const pagesOwnLtmsBuild = 4629139;
const onPageOf = (ltm, changelist) => typeof ltm.builds[0] !== "number" || ltm.builds[0] < pagesOwnLtmsBuild
  || changelist === undefined || !(changelistOf(changelist) < ltm.builds[0]);
export const playlistImageModes = (changelist = undefined) => {
  const seen = new Set();
  return [...defaultModes, ...ltms.filter((ltm) => ltm.playlistName && reachesPlaylistImages(ltm.builds[1]) && onPageOf(ltm, changelist))
    .map((ltm) => ({ playlistName: ltm.playlistName, name: ltm.name }))]
    .filter(({ playlistName }) => !seen.has(playlistName) && seen.add(playlistName))
    .map((mode) => ({ ...mode, epic: epicPlaylistImageOf(mode.playlistName, changelist) }));
};

const changelistOf = (changelist) => (/^\d+$/.test(changelist ?? "") ? Number(changelist) : NaN);
export const readsPlaylistImages = (changelist) =>
  changelistOf(changelist) >= playlistImagesBuild && changelistOf(changelist) < playlistInformationBuild;
export const readsPlaylistInformation = (changelist) => changelistOf(changelist) >= playlistInformationBuild;

// The host's picture of a playlist when it has one, else Epic's: the URL the client is handed (an upload under origin).
export function playlistImageOf(playlistName, custom = {}, origin = undefined, changelist = undefined) {
  const own = custom?.[playlistName];
  if (typeof own === "string" && own) return newsImageUrl(own, origin);
  return epicPlaylistImageOf(playlistName, changelist) ?? "";
}

// The content page's playlistimages section for the requesting build (4.0 to 5.30), or undefined for one that doesn't
// read it.
export function playlistImagesFor(changelist, custom = {}, origin = undefined) {
  if (!readsPlaylistImages(changelist)) return undefined;
  const images = playlistImageModes(changelist)
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
  const playlists = playlistImageModes(changelist)
    .map(({ playlistName }) => ({ image: playlistImageOf(playlistName, custom, origin, changelist), playlist_name: playlistName,
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

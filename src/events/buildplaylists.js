// The playlists of earlier seasons a build's paks still hold, each with everything it loads (Core-Backend #440): its
// ModifierList, mission generator, GameData, loot tables, resource rates, supply drops and ItemsToFullyLoad, every one in
// the build's paks (FModel). An admin may turn such a playlist's mode on there (events/ltms.js heldLtms): Epic didn't
// offer it on the build, but the build plays it. Each entry is the build's own asset's [PlaylistId, MaxTeamCount,
// MaxTeamSize, MaxSquadSize]: a playlist's id can differ from its own season's (9.00's Playlist_Score_Squads is 100, 5.30's
// 103; 9.00's 103 is Playlist_Final_12). Only playlists whose last LTM is before the build are listed: a later season's
// playlist a build ships early may not be finished.
// Each list is the build's paks' FortniteGame/Content/Athena/Playlists (FModel), against events/ltms.js's LTMs of 1.11 to
// 8.51, keyed by the asset's own PlaylistName (not its file's: Playlist_Close_Squads.uasset is Playlist_Close_Squad). A
// playlist is listed only if every ModifierList, mission generator, GameData, loot, resource rates, supply drop and
// ItemsToFullyLoad entry it names is in the paks. Playlist_Music_Highest (7.30's Party at Pleasant Park, 8.51's Unvaulting)
// is a live event's, and the Ice Storm's, the Showdown's, the Arena's and the tournaments' playlists are their events', so
// none is listed.
// 9.00 (CL-6337466): 75. 9.01 (CL-6428087): the same 75, its 146 assets' ids and teams are 9.00's; its paks' Playlist_
// Unvaulted_Squads is 9.10's Unvaulted, a later build's, so it isn't listed.
// 9.10 (CL-6639283): 72, 9.01's less Playlist_Close_Squad, _Respawn_24 and _Snipers_Duos, which 9.10's rotations and Team
// Rumble run themselves; every id and size is 9.01's. CL-6573057 (Update v9.10) has no paks here and plays on CL-6639283's
// data (gamedata/read.js laterData): the 20 playlists 6639283 added (Creative's play-only ones, Downtown Drop, Fortnite_B_*_G,
// Lite_*) are none of an earlier season's, and the other ids and sizes are 9.01's in both, so its list is 6639283's; whether
// Content Update v9.10 changed a held playlist's other assets from Update v9.10 is not knowable without its paks.
// 9.20 (CL-6822798): 9.10's 72. Each of the 72 assets is the same in 9.20's paks as in 9.10's, and every asset each one
// names is in 9.20's paks. 9.20's 12 added assets: 7.40's Playlist_Sword_* (335 to 337), which 9.20's own rotation runs
// (events/ltms.js), Update v9.21's Horde Rush (Playlist_Mash_Squads, a later build's), Playlist_Tutorial_1 and seven
// Creative play-only playlists, none an earlier season's mode.
// 9.21 (CL-6922310): 9.20's. Its 177 playlist assets are 9.20's, each the same asset (the same scan of all its paks but the
// keyed pakchunk1007 and 1010); Horde Rush (Playlist_Mash_Squads) is 9.21's own (events/ltms.js).
const held900 = {
  Playlist_33: [151, 3, 33, 4],
  Playlist_50v50HE: [203, 2, 50, 4],
  Playlist_50v50SAU: [1993, 2, 50, 4],
  Playlist_5x20: [22, 5, 20, 4],
  Playlist_Ashton_Lg: [258, 2, 32, 4],
  Playlist_Ashton_Md: [257, 2, 24, 4],
  Playlist_Ashton_Sm: [256, 2, 20, 4],
  Playlist_Barrier: [204, 2, 24, 4],
  Playlist_Barrier_12: [206, 2, 12, 4],
  Playlist_Barrier_16: [207, 2, 16, 4],
  Playlist_Barrier_16_B_Lava: [226, 2, 16, 4],
  Playlist_Bling_Duos: [141, 100, 2, 2],
  Playlist_Bling_Solo: [140, 100, 1, 1],
  Playlist_Bling_Squads: [142, 100, 4, 4],
  Playlist_Blitz_Duos: [37, 100, 2, 2],
  Playlist_Blitz_Solo: [36, 100, 1, 1],
  Playlist_Blitz_Squad: [19, 100, 4, 4],
  Playlist_Classic_Duos: [215, 100, 2, 2],
  Playlist_Classic_Solo: [214, 100, 1, 1],
  Playlist_Classic_Squads: [216, 100, 4, 4],
  Playlist_Close_50: [4750, 2, 50, 4],
  Playlist_Close_Duos: [45, 100, 2, 2],
  Playlist_Close_Solo: [44, 100, 1, 1],
  Playlist_Close_Squad: [46, 100, 4, 4],
  Playlist_Deimos_50: [450, 2, 32, 4],
  Playlist_Disco_32: [217, 2, 32, 4],
  Playlist_Disco_32_Alt: [232, 2, 32, 4],
  Playlist_Fill_Duos: [350, 100, 2, 2],
  Playlist_Fill_Solo: [349, 100, 1, 1],
  Playlist_Fill_Squads: [351, 100, 4, 4],
  Playlist_Final_12: [103, 8, 12, 4],
  Playlist_Final_20: [104, 5, 20, 4],
  Playlist_FlyExplosives_Duos: [121, 100, 2, 2],
  Playlist_FlyExplosives_Solo: [120, 100, 1, 1],
  Playlist_FlyExplosives_Squads: [122, 100, 4, 4],
  Playlist_Green_Squad: [312, 100, 4, 4],
  Playlist_Ground_Squads: [112, 100, 4, 4],
  Playlist_Hard_Squads: [242, 100, 4, 4],
  Playlist_HighExplosives_Solo: [23, 100, 1, 1],
  Playlist_HighExplosives_Squads: [24, 100, 4, 4],
  Playlist_Hover: [320, 2, 40, 4],
  Playlist_Hover_48: [348, 2, 24, 4],
  Playlist_Hover_64: [326, 2, 32, 4],
  Playlist_Love_Duos: [346, 100, 2, 2],
  Playlist_Love_Solo: [345, 100, 1, 1],
  Playlist_Love_Squads: [347, 100, 4, 4],
  Playlist_Omaha: [285, 2, 20, 4],
  Playlist_Respawn_24: [280, 2, 20, 4],
  Playlist_Score_Duos: [102, 100, 2, 2],
  Playlist_Score_Solo: [101, 100, 1, 1],
  Playlist_Score_Squads: [100, 100, 4, 4],
  Playlist_Slide_Duos: [161, 100, 2, 2],
  Playlist_Slide_Solo: [160, 100, 1, 1],
  Playlist_Sneaky_Solo: [260, 100, 1, 1],
  Playlist_Snipers: [41, 100, 4, 4],
  Playlist_Snipers_Duos: [40, 100, 2, 2],
  Playlist_Snipers_Solo: [39, 100, 1, 1],
  Playlist_Soaring_50s: [53, 2, 50, 4],
  Playlist_Soaring_Duos: [186, 100, 2, 2],
  Playlist_Soaring_Solo: [185, 100, 1, 1],
  Playlist_Soaring_Squads: [187, 100, 4, 4],
  Playlist_SolidGold_Duos: [34, 100, 2, 2],
  Playlist_SolidGold_Solo: [26, 100, 1, 1],
  Playlist_Steady_Duos: [161, 100, 2, 2],
  Playlist_Steady_Solo: [160, 100, 1, 1],
  Playlist_Steady_Squads: [162, 100, 4, 4],
  Playlist_Toss_Duos: [341, 100, 2, 2],
  Playlist_Toss_Solo: [340, 100, 1, 1],
  Playlist_Toss_Squads: [342, 100, 4, 4],
  Playlist_Vamp_Duo: [266, 100, 2, 2],
  Playlist_Vamp_Solo: [265, 100, 1, 1],
  Playlist_Vamp_Squad: [267, 100, 4, 4],
  Playlist_WW_Duos: [901, 100, 2, 2],
  Playlist_WW_Solo: [900, 100, 1, 1],
  Playlist_WW_Squads: [902, 100, 4, 4]
};
const held910 = {
  Playlist_33: [151, 3, 33, 4],
  Playlist_50v50HE: [203, 2, 50, 4],
  Playlist_50v50SAU: [1993, 2, 50, 4],
  Playlist_5x20: [22, 5, 20, 4],
  Playlist_Ashton_Lg: [258, 2, 32, 4],
  Playlist_Ashton_Md: [257, 2, 24, 4],
  Playlist_Ashton_Sm: [256, 2, 20, 4],
  Playlist_Barrier: [204, 2, 24, 4],
  Playlist_Barrier_12: [206, 2, 12, 4],
  Playlist_Barrier_16: [207, 2, 16, 4],
  Playlist_Barrier_16_B_Lava: [226, 2, 16, 4],
  Playlist_Bling_Duos: [141, 100, 2, 2],
  Playlist_Bling_Solo: [140, 100, 1, 1],
  Playlist_Bling_Squads: [142, 100, 4, 4],
  Playlist_Blitz_Duos: [37, 100, 2, 2],
  Playlist_Blitz_Solo: [36, 100, 1, 1],
  Playlist_Blitz_Squad: [19, 100, 4, 4],
  Playlist_Classic_Duos: [215, 100, 2, 2],
  Playlist_Classic_Solo: [214, 100, 1, 1],
  Playlist_Classic_Squads: [216, 100, 4, 4],
  Playlist_Close_50: [4750, 2, 50, 4],
  Playlist_Close_Duos: [45, 100, 2, 2],
  Playlist_Close_Solo: [44, 100, 1, 1],
  Playlist_Deimos_50: [450, 2, 32, 4],
  Playlist_Disco_32: [217, 2, 32, 4],
  Playlist_Disco_32_Alt: [232, 2, 32, 4],
  Playlist_Fill_Duos: [350, 100, 2, 2],
  Playlist_Fill_Solo: [349, 100, 1, 1],
  Playlist_Fill_Squads: [351, 100, 4, 4],
  Playlist_Final_12: [103, 8, 12, 4],
  Playlist_Final_20: [104, 5, 20, 4],
  Playlist_FlyExplosives_Duos: [121, 100, 2, 2],
  Playlist_FlyExplosives_Solo: [120, 100, 1, 1],
  Playlist_FlyExplosives_Squads: [122, 100, 4, 4],
  Playlist_Green_Squad: [312, 100, 4, 4],
  Playlist_Ground_Squads: [112, 100, 4, 4],
  Playlist_Hard_Squads: [242, 100, 4, 4],
  Playlist_HighExplosives_Solo: [23, 100, 1, 1],
  Playlist_HighExplosives_Squads: [24, 100, 4, 4],
  Playlist_Hover: [320, 2, 40, 4],
  Playlist_Hover_48: [348, 2, 24, 4],
  Playlist_Hover_64: [326, 2, 32, 4],
  Playlist_Love_Duos: [346, 100, 2, 2],
  Playlist_Love_Solo: [345, 100, 1, 1],
  Playlist_Love_Squads: [347, 100, 4, 4],
  Playlist_Omaha: [285, 2, 20, 4],
  Playlist_Score_Duos: [102, 100, 2, 2],
  Playlist_Score_Solo: [101, 100, 1, 1],
  Playlist_Score_Squads: [100, 100, 4, 4],
  Playlist_Slide_Duos: [161, 100, 2, 2],
  Playlist_Slide_Solo: [160, 100, 1, 1],
  Playlist_Sneaky_Solo: [260, 100, 1, 1],
  Playlist_Snipers: [41, 100, 4, 4],
  Playlist_Snipers_Solo: [39, 100, 1, 1],
  Playlist_Soaring_50s: [53, 2, 50, 4],
  Playlist_Soaring_Duos: [186, 100, 2, 2],
  Playlist_Soaring_Solo: [185, 100, 1, 1],
  Playlist_Soaring_Squads: [187, 100, 4, 4],
  Playlist_SolidGold_Duos: [34, 100, 2, 2],
  Playlist_SolidGold_Solo: [26, 100, 1, 1],
  Playlist_Steady_Duos: [161, 100, 2, 2],
  Playlist_Steady_Solo: [160, 100, 1, 1],
  Playlist_Steady_Squads: [162, 100, 4, 4],
  Playlist_Toss_Duos: [341, 100, 2, 2],
  Playlist_Toss_Solo: [340, 100, 1, 1],
  Playlist_Toss_Squads: [342, 100, 4, 4],
  Playlist_Vamp_Duo: [266, 100, 2, 2],
  Playlist_Vamp_Solo: [265, 100, 1, 1],
  Playlist_Vamp_Squad: [267, 100, 4, 4],
  Playlist_WW_Duos: [901, 100, 2, 2],
  Playlist_WW_Solo: [900, 100, 1, 1],
  Playlist_WW_Squads: [902, 100, 4, 4]
};

// 9.30 (CL-7095426): 9.21's less Solid Gold's Duos and Solo (Playlist_SolidGold_Duos and _Solo: 9.30's assets of those names
// are The Blues, MissionGen_Blue and "All weapon drops are Rare", so no earlier Solid Gold holds there). Its other held
// assets are 9.21's (the held910 sizes against 9.30's playlist dump; 237 assets, all its paks but the keyed pakchunk1011).
const held930 = Object.fromEntries(Object.entries(held910).filter(([playlistName]) => !playlistName.startsWith("Playlist_SolidGold_")));
export const buildPlaylists = {
  6337466: held900,
  6428087: held900,
  6573057: held910,
  6639283: held910,
  6822798: held910,
  6922310: held910,
  7095426: held930
};

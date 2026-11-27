// Cert (CL-3532353, "1.1") is the build Core-Backend's game data comes from and the default for every other build
// (src/gamedata/read.js); 1.2 (CL-3541083) has its own differences in gamedata/3541083.
export const certBuild = "3532353";

// The Fortnite version players call each build Core knows (as Core-Launcher's KnownBuilds), for what the client shows.
export const buildVersions = { 3532353: "1.1", 3541083: "1.2", 3700114: "1.7.2", 3724489: "1.8", 3729133: "1.8.1", 3741772: "1.8.2", 3757339: "1.9", 3775276: "1.9.1", 3790078: "1.10", 3807424: "1.11", 3825894: "2.1", 3841827: "2.2", 3847564: "2.3", 3858292: "2.4", 3870737: "2.4.2", 3889387: "2.5", 3901517: "3.0", 3915963: "3.1", 3917250: "3.1.1", 3935073: "3.2", 3942182: "3.3", 4000805: "3.5.1", 4008490: "3.5.2", 4019403: "3.6", 4039451: "4.0", 4053532: "4.1", 4072250: "4.2", 4117433: "4.4.0", 4127312: "4.4.1", 4132537: "4.4.2", 4159770: "4.5.0", 4166199: "4.5", 4204761: "5.0.0", 4214610: "5.0", 4225813: "5.10.0", 4240749: "5.10", 4288479: "5.21", 4305896: "5.30", 4352937: "5.40", 4363240: "5.41", 4395664: "6.00.0", 4402180: "6.00", 4417689: "6.01.0", 4424678: "6.01", 4442095: "6.02.0", 4461277: "6.02", 4464155: "6.10.0", 4476098: "6.10.1", 4480234: "6.10", 4497486: "6.20", 4526925: "6.21", 4543176: "6.22", 4573096: "6.30", 4573279: "6.31", 4629139: "7.00", 4667333: "7.10", 4727874: "7.20", 4834550: "7.30", 5046157: "7.40", 5203069: "8.00", 5625478: "8.20", 5793395: "8.30", 6005771: "8.40", 6058028: "8.50", 6165369: "8.51", 6337466: "9.00", 6428087: "9.01", 6573057: "9.10", 6639283: "9.10", 6822798: "9.20", 6922310: "9.21", 7095426: "9.30" };

export const versionOf = (changelist) => buildVersions[changelist] ?? null;

// The day Epic released a build (UTC, ms): the Update's day the version's comments below give, for the builds Core has
// recorded it for (Season 6's), null for the rest. A dated offer (store/currency.js) is on sale at once on a build released
// on or after its start day, whatever day its season's replay stands at, as such a build was never played before it.
export const buildReleases = {
  4395664: Date.UTC(2018, 8, 27), 4402180: Date.UTC(2018, 8, 27), 4417689: Date.UTC(2018, 9, 3), 4424678: Date.UTC(2018, 9, 3),
  4442095: Date.UTC(2018, 9, 10), 4461277: Date.UTC(2018, 9, 10), 4464155: Date.UTC(2018, 9, 16), 4476098: Date.UTC(2018, 9, 16),
  4480234: Date.UTC(2018, 9, 16), 4497486: Date.UTC(2018, 9, 24), 4526925: Date.UTC(2018, 10, 1), 4543176: Date.UTC(2018, 10, 6),
  4573096: Date.UTC(2018, 10, 14), 4573279: Date.UTC(2018, 10, 27), 4629139: Date.UTC(2018, 11, 6), 4667333: Date.UTC(2018, 11, 18),
  4727874: Date.UTC(2019, 0, 15), 4834550: Date.UTC(2019, 0, 29), 5046157: Date.UTC(2019, 1, 14), 5203069: Date.UTC(2019, 1, 28),
  5625478: Date.UTC(2019, 2, 27), 5793395: Date.UTC(2019, 3, 10), 6005771: Date.UTC(2019, 3, 17), 6058028: Date.UTC(2019, 3, 25),
  6165369: Date.UTC(2019, 4, 1), 6337466: Date.UTC(2019, 4, 9), 6428087: Date.UTC(2019, 4, 15),
  6573057: Date.UTC(2019, 4, 22), 6639283: Date.UTC(2019, 4, 29), 6822798: Date.UTC(2019, 5, 6), 6922310: Date.UTC(2019, 5, 12), 7095426: Date.UTC(2019, 5, 18)
};
export const releasedOn = (changelist) => buildReleases[changelist] ?? null;

// The builds with Battle Royale's athena profile and locker: 1.8 (CL-3724489) and later, oldest first.
export const battleRoyaleBuilds = Object.keys(buildVersions).filter((changelist) => Number(changelist) >= 3724489)
  .sort((a, b) => Number(a) - Number(b));

// Battle Royale's seasons by the versions Epic shipped in them (Core-Backend #156): Season 1 was 1.8 to 1.10 here (its
// athena profile's first build to its last), Season 2 1.11 (14 December 2017) to 2.5 (13 February 2018; 3.0 began Season
// 3 on 22 February). This names a season's whole range, not the builds Core plays: of Season 2, Core knows 1.11, 2.1, 2.2,
// 2.3, 2.4, 2.4.2 and 2.5 (buildVersions), Season 2's last. 2.5's data has an AthenaSeason3 ahead of its season, a copy
// of AthenaSeason2's tables, which the extractor passes over (tools/extractor), so its season is AthenaSeason2's.
// Season 3 was 3.0 (22 February 2018) to 3.6 (Season 4 began with 4.0 on 1 May): of it, Core knows 3.0, whose
// AthenaSeason3 has its own curves (Athena_Season3_XP and _BP), so it is the season's, and 3.1 (28 February 2018), whose
// AthenaSeason3 is 3.0's (the same levels and Battle Pass; its weekly challenges gain a tenth week), to 3.5.1 (CL-4000805,
// ++Fortnite+Release-3.5, 11 April 2018), whose AthenaSeason3 is still 3.0's, and 3.5.2 (CL-4008490, the content update of
// 19 April 2018), whose paks give the extractor 3.5.1's data byte for byte, so it plays on gamedata/4000805, and 3.6 (CL-4019403,
// ++Fortnite+Release-3.6, 24 April 2018, the season's last update), whose AthenaSeason3 is still 3.0's and whose own data
// is gamedata/4019403. Core knows no 3.4 (no 3.4 build is at hand):
// a 3.4 client would play on 3.3's data, the closest earlier build that has its own (src/gamedata/read.js).
// Season 4 began with 4.0 (CL-4039451, ++Fortnite+Release-4.0, 1 May 2018): its AthenaSeason4 has its own curves and
// Battle Pass (100 tiers, the BRSeason4 storefront), and its data is gamedata/4039451. 4.1 (CL-4053532,
// ++Fortnite+Release-4.1, 8 May 2018) keeps 4.0's AthenaSeason4, and its data is gamedata/4053532. 4.2 (CL-4072250,
// ++Fortnite+Release-4.2, 16 May 2018) keeps it too, and its data is gamedata/4072250. Core knows no 4.3 (no 4.3 build is
// at hand, as 3.4). 4.4.0 (CL-4117433, ++Fortnite+Release-4.4, Update v4.40, 12 June 2018), 4.4.1 (CL-4127312,
// ++Fortnite+Release-4.4, Update v4.4.1, 14 June 2018) and 4.4.2 (CL-4132537, ++Fortnite+Release-4.4.x, Content Update
// v4.40, 19 June 2018) keep it too; 4.4.2's data is gamedata/4132537, and 4.4.0 and 4.4.1, whose paks Core has no copy of,
// play on it (src/gamedata/read.js laterData). 4.5 (++Fortnite+Release-4.5, Update v4.50, 27 June 2018) is two builds,
// CL-4159770 (its paks say 4.5.0, so it is "4.5.0" here) and CL-4166199 ("4.5"); both keep AthenaSeason4. 4.5's data is
// gamedata/4166199 (a Battle Royale only archive), and CL-4159770, whose paks Core has no copy of, plays on it.
// Season 5 began with 5.0 (++Fortnite+Release-5.0, UE 4.21, Update v5.00, 12 July 2018), two builds both called v5.00:
// CL-4204761, the launch build, whose paks Core has no copy of ("5.0.0" here, as 4.5's earlier build is "4.5.0"), and
// CL-4214610 ("5.0", the exe's own build string, ++Fortnite+Release-5.0-CL-4214610; its paks are dated 17 July, Content
// Update v5.00's day, and Core-ServerAssets calls its pak 5.0.1). Its AthenaSeason5 has its own curves and Battle Pass
// (100 tiers, the BRSeason5 storefront); its data is gamedata/4214610 (a Battle Royale only archive), and CL-4204761
// plays on it (src/gamedata/read.js laterData). 5.10 (++Fortnite+Release-5.10, UE 4.21, Update v5.10, 24 July 2018, the
// Birthday update) is two builds, both v5.10: CL-4225813, the update's own, whose paks Core has no copy of ("5.10.0" here,
// as 5.0's earlier build is "5.0.0"), and CL-4240749 ("5.10", the exe's own build string, ++Fortnite+Release-5.10-CL-4240749;
// two of its paks are dated 31 July, Content Update v5.10's day). Both keep AthenaSeason5; 5.10's data is gamedata/4240749
// (a Battle Royale only archive), and CL-4225813 plays on it. 5.21 (CL-4288479, ++Fortnite+Release-5.21, UE 4.21, Update
// v5.21, 15 August 2018) is the one build Core knows of 5.20 and 5.21: Core has no 5.20 (Update v5.20, 7 August 2018), so
// 5.21 carries 5.20's changes too. It keeps AthenaSeason5; its data is gamedata/4288479 (a full install, Save the World's
// tile maps with it). 5.30 (CL-4305896, ++Fortnite+Release-5.30, UE 4.21, Update v5.30, 23 August 2018; its paks are dated
// 23 August) is Update v5.30's build. Content Update v5.30's (28 August) Shockwave Grenade, Solid Gold, Weekly Horde
// Challenge 4, Bladestorm Enforcer and Redline Ramirez are in its paks already, so it stands for both. It keeps
// AthenaSeason5; its data is gamedata/4305896 (a full install, Save the World with it). 5.40 (CL-4352937,
// ++Fortnite+Release-5.40, UE 4.21, Update v5.40, 6 September 2018; its paks are dated 22 September) is Update v5.40's
// build: Content Update v5.40's (11 September) Wraith, Field Agent Rio and Weekly Horde Challenge 6 and Update v5.41's (18
// September) Port-a-Fortress, Spiky Stadium (Spike Arena) and Weekly Horde Challenge 7 are in its paks already. It keeps
// AthenaSeason5; its data is gamedata/4352937 (Save the World with it, but most mission infos cooked server-only, as
// 3.6's). 5.41 (CL-4363240, ++Fortnite+Release-5.41, UE 4.21, Update v5.41, 18 September 2018, the season's last update:
// Update v6.00 began Season 6 on 27 September) is Update v5.41's build. It keeps AthenaSeason5; its data is
// gamedata/4363240 (a full install, Save the World with every mission info: 5.40's server-only ones are back in its paks).
// Season 6 began with 6.00 (++Fortnite+Release-6.00, UE 4.21, Update v6.00, 27 September 2018, "Darkness Rises"), two
// builds both called v6.00: CL-4395664, the earlier, whose paks Core has no copy of ("6.00.0" here, as 5.10's earlier build
// is "5.10.0"), and CL-4402180 ("6.00", the owner's build). Its AthenaSeason6 has its own Battle Pass (100 tiers, the
// BRSeason6 storefront; Season 5's level and tier curves, unchanged); its data is gamedata/4402180 (a full install, Save
// the World with it), and CL-4395664 plays on it (src/gamedata/read.js laterData). 6.01 (++Fortnite+Release-6.01, UE 4.21,
// Update v6.01, 3 October 2018: the Chiller and Playground's custom options) is two builds too, both called v6.01:
// CL-4417689, the earlier, whose paks Core has no copy of ("6.01.0" here), and CL-4424678 ("6.01", the owner's build; its
// paks are dated 3 October). Both keep AthenaSeason6; 6.01's data is gamedata/4424678 (a full install, Save the World with
// it), and CL-4417689 plays on it. 6.02 (++Fortnite+Release-6.02, UE 4.21, Update v6.02, 10 October 2018: Disco Domination,
// the Quad Launcher, the Skull Trooper's return) is two builds as well, both called v6.02: CL-4442095, the earlier, whose
// paks Core has no copy of ("6.02.0" here), and CL-4461277 ("6.02", the owner's build; its exe was built on 12 October and
// its paks are dated 13 October). Both keep AthenaSeason6; 6.02's data is gamedata/4461277 (a full install, Save the World
// with it), and CL-4442095 plays on it. 6.10 (++Fortnite+Release-6.10, UE 4.21, Update v6.10, 16 October 2018: the Quadcrasher
// and the in-game tournaments' Events tab) is three builds, all called v6.10: CL-4464155 ("6.10.0" here) and CL-4476098
// ("6.10.1"), whose paks Core has no copy of, and CL-4480234 ("6.10", the owner's build; its paks are dated 20 October).
// All keep AthenaSeason6; 6.10's data is gamedata/4480234 (a full install, Save the World with it), and the two earlier
// builds play on it. 6.20 (++Fortnite+Release-6.20, UE 4.21, Update v6.20, 24 October 2018: Fortnitemares, the Six
// Shooter, the Cube Monsters) is one build, CL-4497486 (its paks are dated 24 October), whose data is gamedata/4497486 (a
// full install, Save the World with it). It keeps AthenaSeason6. 6.21 (++Fortnite+Release-6.21, UE 4.21, Update v6.21, 1
// November 2018: the Balloons, Fortnitemares' last days and the Butterfly) is one build, CL-4526925 (its paks are dated 1
// November), whose data is gamedata/4526925. Its install has pakchunk0 and its s1 to s5 only (no pakchunk1, pakchunk1_s1 or
// language paks): Save the World's account data (heroes, schematics, quests, the world's zone themes and generators) is in
// them, its mission maps and tiles (Maps/Tiles, Maps/5x5, Missions/Primary's levels) are not. It keeps AthenaSeason6.
// 6.22 (++Fortnite+Release-6.22, UE 4.21, Update v6.22, 6 November 2018: the Heavy Assault Rifle, Team Terror, the NFL
// outfits and Fortnitemares Part 2 in Save the World) is one build, CL-4543176 (its paks are dated 6 November), whose data
// is gamedata/4543176 (a full install again: pakchunk1 and pakchunk1_s1, Save the World's mission maps and tiles, and the
// language paks are back). It keeps AthenaSeason6.
// 6.30 (++Fortnite+Release-6.30, UE 4.21, Update v6.30, 14 November 2018: Food Fight, the Mounted Turret and Save the
// World's new front end; Content Update v6.30, 20 November: Wild West and the Dynamite) is CL-4573096, whose files are
// dated 19 November, the Content Update's eve, with Wild West's playlists and the Dynamite in its paks: the one build
// both of 6.30's dates are served by here. Its data is gamedata/4573096. Its install has pakchunk0 and its s1 to s6 and
// two keyed paks, pakchunk1000 and 1001 (the backend's keychain has their keys): no pakchunk1 (Save the World's mission
// maps and tiles) and no language paks. It keeps AthenaSeason6.
// 6.31 (++Fortnite+Release-6.31, UE 4.21, Update v6.31, 27 November 2018: Team Rumble, the Epic and Legendary Pump
// Shotgun, Canny Valley Act 2) is CL-4573279, whose data is gamedata/4573279 (6.30's but for its own Battle Royale and Save
// the World additions). A full install again: pakchunk0 and its s1 to s6, pakchunk1 and pakchunk1_s1, the language paks 2,
// 5, 7, 8 and 9, and the keyed pakchunk1000 (the backend's keychain has its key); no pakchunk1001. It keeps AthenaSeason6.
// Season 7 began with 7.00 (++Fortnite+Release-7.00, CL-4629139, Update v7.00, 6 December 2018, "You Better Watch Out": the
// iceberg, the X-4 Stormwing, Wraps and Creative's early access), the first UE 4.22 build Core knows (its FEngineVersion
// is 4.22, and its curve tables are 4.22's: tools/extractor). Its AthenaSeason7 has its own Battle Pass (100 tiers, the
// BRSeason7 storefront; Season 6's tier curve and its own level curve); its data is gamedata/4629139 (a full install, Save
// the World with it: pakchunk0 and its s1 to s6, pakchunk1 and pakchunk1_s1, the language paks 2, 5, 7, 8 and 9, and the
// keyed pakchunk1000 and 1001, both on keys the backend's keychain has).
// 7.10 (++Fortnite+Release-7.10, CL-4667333, UE 4.22, Update v7.10, 18 December 2018: the 14 Days of Fortnite, Frostnite,
// Down Tier Crafting, Creative's winter islands; Update v7.01's Infinity Blade and island codes with it, 7.01 being a
// build Core has no copy of) keeps AthenaSeason7; its data is gamedata/4667333. Its install has pakchunk0 and its s1 to s7,
// pakchunk1 and pakchunk1_s1 and the keyed pakchunk1000 to 1015, all but pakchunk1000 on keys the backend's keychain has;
// no language paks.
// 7.20 (++Fortnite+Release-7.20, CL-4727874, UE 4.22, Update v7.20, 15 January 2019: the Scoped Revolver, Glider
// Redeploy as an item, One Shot, the Ice Storm and its challenges, Creative's Frosty Fortress, Save the World's Item Reset)
// keeps AthenaSeason7; its data is gamedata/4727874. Its install has pakchunk0 and its s1 to s7 and the keyed pakchunk1000
// to 1005, all but pakchunk1001 and 1003 on keys the backend's keychain has; no pakchunk1 and no language paks.
// 7.30 (++Fortnite+Release-7.30, CL-4834550, UE 4.22, Update v7.30, 29 January 2019: the Chiller Grenade, the Prisoner,
// Marshmello's Showtime at Pleasant Park, the Architect Pop-Up Cup) keeps AthenaSeason7; its data is gamedata/4834550. A
// full install again: pakchunk0 and its s1 to s7, pakchunk1 and pakchunk1_s1, the language paks 2, 5, 7, 8 and 9, and the
// keyed pakchunk1000 to 1008, all but pakchunk1000, 1003 and 1006 on keys the backend's keychain has.
// 7.40 (++Fortnite+Release-7.40, CL-5046157, UE 4.22, Update v7.40, 14 February 2019: Share the Love's Overtime Challenges,
// the Infantry Rifle, the earthquakes before Season 8, the Block's Oily Oaks; Content Update v7.40's Driftboard, Driftin' and
// Catch!), the last build of Season 7, keeps AthenaSeason7; its data is gamedata/5046157. A full install: pakchunk0 and its
// s1 to s7, pakchunk1 and pakchunk1_s1, the language paks 2, 5, 7, 8 and 9, and the keyed pakchunk1000 to 1004, all but
// pakchunk1000, 1001 and 1002 on keys the backend's keychain has.
// Season 8 began with 8.00 (++Fortnite+Release-8.00, CL-5203069, UE 4.22, Update v8.00, 28 February 2019: "X Marks the Spot",
// the volcano and its vents, Lazy Lagoon and Sunny Steps, the Season 8 Battle Pass and its Discovery challenges). Its
// AthenaSeason8 has its own Battle Pass (100 tiers, the BRSeason8 storefront; Season 7's tier curve and its own level
// curve); its data is gamedata/5203069. Its install has pakchunk0 and its s1 to s8, pakchunk1 and pakchunk1_s1, the
// language paks 2, 5, 7, 8 and 9, and the keyed pakchunk1000 to 1002, their keys in the backend's keychain but for 1000
// and 1002.
// 8.20 (++Fortnite+Release-8.20, CL-5625478, UE 4.22, Update v8.20, 27 March 2019: Floor is Lava, the Poison Dart Trap,
// the foraged Bananas, Coconuts and Peppers, Arena; its paks also carry 8.01's Buried Treasure, 8.10's Baller and the
// Getaway, 8.11's Flint-Knock Pistol and Content Update v8.20's Boom Bow) keeps AthenaSeason8; its data is
// gamedata/5625478. Its install has pakchunk0 and its s1 to s8, pakchunk1 and pakchunk1_s1, the language paks and the
// keyed pakchunk1000 to 1002, the keychain having pakchunk1000's key only.
// 8.30 (++Fortnite+Release-8.30, CL-5793395, UE 4.23 as FModel reads its paks, Update v8.30, 10 April 2019 by the Fortnite
// Wiki (8.40 is 17 April): Reboot Vans, Buccaneer's Bounty and its challenges, the Block's Llama Sphinx) keeps
// AthenaSeason8; its data is gamedata/5793395. Its install has pakchunk10 and its s1 to s8, pakchunk11 and pakchunk11_s1
// (8.30 renumbers chunks 0 and 1), the language paks and the keyed pakchunk1000 to 1004, the keychain having all but 1001.
// 8.40 (++Fortnite+Release-8.40, CL-6005771, UE 4.23, Update v8.40, 17 April 2019 by the Fortnite Wiki: Air Royale, Food
// Fight: Deep Fried, the Epic and Legendary Infantry Rifle, the Egg Launcher) keeps AthenaSeason8; its data is
// gamedata/6005771. Its install is 8.30's layout with the keyed pakchunk1000 to 1009, the keychain having all but 1002.
// 8.50 (++Fortnite+Release-8.50, CL-6058028, UE 4.23, Update v8.50, 25 April 2019 by the Fortnite Wiki: Endgame, the
// Endgame Challenges, Cottontail Eagle Eye) keeps AthenaSeason8; its data is gamedata/6058028. Its install is 8.40's layout
// with the keyed pakchunk1000 to 1011, the keychain having all but 1003.
// 8.51 (++Fortnite+Release-8.51, CL-6165369, UE 4.23, built 30 April 2019; Update v8.51, 1 May 2019 by the Fortnite Wiki's
// Season 8 page and the Duet's Weekly Store day, 🟡 its Update v8.51 page says 2 May: the Shadow Bomb, the Diner prefabs, the
// Unvaulting) keeps AthenaSeason8; its data is gamedata/6165369. Its install is 8.50's layout with the keyed pakchunk1000
// to 1009, the keychain having all but 1002.
// Season 9 began with 9.00 (++Fortnite+Release-9.00, CL-6337466, UE 4.23, Update v9.00, 9 May 2019: Neo Tilted and Mega
// Mall, the Sky Platforms and Slipstreams, Fortbytes, the Season 9 Battle Pass). Its AthenaSeason9 has its own Battle Pass
// (100 tiers, the BRSeason9 storefront); its data is gamedata/6337466. Its install is 8.51's layout with only the keyed
// pakchunk1000 to 1002, the keychain having pakchunk1002's key only.
// 9.01 (++Fortnite+Release-9.01, CL-6428087, UE 4.23, Update v9.01, 15 May 2019: the Tactical Assault Rifle, Wick's Bounty
// and its challenges, John Wick, Save the World's Mist Pods Wargame and Prehistoric Izza) keeps AthenaSeason9; its data is
// gamedata/6428087. Its install is 9.00's layout with only the keyed pakchunk1000 and 1001, the keychain having 1001's key.
// 9.10 (++Fortnite+Release-9.10, UE 4.23) is two builds, both "9.10": CL-6573057, Update v9.10's (22 May 2019: Hot Spots and
// Loot Carriers, the Downtown Drop LTM and its challenges, the Hang Time set, Save the World's Space Rocks and Rex Jonesy),
// whose paks Core has no copy of, and CL-6639283, Content Update v9.10's (29 May 2019: the Burst SMG, Hexed and Fossil
// Southie). Both keep AthenaSeason9; CL-6639283's data is gamedata/6639283, and CL-6573057 plays on it (src/gamedata/read.js
// laterData). CL-6639283's install is 9.01's layout with the keyed pakchunk1000 to 1009, the keychain having all but 1005.
// 9.20 (++Fortnite+Release-9.20, CL-6822798, UE 4.23, Update v9.20, 6 June 2019 by the Fortnite Wiki: the Storm Flip, Sword
// Fight, Save the World's Invasion Wargame, Beyond the Stellar Horizon and the Sci-Fi Llama) keeps AthenaSeason9; its data
// is gamedata/6822798. Its install is 9.10's layout with the keyed pakchunk1000 to 1016, the keychain having all but 1008
// and 1012.
// 9.21 (++Fortnite+Release-9.21, CL-6922310, UE 4.23, Update v9.21, 12 June 2019 by the Fortnite Wiki: the Proximity Grenade
// Launcher, Horde Rush and its challenges, Save the World's Quantum Countdown Wargame and the Plasmatron 9000) keeps
// AthenaSeason9; its data is gamedata/6922310. Its install is 9.20's layout with the keyed pakchunk1000 to 1013, the
// keychain having all but 1007 and 1010.
// 9.30 (++Fortnite+Release-9.30, CL-7095426, UE 4.23, Update v9.30, 18 June 2019 by the Fortnite Wiki: the Chug Splash,
// Creative's Prop-O-Matic, Save the World's Storm Shield Endurance; its paks also hold its content updates' 14 Days of
// Summer and their modes, Shortcut and Meltdown) keeps AthenaSeason9; its data is gamedata/7095426. Its install is 9.21's
// layout with the keyed pakchunk1000 to 1027, the keychain having all but 1011.
export const battleRoyaleSeasons = [
  { season: 1, firstVersion: "1.8", lastVersion: "1.10" },
  { season: 2, firstVersion: "1.11", lastVersion: "2.5" },
  { season: 3, firstVersion: "3.0", lastVersion: "3.6" },
  { season: 4, firstVersion: "4.0", lastVersion: "4.5" },
  { season: 5, firstVersion: "5.0", lastVersion: "5.41" },
  { season: 6, firstVersion: "6.00", lastVersion: "6.31" },
  { season: 7, firstVersion: "7.00", lastVersion: "7.40" },
  { season: 8, firstVersion: "8.00", lastVersion: "8.51" },
  { season: 9, firstVersion: "9.00", lastVersion: "9.30" }
];
// "Season 2 (1.11 – 2.5)", "1.11 – 2.5"; a season of one version Core knows, "Season 4 (4.0)".
export const seasonVersions = (season) => {
  const known = battleRoyaleSeasons.find((entry) => entry.season === Number(season));
  if (!known) return "";
  return known.firstVersion === known.lastVersion ? known.firstVersion : `${known.firstVersion} – ${known.lastVersion}`;
};
export const seasonName = (season) => `Season ${season} (${seasonVersions(season)})`;

// The changelist a request's User-Agent names: "build=++Fortnite+Release-Cert-CL-3541083" (services, the gameserver
// too) or "version=4.16.0-3541083+++Fortnite+Release-Cert" (CMS, datarouter). 3.2 (UE 4.20's default HTTP User-Agent,
// "%s/%s %s/%s": project, build version, platform, OS) names it by the engine version alone, "Fortnite/4.20.0-3935073
// +++Fortnite+Release-3.2 Windows/10.0.17134.1.256.64bit", with neither "CL-" nor "version=" (Core-Backend #231: the
// news and login message read "Core", the build unknown).
export function getBuild(req) {
  const agent = req.get("user-agent") ?? "";
  const match = /CL-(\d+)/.exec(agent) ?? /version=\d+\.\d+\.\d+-(\d+)/.exec(agent) ?? /\/\d+\.\d+\.\d+-(\d+)\+\+\+/.exec(agent);
  return match ? match[1] : "unknown";
}

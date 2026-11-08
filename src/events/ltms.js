import { currentBuild } from "../builds/context.js";
import { buildVersions, versionOf } from "../builds/detect.js";
import { nextReplayOf, seasonMoment } from "../store/itemshop.js";

// Battle Royale's limited-time modes of Seasons 1 and 2 (Core-Backend #190), and when they run.
//
// From 1.11 (CL-3807424) to 2.5 (CL-3889387) the lobby has eight event queues, EFortAthenaPlaylist::AthenaEvent1 to 8
// (enum 4 to 11), each turned on by the event flag "Event1" to "Event8" (2.4.2 0x20B3770 names them). The queue's
// number is not its mission generator's (Core-Backend #195):
// - Its tile is the matchmaking widget's Event<N>MissionGen (AthenaMatchmakingPlay's defaults, the same in 2.1, 2.3,
//   2.4.2 and 2.5; Athena_Matchmaking_GameModeButton's SetMissionGenData picks it by the queue, ConfigButtonWithMissionGen
//   shows its MissionDescription; 1.11's paks aren't at hand, so its tiles are taken to be 2.1's): Event1
//   MissionGen_AthenaEvent4_ShootingTest ("Shooting Test #1"), Event2
//   _AthenaEvent2_Explosives ("High Explosives"), Event3 _AthenaEvent3_SpeedyCircles, Event4 _AthenaEvent6_Loot
//   ("Luxurious Loot"), Event5 _AthenaEvent1_SneakySilencers, Event6 _AthenaEvent5_Skies, Event7 _AthenaEvent7_Snipers
//   ("Sniper Shootout": "Ready, aim, fire! Sniper Rifles only.") and Event8 _AthenaEvent8 ("Blitz"). 2.1's are on
//   World/MissionGens/TestMissionGens, 2.3's on World/MissionGens/Athena.
// - Its ticket's playlist is the matchmaking button's switch (2.3 0x20E8C60, 2.4.2 0x20FBC90, 2.5 0xD48260; 1.11 the
//   same immediates in the same order, 0x21645FE): AthenaEvent1 15, 2 13, 3 14, 4 17, 5 12, 6 16, 7 18, 8 19. So each
//   tile queues its own playlist (Shooting Test #1 15, Sneaky Silencers 12, Lotsa Loot 17), and the playlist picks its
//   own PlaylistDataTables entry; only the flag that shows the tile isn't the asset's number.
// - Its quest is AthenaEvent<N>_PlayMatches, the queue's number (counted by complete_athena_event_<N>, context
//   Athena.Playlist.Event.<N>): Shooting Test #1's is athenaevent1, Sneaky Silencers' athenaevent5.
// None is a playlist asset; Epic ran them from its servers, as it ran Shooting Test #1 (events/shootingtest.js):
// - The queue: UFortGameInstance's bBattleRoyaleEvent<N>QueueEnabled is true in 2.1's to 2.5's DefaultGame.ini (and
//   UFortGlobals' bEvent<N>ForceEnabled false), so the tile shows while the player's region's FFortMatchmakingRegionState
//   (the calendar's client-matchmaking channel, services/fortnite/calendar.js) lists "Event<N>" in EventFlagsForcedOn.
//   1.11's SDK has the same queue flags and region state.
// - The match: Athena_GameMode's PlaylistDataTables (FAthenaPlaylistDataTableSet, the same in 2.1, 2.3 and 2.4) give
//   playlist 12 "Sneaky Silencers" Athena/Events/SneakySilencers' loot tables, 13 "Rockets and Grenades" Athena/Events/
//   RocketsAndGrenades', and 18 "Snipers" Athena/Events/SnipersOnly' (AthenaLootTierData_Client, AthenaLootPackages_
//   Client). The server picks them natively: when its match assignment arrives (2.4 0x4210A0) it copies the playlist to the
//   game state and calls AFortGameModeAthena's table loader (2.4 0x409790, vtable +0xC08), which takes the
//   PlaylistDataTables entry whose PlaylistId is CurrentPlaylistId, else the default tables. So nothing is hotfixed.
// - The teams: GetMaxTeamInfoForPlaylist (2.4.2 0x7F3790) gives 12 to 19 100 teams of 4, so they are squads
//   (matchmaking/service.js).
//
// What each played, and when (the Fortnite Wiki, from Epic's notes):
// - 50v50 (events/fiftyfifty.js, playlist 11), 1.10's: "introduced on 8th December, 2017" (the Game Awards of 7 December,
//   Pacific time); it ran to 18 December (Core-Backend #190's dates; the wiki gives no end), through 1.10 and 1.11.
// - High Explosives (Event2, 13): 1.11's notes, "This Limited Time event is available on Dec 28 and ends on Jan 2":
//   "Weapons are limited to only … Snowball Launchers, Rocket Launchers and all types of Grenades. Traps are disabled."
//   "There will be no downtime, and no update required."
// - Sneaky Silencers (Event5, 12): 1.11's 1/1 hotfix notes, "available January 5 and ends on January 8".
// - Sniper Shootout (Event7, 18): "introduced on January 29th 2018" ("the only available weapons are Sniper Rifles"), to
//   2 February, through 2.3 (25 January) and 2.4 (31 January).
// - Shooting Test #1 (Event1, 15): 2 to 12 February 2018, 2.4 and 2.4.2 (2.5 shipped on 13 February).
//
// The admin panel's Matchmaking tab turns each on by hand (matchmakingModes, off by default but 50v50), or, with
// "Original dates" on (settings ltmOriginalDates), runs each only in its original window on the season's replay
// (store/itemshop.js seasonMoment: Season 1's on 1.8 to 1.10, Season 2's from 1.11) and only on the builds Epic ran it
// on. Each window is whole UTC days of Epic's calendar, its end the day after its last.
//
// Each event queue has its quest in 1.11's to 2.5's data, Athena/Items/Quests/Events/AthenaEvent<N>_PlayMatches (type
// AthenaEvent, category BREvent): three matches for 1000 season XP, counted by complete_athena_event_<N> (AthenaRank,
// context Athena.Playlist.Event.<N>, N the queue's number: eventQueueOfPlaylist, which profiles/athena.js counts the
// match results by). Epic handed them out while the
// LTM ran, as it did 50v50's (events/fiftyfifty.js; 2.4's notes: "Players will receive quests for “Blitz Mode” LTM"), so
// the quest login gives the player each LTM's quest while the build's lobby offers it, and takes an unfinished one away
// once it doesn't (athenaEventQuestsOf).
//
// The other event queues (Core-Backend #191) work the same way, but Epic never ran them in Seasons 1 and 2, so they
// have no original window (original null): with Original dates on they stay off. 2.1's to 2.5's data (FModel; 1.11's
// build isn't at hand) has each one's tile and PlaylistDataTables entry, which ApplyPlaylistDataTables copies over the
// default loot tiers, loot packages, game data (the storm's phases, AthenaGameData) and resource rates:
// - Speedy Storm (Event3, 14): MissionGen_AthenaEvent3_SpeedyCircles ("Speedy Storms"), Athena/Events/FasterRings'
//   game data only: the storm waits 30 s before each circle (the default's 200, 150, 120, 120, 90 and 90), the loot is
//   the normal one.
// - Take To The Skies (Event6, 16): MissionGen_AthenaEvent5_Skies ("Take to the Skies"), Athena/Events/TakeToTheSkies'
//   loot tiers and packages (Launch Pads among the floor loot).
// - Lotsa Loot (Event4, 17): MissionGen_AthenaEvent6_Loot ("Luxurious Loot" on its tile), Athena/Events/LotsaLoot's
//   loot tiers and game data.
// - Blitz (Event8, 19), from 2.4.2 only (2.4's has no entry 19 and no Athena/Events/Blitz): MissionGen_AthenaEvent8
//   ("Blitz"), Athena/Events/Blitz' loot tiers, packages, game data (a 140000 starting storm radius, not 185000) and
//   resource rates. Epic first ran it on 19 March 2018 (3.3), after 2.5.
// GetMaxTeamInfoForPlaylist gives all four 100 teams of 4 (2.4.2 0x7F3790), so they are squads too.
//
// 3.0 (CL-3901517, Season 3) makes each mode a playlist class (AFortAthenaPlaylistBase, Athena/Events/<mode>/Playlist_*):
// FAthenaPlaylistDataTableSet is now only FortAthenaPlaylistClass, and Athena_GameMode's PlaylistDataTables lists the
// classes whose CDO's PlaylistId the server matches, each with its own LocName, loot tables, game data, resource rates,
// teams (MaxTeamCount, MaxTeamSize, MaxPartySize), AthenaPlaylistTag and PlaylistMissionGen; anything else plays
// DefaultFortAthenaPlaylistClass, Playlist_Default (solo). The lobby's queues are still the event queues, as the 3.0
// client has them:
// - EFortAthenaPlaylist is AthenaEvent1 to 8 (4 to 11), AthenaPlatoon (12), then AthenaEvent21 to 54 (13 to 46). The
//   button's queue → playlist switch (3.0 0xD660F0) and its inverse (0xD662F0) keep the first eight's playlists (Event1
//   15, 2 13, 3 14, 4 17, 5 12, 6 16, 7 18, 8 19) and give AthenaPlatoon 20 and AthenaEvent<N> playlist N from 21 on.
// - AthenaMatchmakingPlay's PlaylistChange shows the tiles of IsFiftyFiftyQueueEnabled, IsEvent1 to 8QueueEnabled,
//   IsPlatoonQueueEnabled and then IsPlaylistQueueEnabled(22) to (54); its Event1 to 8 tiles are 2.5's (Event1 still
//   Shooting Test #1's), Event22 to 54 MissionGen_AthenaEvent22 to 54 (each playlist N's PlaylistMissionGen).
// - UFortGlobalUIContext's queue check (0x27213E0) takes a playlist id: on when -OverridePlaylistId names it or its class
//   is bAlwaysAvailableInFrontEnd; else, unless the player's region is in RegionsWithBattleRoyaleEvent<N>QueueDisabled,
//   (UFortGameInstance's bBattleRoyaleEvent<N>QueueEnabled (0xB360F0) and the region state's EventFlagsForcedOn holding
//   its event flag and EventFlagsForcedOff not) or UFortGlobals' bEvent<N>ForceEnabled (UFortGameInstance::
//   IsEvent_X_ForceEnabled, 0xBBBE60). The event flag is GetStringNameOfEventPlaylist's (0x2719BE0), which names only
//   AthenaEvent1 to 8 ("Event1" to "Event8"): queue 22's and on are an empty name, so no region flag ("Event22", as this
//   file had it, matches nothing) can single one out. Each is turned on by its own bEvent<N>ForceEnabled, which the
//   backend's DefaultGame.ini hotfix sets (services/fortnite/cloudstorage.js, ltmForcedQueues). So on 3.0:
// - Sneaky Silencers (12), High Explosives (13), Speedy Storm (14, "Faster Rings"), Take To The Skies (16, now 100 teams
//   of 2), Lotsa Loot (17), Sniper Shootout (18, "Snipers Only") and Blitz (19) run on, their classes in the list.
// - 50v50 (11) and Shooting Test #1 (15) end with 2.5: no class in 3.0's list has their PlaylistId, so a 3.0 server would
//   play them as Playlist_Default.
// - 3.0's new playlists with a lobby tile (PlaylistMissionGen) run by hand: 5x20 (22, five teams of 20, bIsLargeTeamGame),
//   High Jump (23, solo), Use It & Lose It (25), Steady Storm (26, solo, the storm from the warmup), Solid Gold (27),
//   Sky Supply (30, solo) and Shotguns (31), the event queue N playing playlist N (Playlist_5x20's PlaylistId 22,
//   MissionGen_AthenaEvent22, AthenaPlaylistTag Athena.Playlist.Event.22; their quests count complete_athena_event_<N>,
//   context Athena.Playlist.Event.<N>). Epic first ran them later in Season 3 (🟡: no
//   original dates; Original dates leaves them off). Builder's Paradise (28), Low Grav (29) and Playground (35, "for
//   testing stuffs") have classes but no tile, so they are left out. Solid Gold, Sky Supply and Shotguns have their quests
//   (AthenaEvent27/30/31_PlayMatches), 5x20 AthenaEvent22_PlayMatches.
// The gameserver picks the class itself (CoreV2): the backend only offers the queues and fits the parties to the class's
// teams (matchmaking/service.js playlistTeamsOf).
//
// 3.1 (CL-3915963) keeps 3.0's queues, as its client has them: EFortAthenaPlaylist is 3.0's (SDK), the playlist → queue
// switch (0xD65F50) is 3.0's (15 Event1, 13 2, 14 3, 17 4, 12 5, 16 6, 18 7, 19 8, 20 AthenaPlatoon, N AthenaEvent<N>
// from 21 to 54), GetStringNameOfEventPlaylist (0x2734320) still names only Event1 to 8 and the queue check (0x273BD20)
// is 3.0's. Its Athena_GameMode lists 3.0's classes and two more, Blitz's children (Playlist_Blitz_Child_Solo and
// _Duo: "Blitz (Solo)", "Single Player Blitz Mode", PlaylistId 36, teams of 1; "Blitz (Duo)", 37, teams of 2;
// MissionGen_AthenaEvent36 and 37), which keep Blitz's tables and its AthenaPlaylistTag, Athena.Playlist.Event.8, so
// their matches count Blitz's quest (athenaevent8_playmatches, tagQueue). They run by hand like 3.0's new playlists (🟡:
// Epic ran them later). 3.1's data adds High Jump's quest (AthenaEvent23_PlayMatches, complete_athena_event_23).
//
// 3.2 (CL-3935073, 8 March 2018) adds no playlist: Athena/Events holds 3.1's folders (the notes' new "Teams of 20" is 3.0's
// Playlist_5x20, five teams of 20, which 3.0 and 3.1 already shipped), so every queue runs on. Its data adds Use It & Lose
// It's quest (AthenaEvent25_PlayMatches, complete_athena_event_25). Teams of 20's own notes (60 s first wait, six circles,
// more chests and ammo boxes, five supply drops) are in the playlist's game data.
//
// 3.3 (CL-3942182, 15 March 2018) adds no playlist either: Athena/Events holds 3.2's folders (Blitz, whose notes say "this mode
// will be enabled on 3/19", is 2.4.2's and its children 3.1's), so every queue runs on, Teams of 20 by hand again: its newIn
// is 3.2, the build whose lobby opened on it. Its data changes no event quest.
//
// A build's new mode (Core-Backend #237): Teams of 20 is 3.2's ("New Mode Available!" over TEAMS OF 20 in the lobby).
// The lobby's banner is AthenaMatchmakingPlay's CB_LTM_Bang (a Border-Bang over CommonTextBlock_72, "New Mode
// Available!", collapsed by default), which RefreshBang shows while CheckForLTMBangs finds an LTM queue on: 50v50,
// AthenaEvent1 to 8, Platoon, or IsPlaylistQueueEnabled(22) to (54) (UFortGlobalUIContext, 3.2 0x273BD20's check), so
// it shows whenever any LTM is on. The mode the lobby opens on is native: the matchmaking widget's construct (3.2
// 0x279E970) takes UFortGameUserSettings' LastSelectedPlaylist (+0x218, 0x27966A0; the GameUserSettings.ini config, not
// the player's ClientSettings.Sav), and Solo (Squad where only squads queue, 0x27931E0) if that queue isn't on
// (0x278BF50), then sets it as the party's playlist (0x27A7360 -> 0xD9DBD0). No calendar, content page or playlist flag
// picks it, so the system hotfix sets LastSelectedPlaylist (services/fortnite/cloudstorage.js): each start-up opens the
// lobby on the new mode while it is on, and the player's own choice holds until the game restarts. So a build's new mode
// (newIn) is on there by default, whatever its switch, and its lobby opens on it; its switch still turns it on for the
// builds that shipped it unannounced (3.0 and 3.1's Playlist_5x20). Original dates keeps it on too: Epic ran it from
// the build's release. Only Teams of 20 and 50v50 v2 (3.5.1's and 3.5.2's) have one; 1.10's 50v50 is on by default already (defaultOn).
//
// 3.5.1 (CL-4000805, 11 April 2018; Core has no 3.4) makes each mode a data asset, FortPlaylistAthena (Athena/Playlists:
// PlaylistName, PlaylistId, PlaylistEnumMimic, MaxSquadSize, MaxTeamCount, MaxTeamSize, MaxSocialPartySize, GameplayTags,
// UIDisplayName, its tables), listed by the game instance's UFortPlaylistManager (AthenaPlaylists); Athena/Events and its
// playlist classes are gone, and so are UFortGlobals' bEvent<N>ForceEnabled and UFortGameInstance's
// RegionsWithBattleRoyaleEvent<N>QueueDisabled (3.5's SDK has neither). A mode is turned on by UFortGameInstance's
// PlaylistOverrides (Config, FPlaylistOverrideData {PlaylistName, bEnabled, RegionsDisabled}), which the backend's
// DefaultGame.ini hotfix sets (services/fortnite/cloudstorage.js ltmPlaylistOverrides; 🟡: the client's use of it hasn't
// been traced in 3.5's IDB), and UFortGameUserSettings' LastSelectedPlaylist is the playlist's name (an FName at +0x230).
// Its playlists, by PlaylistId (the matchmaking bucket's, as before; teams in matchmaking/service.js):
// - Solo (2), Duos (10) and Squads (9): Playlist_DefaultSolo/Duo/Squad, bIsDefaultPlaylist.
// - Kept from 3.3: Blitz (19, Playlist_Blitz_Squads, "Blitz! (Squads)", still AthenaEvent8 and Athena.Playlist.Event.8),
//   Blitz Solo and Duos (36, 37: now tagged Athena.Playlist.Event.36 and .37, no longer Blitz's 8, so no quest counts
//   them), Teams of 20 (22), Sky Supply (30, solo) and Solid Gold (27, now "Solid Gold v2 (Squads)").
// - New: 50v50 v2 (50, Playlist_50v50, two teams of 50 in squads of 4: the notes' "50v50 v2 (Battle Royale) Two teams will
//   clash in the updated 50v50 Limited Time Mode", so 3.5.1's new mode; its quest, AthenaEvent_FiftyFifty_PlayMatches,
//   counts Athena.Playlist.FiftyFifty, which it isn't tagged), High Explosives v2 Solo and Squads (23, 24: 3.4's content
//   update's "High Explosives v2"), Sniper Shootout v2 Solo, Duos and Squads (39, 40, 41, AthenaSnipersV2*: 3.4's "Sniper
//   Shootout v2"), Sky Supply Duos and Squads (42, 43), Solid Gold v2 Solo (26, with its own quest,
//   AthenaEvent26_PlayMatches) and Impact Solo, Duos and Squads (44, 45, 46, "Blam!": no notes name it; by hand like the
//   rest). Playground (35, four players, "rewrite") is left out, as 3.0's.
// - Gone (no playlist asset has their id or mode): Sneaky Silencers (12), High Explosives (13), Speedy Storm (14), Take To
//   The Skies (16), Lotsa Loot (17), Sniper Shootout (18), High Jump (23, the id High Explosives v2 Solo now has), Use It &
//   Lose It (25), Steady Storm (26, now Solid Gold v2 Solo's) and Shotguns (31): their entries end with 3.3.
// Two ids changed modes, so a playlist's LTM is the entry for the requesting build (ltmOfPlaylist). A 3.5.1 playlist's
// matches count Athena.Playlist.Event.<its PlaylistId> but Blitz Squads' (Event.8): eventTagOfPlaylist.
const build110 = 3790078;
const build111 = 3807424;
const build21 = 3825894;
const build23 = 3847564;
const build24 = 3858292;
const build242 = 3870737;
const build25 = 3889387;
const build30 = 3901517;
const build31 = 3915963;
const build311 = 3917250;
const build32 = 3935073;
const build33 = 3942182;
const build351 = 4000805;
// 3.5.2 (CL-4008490, 19 April 2018), Content Update v3.50: 3.5.1's paks but for small fixes (the same data and the same
// 22 playlist assets, 50v50 v2's Playlist_50v50 unchanged), so every 3.5.1 playlist runs on. Its notes' one mode is 50v50
// v2 ("50v50 is BACK and bigger than before. Two teams, two buses, one Victory Royale. PLAY NOW!", "The battle begins on
// Thursday, April 19"), so it is 3.5.2's new mode as well as 3.5.1's.
const build352 = 4008490;
// 3.6 (CL-4019403, 24 April 2018), the season's last update: its Athena/Playlists holds 3.5.2's 22 playlist assets and one
// more, Playlist_Fortnite (PlaylistId 32, AthenaEvent32, "Fortnite": solo, a timed HighestScore win), which no notes or
// lobby ever offered, so it is left out as Playground is. Every 3.5.2 playlist runs on. Its notes name no mode, so it has
// no new mode of its own: 50v50 v2 was 3.5.2's ("The battle begins on Thursday, April 19"), and nothing found says it ran
// past 3.6's release (🟡), so on 3.6 it is on by its switch, as every other LTM, and the lobby opens on Solo.
const build36 = 4019403;
// 4.0 (CL-4039451, 1 May 2018), Season 4's first build: its Athena/Playlists holds 3.6's 23 assets, the same ones (3.6's
// Playlist_Fortnite left out as there), so every 3.6 playlist runs on. Its notes ("BRACE FOR IMPACT", the Battle Pass,
// Sprays, the map update and Hop Rocks) name no mode, so it has no new mode either: every LTM is on by its switch and the
// lobby opens on Solo.
const build40 = 4039451;
// 4.1 (CL-4053532, 8 May 2018): its Athena/Playlists holds 4.0's 23 assets (Playlist_Fortnite and Playground left out as
// there) and one more, Playlist_Carmine (PlaylistId 33, AthenaEvent33, Athena.Playlist.Event.33, "Infinity Gauntlet",
// solo: MaxTeamCount 100, MaxTeamSize 1, its own loot, game data and resource rates, the Gauntlet's meteor drop
// MeteorSupplyDrop and the HUD CarmineHUD; its AthenaGameData's Default.MeteorDrop.Gauntlet.* and Default.Jim.* rows are
// the drop's and Thanos's). Its notes open on it: "Starting Tuesday, May 8th, you will be able to become Thanos in the
// Infinity Gauntlet Limited Time Mashup ... Wield the Gauntlet, Become Thanos, Claim Victory!", so it is 4.1's new mode:
// on there whatever its switch, and the lobby opens on it. Its original window is 8 to 16 May 2018 (Core-Backend #258), on
// 4.1 and 4.2. Every 4.0 playlist runs on.
const build41 = 4053532;
// 4.2 (CL-4072250, 16 May 2018): its Athena/Playlists holds 4.1's assets but Impact's three (Playlist_Impact_Solo, Duos
// and Squads are gone; their PlaylistIds, 44 to 46, are Close Encounters' now) and four more: Playlist_Comp_Solo
// (PlaylistId 51, AthenaEvent51, "Solo Showdown": "Be the last one standing in this opt in proving ground for high skill
// players.", solo, Athena.Playlist.Solo, bAccumulateToProfileStats, its HUD CompHUD, an empty widget in 4.2), Close
// Encounters' Playlist_Close_Solo, _Duos and _Squad (44, 45, 46: Athena/Playlists/Shotguns' loot and game data, "Close
// Quarters Combat with Shotguns & Jetpacks!") and Playlist_SolidGold_Duos (34, "Solid Gold v2" Duos, no down state).
// Playlist_Fortnite is left out as before; Playground is there now (Athena/Playlists/Playground/Playlist_Playground, PlaylistId 35, one team of 4, respawns except in the storm), so it is offered by its switch (Core-Backend #279). Update v4.20's notes name no mode (the Burst Assault Rifle,
// Apples, the Perk Recombobulator), so 4.2 has no new mode of its own: every LTM is on by its switch or its original
// window, and the lobby opens on Solo. The Infinity Gauntlet runs on (its window, 8 to 16 May, covers 4.2's first day);
// Solo Showdown is 17 to 21 May; Solid Gold v2 (now with Duos) and Close Encounters are Content Update v4.20's, 22 and 25
// May, which on Epic's side came by a later download with the Jetpack: 4.2's paks have both modes' playlists but no
// Jetpack item (Close Encounters' chests and supply drops give only its shotguns here).
const build42 = 4072250;
// 4.4 (4.4.0 CL-4117433, 12 June 2018; 4.4.1 CL-4127312, 14 June; 4.4.2 CL-4132537, 19 June: Core has 4.4.2's paks, whose
// data the other two play on, gamedata/read.js laterData): Epic emptied Athena/Playlists for 4.4. 4.4.2's holds 20
// playlist assets, and none of 4.2's LTMs but two: Playlist_50v50 (50, Update v4.40's 50v50 v3) and Playlist_Playground
// (35); Blitz, Teams of 20 (Playlist_5x20), Solid Gold, Sky Supply, High Explosives, Impact, Close Encounters, Solo
// Showdown and the Infinity Gauntlet (Playlist_Carmine) are gone (only Athena/Playlists/Carmine's game data is left), so
// none of them runs on 4.4 (their builds end at 4.2), whatever its switch or window. The rest: Playlist_Snipers_Solo,
// _Duos and Playlist_Snipers (39, 40, 41, Update v4.40's Sniper Shootout v3), Playlist_Final_12, _20 and _50 (103, 104, 105,
// Final Fight: Content Update v4.40's "Final Fight: Teams of 20" is _20), the default Solo, Duo and Squad, and the later
// LTMs' Ground Game (110 to 112), Score Royale (101, 102) and Playlist_Taxes (130 to 132), which no 4.4 notes name and are
// left out as Playlist_Fortnite was.
const build440 = 4117433;
const build441 = 4127312;
const build442 = 4132537;
// Core-Backend #257 asked for 3.5.1's to 4.0's Solid Gold v2 (Squads, Solo), Sniper Shootout v2 (Solo, Duos, Squads), High
// Explosives v2 (Squads, Solo), Blitz! (Squads, Solo, Duos), Teams of 20 and 50v50 v2. Each is a playlist asset of 3.5.1's
// and 4.0's Athena/Playlists (and 3.6's, which sits between them, as its note above has it; its paks didn't mount in
// FModel for #257), listed in the game instance's PlaylistManager (Blueprints/PlaylistManager's AthenaPlaylists: all 22
// of 3.5.1's), with the PlaylistName, PlaylistId and teams below (FModel). Five of them keep an
// entry from 3.0 or 3.1 and so its switch: the lobby names them as their asset's UIDisplayName does (name351): Solid Gold
// (27) "Solid Gold v2 (Squads)", Blitz (19) "Blitz! (Squads)", its children (36, 37) "Blitz! (Solo)" and "Blitz! (Duos)", and
// 5x20 (22) "Teams of 20". 4.0's assets read "Solid Gold v2", "Blitz!" and "Sniper Shootout v2", their mode in a new
// UIDisplaySubName; the names here are 3.5.1's. The gameserver needs nothing of its own for them (CoreV2): once the game
// state has the match's CurrentPlaylistData, the game applies the playlist itself. Its tables (loot tiers and packages, game
// data, resource rates) are copied over the defaults (ApplyPlaylistDataTables, 3.5.1 0x9DC890), and Core rolls the world's
// loot again from them (CoreV2 f7cda06): Solid Gold's legendary loot, Sniper Shootout's and High Explosives' weapons.
// - The spawn percents of chests and ammo boxes (Blitz's), the storm's phases and supply drops are the playlist's
//   AthenaGameData rows.
// - LootLevel: AFortGameModeAthena::OnPlaylistDataLoaded (0x9EFF70) has the game state's OverrideLootLevel (0x9F0A00)
//   set the world level from the playlist's LootLevel, else from its MaxSquadSize.
// - bNoDBNO (Sniper Shootout v2, Solid Gold v2 Solo): the pawn's death (0xA314E0) skips the down state when the game state's
//   playlist has it.
// - SafeZoneStartUp and bWarmUpInStorm (Blitz!): OnPlaylistDataLoadCompleted (0x9EFE50) caches the start-up on the game
//   state for the safe zone's code.
// - Teams: SetCurrentPlaylistId (0x9FA020) sets the game state's team count to the playlist's MaxTeamCount.
// None of these playlists has inventory overrides or starting items (no InventoryManagementItemDefinitions).
// The first build whose modes are FortPlaylistAthena assets turned on by PlaylistOverrides (3.5.1, above).
export const playlistAssetBuild = build351;
const playlistAssets = (build) => Number(build) >= playlistAssetBuild;

// Seasons 3 and 4's original dates (Core-Backend #258, 90sNath's list, inclusive days of 2018), each on the builds Epic ran
// it on and replayed on its season's clock as Seasons 1 and 2's are (seasonMoment: Season 3's replay is 22 February to 30
// April, Season 4's 1 May to 11 July):
// - Season 3: Solid Gold 27 February to 5 March (3.1, 3.1.1), Teams of 20 8 to 19 March (3.2, 3.3), Blitz 19 to 29 March
//   (3.3), Sniper Shootout v2 29 March to 4 April (3.5; 3.4, which is lost, once Core has it) and 50v50 v2 19 to 30 April
//   (3.5.1 to 3.6).
// - Season 4: 50v50 v2 1 to 8 May (4.0, 4.1), 22 May to 11 June (4.2 to 4.4) and 27 June to 11 July (4.5); Infinity
//   Gauntlet 8 to 16 May (4.1, 4.2); Solo Showdown 17 to 21 May (4.2); Solid Gold v2 22 to 31 May but for Close
//   Encounters (4.2 to 4.4); Close Encounters on 25 May (4.2); Blitz v2 1 to 4 June and Sniper Shootout v3 5 to 11 June
//   (4.4, and the lost 4.3); Teams of 20 v2 12 to 25 June (4.4, 4.4.x); High Explosives v2 22 to 25 June (4.4.x);
//   Playground 27 June to 11 July (4.5).
// A window's builds are changelists, or for builds Core doesn't have yet versions ("4.2", "4.4.x" for every 4.4 hotfix),
// so a build supported later (builds/detect.js buildVersions) picks its dates up. An LTM still runs only on the builds
// whose data has its playlist (its builds), which each build's bring-up extends once its Athena/Playlists is checked: the
// windows of 4.3 on wait for that. 4.0's data has no Playlist_Carmine, so Infinity Gauntlet's 8 May isn't on 4.0.
// Close Encounters ran for one hour on 25 May: the admin panel runs it the whole day or in a chosen hour of that day
// (settings ltmCloseEncounters {wholeDay, hour}, the hour on the replay's clock), and Solid Gold v2, which it interrupted,
// stops for it and starts again once it ends: on 26 May after a whole day, else after its hour.
// 4.2's data names Solo Showdown's, Close Encounters' (Solo, Duos, Squads) and Solid Gold v2 Duos' playlists. The modes
// no supported build has (Blitz v2, Sniper Shootout v3, Teams of 20 v2) have no playlist here yet (🟡: playlistId and playlistName null until their build's data names them, so no lobby offers
// them before that); Playground keeps 4.1's Playlist_Playground (35, one team of 4, respawns), the mode 4.5 ran.
export const closeEncountersDay = "2018-05-25";
// The admin panel's Close Encounters choice ({wholeDay, hour 0 to 23}): the whole day unless set otherwise.
export function closeEncountersSetting(settingsValue) {
  const value = settingsValue?.ltmCloseEncounters;
  const hour = Number(value?.hour);
  return { wholeDay: value?.wholeDay !== false, hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0 };
}
// Close Encounters' time on Epic's calendar ({start, end} in ms, UTC).
export function closeEncountersTime(settingsValue) {
  const { wholeDay, hour } = closeEncountersSetting(settingsValue);
  const start = day(closeEncountersDay) + (wholeDay ? 0 : hour * 3600000);
  return { start, end: start + (wholeDay ? 86400000 : 3600000) };
}
const solidGoldV2 = [
  { builds: [build42, build42], start: "2018-05-22", end: (settings) => closeEncountersTime(settings).start },
  { builds: [build42, "4.4"], start: (settings) => closeEncountersTime(settings).end, end: "2018-06-01" }
];
const sniperShootoutV2 = [{ builds: ["3.4", build352], start: "2018-03-29", end: "2018-04-05" }];
const sniperShootoutV3 = [{ builds: ["4.3", build442], start: "2018-06-05", end: "2018-06-12" }];
const highExplosivesV2 = [{ builds: ["4.4.1", "4.4.x"], start: "2018-06-22", end: "2018-06-26" }];

export const ltms = [
  { id: "fiftyFifty", name: "50v50", playlistId: 11, eventFlag: null, builds: [build110, build25], seasons: [1, 2], defaultOn: true,
    original: { builds: [build110, build111], start: "2017-12-08", end: "2017-12-19" },
    teams: "2 Teams × 50", description: "Two teams of 50, each from its own Battle Bus." },
  { id: "highExplosives", quest: "athenaevent2_playmatches", name: "High Explosives", playlistId: 13, queue: 2, eventFlag: "Event2", builds: [build111, build33], seasons: [2, 3],
    original: { builds: [build111, build111], start: "2017-12-28", end: "2018-01-03" },
    teams: "100 Teams × 4", description: "Rocket Launchers, Snowball Launchers and grenades only; no traps (Athena/Events/RocketsAndGrenades loot)." },
  { id: "sneakySilencers", quest: "athenaevent5_playmatches", name: "Sneaky Silencers", playlistId: 12, queue: 5, eventFlag: "Event5", builds: [build111, build33], seasons: [2, 3],
    original: { builds: [build111, build111], start: "2018-01-05", end: "2018-01-09" },
    teams: "100 Teams × 4", description: "Silenced weapons only (Athena/Events/SneakySilencers loot)." },
  { id: "sniperShootout", quest: "athenaevent7_playmatches", name: "Sniper Shootout", playlistId: 18, queue: 7, eventFlag: "Event7", builds: [build111, build33], seasons: [2, 3],
    original: { builds: [build23, build24], start: "2018-01-29", end: "2018-02-03" },
    teams: "100 Teams × 4", description: "Ready, aim, fire! Sniper Rifles only (Athena/Events/SnipersOnly loot)." },
  { id: "shootingTest", quest: "athenaevent1_playmatches", name: "Shooting Test #1", playlistId: 15, queue: 1, eventFlag: "Event1", builds: [build24, build25], seasons: [2],
    original: { builds: [build24, build242], start: "2018-02-02", end: "2018-02-13" },
    teams: "100 Teams × 1 (2.4: × 4)", description: "Weapon accuracy for a more precise aim: first-shot accuracy, headshot and fall-off changes." },
  { id: "speedyStorm", quest: "athenaevent3_playmatches", name: "Speedy Storm", playlistId: 14, queue: 3, eventFlag: "Event3", builds: [build21, build33], seasons: [2, 3],
    original: null,
    teams: "100 Teams × 4", description: "The storm waits 30 s between circles, not 90 to 200 (Athena/Events/FasterRings game data); the normal loot." },
  { id: "takeToTheSkies", quest: "athenaevent6_playmatches", name: "Take To The Skies", playlistId: 16, queue: 6, eventFlag: "Event6", builds: [build21, build33], seasons: [2, 3],
    original: null,
    teams: "100 Teams × 4 (3.0: × 2)", description: "Loot with Launch Pads on the floor (Athena/Events/TakeToTheSkies loot)." },
  { id: "lotsaLoot", quest: "athenaevent4_playmatches", name: "Lotsa Loot", playlistId: 17, queue: 4, eventFlag: "Event4", builds: [build21, build33], seasons: [2, 3],
    original: null,
    teams: "100 Teams × 4", description: "More loot (Athena/Events/LotsaLoot loot tiers and game data); its lobby tile reads \"Luxurious Loot\"." },
  { id: "blitz", quest: "athenaevent8_playmatches", name: "Blitz", playlistId: 19, queue: 8, eventFlag: "Event8", builds: [build242, build42], seasons: [2, 3, 4],
    playlistName: "Playlist_Blitz_Squad", tag351: 8, name351: "Blitz! (Squads)",
    original: [{ builds: [build33, build33], start: "2018-03-19", end: "2018-03-30" }],
    teams: "100 Teams × 4", description: "Shorter matches: a smaller first storm circle, its own loot and resource rates (Athena/Events/Blitz tables)." },
  { id: "fiveByTwenty", quest: "athenaevent22_playmatches", name: "5x20", playlistId: 22, queue: 22, eventFlag: null, builds: [build30, build42], seasons: [3, 4], newIn: build32,
    playlistName: "Playlist_5x20", name351: "Teams of 20",
    original: [{ builds: [build32, build33], start: "2018-03-08", end: "2018-03-20" }],
    teams: "5 Teams × 20", description: "Five teams of twenty (Playlist_5x20, a large team game with its own game data)." },
  { id: "highJump", quest: "athenaevent23_playmatches", name: "High Jump", playlistId: 23, queue: 23, eventFlag: null, builds: [build30, build33], seasons: [3],
    original: null,
    teams: "100 Teams × 1", description: "Solo (Playlist_HighJump, no tables of its own)." },
  { id: "useItOrLoseIt", quest: "athenaevent25_playmatches", name: "Use It & Lose It", playlistId: 25, queue: 25, eventFlag: null, builds: [build30, build33], seasons: [3],
    original: null,
    teams: "100 Teams × 4", description: "Its own loot and game data (Athena/Events/UseIt tables)." },
  { id: "steadyStorm", name: "Steady Storm", playlistId: 26, queue: 26, eventFlag: null, builds: [build30, build33], seasons: [3],
    original: null,
    teams: "100 Teams × 1", description: "Solo; the storm closes from the warmup on (Athena/Events/SteadyStorm game data)." },
  { id: "solidGold", quest: "athenaevent27_playmatches", name: "Solid Gold", playlistId: 27, queue: 27, eventFlag: null, builds: [build30, build42], seasons: [3, 4],
    playlistName: "Playlist_SolidGold_Squads", name351: "Solid Gold v2 (Squads)",
    original: [{ builds: [build31, build311], start: "2018-02-27", end: "2018-03-06" }, ...solidGoldV2],
    teams: "100 Teams × 4", description: "Its own loot tables and resource rates (Athena/Events/SolidGold tables; from 3.5.1 Athena/Playlists/SolidGold's: all weapon drops are Legendary)." },
  { id: "skySupply", quest: "athenaevent30_playmatches", name: "Sky Supply", playlistId: 30, queue: 30, eventFlag: null, builds: [build30, build42], seasons: [3, 4],
    playlistName: "Playlist_SkySupply",
    original: null,
    teams: "100 Teams × 1", description: "Solo, with its own loot and game data (Athena/Events/SkySupply tables)." },
  { id: "shotguns", quest: "athenaevent31_playmatches", name: "Shotguns", playlistId: 31, queue: 31, eventFlag: null, builds: [build30, build33], seasons: [3],
    original: null,
    teams: "100 Teams × 4", description: "Shotguns only (Athena/Events/Shotguns tables)." },
  { id: "blitzSolo", quest: "athenaevent8_playmatches", name: "Blitz (Solo)", playlistId: 36, queue: 36, tagQueue: 8, eventFlag: null, builds: [build31, build42], seasons: [3, 4],
    playlistName: "Playlist_Blitz_Solo", quest351: null, name351: "Blitz! (Solo)",
    original: null,
    teams: "100 Teams × 1", description: "Blitz alone (Playlist_Blitz_Child_Solo, Blitz's tables); its matches count Blitz's challenge." },
  { id: "blitzDuo", quest: "athenaevent8_playmatches", name: "Blitz (Duo)", playlistId: 37, queue: 37, tagQueue: 8, eventFlag: null, builds: [build31, build42], seasons: [3, 4],
    playlistName: "Playlist_Blitz_Duos", quest351: null, name351: "Blitz! (Duos)",
    original: null,
    teams: "100 Teams × 2", description: "Blitz in duos (Playlist_Blitz_Child_Duo, Blitz's tables); its matches count Blitz's challenge." },
  // 3.5.1's own playlists (above): data assets with no event queue, turned on by PlaylistOverrides.
  // 50v50 v2 is 3.5.1's and 3.5.2's new mode: on there whatever its switch, and its lobby opens on it. 7049afd took it out while
  // 3.5.1's matches sat on the loading screen, but every mode did that: the server crashed as the first player spawned
  // (CoreV2 #262: its POI volumes had no brush component, fixed in CoreV2 b1c4fb9). The game runs the mode from its
  // playlist (CoreV2 #260): a bus for each team, the final circle, its storm, supply drops, loot and bleed-out.
  { id: "fiftyFiftyV2", name: "50v50 v2", playlistId: 50, playlistName: "Playlist_50v50", eventFlag: null, builds: [build351, build42], seasons: [3, 4], newIn: [build351, build352],
    original: [{ builds: [build351, build36], start: "2018-04-19", end: "2018-05-01" }, { builds: [build40, build41], start: "2018-05-01", end: "2018-05-09" },
      { builds: [build42, build42], start: "2018-05-22", end: "2018-06-12" }, { builds: ["4.5", "4.5"], start: "2018-06-27", end: "2018-07-12" }],
    teams: "2 Teams × 50", description: "Two teams of 50 players, massive forts (Playlist_50v50: its own loot, game data and resource rates)." },
  { id: "highExplosivesSolo", name: "High Explosives v2 (Solo)", playlistId: 23, playlistName: "Playlist_HighExplosives_Solo", eventFlag: null, builds: [build351, build42], seasons: [3, 4],
    original: highExplosivesV2,
    teams: "100 Teams × 1", description: "Explosive weapons everywhere! (Athena/Playlists/HighExplosives tables)." },
  { id: "highExplosivesSquads", name: "High Explosives v2 (Squads)", playlistId: 24, playlistName: "Playlist_HighExplosives_Squads", eventFlag: null, builds: [build351, build42], seasons: [3, 4],
    original: highExplosivesV2,
    teams: "100 Teams × 4", description: "Explosive weapons everywhere! (Athena/Playlists/HighExplosives tables)." },
  { id: "sniperShootoutSolo", name: "Sniper Shootout v2 (Solo)", playlistId: 39, playlistName: "Playlist_Snipers_Solo", eventFlag: null, builds: [build351, build42], seasons: [3, 4],
    original: sniperShootoutV2,
    teams: "100 Teams × 1", description: "Sniper weapons only, no down state (Athena/Playlists/Snipers tables)." },
  { id: "sniperShootoutDuos", name: "Sniper Shootout v2 (Duos)", playlistId: 40, playlistName: "Playlist_Snipers_Duos", eventFlag: null, builds: [build351, build42], seasons: [3, 4],
    original: sniperShootoutV2,
    teams: "100 Teams × 2", description: "Sniper weapons only, no down state (Athena/Playlists/Snipers tables)." },
  { id: "sniperShootoutSquads", name: "Sniper Shootout v2 (Squads)", playlistId: 41, playlistName: "Playlist_Snipers", eventFlag: null, builds: [build351, build42], seasons: [3, 4],
    original: sniperShootoutV2,
    teams: "100 Teams × 4", description: "Sniper weapons only, no down state (Athena/Playlists/Snipers tables)." },
  { id: "skySupplyDuos", name: "Sky Supply (Duos)", playlistId: 42, playlistName: "Playlist_SkySupply_Duos", eventFlag: null, builds: [build351, build42], seasons: [3, 4],
    original: null,
    teams: "100 Teams × 2", description: "Supply drops rain down from the sky (Athena/Playlists/SkySupply tables)." },
  { id: "skySupplySquads", name: "Sky Supply (Squads)", playlistId: 43, playlistName: "Playlist_SkySupply_Squads", eventFlag: null, builds: [build351, build42], seasons: [3, 4],
    original: null,
    teams: "100 Teams × 4", description: "Supply drops rain down from the sky (Athena/Playlists/SkySupply tables)." },
  { id: "solidGoldSolo", quest: "athenaevent26_playmatches", name: "Solid Gold v2 (Solo)", playlistId: 26, playlistName: "Playlist_SolidGold_Solo", eventFlag: null, builds: [build351, build42], seasons: [3, 4],
    original: solidGoldV2,
    teams: "100 Teams × 1", description: "All weapon drops are Legendary (Athena/Playlists/SolidGold tables)." },
  { id: "impactSolo", name: "Impact (Solo)", playlistId: 44, playlistName: "Playlist_Impact_Solo", eventFlag: null, builds: [build351, build41], seasons: [3, 4],
    original: null,
    teams: "100 Teams × 1", description: "\"Blam!\" (Athena/Playlists/Impact game data)." },
  { id: "impactDuos", name: "Impact (Duos)", playlistId: 45, playlistName: "Playlist_Impact_Duos", eventFlag: null, builds: [build351, build41], seasons: [3, 4],
    original: null,
    teams: "100 Teams × 2", description: "\"Blam!\" (Athena/Playlists/Impact game data)." },
  { id: "impactSquads", name: "Impact (Squads)", playlistId: 46, playlistName: "Playlist_Impact_Squads", eventFlag: null, builds: [build351, build41], seasons: [3, 4],
    original: null,
    teams: "100 Teams × 4", description: "\"Blam!\" (Athena/Playlists/Impact game data)." },
  // 4.1's new mode (above), and Season 4's modes of 4.2 on (#258, above).
  { id: "infinityGauntlet", name: "Infinity Gauntlet", playlistId: 33, playlistName: "Playlist_Carmine", eventFlag: null, builds: [build41, build42], seasons: [4], newIn: build41,
    original: [{ builds: [build41, build42], start: "2018-05-08", end: "2018-05-17" }],
    teams: "100 Teams × 1", description: "A meteor strike delivers the Infinity Gauntlet: use it to become Thanos; if Thanos is eliminated the Gauntlet drops (Playlist_Carmine: its own loot, game data and resource rates)." },
  { id: "soloShowdown", name: "Solo Showdown", playlistId: 51, playlistName: "Playlist_Comp_Solo", eventFlag: null, builds: [build42, build42], seasons: [4],
    original: [{ builds: [build42, build42], start: "2018-05-17", end: "2018-05-22" }],
    teams: "100 Teams × 1", description: "Be the last one standing in this opt in proving ground for high skill players (Playlist_Comp_Solo: solo, the normal loot, stats on)." },
  { id: "closeEncounters", name: "Close Encounters (Squads)", playlistId: 46, playlistName: "Playlist_Close_Squad", eventFlag: null, builds: [build42, build42], seasons: [4],
    original: [{ builds: [build42, build42], start: (settings) => closeEncountersTime(settings).start, end: (settings) => closeEncountersTime(settings).end }],
    teams: "100 Teams × 4", description: "Shotguns only, for one hour on 25 May (Athena/Playlists/Shotguns tables; 4.2's paks have no Jetpack, Content Update v4.20's)." },
  { id: "closeEncountersSolo", name: "Close Encounters (Solo)", playlistId: 44, playlistName: "Playlist_Close_Solo", eventFlag: null, builds: [build42, build42], seasons: [4],
    original: [{ builds: [build42, build42], start: (settings) => closeEncountersTime(settings).start, end: (settings) => closeEncountersTime(settings).end }],
    teams: "100 Teams × 1", description: "Shotguns only, for one hour on 25 May (Athena/Playlists/Shotguns tables; 4.2's paks have no Jetpack, Content Update v4.20's)." },
  { id: "closeEncountersDuos", name: "Close Encounters (Duos)", playlistId: 45, playlistName: "Playlist_Close_Duos", eventFlag: null, builds: [build42, build42], seasons: [4],
    original: [{ builds: [build42, build42], start: (settings) => closeEncountersTime(settings).start, end: (settings) => closeEncountersTime(settings).end }],
    teams: "100 Teams × 2", description: "Shotguns only, for one hour on 25 May (Athena/Playlists/Shotguns tables; 4.2's paks have no Jetpack, Content Update v4.20's)." },
  { id: "solidGoldDuos", name: "Solid Gold v2 (Duos)", playlistId: 34, playlistName: "Playlist_SolidGold_Duos", eventFlag: null, builds: [build42, build42], seasons: [4],
    original: solidGoldV2,
    teams: "100 Teams × 2", description: "All weapon drops are Legendary, no down state (Athena/Playlists/SolidGold tables; 4.2's asset)." },
  { id: "blitzV2", name: "Blitz v2", playlistId: null, playlistName: null, eventFlag: null, builds: ["4.3", "4.4"], seasons: [4],
    original: [{ builds: ["4.3", "4.4"], start: "2018-06-01", end: "2018-06-05" }],
    teams: "100 Teams × 4", description: "Blitz again (4.4's: its playlist comes with 4.4's data)." },
  // Update v4.40's Sniper Shootout v3 (PongooDev/CoreV2#327): 4.4's Playlist_Snipers (41, Squads), Playlist_Snipers_Solo
  // (39) and _Duos (40), checked in 4.4.2's paks: 100 teams of 4, 1 and 2, bNoDBNO (the notes' "Reviving Down But Not Out
  // teammates ... is deactivated, players are immediately eliminated"), "Ready, aim, fire! Sniper & Scoped weapons only.",
  // and Athena/Playlists/Snipers' own loot tiers, loot packages and game data: the notes' Sniper Rifles and Scoped ARs
  // only, Epic and Legendary snipers on the floor, no Crossbow, half the floor loot, -25% farming, which the gameserver
  // plays from those tables. 3.5.1's Sniper Shootout v2 had the same PlaylistIds (their builds end at 4.2). On by its switch
  // or Core-Backend #258's window, 5 to 11 June, on 4.4's builds (and the lost 4.3's); 50v50 v3 is the one the 4.4.0 lobby
  // opens on.
  { id: "sniperShootoutV3", name: "Sniper Shootout v3 (Squads)", playlistId: 41, playlistName: "Playlist_Snipers", eventFlag: null, builds: [build440, build442], seasons: [4],
    original: sniperShootoutV3,
    teams: "100 Teams × 4", description: "Sniper Rifles and Scoped ARs only, no down state (Athena/Playlists/Snipers tables, 4.4's)." },
  { id: "teamsOf20V2", name: "Teams of 20 v2", playlistId: null, playlistName: null, eventFlag: null, builds: ["4.4", "4.4.x"], seasons: [4],
    original: [{ builds: ["4.4", "4.4.x"], start: "2018-06-12", end: "2018-06-26" }],
    teams: "5 Teams × 20", description: "Five teams of twenty again (4.4's: its playlist comes with 4.4's data)." },
  { id: "playground", name: "Playground", playlistId: 35, playlistName: "Playlist_Playground", eventFlag: null, builds: [build42, "4.5"], seasons: [4],
    original: [{ builds: ["4.5", "4.5"], start: "2018-06-27", end: "2018-07-12" }],
    teams: "1 Team × 4", description: "A private island, respawning but in the storm (Playlist_Playground: 4.2's paks already have the asset, a stub described as rewrite; 🟡 4.5's unchecked)." },
  // Update v4.40's 50v50 v3 (PongooDev/CoreV2#328): 4.4's Playlist_50v50 (PlaylistId 50: two teams of 50 in squads of 4,
  // bIsLargeTeamGame, a bus for each team, AirCraftBehavior OpposingAirCraftForEachTeam with its custom path's midpoint
  // 60,000 out, SafeZoneStartUp StartsWithWarmUp, StormEffectDelay 330, bDisplayFinalStormPosition, no placement rewards)
  // with its own Athena/Playlists/50v50 loot tiers, loot packages, game data and resource rates: the notes' new first
  // circle, supply drops in batches of 4 to 8, the default DBNO damage, +25% farming, double and triple ammo are those
  // tables', which the gameserver plays. The notes ("Large squad" mode: no profile stats) open on it with Sniper Shootout
  // v3, so it is 4.4.0's new mode (on there whatever its switch). On the replay it takes 50v50 v2's window of 22 May to 11
  // June on 4.4's builds (Core-Backend #258: 4.2 to 4.4), the asset being v3's there; 4.4.1 and 4.4.2 offer it by its
  // switch or that window.
  { id: "fiftyFiftyV3", name: "50v50 v3", playlistId: 50, playlistName: "Playlist_50v50", eventFlag: null, builds: [build440, build442], seasons: [4], newIn: build440,
    original: [{ builds: [build440, build442], start: "2018-05-22", end: "2018-06-12" }],
    teams: "2 Teams × 50", description: "Two teams of fifty, a bus each (Playlist_50v50, 4.4's: a larger first circle, more supply drops, +25% farming, double ammo)." },
  { id: "sniperShootoutV3Solo", name: "Sniper Shootout v3 (Solo)", playlistId: 39, playlistName: "Playlist_Snipers_Solo", eventFlag: null, builds: [build440, build442], seasons: [4],
    original: sniperShootoutV3,
    teams: "100 Teams × 1", description: "Sniper Rifles and Scoped ARs only (Athena/Playlists/Snipers tables, 4.4's)." },
  { id: "sniperShootoutV3Duos", name: "Sniper Shootout v3 (Duos)", playlistId: 40, playlistName: "Playlist_Snipers_Duos", eventFlag: null, builds: [build440, build442], seasons: [4],
    original: sniperShootoutV3,
    teams: "100 Teams × 2", description: "Sniper Rifles and Scoped ARs only, no down state (Athena/Playlists/Snipers tables, 4.4's)." },
  // Content Update v4.40's Final Fight: Teams of 20 (PongooDev/CoreV2#325): 4.4.2's Playlist_Final_20 (PlaylistId 104, read
  // from its paks): five teams of 20 in squads of 4 (MinPlayers 60), bIsLargeTeamGame, a bus for each team
  // (OpposingAirCraftForEachTeam), WinConditionType TimedTeamFinalFight with LastSafeZoneIndex 3 (the storm stops after its
  // third circle and the countdown, Default.WinConditionTime.Final, starts: the team with the most players left wins, ties
  // win together), no placement rewards, and Athena/Playlists/Final's game data, whose circles the notes changed by hotfix
  // (events/finalfight.js). The countdown and win are the gameserver's. Its notes are 4.4.2's (19 June), so it is 4.4.2's
  // new mode, by its switch or from 19 June to 4.5 (26 June) on the replay; 4.4.0 and 4.4.1 don't have it. Its siblings
  // Playlist_Final_12 (103, 8 teams of 12) and _50 (105, 2 of 50) are in the paks too, but no 4.4 notes name them (later
  // Final Fight modes): left out.
  { id: "finalFight", name: "Final Fight: Teams of 20", playlistId: 104, playlistName: "Playlist_Final_20", eventFlag: null, builds: [build442, build442], seasons: [4], newIn: build442,
    original: [{ builds: [build442, build442], start: "2018-06-19", end: "2018-06-26" }],
    teams: "5 Teams × 20", description: "The storm stops after its third circle; when the countdown ends, the team with the most players left wins (Playlist_Final_20)." }
];
// A build range's bounds are changelists or versions ("4.2", "4.4.x"): a version holds only once Core knows the build's.
const versionParts = (version) => String(version).split(".").map((part) => (part === "x" ? Infinity : Number(part)));
function compareVersions(a, b) {
  const [left, right] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const [x, y] = [left[i] ?? 0, right[i] ?? 0];
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
const versionOfBuild = (build) => versionOf(String(Number(build))) ?? versions[Number(build)] ?? null;
const compareToBound = (build, bound) => {
  if (typeof bound === "number") return Math.sign(Number(build) - bound);
  const version = versionOfBuild(build);
  return version === null ? NaN : compareVersions(version, bound);
};
const inRange = ([first, last], build) => compareToBound(build, first) >= 0 && compareToBound(build, last) <= 0;
// The builds an LTM is new in (newIn: one changelist or a list).
const newInBuilds = (ltm) => (ltm.newIn === undefined ? [] : [].concat(ltm.newIn));
const isNewIn = (ltm, build) => newInBuilds(ltm).includes(Number(build));
export const ltmIds = ltms.map(({ id }) => id);
const byId = new Map(ltms.map((ltm) => [ltm.id, ltm]));
// A playlist's LTM: the requesting build's (3.5.1 gave 23 and 26 to other modes), else any build's.
export const ltmOfPlaylist = (playlistId, build = currentBuild()) => {
  const of = ltms.filter((ltm) => ltm.playlistId === Number(playlistId));
  return of.find((ltm) => inRange(ltm.builds, build)) ?? of[0] ?? null;
};
// The event queue's number of each event playlist ({12: 5, 13: 2, 14: 3, 15: 1, 16: 6, 17: 4, 18: 7, 19: 8}, and 3.0's
// N: N from 22 on): the matchmaking button's AthenaEvent<N> → playlist switch read backwards, so the N of the playlist's
// Athena.Playlist.Event.<N> and complete_athena_event_<N>; 3.1's Blitz children (36, 37) take Blitz's, 8 (tagQueue).
export const eventQueueOfPlaylist = Object.fromEntries(ltms.filter((ltm) => ltm.queue).map((ltm) => [ltm.playlistId, ltm.tagQueue ?? ltm.queue]));
// The N of a playlist's Athena.Playlist.Event.<N> on a build: the event queue's above, and on 3.5.1 its PlaylistId but for
// Blitz Squads (8, tag351), undefined for a playlist that is no LTM there.
export function eventTagOfPlaylist(playlistId, build = currentBuild()) {
  if (!playlistAssets(build)) return eventQueueOfPlaylist[playlistId];
  const ltm = ltmOfPlaylist(playlistId, build);
  return ltm && inRange(ltm.builds, build) ? ltm.tag351 ?? ltm.playlistId : undefined;
}

const seasonOf = (build) => (Number(build) >= build40 ? 4 : Number(build) >= build30 ? 3 : Number(build) >= build111 ? 2 : 1);
const day = (date) => Date.parse(`${date}T00:00:00Z`);
// An LTM's original windows ([] for none): {builds, start, end, season}, start and end in ms of Epic's calendar (UTC), end
// the moment after it. A window's start or end is a day ("YYYY-MM-DD") or a function of the settings (Close Encounters'
// hour, Solid Gold v2 around it).
const momentOf = (value, settingsValue) => {
  const resolved = typeof value === "function" ? value(settingsValue) : value;
  return typeof resolved === "number" ? resolved : day(resolved);
};
const seasonOfBound = (bound) => (typeof bound === "number" ? seasonOf(bound) : versionParts(bound)[0]);
const windowsOf = (ltm, settingsValue) => [].concat(ltm.original ?? []).map(({ builds, start, end }) =>
  ({ builds, start: momentOf(start, settingsValue), end: momentOf(end, settingsValue), season: seasonOfBound(builds[0]) }));

// Whether a build's data has the LTM.
export const hasLtm = (id, build) => Boolean(byId.get(id)) && inRange(byId.get(id).builds, build);

// Whether the LTM's original window holds the season's replay now, for a build Epic ran it on.
export function inOriginalWindow(id, build, now = new Date(), settingsValue = settingsProvider()) {
  const ltm = byId.get(id);
  const windows = ltm ? windowsOf(ltm, settingsValue).filter((window) => inRange(window.builds, build)) : [];
  if (!windows.length) return false;
  const moment = seasonMoment(now, null, seasonOf(build)).getTime();
  return windows.some(({ start, end }) => moment >= start && moment < end);
}

// The matchmaking modes in force ({solo, duo, ..., <ltm id>: boolean}): the admin's, with each LTM's by its original
// window while Original dates is on. settingsValue is the settings store's value.
export function ltmModes(build, settingsValue, now = new Date()) {
  const modes = settingsValue?.matchmakingModes;
  if (settingsValue?.ltmOriginalDates !== true) return modes;
  return { ...(modes ?? {}), ...Object.fromEntries(ltms.map(({ id }) => [id, inOriginalWindow(id, build, now, settingsValue)])) };
}

// The settings store's value, for work that has none at hand (the quest login).
let settingsProvider = () => undefined;
export function configureLtms(provider) {
  settingsProvider = typeof provider === "function" ? provider : () => provider;
}

// Whether the build's lobby offers the LTM now: always on the build it is new in.
export function ltmOn(id, build, settingsValue = settingsProvider(), now = new Date()) {
  const ltm = byId.get(id);
  if (!ltm || !hasLtm(id, build)) return false;
  if (isNewIn(ltm, build)) return true;
  const modes = ltmModes(build, settingsValue, now);
  return ltm.defaultOn ? modes?.[id] !== false : modes?.[id] === true;
}

// The event queues the build's lobby offers now (the region state's EventFlagsForcedOn).
export const ltmEventFlags = (build, settingsValue, now = new Date()) => (playlistAssets(build) ? []
  : ltms.filter((ltm) => ltm.eventFlag && ltmOn(ltm.id, build, settingsValue, now)).map((ltm) => ltm.eventFlag));

// The event queues past AthenaEvent8 the build's lobby offers now (3.0's), which have no event flag: the DefaultGame.ini
// hotfix sets their UFortGlobals bEvent<N>ForceEnabled.
export const ltmForcedQueues = (build, settingsValue = settingsProvider(), now = new Date()) => (playlistAssets(build) ? []
  : ltms.filter((ltm) => ltm.queue && !ltm.eventFlag && ltmOn(ltm.id, build, settingsValue, now)).map((ltm) => ltm.queue));

// 3.5.1's: the playlists the build's lobby offers now, by name (UFortGameInstance's PlaylistOverrides, set by the
// DefaultGame.ini hotfix), none before it.
export const ltmPlaylistOverrides = (build, settingsValue = settingsProvider(), now = new Date()) => (!playlistAssets(build) ? []
  : ltms.filter((ltm) => ltm.playlistName && ltmOn(ltm.id, build, settingsValue, now)).map((ltm) => ltm.playlistName));

// The lobby's EFortAthenaPlaylist of an event queue (UFortGameUserSettings' LastSelectedPlaylist): AthenaEvent1 to 8
// are 4 to 11, AthenaPlatoon 12 and AthenaEvent21 to 54 13 to 46 (3.2's SDK).
export const athenaPlaylistOfQueue = (queue) => (queue <= 8 ? queue + 3 : queue === 20 ? 12 : queue - 8);

// The lobby's LastSelectedPlaylist for an LTM on a build: its EFortAthenaPlaylist before 3.5.1, its playlist's name from it.
export const lastSelectedPlaylistOf = (ltm, build) => (playlistAssets(build) ? ltm.playlistName : athenaPlaylistOfQueue(ltm.queue));

// The build's new mode while its lobby offers it (the LTM), or null.
export const ltmNewMode = (build, settingsValue = settingsProvider(), now = new Date()) =>
  ltms.find((ltm) => isNewIn(ltm, build) && ltmOn(ltm.id, build, settingsValue, now)) ?? null;

// The event quests of the LTMs the requesting build offers now (running) or doesn't (events/fiftyfifty.js
// athenaEventQuestsOf).
// A quest several LTMs share (Blitz's, 3.1's Blitz children too) runs while any of them is on.
export function ltmQuests({ running }, build = currentBuild(), now = new Date()) {
  const settings = settingsProvider();
  // 3.5.1's Blitz Solo and Duos count no quest (quest351: their own tags).
  const questOf = (ltm) => (playlistAssets(build) && "quest351" in ltm ? ltm.quest351 : ltm.quest);
  const on = new Set(ltms.filter((ltm) => questOf(ltm) && ltmOn(ltm.id, build, settings, now)).map(questOf));
  if (running) return [...on];
  return [...new Set(ltms.filter((ltm) => ltm.quest && !on.has(ltm.quest)).map((ltm) => ltm.quest))];
}

// When an LTM next starts or ends on the build's replay while Original dates is on (for the calendar's cacheExpire), or
// null.
export function nextLtmChange(build, settingsValue, now = new Date()) {
  if (settingsValue?.ltmOriginalDates !== true) return null;
  const season = seasonOf(build);
  const times = ltms.flatMap((ltm) => windowsOf(ltm, settingsValue)).filter((window) => inRange(window.builds, build))
    .flatMap(({ start, end }) => [start, end]).map((moment) => nextReplayOf(moment, now, null, season).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

// The admin panel's list (its Battle Royale Game Modes, after solo, duos and squads): each LTM with its window and
// builds, whether it is on by hand, and whether its window holds each season's replay now.
const versions = { [build110]: "1.10", [build111]: "1.11", [build21]: "2.1", [build23]: "2.3", [build24]: "2.4", [build242]: "2.4.2", [build25]: "2.5", [build30]: "3.0", [build31]: "3.1", [build311]: "3.1.1", [build32]: "3.2", [build33]: "3.3", [build351]: "3.5.1", [build352]: "3.5.2", [build36]: "3.6", [build40]: "4.0", [build41]: "4.1", [build42]: "4.2", [build440]: "4.4.0", [build441]: "4.4.1", [build442]: "4.4.2" };
const boundName = (bound) => (typeof bound === "number" ? versions[bound] : bound);
const buildRange = ([first, last]) => (first === last ? boundName(first) : `${boundName(first)} to ${boundName(last)}`);
// A window's day or moment for the admin panel: "YYYY-MM-DD" at midnight, else the ISO time; last, its last day.
const shownMoment = (ms) => (ms % 86400000 === 0 ? new Date(ms).toISOString().slice(0, 10) : new Date(ms).toISOString());
const shownWindow = ({ builds, start, end, season }) => ({ builds: buildRange(builds), start: shownMoment(start), end: shownMoment(end),
  last: new Date(end % 86400000 === 0 ? end - 86400000 : end).toISOString().slice(0, 10), season });
// The last build Core knows in a range (a changelist; past every known one for a range of builds Core doesn't have yet).
const lastBuildOf = (range) => (typeof range[1] === "number" ? range[1]
  : Math.max(...Object.keys({ ...buildVersions, ...versions }).map(Number).filter((build) => inRange(range, build)), 0) || 99999999);
// An LTM's windows for the admin panel: original, its first (null for none: off while Original dates is on); windows, all
// of them, each with its season; inWindow, whether one of each season's holds that season's replay now.
function originalOf(ltm, settingsValue, moments) {
  const windows = windowsOf(ltm, settingsValue);
  const shown = windows.map(shownWindow);
  return {
    original: shown[0] ? (({ season, ...first }) => first)(shown[0]) : null,
    windows: shown,
    inWindow: Object.fromEntries(ltm.seasons.map((season) => [season, windows.some((window) => window.season === season &&
      moments[season] >= window.start && moments[season] < window.end)]))
  };
}
export function ltmSchedule(settingsValue, now = new Date()) {
  const modes = settingsValue?.matchmakingModes ?? {};
  const moments = Object.fromEntries([1, 2, 3, 4].map((season) => [season, seasonMoment(now, null, season).getTime()]));
  return {
    originalDates: settingsValue?.ltmOriginalDates === true,
    // Close Encounters' day: the whole of it or one hour (#258).
    closeEncounters: closeEncountersSetting(settingsValue),
    seasonMoments: Object.fromEntries(Object.entries(moments).map(([season, moment]) => [season, new Date(moment).toISOString()])),
    list: ltms.map((ltm) => ({
      id: ltm.id,
      name: ltm.name,
      playlistId: ltm.playlistId,
      eventFlag: ltm.eventFlag,
      queue: ltm.queue ?? null,
      playlistName: ltm.playlistName ?? null,
      // The lobby's name for it from 3.5.1 on, where its playlist asset names it otherwise (null where it doesn't).
      name351: ltm.name351 ?? null,
      seasons: ltm.seasons,
      builds: buildRange(ltm.builds),
      // The last build that has it (its teams there: matchmaking/service.js playlistTeamsOf).
      lastBuild: lastBuildOf(ltm.builds),
      teams: ltm.teams,
      description: ltm.description,
      enabled: ltm.defaultOn ? modes[ltm.id] !== false : modes[ltm.id] === true,
      // The builds it is new in, where it is on whatever its switch (null for none): "3.2", "3.5.1 and 3.5.2".
      newIn: newInBuilds(ltm).map((build) => versions[build]).join(" and ") || null,
      ...originalOf(ltm, settingsValue, moments)
    }))
  };
}

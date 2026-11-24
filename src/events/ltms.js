import { currentBuild } from "../builds/context.js";
import { buildVersions, versionOf } from "../builds/detect.js";
import { nextReplayOf, seasonMoment } from "../store/itemshop.js";
import { leakyLakeState } from "./butterfly.js";
import { iceKingOnEpicDates, iceKingState, iceKingStormSoon } from "./icestorm.js";

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
// 4.5 (CL-4159770, "4.5.0", 27 June 2018, and CL-4166199, "4.5": Core has CL-4166199's paks, whose data the other plays
// on, gamedata/read.js laterData): its Athena/Playlists holds 4.4.2's assets but the Snipers (gone) and adds Fly
// Explosives (Playlist_FlyExplosives_*, 120 to 122: 31 July 2018's, Season 5, left out). Update v4.50 names two modes:
// Playground (Playlist_Playground, 35: one team of 4, InfiniteRespawnExceptStorm, "Low-pressure environment where friends
// can let their creativity run wild"), its new mode, and Final Fight Teams of 12 (Playlist_Final_12, 103: 8 teams of 12 in
// squads of 4, TimedTeamFinalFight with LastSafeZoneIndex 3). 50v50 v3 (Playlist_50v50, "50 V 50 v3") is still in. The
// Soaring 50s (15 August 2018) and Blitz have no 4.5 playlist, so 4.5 offers neither.
const build450 = 4159770;
const build45 = 4166199;
// 5.0 (CL-4204761, "5.0.0", 12 July 2018, and CL-4214610, "5.0": Core has CL-4214610's paks, whose data the other plays on),
// Season 5: Epic emptied Athena/Playlists again, which holds only the default Solo, Duo and Squad, Playlist_Playground (35)
// and Playlist_50v50 (50). Its 50v50 is a new revision: "50 V 50" (no longer "v3"), "Two teams of fifty players fight to the
// finish! This mode has extra loot...", SafeZoneStartUp StartsWithAirCraft, the bus path's midpoint 52,500 out, and
// bRewardForRevivingTeammates (Update v5.00: "You now earn XP for reviving teammates in 50v50 and Teams of 20 LTMs"), so it
// is an LTM of its own (fiftyFiftySeason5). Update v5.00 names no new mode, so 5.0's lobby opens on Solo; Playground went
// with Season 4 ("Playground mode is back on Wednesday, July 25", Update v5.10, with a revision of its own), so on the
// replay neither runs by date on 5.0: both are there by their switches (🟡 nothing found dates a 50v50 between 12 and 24
// July). The Final Fight, Fly Explosives and Snipers playlists are gone, so 5.0 offers none of them.
const build500 = 4204761;
const build50 = 4214610;
// 5.10 (CL-4225813, "5.10.0", Update v5.10, 24 July 2018, and CL-4240749, "5.10", Content Update v5.10, 31 July: Core has
// CL-4240749's paks, whose data the other plays on): Athena/Playlists holds the defaults, 5.0's Playlist_50v50 (unchanged)
// and Playlist_Playground, now a new revision (four teams of up to four, MaxPlayers 4, bAllowTeamSwitching, LootDropRounds 3,
// Athena.Creative), and, back, Playlist_FlyExplosives_Solo, _Duos and _Squads (120 to 122; Athena/Playlists/HighExplosives'
// tables, MissionGen_FlyExplosives), Playlist_Comp_Solo (51, "Solo Showdown") and Playlist_Fortnite (32, "Final Five").
// Update v5.10: "Playground mode is back on Wednesday, July 25! New team select options let you and your squad set up
// team battles", so 5.10's Playground (playgroundV2) runs from 25 July to the season's end on the replay (🟡 the end:
// Core's, as 4.5's) and by its switch, and the lobby opens on it on neither build (it came the day after 5.10). Content
// Update v5.10 (31 July, CL-4240749's): "This week kicks off with a new LTM, Fly Explosives", a squads mode ("Take flight
// with your team"; the Fortnite Wiki's Fly Explosives: Squads), so Fly Explosives (Squads) is CL-4240749's new mode, on
// there from 31 July to 7 August (🟡 the end: Update v5.20's day, whose Steady Storm followed), and its Solo and Duos are
// by their switches; CL-4225813 predates it (24 July). No 5.10 notes name Solo Showdown or Final Five (later modes), so
// they are left out as before.
const build5100 = 4225813;
const build510 = 4240749;
// 5.21 (CL-4288479, Update v5.21, 15 August 2018; Core has no 5.20, Update v5.20 of 7 August, so 5.21 carries its modes
// too): Athena/Playlists holds the defaults, 5.10's Playlist_50v50 ("50 V 50", unchanged) and Playlist_Playground (four
// teams of four still: Update v5.20's "Fill/No Fill option added to game mode selector" and "Chest & floor loot changed
// back to one weapon spawn each" are its loot tables' and the front end's), and, new, Playlist_Steady_Solo, _Duos and
// _Squads (160 to 162, "Steady Storm": Athena/Playlists/SteadyStorm's game data, MissionGen_SteadyStorm, profile stats on),
// Playlist_Soaring_50s (53, "Soaring 50's": two teams of fifty in squads of 4, a bus each, RedeployGlider_Modifier, its
// own Athena/Playlists/50v50/Soaring loot tables), and, back, Playlist_Snipers_Solo, _Duos and Playlist_Snipers (39 to 41,
// "Sniper Shootout": 100 teams of 1, 2 and 4, bNoDBNO, Athena/Playlists/Snipers' tables). Fly Explosives' playlists are
// gone. Update v5.20 (7 August): "Limited Time Mode: Steady Storm ... One Storm that closes in over the course of 15
// minutes", the mode of 5.20 (which Core lacks), so on 5.21 Steady Storm runs from 7 August to 15 August on the replay (🟡
// the end: Update v5.21's day) and by its switches. Update v5.21 (15 August): "Redeploy your glider and stay mobile in
// the newest limited time mode, Soaring 50's", and "Limited Time Mode: Sniper Shootout ... Scoped Assault Rifles have
// been removed. The Heavy Sniper Rifle has been added" (Athena/Playlists/Snipers' loot, which the gameserver plays): so
// Soaring 50's is 5.21's new mode, on there from 15 August to 23 August (🟡 the end: Update v5.30's day), and Sniper
// Shootout v4 (Solo, Duos, Squads) takes the same window (🟡: the notes don't date it) and its switches.
// Playlist_Velocity_Solo, _Duos and _Squads ("Velocity", PlaylistId 160, Steady Storm Solo's, a placeholder) and
// Playlist_Comp_Meta_Solo and Playlist_Fortnite_B_* are in the paks too, but no 5.20 or 5.21 notes name them (later
// modes): left out, as Solo Showdown and Final Five are.
const build521 = 4288479;
const steadyStorm = [{ builds: [build521, build521], start: "2018-08-07", end: "2018-08-15" }];
const update521Window = [{ builds: [build521, build521], start: "2018-08-15", end: "2018-08-23" }];
// 5.30 (CL-4305896, Update v5.30, 23 August 2018): Athena/Playlists holds the defaults, Playlist_50v50 and
// Playlist_Playground (unchanged: Update v5.30's "a couple dozen new ATK's ... and a handful of new Rifts" are its map's),
// Playlist_Soaring_50s, and, new, Athena/Playlists/Score's Playlist_Score_Solo, _Duos and _Squads (101, 102, 103: "Score
// Royale", 100 teams of 1, 2 and 4, WinConditionType FirstToGoalScore, MissionGen_HighScore, ScoreGameplayModifier, the
// coins' BronzeCoinData to GoldCoinData_9 as SpawnActorInfoList, its AthenaGameData's ScoringEvent rows: Update v5.30's
// "Collect points to claim Victory Royale in this new Limited Time Mode"), Athena/Playlists/SolidGold's
// Playlist_SolidGold_Solo, _Duos and _Squads (26, 34, 27: "Solid Gold", 100 teams of 1, 2 and 4) and
// Playlist_50v50SAU (1993: "50 V 50 Solid Gold", two teams of fifty in squads of 4). Steady Storm's and Sniper Shootout's
// playlists are gone. Score Royale is 5.30's new mode, on there from 23 August (Update v5.30) to 28 August (🟡 the end:
// Content Update v5.30's day, which brought Solid Gold); Content Update v5.30 (28 August): "Battle with all legendary
// weapons in the Solid Gold and Solid Gold 50v50 LTM's, available now!", so Solid Gold (Squads) and 50v50 Solid Gold run
// from 28 August to 6 September (🟡 the end: Update v5.40's day), Solid Gold Solo and Duos by their switches (the notes
// name neither). Playlist_Fortnite_B_* and Playlist_Fortnite ("Final Five") are in the paks too, but no 5.30 notes name
// them: left out.
const build530 = 4305896;
const scoreRoyale = [{ builds: [build530, build530], start: "2018-08-23", end: "2018-08-28" }];
const solidGold530 = [{ builds: [build530, build530], start: "2018-08-28", end: "2018-09-06" }];
// 5.40 (CL-4352937, Update v5.40, 6 September 2018; Content Update v5.40's and Update v5.41's items are in its paks):
// Athena/Playlists holds the defaults (and Athena/Playlists/Up's Playlist_Up_Solo, _Duos and _Squads, 180 to 182, more
// default playlists, bIsDefaultPlaylist, which no notes name: left out), Playlist_50v50, Playlist_50v50SAU, Playlist_Playground
// and Playlist_Soaring_50s, unchanged, and, new, Athena/Playlists/Bling's Playlist_Bling_Solo, _Duos and _Squads (140, 141,
// 142: "The Getaway", 100 teams of 1, 2 and 4, WinConditionType MutatorControlled, VictoryUIType Heist, MissionGen_Bling,
// BlingModifierDefinition, the safes' BlingSupplyDrop, the vans' Bling_VanInfo, the Jewel Athena_Bling_Pack; its
// description: "players will race to find a Jewel and then escape in one of the getaway vans! The first four squads to
// escape win the Victory Royale!"), and Close Encounters' Playlist_Close_Solo, _Duos and _Squad (44, 45, 46: 4.2's ids,
// Athena/Playlists/Shotguns' loot, MissionGen_AthenaEvent44: Update v5.41's "Limited Time Mode: Close Encounters ...
// Decreased Jetpack fuel burn rate by 50% ... Grapplers have been added"). Score Royale's and Solid Gold's three are gone.
// The Getaway is 5.40's new mode (Update v5.40: "It added both the Grappler and Getaway LTM"). Epic's tweets (the Fortnite
// Wiki's High Stakes Challenges): the High Stakes event began on 6 September with the Getaway, and on 13 September "The
// Getaway LTM has switched back to Squads ... before High Stakes ends next week with the update" (Update v5.41, 18
// September). So the Getaway ran in Squads from 6 September, in Duos for a while before 13 September (🟡 from Content
// Update v5.40's day, 11 September, which fixed the mode's bugs: the tweet gives only its end), and in Squads again from 13
// to 18 September; Solo by its switch (nothing names it). Squads and Duos are on by default on 5.40 (their switches turn
// them off): its shipped lobby has no FrontEndPlaylistData entry for them, so the backend's list (ltmFrontEndPlaylists)
// puts them there, as New (AdvertiseType, advertise); Original dates runs them by the windows. Close Encounters by its
// switches (🟡 Update v5.41 names it, not its days); 50v50 Solid Gold by its switch (its window is 5.30's).
const build540 = 4352937;
// 5.41 (CL-4363240, Update v5.41, 18 September 2018): Athena/Playlists holds 5.40's, unchanged (The Getaway's three, Close
// Encounters' three, Playlist_50v50, Playlist_50v50SAU, Playlist_Playground and Playlist_Soaring_50s), and, new,
// Athena/Playlists/Soaring's Playlist_Soaring_Solo, _Duos and _Squads (185, 186, 187: "Soaring Solos", "Soaring Duos" and
// "Soaring Squads", 100 teams of 1, 2 and 4, MissionGen_Soaring, Velocity's RedeployGlider_Modifier, profile stats on; its
// description: "Classic Battle Royale with gliders that can be re-deployed by pressing Jump when falling from large
// heights"). Update v5.41: "LTM: Soaring Solos" (that text) and "Limited Time Mode: Close Encounters ... Decreased Jetpack
// fuel burn rate by 50% while this LTM is active. Grapplers have been added" (its loot and modifiers, the gameserver's
// playlist). So Soaring Solos is 5.41's new mode: on by default (its switch turns it off) and, as the Getaway on 5.40,
// listed in the lobby by the backend as New (5.41's shipped DefaultGame.ini is 5.40's, byte for byte, and lists neither);
// its Duos and Squads by their switches (the notes name Solos only). With Original dates, Soaring Solos and Close
// Encounters (Squads) run on 5.41 from Update v5.41's day to the season's end (🟡 Update v6.00's day, 27 September: the
// notes name both modes, not their days). The Getaway, High Stakes' mode, keeps 5.40's switches (on by default) and,
// with Original dates, its windows on 5.41 too, beside the High Stakes Challenges (events/highstakes.js), which 5.41's
// paks keep and its replay serves by the same dates.
const build541 = 4363240;
const getawaySquads = [{ builds: [build540, build541], start: "2018-09-06", end: "2018-09-11" },
  { builds: [build540, build541], start: "2018-09-13", end: "2018-09-18" }];
const getawayDuos = [{ builds: [build540, build541], start: "2018-09-11", end: "2018-09-13" }];
const update541Window = [{ builds: [build541, build541], start: "2018-09-18", end: "2018-09-27" }];
// 6.00 (CL-4395664, "6.00.0", and CL-4402180, "6.00", Update v6.00, 27 September 2018: Core has CL-4402180's paks, whose
// data the other plays on), Season 6: Athena/Playlists (every playlist asset of its 15 paks) holds only the defaults,
// Playlist_50v50 (50 V 50, PlaylistId 50, now with "Press jump to redeploy your glider when falling from large heights"),
// Playlist_Playground (35, Playground's four teams of four, Athena.Creative), Playlist_Soaring_50s (53) and
// Playlist_Fortnite_B_* / Playlist_Fortnite ("Final Five", left out as on 5.40). The Getaway's, Close Encounters', 50v50
// Solid Gold's and Soaring Solos' playlists are gone (High Stakes ended with Update v5.41). Its shipped DefaultGame.ini
// lists 5.41's lobby: the default Solo, Duo and Squad, Playlist_50v50 and Playlist_Playground (AdvertiseType Updated), all
// enabled. Update v6.00 names no limited time mode, so 6.00's lobby opens on Solo: its 50v50 (fiftyFiftySeason6, the new
// revision) and Season 5's Playground are on by default, as the shipped lobby has them (Update v6.01's "Playground Custom
// Options" and v6.20's spawnables have Playground running through Season 6, so with Original dates it runs from 27
// September to the season's end, 6 December), and Soaring 50's is there by its switch, with Original dates from the
// season's first day to Update v6.02's, 27 September to 10 October, on 6.00 and 6.01 (Core-Backend #367's list: Disco
// Domination took its place).
const build6000 = 4395664;
const build600 = 4402180;
// 6.01 (CL-4417689, "6.01.0", and CL-4424678, "6.01", Update v6.01, 3 October 2018: Core has CL-4424678's paks, whose data
// the other plays on): Athena/Playlists (every playlist asset of its 15 paks, against 6.00's) keeps Playlist_50v50 and
// Playlist_Soaring_50s byte for byte and changes two. Playlist_Playground now names UserOptions, Playgrounds_UserKnobsV1,
// and the UserKnobsModifier: Update v6.01's "Playground Custom Options ... Allowing you to change settings such as starting
// health, time of day, gravity, and more!" (seven options, each a property of a Creative mutator: Shields, Health, Drop
// Items When Eliminated, Fall Damage, Gravity, Time of Day, Player Names & Location; the lobby sends the party's choices
// with its ticket and the matchmaking service hands them to the server, matchmaking/service.js customMatchOptionsOf).
// Playlist_Fortnite_B_Solo ("Final Five", left out as before) drops bNoDBNO. And one is new: 50v50/Disco's Playlist_Disco
// (PlaylistId 202, "Disco Domination", two teams of 50 in squads of 4, MissionGen_Disco, RedeployGlider_Modifier and
// DiscoGameModifier), Update v6.02's limited time mode (10 October 2018), cooked a week ahead of it. Its shipped
// DefaultGame.ini lists 6.00's lobby unchanged (the default Solo, Duo and Squad, Playlist_50v50 and Playlist_Playground,
// AdvertiseType Updated). So 6.01's lobby is 6.00's: its 50v50 and Playground on by default (Playground through Season 6
// with Original dates), Soaring 50's by its switch (6.00's dates), and Disco Domination by its switch too (🟡 6.01 was never played with
// it: Update v6.02 brought it, so it has no Original dates here).
const build6010 = 4417689;
const build601 = 4424678;
// 6.02 (CL-4442095, "6.02.0", and CL-4461277, "6.02", Update v6.02, 10 October 2018: Core has CL-4461277's paks, whose data
// the other plays on): Athena/Playlists (every playlist asset of the 13 paks that mount, against 6.01's) keeps the
// defaults, Playlist_50v50, Playlist_Soaring_50s, Playlist_Disco and the "Final Five" ones byte for byte (Playground gains
// bForceCameraFadeOnRespawn, false) and adds six:
// - 50v50/Disco's Playlist_Disco_32 (PlaylistId 217, "Disco Domination" again: two teams of 32 in squads of 4, 24 to 64
//   players, the same MissionGen_Disco, RedeployGlider_Modifier and DiscoGameModifier), a smaller Disco Domination no
//   notes name;
// - HighExplosives' Playlist_HighExplosives_Solo and _Squads (23 and 24, 3.5.1's ids: "High Explosives", "Explosive
//   weapons everywhere!", MissionGen_AthenaEvent23 and the ResourceCapModifier; the Solo one on 5.10's Fly Explosives
//   tables, AthenaCompositeLTD/LP/GD_FlyExplosives, the Squads one on HighExplosives' own);
// - SteadyStorm's Playlist_Steady_Solo, _Duos and _Squads (160 to 162, 5.21's ids and assets' names: "The storm absolutely
//   will... not... stop. Ever!", MissionGen_SteadyStorm, profile stats on).
// Update v6.02: "Limited Time Mode: Disco Domination ... Two teams battle it out! Respawning will be turned on until the
// third (last) storm circle. Five dance floors will appear on the map whenever the storm is not moving ... The first team
// to fill their dance bar to 100% will win the match ... Glider redeploy is activated in this mode ... This mode uses 50v50
// levels of loot and resources": Playlist_Disco, 6.02's new mode (the Fortnite Wiki's Disco Domination: "introduced on
// October 10th 2018"). Its shipped DefaultGame.ini is 6.01's byte for byte, so it lists 6.00's lobby and Epic turned the
// mode on from its servers. So on 6.02 Disco Domination is on by default (its switch turns it off) and listed by the
// backend as New, as 5.41's Soaring Solos; with Original dates it runs from 10 October to Update v6.10's day, 16 October
// (🟡 the end: Update v6.10's notes still list the mode, "What's New? Reduced all bandage spawns by 50% ...", so Epic ran
// it on into 6.10; 6.02 itself was played until that day). The 32 a side one, High Explosives and Steady Storm are there
// by their switches (🟡 nothing found names or dates them in October 2018). 50v50, Playground and Soaring 50's are as on
// 6.01.
const build6020 = 4442095;
const build602 = 4461277;
// 6.10 (CL-4464155, "6.10.0", CL-4476098, "6.10.1", and CL-4480234, "6.10", Update v6.10, 16 October 2018: Core has
// CL-4480234's paks, whose data the other two play on): Athena/Playlists (every playlist asset of its 8 paks, against
// 6.02's) keeps Playlist_DefaultSolo, the High Explosives pair and Playground (it gains ServerMetricsEventFrequency),
// changes five and adds eleven:
// - Playlist_50v50 and Playlist_Soaring_50s lose RedeployGlider_Modifier from their ModifierList (their descriptions still
//   promise the redeploy: Update v6.10's "Glider Redeploy now functions properly in game modes that support this feature")
//   and gain RatingType largeTeam and bUpdateMMR, as the default Duo and Squad gain RatingType team; Playlist_Disco and
//   Playlist_Disco_32 lose the modifier too and keep DiscoGameModifier.
// - 50v50/Disco's Playlist_Disco_40 (PlaylistId 218, two teams of 40, 24 to 80 players) and Playlist_Disco_Alt (230, two
//   teams of 50 on DiscoGameModifierNoA): two more Disco Dominations no notes name.
// - Blitz's Playlist_Blitz_Solo, _Duos and _Squads (36, 37 and 19, 3.5.1's ids; "Blitz! v2", "matches that are 15 minutes
//   long or less", MissionGen_AthenaEvent36, 37 and 8, tables of their own).
// - Soaring's Playlist_GRD_Solo, _Duos and _Squads (223 to 225: "Solo", "Duos" and "Squads" with RedeployGlider_Modifier,
//   bIsDefaultPlaylist set and profile stats on: the default modes with glider redeploy; 🟡 Update v6.10 names no such
//   mode).
// - Showdown's Playlist_Showdown_Solo, _Duos and _Squads (58071 to 58073, "Tournament": MinPlayers 80, Strategy
//   BattleRoyaleStrategy_Showdown, bEnforceFullSquadInUI, ShowdownLoading and ShowdownScoringHUD), the in-game tournaments'
//   playlists (tournaments/store.js). They are no lobby mode: the shipped DefaultGame.ini lists them disabled, and the
//   client itself turns on the one its current event names (UFortGameInstance::GetPlaylistAccess, CL-4480234 0xE7EFA0).
// - Gone: SteadyStorm's three playlists (and its game data), which 6.02 had.
// Its shipped DefaultGame.ini lists the defaults, Playlist_50v50 as one of them (bIsDefaultPlaylist and
// bVisibleWhenDisabled set, bDisplayAsLimitedTime false, DisplayPriority 3, where 6.02 had it a limited time mode at 10),
// Playlist_Playground as before and the three Showdown playlists, disabled, at 50 to 52 (services/fortnite/cloudstorage.js).
// Update v6.10: "Limited Time Mode: Disco Domination ... What's New? Reduced all bandage spawns by 50%. Removed all Common
// weapons ... Brought in the side dance floors closer to the Storm edge. Reduced max respawn distance by 20%": the mode
// runs on, so 6.02's Disco Domination entry covers 6.10, on by default; with Original dates from Update v6.10's day, 16
// October, to Update v6.20's, 24 October (🟡 the end: the day Epic took the mode down isn't in the notes). The 40 a side and
// Alt Disco Dominations, Blitz! v2 and the glider redeploy defaults are there by their switches (🟡 nothing found names them
// in 6.10's days; Blitz!'s Original dates are 6.22's, below). 50v50, Playground, Soaring 50's, the 32 a side Disco
// Domination and High Explosives are as on 6.02.
const build6100 = 4464155;
const build6101 = 4476098;
const build610 = 4480234;
// 6.20 (CL-4497486, Update v6.20, 24 October 2018): Athena/Playlists (every playlist asset of its 14 paks, against 6.10's)
// keeps 6.10's but the glider redeploy defaults (Playlist_GRD_Solo, _Duos and _Squads are gone: Update v6.20's "Glider
// Redeploy is currently available in all game modes" is game data, AthenaGameData's Default.GliderRedeploy.CanRedeploy,
// 0 in 6.10's curve and 1 in 6.20's, so nothing here serves it), changes four (Playground gains
// bAllowLayoutRequirementsFeature, the Port-A-Challenges; the three Showdown playlists gain bIsTournament,
// SessionAssignmentChannel OT, MaxPendingMatches 200 and MaxBucketCapacity 10000) and adds eleven:
// - Fortnitemares' Playlist_Deimos_Solo, _Duo and _Squad (PlaylistId 47 to 49, "Fortnitemares", 100 teams of 1, 2 and 4,
//   AthenaGameData_Deimos, the modifiers GameplayMod_DeimosAI, _DeimosMissions, _DeimosRiftDrop and _DeimosDifficulty<size>:
//   the Cube Monsters, "Cube Fragments spawn Cube Monsters ... Large Cube Fragments are found near corrupted areas"). Its
//   challenges count only there (their objective stats' context Athena.Playlist.Deimos). The shipped DefaultGame.ini lists
//   none of them (Epic's lobby turned them on), so they are an LTM of their own here, on by default and listed as New, with
//   Original dates from Update v6.20's day, 24 October, to Update v6.21's "Fortnitemares in Battle Royale ends on Sunday,
//   November 4 at 1 PM Eastern Time" (18:00 UTC). Epic's lobby put them in the defaults' place (Core-Backend #348: during
//   Fortnitemares the mode select had Fortnitemares Solo, Duos and Squads, not the normal three), which the files don't say:
//   that was Epic's FrontEndPlaylistData hotfix. So while each is on, its default (`replaces`) is taken off the lobby and
//   it takes the default's place (defaultReplacements, services/fortnite/cloudstorage.js), unless the admin panel turns
//   that off (settings fortnitemaresReplacesDefaults, on by default). 🟡 Epic's exact access values for them aren't in any
//   file read; Core gives them the defaults' own (bIsDefaultPlaylist, the defaults' priorities, no limited time banner).
//   On 6.21 they end at the Butterfly, as Epic's did (Core-Backend #354; `untilButterfly`): they follow the Leaky Lake's
//   state (events/butterfly.js leakyLakeState) rather than the dates. Before the event (POI0) they are on by their switch,
//   whatever Original dates says, and after it (POI1) off, so Solo, Duos and Squads are back; the Butterfly card's "Before
//   the event" brings them back with the pre-event map. Without POI0 6.21's Cube Monster spawners don't run anyway
//   (events/events.js). 6.20 (no Butterfly) keeps its dates.
//   Core-Backend #367: on its first day Epic took Fortnitemares Duos and Squads down for about four hours, the normal Duos
//   and Squads in their place (the list; Dexerto, 24 October 2018, quotes Epic's "We have disabled Fortnitemares in Battle
//   Royale while we investigate issues with matchmaking", without naming the modes, and dates its return 11:15 AM
//   Eastern, 15:15 UTC).
//   With Original dates on, the admin panel's outage option (settings fortnitemaresOutage, off by default) replays it:
//   Duos' and Squads' window stops from 11:15 to 15:15 UTC on 24 October (🟡 the start is four hours before, the list's
//   "about 4 hours"; Kotaku has Epic's long-queue notice at about 7 AM Eastern), so their defaults are back in the lobby
//   meanwhile (#348's replacement follows each mode). The list names the stand-ins "Soaring 50s Duos and Squads": 6.20's
//   paks have no such playlist (5.41's Soaring Duos and Squads are gone since 6.00), and its default Duos and Squads have
//   glider redeploy (above), so those are what come back. Solo keeps its whole window.
// - Playlist_Deimos_SoloCN, _DuoCN and _SquadCN (147 to 149): the same for China's region, no mode here.
// - Playlist_Deimos_SoloShow, _DuoShow and _SquadShow (59071 to 59073, "Tournament"): Fortnitemares' tournament playlists,
//   which the shipped DefaultGame.ini lists disabled at 53 to 55 beside the Showdown ones' 50 to 52, so in-game
//   tournament playlists as 6.10's Showdown ones (tournaments/store.js).
// - Disco Domination's Playlist_Disco_40_Alt (231, 2 × 40) and _32_Alt (232, 2 × 32), on DiscoGameModifierNoA as
//   Playlist_Disco_Alt.
// The shipped list also enables Playlist_CreativeTestIsland (DisplayPriority 16), whose playlist asset isn't in the paks:
// it isn't listed here. Disco Domination's Original dates end on 24 October (above), so on 6.20 it is there by its switch.
// 6.21 (CL-4526925, Update v6.21, 1 November 2018): Athena/Playlists (every playlist asset of its 6 paks, against 6.20's)
// keeps every 6.20 playlist and adds none; the Deimos ones (and their CN ones) change, on MissionGen_Athena now (6.20's
// MissionGen_AthenaEvent47 to 49 are gone), and Playlist_Playground gains PlaygroundModifiers (CreativeMutator_POIOverride),
// beside a new GameplayModifier, ButterflyEventModifier, which Athena_GameMode registers in every match. Its DefaultGame.ini's
// lobby list is 6.20's line for line. So every 6.20 mode runs to 6.21, as it was, Fortnitemares' Original dates with them
// (they end on 4 November, 6.21's fourth day: events/events.js has the POI0 its spawners now need). Core-Backend #367's
// list has Disco Domination back from 4 November to Update v6.22's day, the 6th: Playlist_Disco's Original dates from
// Fortnitemares' end, 18:00 UTC (🟡 the hour: the list gives the day, and Fortnitemares ran to 1 PM Eastern).
// 6.22 (CL-4543176, Update v6.22, 6 November 2018: "Fortnitemares has come to an end in Battle Royale"): Athena/Playlists
// (every playlist asset of its 13 paks, against 6.21's) drops Fortnitemares' Playlist_Deimos_Solo, _Duo and _Squad, their
// CN and tournament (Show) playlists, and five of the six Disco Dominations (Playlist_Disco, _Disco_40, _Disco_Alt,
// _Disco_40_Alt and _Disco_32_Alt: only Playlist_Disco_32 is left), keeps the rest, and adds one:
// - Team Terror, Deimos/Playlist_Deimos_50v50 (its PlaylistName is Playlist_Deimos_50, which the lobby, the matchmaking
//   bucket and the gameserver's playlist manager go by; PlaylistId 450; "Team Terror", "Monsters have invaded the Battle
//   Royale island! Two teams will battle it out as Cube Monsters monsters join the fight"): 2 teams of 32 (MinPlayers 24,
//   MaxPlayers 64, squads of 4, bIsLargeTeamGame, RatingType largeTeam, a Battle Bus for each team as 50v50's), glider
//   redeploy, the Deimos modifiers (GameplayMod_DeimosAI, _DeimosMissions, _DeimosRiftDrop and the new
//   _DeimosDifficulty50v50) on MissionGen_DeimosLarge, AthenaGameData_Deimos_50v50, the large teams' loot
//   (DeimosLootTiers_LargeTeam, DeimosLootPackages_LargeTeams) and 50v50's resource rates. Update v6.22: "Two teams of 32
//   players ... Monster spawners are scattered throughout the map and also appear each time the storm closes in to a new
//   circle ... Gold monsters and monster spawners drop Legendary items". The shipped DefaultGame.ini lists it nowhere (its
//   lobby list is 6.21's line for line: Epic's hotfix turned it on), so it is an LTM of its own here, on by default and
//   listed as New (a server owner's request: "enable the playlist by default"), with Original dates from Update v6.22's day,
//   6 November, to Update v6.30's, 14 November (🟡 the day Epic took it down isn't in the notes). It takes no default
//   mode's place: Fortnitemares' replacement (#348) is 6.20's and 6.21's Deimos playlists' alone. 6.22's Cube Monster
//   spawners no longer wait for a calendar flag: its Deimos_Mission_RiftSpawners_Static and _Dynamic set no
//   RequiredEventFlag (6.21's named POI0).
// Core-Backend #367: Update v6.22's Blitz! is 6.10's Blitz playlists (36, 37, 19). It returned with the update on 6 November
// and was removed on the 9th, when Disco Domination returned (Dexerto, 9 November: three days after it came back), so its
// Original dates are 6 November to the 9th, there by its switches otherwise. The Disco Domination that replaced it is
// Playlist_Disco_32, the only one 6.22's paks keep (Dexerto France, 9 November 2018: "Disco vient de remplacer le mode
// Blitz"), so its Original dates are the 9th to Update v6.30's day, the 14th (the issue's list has no window there: the
// sources do).
// 6.30 (CL-4573096, Update v6.30, 14 November 2018, and Content Update v6.30, 20 November; its files are dated 19 November):
// Athena/Playlists (every playlist asset of its 9 paks, against 6.22's) drops Blitz! (36, 37, 19), keeps the rest (Team
// Terror's Playlist_Deimos_50v50 among them, its teams, modifiers and tables 6.22's, and Playlist_Disco_32), brings back 6.20's Playlist_Disco_32_Alt
// (232) and adds three modes, none of which its shipped DefaultGame.ini lists (its lobby list is 6.22's and the
// ShowdownAlt tournaments, disabled; Epic's hotfixes turned them on):
// - Food Fight, Barrier/Playlist_Barrier (204, "Food Fight: Defend the Mascots"): 2 teams of 24 (MinPlayers 24, MaxPlayers
//   48, squads of 4, bIsLargeTeamGame, a Battle Bus for each team), BarrierModifierDefinition, MissionGen_Barrier, its own
//   loot, game data and resource rates; and Playlist_Barrier_12 (206), the same with 2 teams of 12 (18 to 24 players).
//   Update v6.30: "Two teams on either side of the map. A huge barrier runs down the middle ... destroy the enemy's mascot
//   to win the match!" (the notes give no team size: the data's is 24). Food Fight (Playlist_Barrier) is on by default
//   and listed as New, its Original dates Update v6.30's day, 14 November, to Update v6.31's, 27 November, whose paks drop
//   it (Core-Backend #367's list: it ran beside Wild West from the 20th); the 12 a side one is by its switch.
// - Wild West, WW/Playlist_WW_Solo (900), Playlist_WW_Duo (901, PlaylistName Playlist_WW_Duos) and Playlist_WW_Squad (902,
//   Playlist_WW_Squads): Battle Royale with its own loot (Content Update v6.30: "Hunting Rifles, Shotguns and Dynamite"),
//   game data and resource rates. On by default and listed as New, their Original dates the Content Update's day, 20
//   November, to Update v6.31's, 27 November (🟡 Epic's end isn't in the notes).
// - The Scavenger Pop-Up Cup's tournament playlists, Showdown/Playlist_ShowdownAlt_Solo, _Duos and _Squads (58074 to 58076,
//   bIsTournament, the Showdown modifiers): in-game tournaments' as the Showdown ones, no lobby mode.
// Core-Backend #367's list has Disco Domination on 6.30 too, 14 to 27 November (Update v6.30 keeps glider redeploy "in the
// larger team modes (e.g. Soaring 50s, Disco Domination etc.)"): Playlist_Disco_32's Original dates go on from 6.22's to
// Update v6.31's day. 6.30's paks have two Disco Dominations, Playlist_Disco_32 and _32_Alt, the same but for the modifier
// (DiscoGameModifier, DiscoGameModifierNoA); 🟡 which one Epic's lobby offered isn't known, so the Alt stays by its switch.
// 6.31 (CL-4573279, Update v6.31, 27 November 2018): Athena/Playlists (every playlist asset of its 15 paks, against 6.30's)
// drops Food Fight (Barrier), Wild West (WW) and Team Terror (Playlist_Deimos_50v50; only Deimos' game data stays), keeps
// the rest (50v50, Soaring 50's, Disco Domination 32 v 32 and its Alt, High Explosives, Playground, the Showdown and
// ShowdownAlt tournaments) and adds one mode, which its shipped DefaultGame.ini doesn't list (its lobby list is 6.30's;
// Epic's hotfix turned it on). Core-Backend #367: High Explosives returned with this update too (Dexerto's 29 November
// guide has it in 6.31; 🟡 the notes don't date its return), so its Original dates are the update's day, 27 November, to the
// season's end:
// - Team Rumble, Respawn/Playlist_Respawn_24 (280, "Two large teams fight for the Victory Royale in an action-packed mode
//   where the first team to get 100 eliminations wins!"): 2 teams of 20 (MinPlayers 24, MaxPlayers 40, squads of 4,
//   bIsLargeTeamGame, a Battle Bus for each team, WinConditionType MutatorControlledGoalScore, DBNO NotWhenRespawning),
//   RespawnGameplayModifier, MissionGen_Respawn, its own loot and game data, 50v50's resource rates. Update v6.31: "Two
//   teams of 20 players ... respawn after 5 seconds ... The first team to 100 eliminations wins." On by default and listed
//   as New, its Original dates Update v6.31's day, 27 November, to the season's end, 6 December (🟡 Epic's end isn't in
//   the notes: Update v7.00's day).
// The ShowdownAlt playlists are Update v6.31's Alchemist Pop-Up Cup ("A material cap of 500 Wood, 500 Stone, 500 Metal,
// Harvesting Rate Increased by 40%, +50 Health on Eliminations, Storm Surge"), the same assets as 6.30's Scavenger.
const build620 = 4497486;
const build621 = 4526925;
const build622 = 4543176;
const build630 = 4573096;
const build631 = 4573279;
// Season 6's Original dates (Core-Backend #367, 90sNath's list, each window to the day the next mode took its place; the
// season's last day is 5 December, Update v7.00 came on the 6th), each on the builds whose paks have its playlist:
// - Soaring 50's 27 September to 10 October (6.00, 6.01);
// - Disco Domination 10 to 24 October (6.02, 6.10), 4 to 6 November (6.21) and 14 to 27 November (6.30), and, from the
//   sources rather than the list, 9 to 14 November (6.22), when it replaced Blitz!;
// - Fortnitemares 24 October to 4 November (6.20, 6.21), in Solo's, Duos' and Squads' place (#348), with its launch-day
//   outage as an option;
// - Blitz! 6 to 9 November and Team Terror 6 to 14 November (6.22), Food Fight 14 to 27 November and Wild West 20 to 27
//   November (6.30), Team Rumble and High Explosives 27 November to the season's end (6.31).
// The list's Close Encounters, Sniper Shootout and Solid Gold have no Season 6 dates: no Season 6 build's paks have their
// playlists (no Playlist_Close_*, _Snipers* or _SolidGold_* in 6.00's to 6.31's Athena/Playlists, which each build's
// bring-up read whole, and 6.20's and 6.30's again for #367), so no build here could offer them.
const season6Window = [{ builds: [build6000, build631], start: "2018-09-27", end: "2018-12-06" }];
const soaringSeason6Window = [{ builds: [build6000, build601], start: "2018-09-27", end: "2018-10-10" }];
const teamTerrorWindow = [{ builds: [build622, build622], start: "2018-11-06", end: "2018-11-14" }];
// Blitz! v2 returned in Update v6.22 on 6 November 2018 and was removed on the 9th, when Disco Domination returned.
const blitzSeason6Window = [{ builds: [build622, build622], start: "2018-11-06", end: "2018-11-09" }];
// High Explosives returned with Update v6.31 on 27 November 2018 and ran to the season's end.
const highExplosivesSeason6Window = [{ builds: [build631, build631], start: "2018-11-27", end: "2018-12-06" }];
const foodFightWindow = [{ builds: [build630, build630], start: "2018-11-14", end: "2018-11-27" }];
const wildWestWindow = [{ builds: [build630, build630], start: "2018-11-20", end: "2018-11-27" }];
const teamRumbleWindow = [{ builds: [build631, build631], start: "2018-11-27", end: "2018-12-06" }];
// Fortnitemares ends on 4 November at 1 PM Eastern (Update v6.20's notes).
const fortnitemaresEnd = Date.parse("2018-11-04T18:00:00.000Z");
const fortnitemaresWindow = [{ builds: [build620, build621], start: "2018-10-24", end: fortnitemaresEnd }];
// Its launch-day outage (Core-Backend #367, 6.20's note above): Duos and Squads off from 11:15 to 15:15 UTC on 24 October
// while the admin panel's option is on (settings fortnitemaresOutage, off by default), Original dates only.
export const fortnitemaresOutage = { start: Date.parse("2018-10-24T11:15:00.000Z"), end: Date.parse("2018-10-24T15:15:00.000Z") };
export const fortnitemaresOutageOn = (settingsValue) => settingsValue?.fortnitemaresOutage === true;
const fortnitemaresTeamsWindow = [
  { builds: [build620, build621], start: "2018-10-24", end: (settings) => (fortnitemaresOutageOn(settings) ? fortnitemaresOutage.start : fortnitemaresEnd) },
  { builds: [build620, build621], start: (settings) => (fortnitemaresOutageOn(settings) ? fortnitemaresOutage.end : fortnitemaresEnd), end: fortnitemaresEnd }
];
const discoDominationWindow = [{ builds: [build6020, build602], start: "2018-10-10", end: "2018-10-16" },
  { builds: [build6100, build610], start: "2018-10-16", end: "2018-10-24" },
  { builds: [build621, build621], start: fortnitemaresEnd, end: "2018-11-06" }];
// 6.22's and 6.30's Disco Domination, the 32 a side one (the only one 6.22's paks keep).
const discoDomination32Window = [{ builds: [build622, build622], start: "2018-11-09", end: "2018-11-14" },
  { builds: [build630, build630], start: "2018-11-14", end: "2018-11-27" },
  // The 14 Days of Fortnite's Disco Domination, its days 5 and 6 (7.00's Playlist_Disco_32, below).
  { builds: [4629139, 4629139], start: "2018-12-23", end: "2018-12-25" }];
// 7.00 (CL-4629139, Update v7.00, 6 December 2018), Season 7: Athena/Playlists (every playlist asset of its 16 paks)
// keeps 6.31's (50v50, Soaring 50's, Disco Domination 32 v 32 and its Alt, High Explosives Solo and Squads, Playground,
// Team Rumble, the Showdown and ShowdownAlt tournaments) and adds Season 7's: Playlist_PlaygroundV2 and _4 (35, "Creative",
// Athena.Creative: the Creative subgame's islands, the `creative` mode below), Playlist_Playground16 (35, 16
// players), Classic (Playlist_Classic_Solo, _Duos, _Squads: 214 to 216, "Classic Solos/Duos/Squads"), Close Encounters
// (Shotguns: 44 to 46, Playlist_Close_Solo, _Duos, _Squad, back from 5.41), Sniper Shootout (Snipers: 39, 40 and 41
// Playlist_Snipers), Soaring Solos, Duos and Squads (185 to 187, back from 5.41) and Vamp (Playlist_Vamp_Solo, _Duo,
// _Squad: 265 to 267, "Vamp", the 14 Days of Fortnite's Siphon). Its shipped DefaultGame.ini's lobby is the default Solo,
// Duo and Squad, Playlist_50v50, Playlist_Playground (AdvertiseType Updated) and Playlist_PlaygroundV2 (bDisplayAsNew),
// with the tournaments disabled. Update v7.00 names no limited time mode; Update v7.01 (11 December) brought Close
// Encounters ("Close quarters combat with Shotguns & Jetpacks!"), whose playlists 7.00's paks already have. The 14 Days of
// Fortnite (19 December 2018 to 1 January 2019, a large mode every two days and a small one each day; the Fortnite Wiki's
// day list, its days 18 December + n) used these 7.00 playlists: Unvaulted (Squads, Playlist_Classic_Squads, the tile Epic's
// later page names for it) on the 19th, Siphon (Solo, Playlist_Vamp_Solo) the 20th, Disco Domination the 23rd and 24th,
// Sniper Shootout (Duos) the 23rd, Close Encounters (Squads) the 24th, Team Rumble the 25th and 26th, High Explosives
// (Squads) the 31st; its other modes (Teams of 33, Team Terror, Barebones, Slide, Solid Gold, Score Royale, Food Fight, Ground
// Game, Sneaky Silencers, Close Encounters 50s, Wild West, Steady Storm, High Explosives 50s, One Shot) have no playlist in
// 7.00's paks (Content Update v7.10's), so no build here could offer them. On by default: 7.00's lobby's 50v50 and
// Playground, Team Rumble (6.31's, on by default there and kept in 7.00's paks) and Update v7.01's Close Encounters (as 6.30's
// Content Update modes were); the rest by their switches, each with the Original dates above (🟡 Close Encounters' end isn't
// in the notes: Update v7.10's day, 18 December, here).
const build700 = 4629139;
// 7.10 (CL-4667333, Update v7.10, 18 December 2018), Season 7: the 14 Days of Fortnite's build. Its Athena/Playlists (every
// playlist asset of its paks, all but the keyed pakchunk1000) keeps 7.00's but Playlist_PlaygroundV2_4, and brings back or
// adds the 14 Days' modes: Teams of 33 (Playlist_33: 151, 3 teams of 33 in squads of 4, "Three teams of thirty-three
// players fight to the finish!", new), Team Terror (Playlist_Deimos_50: 450), Food Fight (Playlist_Barrier and _12, and
// Playlist_Barrier_16: 207, 2 × 16, new), Close Encounters 50's (Playlist_Close_50: 4750, 2 × 50, new), High Explosive
// 50s (Playlist_50v50HE: 203, 2 × 50, new), Barebones (Playlist_Hard_Solo, _Duos, _Squads: 240 to 242, new), Slide
// (Playlist_Slide_*: 160 to 162), Ground Game (Playlist_Ground_*: 110 to 112, new), Sneaky Silencers (Playlist_Sneaky_*:
// 260 to 262), One Shot (Playlist_Low_*: 250 to 252, new), Score Royale, Solid Gold, Steady Storm and Wild West, and a
// few never offered in Season 7 (Blitz!, Fly Explosives, Final Fight, Teams of 20, Solid Gold 50s, Trios, Infinite Blades,
// Playlist_Fortnite_B_*), which have no mode here. Its shipped DefaultGame.ini's lobby is 7.00's but the tournaments'
// lines (the Showdown and ShowdownAlt playlists aren't listed any more; the in-game tournaments' own window turns theirs
// on, tournaments/showdown.js).
// Update v7.10: "The 14 Days of Fortnite event will feature both new and returning LTMs. Large team modes switch every two
// days and small team modes rotate every 24 hours. Starting December 19, log in each day at 9 AM ET(1400 UTC) to find out
// which modes are available to explore." The Fortnite Wiki's 14 Days of Fortnite has the days: large Teams of 33 (days 1
// and 2), Team Terror, Disco Domination, Team Rumble, Food Fight, Close Encounters 50's and High Explosives 50's (days 13
// and 14); small Unvaulted (Squads), Siphon (Solo), Barebones (Squads), Slide (Solo), Sniper Shootout (Duos), Close
// Encounters (Squads), Solid Gold (Squads), Score Royale (Duos), Ground Game (Squads), Sneaky Silencers (Solo), Wild West
// (Squads), Steady Storm (Solo), High Explosives (Squads) and One Shot (Squads). Each window here is its day(s) from 14:00
// UTC (day 1: 19 December 2018), on 7.10. Which Food Fight and Disco Domination playlists the 14 Days used is read from
// Epic's later page (LawinServer's contentpages.json copy, 2019): the 14 Days' tiles, BR_LTM_<mode> as Unvaulted's and
// Siphon's, name Playlist_Barrier_16 (BR_LTM_FoodFight16), new in 7.10's paks, and Playlist_Disco_32_Alt
// (BR_LTM_HolidayDisco: the wiki's "During the 14 Days of Fortnite rerun of Disco Domination, it featured unique holiday
// tracks"), and Wild West's Squads BR_LTM_WildWest; Teams of 33's tile is BR07_14-DoF_Social (🟡 the playlists are read
// from the tiles' names, not from a schedule of Epic's). On by default (as 6.30's Content Update modes were): every 14
// Days mode, besides 7.00's 50v50, Playground, Team Rumble and Close Encounters; 7.00's other modes on 7.10 by their
// switches. Without Original dates every one of them is on at once, as Epic never ran them; with them, each on its day.
const build710 = 4667333;
// 7.20 (CL-4727874, Update v7.20, 15 January 2019), Season 7. Its Athena/Playlists (every playlist asset of its paks, all
// but the keyed pakchunk1001 and 1003) are 7.10's and nine more, the Ice Storm's: Playlist_Deimos_Solo_Winter, _Duo_Winter
// and _Squad_Winter (282 to 284, "Ice Storm", Athena.Playlist.Deimos.*: Battle Royale with the Ice Legion), their _WinterCN
// copies (285 to 287) and the in-game tournaments' _WinterShow (58288 to 58290). Its shipped DefaultGame.ini's lobby is
// 7.10's. Update v7.20: "Limited Time Mode: One Shot ... There's low gravity and every player has 50 health. Snipers are
// the only weapon and Bandages the only healing item" (One Shot's Squads, Playlist_Low_Squads: the press's "Squads
// gameplay"); the Ice Storm (the Fortnite Wiki: 19 January 2019, 11:00 AM PST) brought the Ice Legion to the map (gone
// with Update v7.30, 29 January: "Vaulted ... Ice Legion"), which 7.20's Ice Storm playlists put in Solo, Duos and Squads
// (replacing them, as 6.20's Fortnitemares playlists did); Content Update v7.20 (22 January): "Limited Time Mode: Sniper
// Shootout ... Reviving 'Down But Not Out' teammates in Duos & Squads is deactivated" (Solo, Duos and Squads,
// Playlist_Snipers_*). On by default, each by its Original dates (🟡 One Shot's and Sniper Shootout's ends are the next
// mode's day, no source gives them): One Shot from 15 to 22 January, Sniper Shootout from 22 to 29 January, the Ice Storm
// modes from the Ice Storm to 29 January. 7.10's 14 Days of Fortnite modes stay 7.10's ("The 14 Days of Fortnite event
// has ended"); 7.00's and 7.10's other modes run to 7.20 with their switches, but 7.00's Sniper Shootout (Solo, Squads),
// which 7.20's own entries below take over.
const build720 = 4727874;
// 7.30 (CL-4834550, Update v7.30, 29 January 2019), Season 7. Its Athena/Playlists (every playlist asset of its paks, all
// but the keyed pakchunk1000, 1003 and 1006) are 7.20's and six more: Playlist_Omaha (285, "NFL Rumble": Team Rumble's
// rules for the Big Game's two teams, two teams of 20 in squads of 4; 285 is also Playlist_Deimos_Solo_WinterCN's id, which
// Core doesn't serve) and Playlist_Music_Low, _Med, _High, _Higher and _Highest (321 to 325, "Party at Pleasant Park":
// "Drop in to Pleasant Park and enjoy the show. Respawn enabled.", Athena.Playlist.Concert: Showtime's own playlists, the
// only ones where BP_FestivusManager plays the concert, events/festivus.js; 48 to 100 players, two teams of 24 to 50 in
// squads of 4). Its shipped DefaultGame.ini's lobby is 7.20's and Playlist_Creative_TDM_v1, which no playlist asset of its
// paks is. The Fortnite Wiki: the Showtime concert on 2 February 2019 (11 AM and 11 PM PST), NFL Rumble's "release_date
// February 3rd 2019" (Super Bowl LIII's day), and Content Update v7.30 (5 February): "Limited Time Mode: Wild West Duos ...
// We've begun testing a new schedule for Limited Time Modes. Playlists will rotate every couple of days". On by default,
// each by its Original dates: Party at Pleasant Park from 2 February to the encore's end (07:10 UTC on the 3rd; 🟡 the
// playlist's own hours aren't recorded; Playlist_Music_Highest, the 100-player one, as no source says which of the five Epic ran), NFL Rumble from 3
// to 5 February and Wild West Duos from 5 to 7 February (🟡 the ends are the next rotation's day, as Content Update v7.30
// put it; no source gives them). 7.20's Ice Storm modes stay 7.20's (Update v7.30 vaulted the Ice Legion); 7.20's One
// Shot, and 7.00's to 7.10's other modes, run to 7.30 with their switches.
const build730 = 4834550;
// 7.40 (CL-5046157, Update v7.40, 14 February 2019), Season 7's last. Its Athena/Playlists (every playlist asset of its paks,
// all but the keyed pakchunk1000, 1001 and 1002) are 7.30's and 21 more: Playlist_Love_Solo, _Duos and _Squads (345 to 347,
// "Love Shot": "Low Gravity. Every player has 50 health. Cupid's Crossbow is the only weapon, Bandages are the only healing
// item"), Playlist_Sword_Solo, _Duos and _Squads (335 to 337, "Sword Fight": Epic or better weapons and the Infinity Blade
// in chests), Playlist_Toss_Solo, _Duos and _Squads (340 to 342, "Catch!": throwables only), Playlist_Hover (320, 2 × 40),
// Playlist_Hover_64 (326, 2 × 32) and Playlist_Hover_48 (348, "Driftin' 20's", 2 × 24; "Driftin'", Athena.Playlist.Hover.
// LargeTeam: Red Supply Drops with a Driftboard each), Playlist_Unvaulted_* (330 to 332), Playlist_Gungame_Solo and _Reverse
// (999, 1000, 20 players), Playlist_Showdown_Trios and Playlist_ShowdownAlt_Trios (58077, 58078: the tournaments' trios),
// and Creative's Playlist_Creative_PlayOnly and Playlist_Creative_TDM_v1 (35); Playlist_Trios now takes 100 players. Its
// shipped DefaultGame.ini's lobby is 7.30's. The Fortnite Wiki: Love Shot, Valentine's Day's (Update v7.40, 14 February
// 2019); Sword Fight's "release_date February 15th 2019" (Squads); Content Update v7.40 (19 February): "Limited Time Mode:
// Driftin' ... Two teams of 32 players" (Playlist_Hover_64) and "Limited Time Mode: Catch!" (Solo, Duos and Squads, the
// wiki's Throwdown). On by default, each by its Original dates: Love Shot (Duos, the wiki's two to a team) from 14 to 16
// February, Sword Fight (Squads) from 15 to 17 February, Catch! from 19 to 21 February (🟡 the ends are the rotation's two
// days, as Content Update v7.30 put it; no source gives them), and Driftin' from 19 February to the season's end (🟡 so the
// Overtime Challenges' "Play matches of Driftin' with a friend", from their ninth day, can be done). Their other playlists
// (Love Shot's Solo and Squads, Sword Fight's Solo and Duos, Driftin's 40 and 24 a side) by their switches; Unvaulted's,
// Gun Game's and the trios tournaments' aren't served (no record of Epic running them in Season 7; 7.40's Events tab asks
// Epic's events service, services/fortnite/events.js). 7.30's own modes stay 7.30's; 7.00's to 7.20's other modes run to
// 7.40 with their switches.
const build740 = 5046157;
const build800 = 5203069;
const build820 = 5625478;
const build840 = 6005771;
const season8Window = [{ builds: [build800, build840], start: "2019-02-28", end: "2019-05-09" }];
const season7Window = [{ builds: [build700, build740], start: "2018-12-06", end: "2019-02-28" }];
const loveShotWindow = [{ builds: [build740, build740], start: "2019-02-14", end: "2019-02-16" }];
const swordFightWindow = [{ builds: [build740, build740], start: "2019-02-15", end: "2019-02-17" }];
const catchWindow = [{ builds: [build740, build740], start: "2019-02-19", end: "2019-02-21" }];
const driftinWindow = [{ builds: [build740, build740], start: "2019-02-19", end: "2019-02-28" }];
const partyAtPleasantParkWindow = [{ builds: [build730, build730], start: "2019-02-02", end: Date.parse("2019-02-03T08:00:00Z") }];
const nflRumbleWindow = [{ builds: [build730, build730], start: "2019-02-03", end: "2019-02-05" }];
const wildWestDuos730Window = [{ builds: [build730, build730], start: "2019-02-05", end: "2019-02-07" }];
const oneShot720Window = [{ builds: [build720, build720], start: "2019-01-15", end: "2019-01-22" }];
const sniperShootout720Window = [{ builds: [build720, build720], start: "2019-01-22", end: "2019-01-29" }];
export const iceStormAt = Date.parse("2019-01-19T19:00:00Z");
const iceStormWindow = [{ builds: [build720, build720], start: iceStormAt, end: "2019-01-29" }];
const closeEncountersSeason7Window = [{ builds: [build700, build700], start: "2018-12-11", end: "2018-12-18" }];
const closeEncountersSeason7SquadsWindow = [...closeEncountersSeason7Window, { builds: [build700, build700], start: "2018-12-24", end: "2018-12-25" }];
const fourteenDays = (start, end) => [{ builds: [build700, build700], start, end }];
// 7.10's 14 Days of Fortnite days: day n from 14:00 UTC of 18 December + n, for `days` days.
const fourteenDaysStart = Date.parse("2018-12-19T14:00:00Z");
const fourteenDays710 = (day, days = 1) => [{ builds: [build710, build710], start: fourteenDaysStart + (day - 1) * 86400000,
  end: fourteenDaysStart + (day - 1 + days) * 86400000 }];
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
//   Encounters (4.2 to 4.4); Close Encounters on 25 May (4.2); Blitz v2 1 to 4 June (the lost 4.3's only: 4.4's paks have
//   no Blitz playlist) and Sniper Shootout v3 5 to 11 June (4.4, and the lost 4.3); Teams of 20 v2 12 to 25 June (4.4, 4.4.x); High Explosives v2 22 to 25 June (4.4.x);
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
      { builds: [build42, build42], start: "2018-05-22", end: "2018-06-12" }],
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
  // Update v4.30's Blitz! v2 (PongooDev/CoreV2#326) was 4.3's, which Core doesn't have, and 4.4's paks have no Blitz
  // playlist (no Playlist_Blitz_*, no Athena/Playlists/Blitz tables: Epic emptied Athena/Playlists for 4.4, above), so no
  // build Core knows can offer it: its builds and window are 4.3's alone. 4.2's Blitz (Squads, Solo, Duos) is Blitz v1's
  // tables.
  { id: "blitzV2", name: "Blitz v2", playlistId: null, playlistName: null, eventFlag: null, builds: ["4.3", "4.3"], seasons: [4],
    original: [{ builds: ["4.3", "4.3"], start: "2018-06-01", end: "2018-06-05" }],
    teams: "100 Teams × 4", description: "Blitz again (4.3's: no build Core has ships its playlist; 4.4's paks have none)." },
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
  // Update v4.50's Playground (4.5's new mode, on there whatever its switch): 27 June, pulled the next day for its servers
  // and back from 2 July (the Fortnite Wiki's Playground page) to the season's end.
  { id: "playground", name: "Playground", playlistId: 35, playlistName: "Playlist_Playground", eventFlag: null, builds: [build42, build50], seasons: [4, 5], newIn: [build450, build45],
    original: [{ builds: [build450, build45], start: "2018-06-27", end: "2018-06-28" }, { builds: [build450, build45], start: "2018-07-02", end: "2018-07-12" }],
    teams: "1 Team × 4", description: "An hour on the island with up to 3 friends: respawns unless the storm kills you, 10x resources, every chest (Playlist_Playground, 4.5's)." },
  // Update v4.40's 50v50 v3 (PongooDev/CoreV2#328): 4.4's Playlist_50v50 (PlaylistId 50: two teams of 50 in squads of 4,
  // bIsLargeTeamGame, a bus for each team, AirCraftBehavior OpposingAirCraftForEachTeam with its custom path's midpoint
  // 60,000 out, SafeZoneStartUp StartsWithWarmUp, StormEffectDelay 330, bDisplayFinalStormPosition, no placement rewards)
  // with its own Athena/Playlists/50v50 loot tiers, loot packages, game data and resource rates: the notes' new first
  // circle, supply drops in batches of 4 to 8, the default DBNO damage, +25% farming, double and triple ammo are those
  // tables', which the gameserver plays. The notes ("Large squad" mode: no profile stats) open on it with Sniper Shootout
  // v3, so it is 4.4.0's new mode (on there whatever its switch). On the replay it takes 50v50 v2's window of 22 May to 11
  // June on 4.4's builds (Core-Backend #258: 4.2 to 4.4), the asset being v3's there; 4.4.1 and 4.4.2 offer it by its
  // switch or that window.
  // 4.5's Playlist_50v50 is v3's still: by its switch, or 50v50's 4.5 window (27 June to 11 July) on the replay.
  { id: "fiftyFiftyV3", name: "50v50 v3", playlistId: 50, playlistName: "Playlist_50v50", eventFlag: null, builds: [build440, build45], seasons: [4], newIn: build440,
    original: [{ builds: [build440, build442], start: "2018-05-22", end: "2018-06-12" }, { builds: [build450, build45], start: "2018-06-27", end: "2018-07-12" }],
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
    teams: "5 Teams × 20", description: "The storm stops after its third circle; when the countdown ends, the team with the most players left wins (Playlist_Final_20)." },
  // Update v4.50's Final Fight Teams of 12: 4.5's Playlist_Final_12 (103), Final Fight's table and circles
  // (events/finalfight.js). By its switch: nothing found dates it (🟡).
  { id: "finalFightTeams12", name: "Final Fight: Teams of 12", playlistId: 103, playlistName: "Playlist_Final_12", eventFlag: null, builds: [build450, build45], seasons: [4],
    teams: "8 Teams × 12", description: "The storm stops after its third circle; when the countdown ends, the team with the most players left wins (Playlist_Final_12)." },
  // 5.0's Playlist_50v50 (above); 5.10's, 5.21's, 5.30's, 5.40's and 5.41's are the same asset. On by default (Core-Backend #314): every
  // Season 5 build's shipped DefaultGame.ini enables it in the lobby (FrontEndPlaylistData, ltmFrontEndPlaylists).
  { id: "fiftyFiftySeason5", name: "50v50 (Season 5)", playlistId: 50, playlistName: "Playlist_50v50", eventFlag: null, builds: [build500, build541], seasons: [5], defaultOn: true,
    teams: "2 Teams × 50", description: "Two teams of fifty, a bus each, extra loot; reviving a teammate earns XP (Playlist_50v50, 5.0's)." },
  // 5.10's Playground (5.21's to 5.41's and 6.00's to 6.10's too) and Fly Explosives (above). On by default (Core-Backend
  // #314): 5.10's, 5.21's, 5.30's and 6.00's to 6.10's shipped DefaultGame.ini enable Playlist_Playground in the lobby
  // (FrontEndPlaylistData, AdvertiseType Updated), as Epic ran it from 25 July to the season's end, and on through Season
  // 6. 6.01's has the custom options (above): the same playlist, so the same mode here.
  { id: "playgroundV2", name: "Playground v2", playlistId: 35, playlistName: "Playlist_Playground", eventFlag: null, builds: [build5100, build840], seasons: [5, 6, 7, 8], defaultOn: true,
    original: [{ builds: [build5100, build541], start: "2018-07-25", end: "2018-09-27" }, ...season6Window, ...season7Window, ...season8Window],
    teams: "4 Teams × 4", description: "Playground again, with team select: up to four players on up to four teams, respawns, 10x resources, golf carts (Playlist_Playground, 5.10's)." },
  { id: "flyExplosives", name: "Fly Explosives (Squads)", playlistId: 122, playlistName: "Playlist_FlyExplosives_Squads", eventFlag: null, builds: [build510, build510], seasons: [5], newIn: build510,
    original: [{ builds: [build510, build510], start: "2018-07-31", end: "2018-08-07" }],
    teams: "100 Teams × 4", description: "Explosive weapons only, with jetpacks on the floor; rocket ammo capped at 120 (Athena/Playlists/HighExplosives tables, 5.10's)." },
  { id: "flyExplosivesSolo", name: "Fly Explosives (Solo)", playlistId: 120, playlistName: "Playlist_FlyExplosives_Solo", eventFlag: null, builds: [build510, build510], seasons: [5],
    teams: "100 Teams × 1", description: "Explosive weapons only, with jetpacks on the floor (Playlist_FlyExplosives_Solo, 5.10's)." },
  { id: "flyExplosivesDuos", name: "Fly Explosives (Duos)", playlistId: 121, playlistName: "Playlist_FlyExplosives_Duos", eventFlag: null, builds: [build510, build510], seasons: [5],
    teams: "100 Teams × 2", description: "Explosive weapons only, with jetpacks on the floor (Playlist_FlyExplosives_Duos, 5.10's)." },
  // 5.21's Steady Storm (Update v5.20's), Soaring 50's and Sniper Shootout v4 (above).
  { id: "steadyStormSolo", name: "Steady Storm (Solo)", playlistId: 160, playlistName: "Playlist_Steady_Solo", eventFlag: null, builds: [build521, build521], seasons: [5],
    original: steadyStorm,
    teams: "100 Teams × 1", description: "One storm that closes in over 15 minutes, no safe zones, 10 damage a second (Athena/Playlists/SteadyStorm game data, 5.21's)." },
  { id: "steadyStormDuos", name: "Steady Storm (Duos)", playlistId: 161, playlistName: "Playlist_Steady_Duos", eventFlag: null, builds: [build521, build521], seasons: [5],
    original: steadyStorm,
    teams: "100 Teams × 2", description: "One storm that closes in over 15 minutes, no safe zones, 10 damage a second (Athena/Playlists/SteadyStorm game data, 5.21's)." },
  { id: "steadyStormSquads", name: "Steady Storm (Squads)", playlistId: 162, playlistName: "Playlist_Steady_Squads", eventFlag: null, builds: [build521, build521], seasons: [5],
    original: steadyStorm,
    teams: "100 Teams × 4", description: "One storm that closes in over 15 minutes, no safe zones, 10 damage a second (Athena/Playlists/SteadyStorm game data, 5.21's)." },
  { id: "soaring50s", name: "Soaring 50's", playlistId: 53, playlistName: "Playlist_Soaring_50s", eventFlag: null, builds: [build521, build740], seasons: [5, 6, 7], newIn: build521,
    original: [...update521Window, ...soaringSeason6Window],
    teams: "2 Teams × 50", description: "50v50 with glider redeploy from 10 m up, extra Impulse Grenades, Launch Pads and Bounce Pads; no profile stats (Playlist_Soaring_50s, 5.21's)." },
  { id: "sniperShootoutV4", name: "Sniper Shootout v4 (Squads)", playlistId: 41, playlistName: "Playlist_Snipers", eventFlag: null, builds: [build521, build521], seasons: [5],
    original: update521Window,
    teams: "100 Teams × 4", description: "Sniper Rifles only, the Heavy Sniper Rifle in and Scoped ARs out, half the floor loot, no down state (Athena/Playlists/Snipers tables, 5.21's)." },
  { id: "sniperShootoutV4Solo", name: "Sniper Shootout v4 (Solo)", playlistId: 39, playlistName: "Playlist_Snipers_Solo", eventFlag: null, builds: [build521, build521], seasons: [5],
    original: update521Window,
    teams: "100 Teams × 1", description: "Sniper Rifles only, the Heavy Sniper Rifle in and Scoped ARs out, no down state (Athena/Playlists/Snipers tables, 5.21's)." },
  { id: "sniperShootoutV4Duos", name: "Sniper Shootout v4 (Duos)", playlistId: 40, playlistName: "Playlist_Snipers_Duos", eventFlag: null, builds: [build521, build521], seasons: [5],
    original: update521Window,
    teams: "100 Teams × 2", description: "Sniper Rifles only, the Heavy Sniper Rifle in and Scoped ARs out, no down state (Athena/Playlists/Snipers tables, 5.21's)." },
  // 5.30's Score Royale (Update v5.30's: all three are new in 5.30) and Solid Gold (Content Update v5.30's; above).
  { id: "scoreRoyaleSolo", name: "Score Royale (Solo)", playlistId: 101, playlistName: "Playlist_Score_Solo", eventFlag: null, builds: [build530, build530], seasons: [5], newIn: build530,
    original: scoreRoyale,
    teams: "100 Teams × 1", description: "Points for coins, chests, ammo boxes, llamas, supply drops, foraged items and eliminations; the first to 2,000 wins (Playlist_Score_Solo, 5.30's)." },
  { id: "scoreRoyaleDuos", name: "Score Royale (Duos)", playlistId: 102, playlistName: "Playlist_Score_Duos", eventFlag: null, builds: [build530, build530], seasons: [5], newIn: build530,
    original: scoreRoyale,
    teams: "100 Teams × 2", description: "Points for coins, chests, ammo boxes, llamas, supply drops, foraged items and eliminations; the first team to 3,000 wins (Playlist_Score_Duos, 5.30's)." },
  { id: "scoreRoyaleSquads", name: "Score Royale (Squads)", playlistId: 103, playlistName: "Playlist_Score_Squads", eventFlag: null, builds: [build530, build530], seasons: [5], newIn: build530,
    original: scoreRoyale,
    teams: "100 Teams × 4", description: "Points for coins, chests, ammo boxes, llamas, supply drops, foraged items and eliminations; the first team to 4,500 wins (Playlist_Score_Squads, 5.30's)." },
  { id: "solidGoldSeason5", name: "Solid Gold (Season 5)", playlistId: 27, playlistName: "Playlist_SolidGold_Squads", eventFlag: null, builds: [build530, build530], seasons: [5],
    original: solidGold530,
    teams: "100 Teams × 4", description: "Legendary weapons only (Athena/Playlists/SolidGold tables, 5.30's)." },
  { id: "solidGoldSeason5Solo", name: "Solid Gold (Season 5, Solo)", playlistId: 26, playlistName: "Playlist_SolidGold_Solo", eventFlag: null, builds: [build530, build530], seasons: [5],
    teams: "100 Teams × 1", description: "Legendary weapons only, no down state (Athena/Playlists/SolidGold tables, 5.30's)." },
  { id: "solidGoldSeason5Duos", name: "Solid Gold (Season 5, Duos)", playlistId: 34, playlistName: "Playlist_SolidGold_Duos", eventFlag: null, builds: [build530, build530], seasons: [5],
    teams: "100 Teams × 2", description: "Legendary weapons only (Athena/Playlists/SolidGold tables, 5.30's)." },
  { id: "fiftyFiftySolidGold", name: "50v50 Solid Gold", playlistId: 1993, playlistName: "Playlist_50v50SAU", eventFlag: null, builds: [build530, build541], seasons: [5],
    original: solidGold530,
    teams: "2 Teams × 50", description: "50v50 with legendary weapons and items only (Athena/Playlists/50v50/50v50SAU tables, 5.30's)." },
  // 5.40's Getaway (Update v5.40's new mode) and Close Encounters (Update v5.41's; above), 5.41's too.
  { id: "getaway", name: "The Getaway (Squads)", playlistId: 142, playlistName: "Playlist_Bling_Squads", eventFlag: null, builds: [build540, build541], seasons: [5],
    advertise: "New", defaultOn: true,
    original: getawaySquads,
    teams: "100 Teams × 4", description: "Find a Jewel in a supply drop safe and escape in one of the floating getaway vans; the first four squads to escape win (Playlist_Bling_Squads, 5.40's)." },
  { id: "getawayDuos", name: "The Getaway (Duos)", playlistId: 141, playlistName: "Playlist_Bling_Duos", eventFlag: null, builds: [build540, build541], seasons: [5],
    advertise: "New", defaultOn: true,
    original: getawayDuos,
    teams: "100 Teams × 2", description: "Find a Jewel in a supply drop safe and escape in one of the floating getaway vans; the first four duos to escape win (Playlist_Bling_Duos, 5.40's)." },
  { id: "getawaySolo", name: "The Getaway (Solo)", playlistId: 140, playlistName: "Playlist_Bling_Solo", eventFlag: null, builds: [build540, build541], seasons: [5],
    advertise: "New",
    teams: "100 Teams × 1", description: "Find a Jewel in a supply drop safe and escape in one of the floating getaway vans; the first four players to escape win (Playlist_Bling_Solo, 5.40's)." },
  { id: "closeEncountersSeason5", name: "Close Encounters (Season 5, Squads)", playlistId: 46, playlistName: "Playlist_Close_Squad", eventFlag: null, builds: [build540, build541], seasons: [5],
    original: update541Window,
    teams: "100 Teams × 4", description: "Shotguns and jetpacks only, close quarters (Athena/Playlists/Shotguns tables; Update v5.41's)." },
  { id: "closeEncountersSeason5Solo", name: "Close Encounters (Season 5, Solo)", playlistId: 44, playlistName: "Playlist_Close_Solo", eventFlag: null, builds: [build540, build541], seasons: [5],
    teams: "100 Teams × 1", description: "Shotguns and jetpacks only, close quarters (Athena/Playlists/Shotguns tables; Update v5.41's)." },
  { id: "closeEncountersSeason5Duos", name: "Close Encounters (Season 5, Duos)", playlistId: 45, playlistName: "Playlist_Close_Duos", eventFlag: null, builds: [build540, build541], seasons: [5],
    teams: "100 Teams × 2", description: "Shotguns and jetpacks only, close quarters (Athena/Playlists/Shotguns tables; Update v5.41's)." },
  // 5.41's Soaring Solos (Update v5.41's new mode; above).
  { id: "soaringSolos", name: "Soaring Solos", playlistId: 185, playlistName: "Playlist_Soaring_Solo", eventFlag: null, builds: [build541, build541], seasons: [5],
    advertise: "New", defaultOn: true,
    original: update541Window,
    teams: "100 Teams × 1", description: "Classic Battle Royale with glider redeploy: press Jump when falling from a height (Playlist_Soaring_Solo, 5.41's)." },
  { id: "soaringDuos", name: "Soaring Duos", playlistId: 186, playlistName: "Playlist_Soaring_Duos", eventFlag: null, builds: [build541, build541], seasons: [5],
    advertise: "New",
    teams: "100 Teams × 2", description: "Classic Battle Royale with glider redeploy: press Jump when falling from a height (Playlist_Soaring_Duos, 5.41's)." },
  { id: "soaringSquads", name: "Soaring Squads", playlistId: 187, playlistName: "Playlist_Soaring_Squads", eventFlag: null, builds: [build541, build541], seasons: [5],
    advertise: "New",
    teams: "100 Teams × 4", description: "Classic Battle Royale with glider redeploy: press Jump when falling from a height (Playlist_Soaring_Squads, 5.41's)." },
  // 6.00's Playlist_50v50 (above), a new revision: glider redeploy ("Press jump to redeploy your glider when falling from large
  // heights"), so an LTM of its own, as 5.0's was. On by default: 6.00's shipped DefaultGame.ini enables it in the lobby.
  // 6.01's and 6.02's are the same asset, enabled the same way; 6.10's (above) is listed as a default playlist.
  { id: "fiftyFiftySeason6", name: "50v50 (Season 6)", playlistId: 50, playlistName: "Playlist_50v50", eventFlag: null, builds: [build6000, build631], seasons: [6], defaultOn: true,
    teams: "2 Teams × 50", description: "Two teams of fifty, a bus each, extra loot, and glider redeploy when falling from a height (Playlist_50v50, 6.00's)." },
  // 6.01's Playlist_Disco (above), Update v6.02's Disco Domination, in 6.01's paks already: by its switch, listed as New.
  { id: "discoDomination", name: "Disco Domination", playlistId: 202, playlistName: "Playlist_Disco", eventFlag: null, builds: [build6010, build601], seasons: [6],
    advertise: "New",
    teams: "2 Teams × 50", description: "Two teams of fifty capture dance floors by emoting on them; respawns until the last circle, glider redeploy, 50v50's loot (Playlist_Disco, in 6.01's paks; Update v6.02's mode)." },
  // 6.02's Disco Domination (above), Update v6.02's new mode: the same playlist, on by default there and listed as New,
  // so an LTM of its own beside 6.01's, which stays by its switch. Its 32 a side playlist, High Explosives and Steady
  // Storm by their switches (with Original dates, the 32 a side one by 6.22's and 6.30's, High Explosives by 6.31's:
  // #367). 6.10 keeps the mode (Update v6.10's "What's New?"), the 32 a side one and High Explosives;
  // Steady Storm's playlists are gone from its paks.
  { id: "discoDomination602", name: "Disco Domination (6.02 – 6.21)", playlistId: 202, playlistName: "Playlist_Disco", eventFlag: null, builds: [build6020, build621], seasons: [6],
    advertise: "New", defaultOn: true,
    original: discoDominationWindow,
    teams: "2 Teams × 50", description: "Two teams of fifty capture dance floors by emoting on them; respawns until the last circle, glider redeploy, 50v50's loot (Playlist_Disco, Update v6.02's mode; 6.10: fewer bandages, no Common weapons)." },
  { id: "discoDomination32", name: "Disco Domination (32 v 32)", playlistId: 217, playlistName: "Playlist_Disco_32", eventFlag: null, builds: [build6020, build740], seasons: [6, 7],
    advertise: "New", original: discoDomination32Window,
    teams: "2 Teams × 32", description: "Disco Domination with two teams of thirty-two, for 24 to 64 players (Playlist_Disco_32, 6.02's)." },
  { id: "highExplosivesSeason6Solo", name: "High Explosives (Season 6, Solo)", playlistId: 23, playlistName: "Playlist_HighExplosives_Solo", eventFlag: null, builds: [build6020, build631], seasons: [6],
    teams: "100 Teams × 1", description: "Explosive weapons everywhere! (Playlist_HighExplosives_Solo on the Fly Explosives tables, 6.02's).",
    original: highExplosivesSeason6Window },
  { id: "highExplosivesSeason6Squads", name: "High Explosives (Season 6, Squads)", playlistId: 24, playlistName: "Playlist_HighExplosives_Squads", eventFlag: null, builds: [build6020, build631], seasons: [6],
    teams: "100 Teams × 4", description: "Explosive weapons everywhere! (Athena/Playlists/HighExplosives tables, 6.02's).",
    original: highExplosivesSeason6Window },
  { id: "steadyStormSeason6Solo", name: "Steady Storm (Season 6, Solo)", playlistId: 160, playlistName: "Playlist_Steady_Solo", eventFlag: null, builds: [build6020, build602], seasons: [6],
    teams: "100 Teams × 1", description: "One storm that never stops closing in, no safe zones (Athena/Playlists/SteadyStorm game data, 6.02's)." },
  { id: "steadyStormSeason6Duos", name: "Steady Storm (Season 6, Duos)", playlistId: 161, playlistName: "Playlist_Steady_Duos", eventFlag: null, builds: [build6020, build602], seasons: [6],
    teams: "100 Teams × 2", description: "One storm that never stops closing in, no safe zones (Athena/Playlists/SteadyStorm game data, 6.02's)." },
  { id: "steadyStormSeason6Squads", name: "Steady Storm (Season 6, Squads)", playlistId: 162, playlistName: "Playlist_Steady_Squads", eventFlag: null, builds: [build6020, build602], seasons: [6],
    teams: "100 Teams × 4", description: "One storm that never stops closing in, no safe zones (Athena/Playlists/SteadyStorm game data, 6.02's)." },
  // 6.10's (above): two more Disco Dominations, Blitz! v2 and the default modes with glider redeploy, by their switches.
  { id: "discoDomination40", name: "Disco Domination (40 v 40)", playlistId: 218, playlistName: "Playlist_Disco_40", eventFlag: null, builds: [build6100, build621], seasons: [6],
    advertise: "New",
    teams: "2 Teams × 40", description: "Disco Domination with two teams of forty, for 24 to 80 players (Playlist_Disco_40, 6.10's)." },
  { id: "discoDominationAlt", name: "Disco Domination (Alt)", playlistId: 230, playlistName: "Playlist_Disco_Alt", eventFlag: null, builds: [build6100, build621], seasons: [6],
    advertise: "New",
    teams: "2 Teams × 50", description: "Disco Domination on its other modifier, DiscoGameModifierNoA (Playlist_Disco_Alt, 6.10's)." },
  { id: "blitzSeason6Solo", name: "Blitz! v2 (Season 6, Solo)", playlistId: 36, playlistName: "Playlist_Blitz_Solo", eventFlag: null, builds: [build6100, build622], seasons: [6],
    teams: "100 Teams × 1", description: "The storm closes in from the start, shorter waits between circles, extra loot and resources: matches of 15 minutes or less (Athena/Playlists/Blitz tables, 6.10's).",
    original: blitzSeason6Window },
  { id: "blitzSeason6Duos", name: "Blitz! v2 (Season 6, Duos)", playlistId: 37, playlistName: "Playlist_Blitz_Duos", eventFlag: null, builds: [build6100, build622], seasons: [6],
    teams: "100 Teams × 2", description: "The storm closes in from the start, shorter waits between circles, extra loot and resources: matches of 15 minutes or less (Athena/Playlists/Blitz tables, 6.10's).",
    original: blitzSeason6Window },
  { id: "blitzSeason6Squads", name: "Blitz! v2 (Season 6, Squads)", playlistId: 19, playlistName: "Playlist_Blitz_Squad", eventFlag: null, builds: [build6100, build622], seasons: [6],
    teams: "100 Teams × 4", description: "The storm closes in from the start, shorter waits between circles, extra loot and resources: matches of 15 minutes or less (Athena/Playlists/Blitz tables, 6.10's).",
    original: blitzSeason6Window },
  { id: "gliderRedeploySolo", name: "Solo with glider redeploy", playlistId: 223, playlistName: "Playlist_GRD_Solo", eventFlag: null, builds: [build6100, build610], seasons: [6],
    teams: "100 Teams × 1", description: "Solo with glider redeploy: press Jump when falling from a height (Playlist_GRD_Solo, 6.10's)." },
  { id: "gliderRedeployDuos", name: "Duos with glider redeploy", playlistId: 224, playlistName: "Playlist_GRD_Duos", eventFlag: null, builds: [build6100, build610], seasons: [6],
    teams: "100 Teams × 2", description: "Duos with glider redeploy: press Jump when falling from a height (Playlist_GRD_Duos, 6.10's)." },
  { id: "gliderRedeploySquads", name: "Squads with glider redeploy", playlistId: 225, playlistName: "Playlist_GRD_Squads", eventFlag: null, builds: [build6100, build610], seasons: [6],
    teams: "100 Teams × 4", description: "Squads with glider redeploy: press Jump when falling from a height (Playlist_GRD_Squads, 6.10's)." },
  // 6.10's Showdown playlists (above), the in-game tournaments' (tournaments/store.js): no lobby mode and no switch. The
  // lobby lists each as shipped, disabled, and a ticket for one is taken while a tournament event of it runs.
  { id: "showdownSolo", name: "Tournament (Solo)", playlistId: 58071, playlistName: "Playlist_Showdown_Solo", eventFlag: null, builds: [build6100, build740], seasons: [6, 7], tournament: true,
    teams: "100 Teams × 1", description: "The in-game tournaments' Solo playlist: points for placements and eliminations, shown in the match (Playlist_Showdown_Solo, 6.10's)." },
  { id: "showdownDuos", name: "Tournament (Duos)", playlistId: 58072, playlistName: "Playlist_Showdown_Duos", eventFlag: null, builds: [build6100, build740], seasons: [6, 7], tournament: true,
    teams: "100 Teams × 2", description: "The in-game tournaments' Duos playlist, for full duos (Playlist_Showdown_Duos, 6.10's)." },
  { id: "showdownSquads", name: "Tournament (Squads)", playlistId: 58073, playlistName: "Playlist_Showdown_Squads", eventFlag: null, builds: [build6100, build740], seasons: [6, 7], tournament: true,
    teams: "100 Teams × 4", description: "The in-game tournaments' Squads playlist, for full squads (Playlist_Showdown_Squads, 6.10's)." },
  // 6.20's (above): Fortnitemares, on by default by its Original dates, and two more Disco Dominations by their switches.
  { id: "fortnitemares2018Solo", name: "Fortnitemares (Solo)", playlistId: 47, playlistName: "Playlist_Deimos_Solo", eventFlag: null, builds: [build620, build621], seasons: [6],
    advertise: "New", defaultOn: true, original: fortnitemaresWindow, untilButterfly: true, replaces: "Playlist_DefaultSolo",
    teams: "100 Teams × 1", description: "Battle Royale with the Cube Monsters: Cube Fragments spawn Fiends and Brutes that drop loot and give shield (Playlist_Deimos_Solo, 6.20's)." },
  { id: "fortnitemares2018Duos", name: "Fortnitemares (Duos)", playlistId: 48, playlistName: "Playlist_Deimos_Duo", eventFlag: null, builds: [build620, build621], seasons: [6],
    advertise: "New", defaultOn: true, original: fortnitemaresTeamsWindow, untilButterfly: true, replaces: "Playlist_DefaultDuo",
    teams: "100 Teams × 2", description: "Battle Royale with the Cube Monsters, in duos (Playlist_Deimos_Duo, 6.20's)." },
  { id: "fortnitemares2018Squads", name: "Fortnitemares (Squads)", playlistId: 49, playlistName: "Playlist_Deimos_Squad", eventFlag: null, builds: [build620, build621], seasons: [6],
    advertise: "New", defaultOn: true, original: fortnitemaresTeamsWindow, untilButterfly: true, replaces: "Playlist_DefaultSquad",
    teams: "100 Teams × 4", description: "Battle Royale with the Cube Monsters, in squads (Playlist_Deimos_Squad, 6.20's)." },
  { id: "discoDomination40Alt", name: "Disco Domination (40 v 40, Alt)", playlistId: 231, playlistName: "Playlist_Disco_40_Alt", eventFlag: null, builds: [build620, build621], seasons: [6],
    teams: "2 Teams × 40", description: "Disco Domination with two teams of forty on DiscoGameModifierNoA (Playlist_Disco_40_Alt, 6.20's)." },
  { id: "discoDomination32Alt", name: "Disco Domination (32 v 32, Alt)", playlistId: 232, playlistName: "Playlist_Disco_32_Alt", eventFlag: null, builds: [build620, build621], seasons: [6],
    teams: "2 Teams × 32", description: "Disco Domination with two teams of thirty-two on DiscoGameModifierNoA (Playlist_Disco_32_Alt, 6.20's)." },
  // 6.20's Fortnitemares tournament playlists (above): in-game tournaments' as the Showdown ones, no lobby mode.
  { id: "fortnitemaresShowSolo", name: "Fortnitemares Tournament (Solo)", playlistId: 59071, playlistName: "Playlist_Deimos_SoloShow", eventFlag: null, builds: [build620, build621], seasons: [6], tournament: true,
    teams: "100 Teams × 1", description: "The in-game tournaments' Fortnitemares Solo playlist, with the Cube Monsters (Playlist_Deimos_SoloShow, 6.20's)." },
  { id: "fortnitemaresShowDuos", name: "Fortnitemares Tournament (Duos)", playlistId: 59072, playlistName: "Playlist_Deimos_DuoShow", eventFlag: null, builds: [build620, build621], seasons: [6], tournament: true,
    teams: "100 Teams × 2", description: "The in-game tournaments' Fortnitemares Duos playlist, for full duos (Playlist_Deimos_DuoShow, 6.20's)." },
  { id: "fortnitemaresShowSquads", name: "Fortnitemares Tournament (Squads)", playlistId: 59073, playlistName: "Playlist_Deimos_SquadShow", eventFlag: null, builds: [build620, build621], seasons: [6], tournament: true,
    teams: "100 Teams × 4", description: "The in-game tournaments' Fortnitemares Squads playlist, for full squads (Playlist_Deimos_SquadShow, 6.20's)." },
  // 6.22's Team Terror (above): on by default, listed as New, by its Original dates when those are on (6.22's alone: on
  // 6.30, whose paks keep it, by its switch, which is on unless the admin turns it off).
  { id: "teamTerror", name: "Team Terror", playlistId: 450, playlistName: "Playlist_Deimos_50", eventFlag: null, builds: [build622, build630], seasons: [6],
    advertise: "New", defaultOn: true, original: teamTerrorWindow,
    teams: "2 Teams × 32", description: "Two teams of thirty-two with the Cube Monsters: monster spawners across the map and at each new storm circle, gold monsters, Legendary drops, more loot and ammo, glider redeploy (Playlist_Deimos_50v50, 6.22's)." },
  // 6.30's (above): Food Fight and Wild West on by default, listed as New, by their Original dates when those are on; the
  // 12 a side Food Fight and 6.20's Disco Domination (32 v 32, Alt), back in 6.30's paks, by their switches; the Scavenger
  // Pop-Up Cup's tournament playlists.
  { id: "foodFight", name: "Food Fight", playlistId: 204, playlistName: "Playlist_Barrier", eventFlag: null, builds: [build630, build630], seasons: [6],
    advertise: "New", defaultOn: true, original: foodFightWindow,
    teams: "2 Teams × 24", description: "Durrr Burger against Pizza Pit: two teams build forts around their mascot while a barrier splits the map, then destroy the other team's mascot to win; respawns, no explosives (Playlist_Barrier, 6.30's)." },
  { id: "foodFight12", name: "Food Fight (12 v 12)", playlistId: 206, playlistName: "Playlist_Barrier_12", eventFlag: null, builds: [build630, build630], seasons: [6],
    advertise: "New",
    teams: "2 Teams × 12", description: "Food Fight with two teams of twelve, for 18 to 24 players (Playlist_Barrier_12, 6.30's)." },
  { id: "wildWestSolo", name: "Wild West (Solo)", playlistId: 900, playlistName: "Playlist_WW_Solo", eventFlag: null, builds: [build630, build630], seasons: [6],
    advertise: "New", defaultOn: true, original: wildWestWindow,
    teams: "100 Teams × 1", description: "Battle Royale with frontier weapons only: Hunting Rifles, Pump and Double Barrel Shotguns, Six Shooters and Dynamite (Playlist_WW_Solo, 6.30's)." },
  { id: "wildWestDuos", name: "Wild West (Duos)", playlistId: 901, playlistName: "Playlist_WW_Duos", eventFlag: null, builds: [build630, build630], seasons: [6],
    advertise: "New", defaultOn: true, original: wildWestWindow,
    teams: "100 Teams × 2", description: "Wild West in duos (Playlist_WW_Duo, 6.30's)." },
  { id: "wildWestSquads", name: "Wild West (Squads)", playlistId: 902, playlistName: "Playlist_WW_Squads", eventFlag: null, builds: [build630, build630], seasons: [6],
    advertise: "New", defaultOn: true, original: wildWestWindow,
    teams: "100 Teams × 4", description: "Wild West in squads (Playlist_WW_Squad, 6.30's)." },
  { id: "discoDomination32Alt630", name: "Disco Domination (32 v 32, Alt; 6.30, 6.31)", playlistId: 232, playlistName: "Playlist_Disco_32_Alt", eventFlag: null, builds: [build630, build700], seasons: [6, 7],
    teams: "2 Teams × 32", description: "6.20's Disco Domination with two teams of thirty-two on DiscoGameModifierNoA, back in 6.30's paks and kept in 6.31's (Playlist_Disco_32_Alt)." },
  { id: "scavengerSolo", name: "Pop-Up Cup (Solo)", playlistId: 58074, playlistName: "Playlist_ShowdownAlt_Solo", eventFlag: null, builds: [build630, build740], seasons: [6, 7], tournament: true,
    teams: "100 Teams × 1", description: "The in-game tournaments' Solo playlist of the Pop-Up Cups: 6.30's Scavenger, 6.31's Alchemist (Playlist_ShowdownAlt_Solo)." },
  { id: "scavengerDuos", name: "Pop-Up Cup (Duos)", playlistId: 58075, playlistName: "Playlist_ShowdownAlt_Duos", eventFlag: null, builds: [build630, build740], seasons: [6, 7], tournament: true,
    teams: "100 Teams × 2", description: "The in-game tournaments' Duos playlist of the Pop-Up Cups (6.30's Scavenger, 6.31's Alchemist), for full duos (Playlist_ShowdownAlt_Duos)." },
  { id: "scavengerSquads", name: "Pop-Up Cup (Squads)", playlistId: 58076, playlistName: "Playlist_ShowdownAlt_Squads", eventFlag: null, builds: [build630, build740], seasons: [6, 7], tournament: true,
    teams: "100 Teams × 4", description: "The in-game tournaments' Squads playlist of the Pop-Up Cups (6.30's Scavenger, 6.31's Alchemist), for full squads (Playlist_ShowdownAlt_Squads)." },
  // 6.31's (above): Team Rumble on by default, listed as New, by its Original dates when those are on.
  { id: "teamRumble", name: "Team Rumble", playlistId: 280, playlistName: "Playlist_Respawn_24", eventFlag: null, builds: [build631, build740], seasons: [6, 7],
    advertise: "New", defaultOn: true, original: [...teamRumbleWindow, ...fourteenDays("2018-12-25", "2018-12-27"), ...fourteenDays710(7, 2)],
    teams: "2 Teams × 20", description: "Two teams of twenty, a bus each: respawn after 5 seconds with your inventory, eliminated players drop ammo and materials, Uncommon weapons or better; the first team to 100 eliminations wins (Playlist_Respawn_24, 6.31's)." },
  // 7.00's (CL-4629139; above): 50v50, Playground (above), Team Rumble (above) and Update v7.01's Close Encounters on by
  // default, the others by their switches, each by its Original dates when those are on.
  { id: "fiftyFiftySeason7", name: "50v50 (Season 7)", playlistId: 50, playlistName: "Playlist_50v50", eventFlag: null, builds: [build700, build740], seasons: [7], defaultOn: true,
    teams: "2 Teams × 50", description: "Two teams of fifty, a bus each, extra loot, and glider redeploy when falling from a height (Playlist_50v50, 7.00's)." },
  { id: "closeEncountersSeason7Squads", name: "Close Encounters (Season 7, Squads)", playlistId: 46, playlistName: "Playlist_Close_Squad", eventFlag: null, builds: [build700, build740], seasons: [7],
    advertise: "New", defaultOn: true, original: [...closeEncountersSeason7SquadsWindow, ...fourteenDays710(6)],
    teams: "100 Teams × 4", description: "Shotguns only, with jetpacks and Heavy Shotguns in chests and supply drops and a faster storm late in the match (Playlist_Close_Squad, 7.00's; Update v7.01's mode)." },
  { id: "closeEncountersSeason7Solo", name: "Close Encounters (Season 7, Solo)", playlistId: 44, playlistName: "Playlist_Close_Solo", eventFlag: null, builds: [build700, build740], seasons: [7],
    advertise: "New", defaultOn: true, original: closeEncountersSeason7Window,
    teams: "100 Teams × 1", description: "Shotguns and jetpacks only, close quarters (Playlist_Close_Solo, 7.00's; Update v7.01's mode)." },
  { id: "closeEncountersSeason7Duos", name: "Close Encounters (Season 7, Duos)", playlistId: 45, playlistName: "Playlist_Close_Duos", eventFlag: null, builds: [build700, build740], seasons: [7],
    advertise: "New", defaultOn: true, original: closeEncountersSeason7Window,
    teams: "100 Teams × 2", description: "Shotguns and jetpacks only, close quarters (Playlist_Close_Duos, 7.00's; Update v7.01's mode)." },
  { id: "highExplosivesSeason7Solo", name: "High Explosives (Season 7, Solo)", playlistId: 23, playlistName: "Playlist_HighExplosives_Solo", eventFlag: null, builds: [build700, build740], seasons: [7],
    teams: "100 Teams × 1", description: "Explosive weapons only (Playlist_HighExplosives_Solo, 7.00's)." },
  { id: "highExplosivesSeason7Squads", name: "High Explosives (Season 7, Squads)", playlistId: 24, playlistName: "Playlist_HighExplosives_Squads", eventFlag: null, builds: [build700, build700], seasons: [7],
    original: fourteenDays("2018-12-31", "2019-01-01"),
    teams: "100 Teams × 4", description: "Explosive weapons only: the 14 Days of Fortnite's day 13 (Playlist_HighExplosives_Squads, 7.00's)." },
  { id: "unvaultedSquads", name: "Unvaulted (Squads)", playlistId: 216, playlistName: "Playlist_Classic_Squads", eventFlag: null, builds: [build700, build700], seasons: [7],
    original: fourteenDays("2018-12-19", "2018-12-20"),
    teams: "100 Teams × 4", description: "Battle Royale with vaulted weapons back in the loot: the 14 Days of Fortnite's day 1 (Playlist_Classic_Squads, \"Classic Squads\", 7.00's)." },
  { id: "unvaultedSolo", name: "Unvaulted (Solo)", playlistId: 214, playlistName: "Playlist_Classic_Solo", eventFlag: null, builds: [build700, build740], seasons: [7],
    teams: "100 Teams × 1", description: "Battle Royale with vaulted weapons back in the loot (Playlist_Classic_Solo, \"Classic Solos\", 7.00's)." },
  { id: "unvaultedDuos", name: "Unvaulted (Duos)", playlistId: 215, playlistName: "Playlist_Classic_Duos", eventFlag: null, builds: [build700, build740], seasons: [7],
    teams: "100 Teams × 2", description: "Battle Royale with vaulted weapons back in the loot (Playlist_Classic_Duos, \"Classic Duos\", 7.00's)." },
  { id: "siphonSolo", name: "Siphon (Solo)", playlistId: 265, playlistName: "Playlist_Vamp_Solo", eventFlag: null, builds: [build700, build700], seasons: [7],
    original: fourteenDays("2018-12-20", "2018-12-21"),
    teams: "100 Teams × 1", description: "Eliminations restore health and shield: the 14 Days of Fortnite's day 2 (Playlist_Vamp_Solo, \"Vamp\", 7.00's)." },
  { id: "siphonDuos", name: "Siphon (Duos)", playlistId: 266, playlistName: "Playlist_Vamp_Duo", eventFlag: null, builds: [build700, build740], seasons: [7],
    teams: "100 Teams × 2", description: "Eliminations restore health and shield (Playlist_Vamp_Duo, \"Vamp\", 7.00's)." },
  { id: "siphonSquads", name: "Siphon (Squads)", playlistId: 267, playlistName: "Playlist_Vamp_Squad", eventFlag: null, builds: [build700, build740], seasons: [7],
    teams: "100 Teams × 4", description: "Eliminations restore health and shield (Playlist_Vamp_Squad, \"Vamp\", 7.00's)." },
  { id: "sniperShootoutSeason7Duos", name: "Sniper Shootout (Season 7, Duos)", playlistId: 40, playlistName: "Playlist_Snipers_Duos", eventFlag: null, builds: [build700, build700], seasons: [7],
    original: fourteenDays("2018-12-23", "2018-12-24"),
    teams: "100 Teams × 2", description: "Sniper rifles and revolvers only: the 14 Days of Fortnite's day 5 (Playlist_Snipers_Duos, 7.00's)." },
  { id: "sniperShootoutSeason7Solo", name: "Sniper Shootout (Season 7, Solo)", playlistId: 39, playlistName: "Playlist_Snipers_Solo", eventFlag: null, builds: [build700, build710], seasons: [7],
    teams: "100 Teams × 1", description: "Sniper rifles and revolvers only (Playlist_Snipers_Solo, 7.00's)." },
  { id: "sniperShootoutSeason7Squads", name: "Sniper Shootout (Season 7, Squads)", playlistId: 41, playlistName: "Playlist_Snipers", eventFlag: null, builds: [build700, build710], seasons: [7],
    teams: "100 Teams × 4", description: "Sniper rifles and revolvers only (Playlist_Snipers, 7.00's)." },
  { id: "soaringSeason7Solo", name: "Soaring Solos (Season 7)", playlistId: 185, playlistName: "Playlist_Soaring_Solo", eventFlag: null, builds: [build700, build740], seasons: [7],
    teams: "100 Teams × 1", description: "Classic Battle Royale with glider redeploy (Playlist_Soaring_Solo, back in 7.00's paks)." },
  { id: "soaringSeason7Duos", name: "Soaring Duos (Season 7)", playlistId: 186, playlistName: "Playlist_Soaring_Duos", eventFlag: null, builds: [build700, build740], seasons: [7],
    teams: "100 Teams × 2", description: "Classic Battle Royale with glider redeploy (Playlist_Soaring_Duos, back in 7.00's paks)." },
  { id: "soaringSeason7Squads", name: "Soaring Squads (Season 7)", playlistId: 187, playlistName: "Playlist_Soaring_Squads", eventFlag: null, builds: [build700, build740], seasons: [7],
    teams: "100 Teams × 4", description: "Classic Battle Royale with glider redeploy (Playlist_Soaring_Squads, back in 7.00's paks)." },
  // 7.10's (CL-4667333; above): the 14 Days of Fortnite's modes, on by default, each by its day when Original dates is on
  // (Team Rumble and Close Encounters (Squads) are 7.00's entries above, with their 7.10 days).
  { id: "teamsOf33", name: "Teams of 33", playlistId: 151, playlistName: "Playlist_33", eventFlag: null, builds: [build710, build710], seasons: [7],
    advertise: "New", defaultOn: true, original: fourteenDays710(1, 2),
    teams: "3 Teams × 33", description: "Three teams of thirty-three, a bus each, extra loot and resources and a more lethal storm: the 14 Days of Fortnite's days 1 and 2 (Playlist_33, 7.10's)." },
  { id: "unvaultedSquads710", name: "Unvaulted (Squads; 7.10)", playlistId: 216, playlistName: "Playlist_Classic_Squads", eventFlag: null, builds: [build710, build710], seasons: [7],
    defaultOn: true, original: fourteenDays710(1),
    teams: "100 Teams × 4", description: "Only the weapons and items of the game's first two seasons: the 14 Days of Fortnite's day 1 (Playlist_Classic_Squads, 7.10's)." },
  { id: "siphonSolo710", name: "Siphon (Solo; 7.10)", playlistId: 265, playlistName: "Playlist_Vamp_Solo", eventFlag: null, builds: [build710, build710], seasons: [7],
    defaultOn: true, original: fourteenDays710(2),
    teams: "100 Teams × 1", description: "Eliminations restore health and shield: the 14 Days of Fortnite's day 2 (Playlist_Vamp_Solo, 7.10's)." },
  { id: "teamTerror710", name: "Team Terror (7.10)", playlistId: 450, playlistName: "Playlist_Deimos_50", eventFlag: null, builds: [build710, build710], seasons: [7],
    defaultOn: true, original: fourteenDays710(3, 2),
    teams: "2 Teams × 32", description: "Two teams of thirty-two with Cube Monsters joining the fight: the 14 Days of Fortnite's days 3 and 4 (Playlist_Deimos_50, back in 7.10's paks)." },
  { id: "barebonesSquads", name: "Barebones (Squads)", playlistId: 242, playlistName: "Playlist_Hard_Squads", eventFlag: null, builds: [build710, build710], seasons: [7],
    advertise: "New", defaultOn: true, original: fourteenDays710(3),
    teams: "100 Teams × 4", description: "The map, compass, storm timer and much of the HUD turned off: the 14 Days of Fortnite's day 3 (Playlist_Hard_Squads, 7.10's)." },
  { id: "slideSolo", name: "Slide (Solo)", playlistId: 160, playlistName: "Playlist_Slide_Solo", eventFlag: null, builds: [build710, build710], seasons: [7],
    advertise: "New", defaultOn: true, original: fourteenDays710(4),
    teams: "100 Teams × 1", description: "Ice blocks on everyone's feet and an infinite-ammo Grappler each: the 14 Days of Fortnite's day 4 (Playlist_Slide_Solo, 7.10's)." },
  { id: "holidayDisco", name: "Disco Domination (Holiday; 7.10)", playlistId: 232, playlistName: "Playlist_Disco_32_Alt", eventFlag: null, builds: [build710, build710], seasons: [7],
    defaultOn: true, original: fourteenDays710(5, 2),
    teams: "2 Teams × 32", description: "Disco Domination, two teams of thirty-two, with holiday tracks: the 14 Days of Fortnite's days 5 and 6 (Playlist_Disco_32_Alt, 7.10's)." },
  { id: "sniperShootoutDuos710", name: "Sniper Shootout (Duos; 7.10)", playlistId: 40, playlistName: "Playlist_Snipers_Duos", eventFlag: null, builds: [build710, build710], seasons: [7],
    defaultOn: true, original: fourteenDays710(5),
    teams: "100 Teams × 2", description: "Sniper rifles and revolvers only: the 14 Days of Fortnite's day 5 (Playlist_Snipers_Duos, 7.10's)." },
  { id: "solidGoldSquads710", name: "Solid Gold (Squads; 7.10)", playlistId: 27, playlistName: "Playlist_SolidGold_Squads", eventFlag: null, builds: [build710, build710], seasons: [7],
    defaultOn: true, original: fourteenDays710(7),
    teams: "100 Teams × 4", description: "Legendary weapons only: the 14 Days of Fortnite's day 7 (Playlist_SolidGold_Squads, back in 7.10's paks)." },
  { id: "scoreRoyaleDuos710", name: "Score Royale (Duos; 7.10)", playlistId: 102, playlistName: "Playlist_Score_Duos", eventFlag: null, builds: [build710, build710], seasons: [7],
    defaultOn: true, original: fourteenDays710(8),
    teams: "100 Teams × 2", description: "Points for coins, loot containers, foraged items and eliminations; the first to the Winning Score wins: the 14 Days of Fortnite's day 8 (Playlist_Score_Duos, back in 7.10's paks)." },
  { id: "foodFight16", name: "Food Fight (16 v 16)", playlistId: 207, playlistName: "Playlist_Barrier_16", eventFlag: null, builds: [build710, build710], seasons: [7],
    defaultOn: true, original: fourteenDays710(9, 2),
    teams: "2 Teams × 16", description: "Durrburger against Pete's Pizza, a barrier down the middle: build a fort round your mascot, then destroy theirs once it lowers: the 14 Days of Fortnite's days 9 and 10 (Playlist_Barrier_16, 7.10's)." },
  { id: "groundGameSquads", name: "Ground Game (Squads)", playlistId: 112, playlistName: "Playlist_Ground_Squads", eventFlag: null, builds: [build710, build710], seasons: [7],
    advertise: "New", defaultOn: true, original: fourteenDays710(9),
    teams: "100 Teams × 4", description: "Fewer building materials and less ammo can be carried: the 14 Days of Fortnite's day 9 (Playlist_Ground_Squads, 7.10's)." },
  { id: "sneakySilencersSolo710", name: "Sneaky Silencers (Solo; 7.10)", playlistId: 260, playlistName: "Playlist_Sneaky_Solo", eventFlag: null, builds: [build710, build710], seasons: [7],
    defaultOn: true, original: fourteenDays710(10),
    teams: "100 Teams × 1", description: "Suppressed weapons and stealth (\"Shhhhh be very very quiet!\"): the 14 Days of Fortnite's day 10 (Playlist_Sneaky_Solo, 7.10's)." },
  { id: "closeEncounters50s", name: "Close Encounters 50's", playlistId: 4750, playlistName: "Playlist_Close_50", eventFlag: null, builds: [build710, build710], seasons: [7],
    advertise: "New", defaultOn: true, original: fourteenDays710(11, 2),
    teams: "2 Teams × 50", description: "Two teams of fifty with Shotguns and Jetpacks only: the 14 Days of Fortnite's days 11 and 12 (Playlist_Close_50, 7.10's)." },
  { id: "wildWestSquads710", name: "Wild West (Squads; 7.10)", playlistId: 902, playlistName: "Playlist_WW_Squads", eventFlag: null, builds: [build710, build710], seasons: [7],
    defaultOn: true, original: fourteenDays710(11),
    teams: "100 Teams × 4", description: "Shotguns, Six Shooters, Hunting Rifles and Dynamite: the 14 Days of Fortnite's day 11 (Playlist_WW_Squads, back in 7.10's paks)." },
  { id: "steadyStormSolo710", name: "Steady Storm (Solo; 7.10)", playlistId: 160, playlistName: "Playlist_Steady_Solo", eventFlag: null, builds: [build710, build710], seasons: [7],
    defaultOn: true, original: fourteenDays710(12),
    teams: "100 Teams × 1", description: "The storm never stops closing in: the 14 Days of Fortnite's day 12 (Playlist_Steady_Solo, back in 7.10's paks)." },
  { id: "highExplosives50s", name: "High Explosives 50's", playlistId: 203, playlistName: "Playlist_50v50HE", eventFlag: null, builds: [build710, build710], seasons: [7],
    advertise: "New", defaultOn: true, original: fourteenDays710(13, 2),
    teams: "2 Teams × 50", description: "Two teams of fifty with explosive weapons only, extra loot and a shorter match: the 14 Days of Fortnite's days 13 and 14 (Playlist_50v50HE, 7.10's)." },
  { id: "highExplosivesSquads710", name: "High Explosives (Squads; 7.10)", playlistId: 24, playlistName: "Playlist_HighExplosives_Squads", eventFlag: null, builds: [build710, build710], seasons: [7],
    defaultOn: true, original: fourteenDays710(13),
    teams: "100 Teams × 4", description: "Explosive weapons only: the 14 Days of Fortnite's day 13 (Playlist_HighExplosives_Squads, 7.10's)." },
  { id: "oneShotSquads", name: "One Shot (Squads)", playlistId: 252, playlistName: "Playlist_Low_Squads", eventFlag: null, builds: [build710, build710], seasons: [7],
    advertise: "New", defaultOn: true, original: fourteenDays710(14),
    teams: "100 Teams × 4", description: "Low gravity, 50 health, sniper rifles only and Bandages the only healing: the 14 Days of Fortnite's day 14 (Playlist_Low_Squads, 7.10's)." },
  // 7.20's (CL-4727874; above): One Shot, the Ice Storm's Solo, Duos and Squads (in place of the default ones while they are
  // on) and Content Update v7.20's Sniper Shootout, on by default, each by its Original dates when those are on; the Ice
  // Storm's tournament playlists. 7.30's paks are 7.20's plus six and 7.40's are 7.30's plus 21, so Playlist_Low_Squads stays
  // in both: One Shot runs on 7.30 and 7.40 too, by its switch (Core-Backend #397).
  { id: "oneShotSquads720", name: "One Shot (Squads; 7.20)", playlistId: 252, playlistName: "Playlist_Low_Squads", eventFlag: null, builds: [build720, build740], seasons: [7],
    advertise: "New", defaultOn: true, original: oneShot720Window,
    teams: "100 Teams × 4", description: "Low gravity, 50 health, sniper rifles only and Bandages the only healing, the storm's waits much shorter: Update v7.20's limited time mode (Playlist_Low_Squads, kept by 7.30's and 7.40's paks)." },
  { id: "iceStormSolo", name: "Ice Storm (Solo)", playlistId: 282, playlistName: "Playlist_Deimos_Solo_Winter", eventFlag: null, builds: [build720, build720], seasons: [7],
    advertise: "New", defaultOn: true, original: iceStormWindow, fromIceStorm: true, replaces: "Playlist_DefaultSolo",
    teams: "100 Teams × 1", description: "Battle Royale with the Ice Legion, Ice Fiends and Brutes across the island after the Ice Storm (Playlist_Deimos_Solo_Winter, 7.20's)." },
  { id: "iceStormDuos", name: "Ice Storm (Duos)", playlistId: 283, playlistName: "Playlist_Deimos_Duo_Winter", eventFlag: null, builds: [build720, build720], seasons: [7],
    advertise: "New", defaultOn: true, original: iceStormWindow, fromIceStorm: true, replaces: "Playlist_DefaultDuo",
    teams: "100 Teams × 2", description: "Battle Royale with the Ice Legion, in duos (Playlist_Deimos_Duo_Winter, 7.20's)." },
  { id: "iceStormSquads", name: "Ice Storm (Squads)", playlistId: 284, playlistName: "Playlist_Deimos_Squad_Winter", eventFlag: null, builds: [build720, build720], seasons: [7],
    advertise: "New", defaultOn: true, original: iceStormWindow, fromIceStorm: true, replaces: "Playlist_DefaultSquad",
    teams: "100 Teams × 4", description: "Battle Royale with the Ice Legion, in squads (Playlist_Deimos_Squad_Winter, 7.20's)." },
  { id: "sniperShootoutSolo720", name: "Sniper Shootout (Solo; 7.20)", playlistId: 39, playlistName: "Playlist_Snipers_Solo", eventFlag: null, builds: [build720, build720], seasons: [7],
    defaultOn: true, original: sniperShootout720Window,
    teams: "100 Teams × 1", description: "Scoped weapons only, Suppressed Sniper Rifles added and Legendary Scoped Revolvers in supply drops: Content Update v7.20's limited time mode (Playlist_Snipers_Solo)." },
  { id: "sniperShootoutDuos720", name: "Sniper Shootout (Duos; 7.20)", playlistId: 40, playlistName: "Playlist_Snipers_Duos", eventFlag: null, builds: [build720, build720], seasons: [7],
    defaultOn: true, original: sniperShootout720Window,
    teams: "100 Teams × 2", description: "Scoped weapons only, no reviving Down But Not Out teammates: Content Update v7.20's limited time mode (Playlist_Snipers_Duos)." },
  { id: "sniperShootoutSquads720", name: "Sniper Shootout (Squads; 7.20)", playlistId: 41, playlistName: "Playlist_Snipers", eventFlag: null, builds: [build720, build720], seasons: [7],
    defaultOn: true, original: sniperShootout720Window,
    teams: "100 Teams × 4", description: "Scoped weapons only, no reviving Down But Not Out teammates: Content Update v7.20's limited time mode (Playlist_Snipers)." },
  { id: "iceStormShowSolo", name: "Ice Storm Tournament (Solo)", playlistId: 58288, playlistName: "Playlist_Deimos_Solo_WinterShow", eventFlag: null, builds: [build720, build720], seasons: [7], tournament: true,
    teams: "100 Teams × 1", description: "The in-game tournaments' Solo playlist with the Ice Legion (Playlist_Deimos_Solo_WinterShow, 7.20's)." },
  { id: "iceStormShowDuos", name: "Ice Storm Tournament (Duos)", playlistId: 58289, playlistName: "Playlist_Deimos_Duo_WinterShow", eventFlag: null, builds: [build720, build720], seasons: [7], tournament: true,
    teams: "100 Teams × 2", description: "The in-game tournaments' Duos playlist with the Ice Legion, for full duos (Playlist_Deimos_Duo_WinterShow, 7.20's)." },
  { id: "iceStormShowSquads", name: "Ice Storm Tournament (Squads)", playlistId: 58290, playlistName: "Playlist_Deimos_Squad_WinterShow", eventFlag: null, builds: [build720, build720], seasons: [7], tournament: true,
    teams: "100 Teams × 4", description: "The in-game tournaments' Squads playlist with the Ice Legion, for full squads (Playlist_Deimos_Squad_WinterShow, 7.20's)." },
  // 7.30's (CL-4834550; above): Party at Pleasant Park (Showtime's concert), NFL Rumble and Content Update v7.30's Wild West
  // Duos, on by default, each by its Original dates when those are on.
  { id: "partyAtPleasantPark", name: "Party at Pleasant Park", playlistId: 325, playlistName: "Playlist_Music_Highest", eventFlag: null, builds: [build730, build730], seasons: [7],
    advertise: "New", defaultOn: true, original: partyAtPleasantParkWindow,
    teams: "2 Teams × 50", description: "Drop in to Pleasant Park and enjoy the show, respawn on: the only mode that plays Showtime, Marshmello's concert, at its times (Playlist_Music_Highest, 7.30's)." },
  { id: "nflRumble", name: "NFL Rumble", playlistId: 285, playlistName: "Playlist_Omaha", eventFlag: null, builds: [build730, build730], seasons: [7],
    advertise: "New", defaultOn: true, original: nflRumbleWindow,
    teams: "2 Teams × 20", description: "Team Rumble for the Big Game: two teams of 20, the Los Angeles Rams and the New England Patriots, respawn until one reaches 100 eliminations (Playlist_Omaha, 7.30's)." },
  { id: "wildWestDuos730", name: "Wild West (Duos; 7.30)", playlistId: 901, playlistName: "Playlist_WW_Duos", eventFlag: null, builds: [build730, build730], seasons: [7],
    defaultOn: true, original: wildWestDuos730Window,
    teams: "100 Teams × 2", description: "Battle Royale with frontier weapons only, in duos: Content Update v7.30's limited time mode (Playlist_WW_Duos)." },
  // 7.40's (CL-5046157; above): Love Shot, Sword Fight, Catch! and Content Update v7.40's Driftin', on by default, each by its
  // Original dates when those are on; their other playlists by their switches.
  { id: "loveShotDuos", name: "Love Shot (Duos)", playlistId: 346, playlistName: "Playlist_Love_Duos", eventFlag: null, builds: [build740, build740], seasons: [7],
    advertise: "New", defaultOn: true, original: loveShotWindow,
    teams: "100 Teams × 2", description: "Low gravity, 50 health, Cupid's Crossbow the only weapon and Bandages the only healing: Valentine's Day's limited time mode (Playlist_Love_Duos, 7.40's)." },
  { id: "loveShotSolo", name: "Love Shot (Solo)", playlistId: 345, playlistName: "Playlist_Love_Solo", eventFlag: null, builds: [build740, build740], seasons: [7],
    teams: "100 Teams × 1", description: "Low gravity, 50 health, Cupid's Crossbow the only weapon (Playlist_Love_Solo, 7.40's)." },
  { id: "loveShotSquads", name: "Love Shot (Squads)", playlistId: 347, playlistName: "Playlist_Love_Squads", eventFlag: null, builds: [build740, build740], seasons: [7],
    teams: "100 Teams × 4", description: "Low gravity, 50 health, Cupid's Crossbow the only weapon (Playlist_Love_Squads, 7.40's)." },
  { id: "swordFightSquads", name: "Sword Fight (Squads)", playlistId: 337, playlistName: "Playlist_Sword_Squads", eventFlag: null, builds: [build740, build740], seasons: [7],
    advertise: "New", defaultOn: true, original: swordFightWindow,
    teams: "100 Teams × 4", description: "Epic or better weapons in chests, now and then an Infinity Blade, a faster storm (Playlist_Sword_Squads, 7.40's)." },
  { id: "swordFightSolo", name: "Sword Fight (Solo)", playlistId: 335, playlistName: "Playlist_Sword_Solo", eventFlag: null, builds: [build740, build740], seasons: [7],
    teams: "100 Teams × 1", description: "Epic or better weapons and the Infinity Blade in chests (Playlist_Sword_Solo, 7.40's)." },
  { id: "swordFightDuos", name: "Sword Fight (Duos)", playlistId: 336, playlistName: "Playlist_Sword_Duos", eventFlag: null, builds: [build740, build740], seasons: [7],
    teams: "100 Teams × 2", description: "Epic or better weapons and the Infinity Blade in chests (Playlist_Sword_Duos, 7.40's)." },
  { id: "catchSolo", name: "Catch! (Solo)", playlistId: 340, playlistName: "Playlist_Toss_Solo", eventFlag: null, builds: [build740, build740], seasons: [7],
    advertise: "New", defaultOn: true, original: catchWindow,
    teams: "100 Teams × 1", description: "No guns: grenades and other throwables only, more supply drops, a faster storm: Content Update v7.40's limited time mode (Playlist_Toss_Solo)." },
  { id: "catchDuos", name: "Catch! (Duos)", playlistId: 341, playlistName: "Playlist_Toss_Duos", eventFlag: null, builds: [build740, build740], seasons: [7],
    advertise: "New", defaultOn: true, original: catchWindow,
    teams: "100 Teams × 2", description: "No guns: grenades and other throwables only, in duos (Playlist_Toss_Duos, 7.40's)." },
  { id: "catchSquads", name: "Catch! (Squads)", playlistId: 342, playlistName: "Playlist_Toss_Squads", eventFlag: null, builds: [build740, build740], seasons: [7],
    advertise: "New", defaultOn: true, original: catchWindow,
    teams: "100 Teams × 4", description: "No guns: grenades and other throwables only, in squads (Playlist_Toss_Squads, 7.40's)." },
  { id: "driftin", name: "Driftin'", playlistId: 326, playlistName: "Playlist_Hover_64", eventFlag: null, builds: [build740, build740], seasons: [7],
    advertise: "New", defaultOn: true, original: driftinWindow,
    teams: "2 Teams × 32", description: "Two teams of 32: land by a Red Supply Drop, grab its Driftboard and weapons, no chests or ammo boxes, health and shields regenerate on the board: Content Update v7.40's limited time mode (Playlist_Hover_64)." },
  { id: "driftin40", name: "Driftin' (40 v 40)", playlistId: 320, playlistName: "Playlist_Hover", eventFlag: null, builds: [build740, build740], seasons: [7],
    teams: "2 Teams × 40", description: "Driftin' with two teams of 40 (Playlist_Hover, 7.40's)." },
  { id: "driftin20s", name: "Driftin' 20's", playlistId: 348, playlistName: "Playlist_Hover_48", eventFlag: null, builds: [build740, build740], seasons: [7],
    teams: "2 Teams × 24", description: "Driftin' with two teams of 24 (Playlist_Hover_48, 7.40's)." },
  // 8.00 (CL-5203069, Update v8.00, 28 February 2019), Season 8's first build. Its Athena/Playlists (every playlist asset of
  // its paks, all but the keyed pakchunk1000 and 1002; 1001's key is in the keychain) are 7.40's less Gun Game's Playlist_Gungame_Solo and _Reverse
  // (999, 1000) and Playlist_Playground16 (35): no mode is new in its paks. Its shipped DefaultGame.ini's lobby is the
  // default Solo, Duo and Squad, Playlist_50v50, Playlist_Playground (AdvertiseType Updated), Playlist_PlaygroundV2
  // (bDisplayAsNew) and Playlist_Creative_TDM_v1, so 50v50, Playground and Creative are on as 7.00's were and no other mode
  // is on by default. Update v8.00's notes name 50v50 and Close Encounters; the modes of Season 8's later updates aren't in
  // 8.00's paks: High Stakes 2019's Getaway (8.10's Playlist_Heist_*), Floor is Lava (8.20's Playlist_Lava_*), Air Royale
  // (8.40's Playlist_Goose_*) and Endgame (8.50). Buccaneer's Bounty (8.30) rotated six modes a day from 10 to 15 April;
  // five are 8.00's playlists (the Getaway's isn't), so they run on its replay each by its day, the Fortnite Wiki's
  // Buccaneer's Bounty list. Team Rumble is 8.30's other mode (its eliminations went from 100 to 150, the final circle
  // from 20000 to 12500); no source gives its Season 8 window (🟡 10 to 17 April, the event's days), and 8.00's lobby doesn't
  // ship it, so it is off by default. Close Encounters' launch window ends at 8.10 (🟡 no source gives it).
  { id: "fiftyFiftySeason8", name: "50v50 (Season 8)", playlistId: 50, playlistName: "Playlist_50v50", eventFlag: null, builds: [build800, build840], seasons: [8], defaultOn: true,
    original: season8Window,
    teams: "2 Teams × 50", description: "Two teams of fifty, a bus each, extra loot, and glider redeploy when falling from a height: 8.00's lobby ships it on (Playlist_50v50, 8.00's and 8.20's)." },
  { id: "closeEncountersSeason8Squads", name: "Close Encounters (Season 8, Squads)", playlistId: 46, playlistName: "Playlist_Close_Squad", eventFlag: null, builds: [build800, build840], seasons: [8],
    original: [{ builds: [build800, build840], start: "2019-02-28", end: "2019-03-12" },
      { builds: [build800, build840], start: "2019-04-12", end: "2019-04-13" }],
    teams: "100 Teams × 4", description: "Shotguns and jetpacks only, close quarters: Update v8.00's mode, and Buccaneer's Bounty's third day (Playlist_Close_Squad, 8.00's and 8.20's)." },
  { id: "teamRumbleSeason8", name: "Team Rumble (Season 8)", playlistId: 280, playlistName: "Playlist_Respawn_24", eventFlag: null, builds: [build800, build840], seasons: [8],
    original: [{ builds: [build800, build840], start: "2019-04-10", end: "2019-04-17" }],
    teams: "2 Teams × 20", description: "Two teams of twenty, a bus each: respawn after 5 seconds with your inventory, Uncommon weapons or better; 8.30 puts the win at 150 eliminations and the final circle at 12500 (Playlist_Respawn_24, 8.00's and 8.20's)." },
  { id: "flyExplosivesSeason8Squads", name: "Fly Explosives (Season 8, Squads)", playlistId: 122, playlistName: "Playlist_FlyExplosives_Squads", eventFlag: null, builds: [build800, build840], seasons: [8],
    original: [{ builds: [build800, build840], start: "2019-04-10", end: "2019-04-11" }],
    teams: "100 Teams × 4", description: "Explosives only, with Jetpacks on the floor and a faster storm: Buccaneer's Bounty's first day (Playlist_FlyExplosives_Squads, back in 8.00's paks)." },
  { id: "oneShotSeason8Squads", name: "One Shot (Season 8, Squads)", playlistId: 252, playlistName: "Playlist_Low_Squads", eventFlag: null, builds: [build800, build840], seasons: [8],
    original: [{ builds: [build820, build840], start: "2019-03-20", end: "2019-03-27" },
      { builds: [build800, build840], start: "2019-04-11", end: "2019-04-12" }],
    teams: "100 Teams × 4", description: "Low gravity, 50 health, snipers only and Bandages the only healing: Update v8.11's limited time mode on 8.20, and Buccaneer's Bounty's second day (Playlist_Low_Squads, 8.00's and 8.20's)." },
  { id: "solidGoldSeason8Squads", name: "Solid Gold (Season 8, Squads)", playlistId: 27, playlistName: "Playlist_SolidGold_Squads", eventFlag: null, builds: [build800, build840], seasons: [8],
    original: [{ builds: [build800, build840], start: "2019-04-13", end: "2019-04-14" }],
    teams: "100 Teams × 4", description: "Every weapon Legendary: Buccaneer's Bounty's fourth day (Playlist_SolidGold_Squads, 8.00's and 8.20's)." },
  { id: "classicSeason8Squads", name: "Classic (Season 8, Squads)", playlistId: 216, playlistName: "Playlist_Classic_Squads", eventFlag: null, builds: [build800, build840], seasons: [8],
    original: [{ builds: [build800, build840], start: "2019-04-15", end: "2019-04-16" }],
    teams: "100 Teams × 4", description: "Battle Royale with the vaulted weapons back in the loot: Buccaneer's Bounty's sixth day (Playlist_Classic_Squads, 8.00's; the fifth, the Getaway, is 8.10's playlist and not served)." },
  // 8.20 (CL-5625478, Update v8.20, 27 March 2019). Its Athena/Playlists (every playlist asset of its paks but the keyed
  // pakchunk1001 and 1002's; the keychain opens 1000) are 8.00's and 17 more: the Getaway (Playlist_Bling_Solo, _Duos,
  // _Squads, 140 to 142), Floor is Lava (Playlist_Fill_*, 349 to 351), Going Green (Playlist_Green_*, 310 to 312, "Classic
  // Battle Royale with a St. Paddy's day twist"), Reverse Gun Game (Playlist_Gg_Reverse, 999), Playlist_Creative_PlayOnly_40
  // and six tournament playlists (Playlist_ShowdownTesting_* and Playlist_ShowdownTournament_*, the Gauntlet's and Arena's,
  // not limited-time modes). Its DefaultGame.ini's lobby is 8.00's. The modes of Season 8's updates up to 8.20 that its
  // paks have, by their notes: Update v8.01's Slide (Duos; Playlist_Slide_Duos, in 8.00's paks too), v8.10's Getaway
  // (High Stakes: the Fortnite Wiki's Limited-Time Events put the event, its LTM and challenges from 14 to 19 March; no
  // source gives the team size, 🟡 Squads), v8.11's One Shot (🟡 Squads, the entry above, to v8.20), v8.20's Floor is Lava
  // (the wiki's Squads) and Content Update v8.20's Sniper Shootout (2 April; its notes name Duos and Squads). Buccaneer's
  // Bounty's fifth day, the Getaway (14 April), is in 8.20's paks, so it runs on 8.20. Each ends at the next update (🟡 no
  // source gives the ends); Going Green has no recorded days (🟡 St. Patrick's Day, 15 to 18 March) and Reverse Gun Game no
  // Season 8 run, so that one isn't served. All are off by default, as 8.20's lobby ships none of them.
  // 8.30 (CL-5793395, Update v8.30, 10 April 2019): its 138 playlist assets are 8.20's (the same PlaylistNames, ids, sizes
  // and descriptions) and its DefaultGame.ini's lobby is 8.20's, so every Season 8 entry here runs to 8.30 on the same
  // days. Update v8.30's own modes are Buccaneer's Bounty's six days (10 to 15 April, the entries above, the Getaway's
  // on 14 April included) and Team Rumble (above); its notes name no new playlist.
  { id: "slideSeason8Duos", name: "Slide (Season 8, Duos)", playlistId: 161, playlistName: "Playlist_Slide_Duos", eventFlag: null, builds: [build820, build840], seasons: [8],
    original: [{ builds: [build820, build840], start: "2019-03-06", end: "2019-03-12" }],
    teams: "100 Teams × 2", description: "Ice blocks on everyone's feet and infinite-ammo Grapplers, no fall damage: Update v8.01's limited time mode (Playlist_Slide_Duos, 8.20's)." },
  { id: "getawaySeason8Squads", name: "The Getaway (Season 8, Squads)", playlistId: 142, playlistName: "Playlist_Bling_Squads", eventFlag: null, builds: [build820, build840], seasons: [8],
    original: [{ builds: [build820, build840], start: "2019-03-14", end: "2019-03-20" },
      { builds: [build820, build840], start: "2019-04-14", end: "2019-04-15" }],
    teams: "100 Teams × 4", description: "Find a Jewel in the safe drops and escape in a getaway van; the first four squads out win: Update v8.10's High Stakes mode, and Buccaneer's Bounty's fifth day (Playlist_Bling_Squads, 8.20's)." },
  { id: "getawaySeason8Duos", name: "The Getaway (Season 8, Duos)", playlistId: 141, playlistName: "Playlist_Bling_Duos", eventFlag: null, builds: [build820, build840], seasons: [8],
    teams: "100 Teams × 2", description: "The Getaway in duos (Playlist_Bling_Duos, 8.20's)." },
  { id: "floorIsLavaSquads", name: "Floor is Lava (Squads)", playlistId: 351, playlistName: "Playlist_Fill_Squads", eventFlag: null, builds: [build820, build840], seasons: [8],
    advertise: "New", original: [{ builds: [build820, build840], start: "2019-03-27", end: "2019-04-10" }],
    teams: "100 Teams × 4", description: "The lava rises from the lowest ground until it covers the island; materials every second, build up to stay out of it: Update v8.20's limited time mode (Playlist_Fill_Squads)." },
  { id: "floorIsLavaDuos", name: "Floor is Lava (Duos)", playlistId: 350, playlistName: "Playlist_Fill_Duos", eventFlag: null, builds: [build820, build840], seasons: [8],
    teams: "100 Teams × 2", description: "Floor is Lava in duos (Playlist_Fill_Duos, 8.20's)." },
  { id: "floorIsLavaSolo", name: "Floor is Lava (Solo)", playlistId: 349, playlistName: "Playlist_Fill_Solo", eventFlag: null, builds: [build820, build840], seasons: [8],
    teams: "100 Teams × 1", description: "Floor is Lava alone (Playlist_Fill_Solo, 8.20's)." },
  { id: "sniperShootoutSeason8Duos", name: "Sniper Shootout (Season 8, Duos)", playlistId: 40, playlistName: "Playlist_Snipers_Duos", eventFlag: null, builds: [build820, build840], seasons: [8],
    original: [{ builds: [build820, build840], start: "2019-04-02", end: "2019-04-10" }],
    teams: "100 Teams × 2", description: "Sniper rifles only, half the floor loot, no reviving: Content Update v8.20's limited time mode (Playlist_Snipers_Duos, 8.20's)." },
  { id: "sniperShootoutSeason8Squads", name: "Sniper Shootout (Season 8, Squads)", playlistId: 41, playlistName: "Playlist_Snipers", eventFlag: null, builds: [build820, build840], seasons: [8],
    original: [{ builds: [build820, build840], start: "2019-04-02", end: "2019-04-10" }],
    teams: "100 Teams × 4", description: "Sniper rifles only, half the floor loot, no reviving, in squads (Playlist_Snipers_Squads, whose PlaylistName is Playlist_Snipers; 8.20's)." },
  { id: "goingGreenSquads", name: "Going Green (Squads)", playlistId: 312, playlistName: "Playlist_Green_Squad", eventFlag: null, builds: [build820, build840], seasons: [8],
    original: [{ builds: [build820, build840], start: "2019-03-15", end: "2019-03-19" }],
    teams: "100 Teams × 4", description: "Classic Battle Royale with a St. Patrick's Day twist: chest loot is all Uncommon, only Buried Treasure gives rarer (Playlist_Green_Squads, whose PlaylistName is Playlist_Green_Squad; 8.20's)." },
  // 8.40 (CL-6005771, Update v8.40, 17 April 2019): its 143 playlist assets are 8.30's and five more, and its
  // DefaultGame.ini's lobby is 8.30's. Air Royale: Athena/Playlists/Goose's Playlist_Goose_Solo, _Duos, _Duos_24 and _Squads
  // (300 to 303; "Climb aboard a Stormwing and take to the skies in this fast-paced mode where players fight to be the last
  // one flying!", no Battle Bus, MissionGen_Goose); Update v8.40: "Air Royale is lifting off as a Duos-only mode", so
  // Playlist_Goose_Duos (32 players, 16 teams of 2) is the one served, from 17 April to the next update (🟡 Update v8.50,
  // 25 April; no source gives the end); its free challenges are events/airroyale.js's. Food Fight: Deep Fried,
  // Barrier/Playlist_Barrier_16_B_Lava (226; Food Fight with the lava rising, 2 teams of 16, MissionGen_Barrier_B,
  // BarrierModifier_B_Lava), in Update v8.40's notes, so from 17 April to the next update too (🟡 the same end; the notes
  // give no start of its own). Playlist_Barrier_16 (207) is 7.10's. Both are off by default, as 8.40's lobby ships neither.
  { id: "airRoyaleDuos", name: "Air Royale (Duos)", playlistId: 301, playlistName: "Playlist_Goose_Duos", eventFlag: null, builds: [build840, build840], seasons: [8],
    advertise: "New", original: [{ builds: [build840, build840], start: "2019-04-17", end: "2019-04-25" }],
    teams: "16 Teams × 2", description: "Every pair in an X-4 Stormwing with three lives, no Battle Bus: touch the ground and you're out, fly through sky chests for better guns and plane weapons, hijack planes for their lives, under a storm ceiling that lowers: Update v8.40's limited time mode (Playlist_Goose_Duos, 8.40's)." },
  { id: "foodFightDeepFried", name: "Food Fight: Deep Fried", playlistId: 226, playlistName: "Playlist_Barrier_16_B_Lava", eventFlag: null, builds: [build840, build840], seasons: [8],
    original: [{ builds: [build840, build840], start: "2019-04-17", end: "2019-04-25" }],
    teams: "2 Teams × 16", description: "Food Fight with the lava rising from below: build a fort round your mascot, then destroy theirs and finish the enemies once the barrier lowers; red supply drops, free materials every second, no explosives (Playlist_Barrier_16_B_Lava, 8.40's)." },
  // Season 8's Arena (Core-Backend #420, tournaments/arena.js): Update v8.20's "Arena Game Mode (Solo & Duos)", on the Pop-Up
  // Cups' Playlist_ShowdownAlt_Solo and _Duos (58074, 58075), which 8.20's to 8.40's paks name "Arena" ("Prove your skill in
  // this competitive mode! During each match, you'll earn Hype ..."; bIsTournament, bUseMultidivisionQueues, full parties).
  // No lobby mode and no switch (arena): the events service's Arena events put the tile in the mode select, and a ticket for
  // one is taken for the division the player holds (services/matchmaking/ticket.js).
  { id: "arenaSolo", name: "Arena (Solo)", playlistId: 58074, playlistName: "Playlist_ShowdownAlt_Solo", eventFlag: null, builds: [build820, build840], seasons: [8], arena: true,
    teams: "100 Teams × 1", description: "Season 8's Arena: Hype for placements and eliminations, seven divisions from the Open League to the Champion League (Playlist_ShowdownAlt_Solo, 8.20's)." },
  { id: "arenaDuos", name: "Arena (Duos)", playlistId: 58075, playlistName: "Playlist_ShowdownAlt_Duos", eventFlag: null, builds: [build820, build840], seasons: [8], arena: true,
    teams: "100 Teams × 2", description: "Season 8's Arena in duos, for full duos (Playlist_ShowdownAlt_Duos, 8.20's)." },
  // 7.00's Creative (PongooDev/CoreV2#471): Athena/Playlists/Creative/Playlist_PlaygroundV2 (PlaylistId 35, as Playground's,
  // "Creative", "Design games with friends, race around your island or build your dream Fortnite. Your island. Your friends.
  // Your rules.": MinPlayers 1, MaxPlayers 16, MaxSocialPartySize 4, bAllowJoinInProgress, bEnableCreativeMode,
  // bEnablePlayspaceManager, Athena.Creative, the Athena_Playground, PG_Island_GroupMaster and StarterIsland levels). Not a
  // limited-time mode but Season 7's new one, which 7.00's shipped lobby lists as its own (DefaultGame.ini:
  // "PlaylistName=Playlist_PlaygroundV2, PlaylistAccess=(bEnabled=true, bIsDefaultPlaylist=false, bVisibleWhenDisabled=false,
  // bDisplayAsNew=true, bDisplayAsLimitedTime=false, DisplayPriority=16)"; 7.00's FPlaylistAccess has AdvertiseType where 5.0's
  // had bDisplayAsNew, so its line here says AdvertiseType=New). It is kept in the lobby's list as shipped, with no
  // limited-time banner (limitedTime false, services/fortnite/cloudstorage.js). Creative is a game mode as Save the World and
  // Battle Royale are (the owner's decision, Core-Backend #375), so it is always on where the build has it (alwaysOn): no
  // admin panel switch, no Original dates, and a matchmaking setting saved for it before is ignored. A Creative match is its
  // party's alone, as Playground's (matchmaking/service.js isPartyOnlyBucket: a free server per party), never with bots
  // (matchmaking/botmodes.js), and before 13 December 2018 only Battle Pass owners queue it (profiles/creative.js, Update
  // v7.00's early access).
  { id: "creative", name: "Creative", playlistId: 35, playlistName: "Playlist_PlaygroundV2", eventFlag: null, builds: [build700, build840], seasons: [7, 8], defaultOn: true,
    alwaysOn: true, advertise: "New", limitedTime: false,
    teams: "Party only, up to 16 players", description: "Your own islands to build on with friends: the Creative hub, four islands that save, prefabs, devices and fly mode (Playlist_PlaygroundV2, 7.00's)." }
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
// The modes the admin panel switches (every LTM but the game modes that are always on where the build has them: 7.00's
// Creative, Core-Backend #375).
export const ltmIds = ltms.filter(({ alwaysOn }) => !alwaysOn).map(({ id }) => id);
const byId = new Map(ltms.map((ltm) => [ltm.id, ltm]));
// A playlist's LTM: the requesting build's (3.5.1 gave 23 and 26 to other modes), else any build's.
export const ltmOfPlaylist = (playlistId, build = currentBuild()) => {
  const of = ltms.filter((ltm) => ltm.playlistId === Number(playlistId));
  return of.find((ltm) => inRange(ltm.builds, build)) ?? of[0] ?? null;
};
// A matchmaking bucket's LTM (matchmaking/service.js parseBucket's {playlistId, playlistName}): by its PlaylistName where the
// bucket names one (from 4.4), so two playlists sharing an id are told apart (7.00's Creative, Playlist_PlaygroundV2, and its
// Playground, Playlist_Playground, are both 35), else by its id as ltmOfPlaylist.
export const ltmOfBucketPlaylist = ({ playlistId, playlistName } = {}, build = currentBuild()) => {
  const named = playlistName ? ltms.filter((ltm) => ltm.playlistName?.toLowerCase() === String(playlistName).toLowerCase()) : [];
  return named.find((ltm) => inRange(ltm.builds, build)) ?? named[0] ?? (playlistId === null || playlistId === undefined ? null : ltmOfPlaylist(playlistId, build));
};
// A playlist's id by its PlaylistName, in any case, or null for a name Core has no id for. From 4.4 (CL-4117433) the
// client's matchmaking bucket names its playlist, lowercased, where 4.2 and earlier gave the id ("%u:%d:%s:%s" against
// "%u:%d:%s:%d": 4.4's, 4.5's and 5.0's dumps against 1.10's to 4.2's; "4148992:0:NAE:playlist_playground"). The
// default playlists are 3.5.1's Playlist_DefaultSolo/Duo/Squad (2, 10, 9), the others the LTMs': the requesting build's,
// else any build's (as ltmOfPlaylist).
const defaultPlaylistIds = { playlist_defaultsolo: 2, playlist_defaultduo: 10, playlist_defaultsquad: 9 };
export const playlistIdOfName = (name, build = currentBuild()) => {
  const key = String(name ?? "").toLowerCase();
  if (Object.hasOwn(defaultPlaylistIds, key)) return defaultPlaylistIds[key];
  const of = ltms.filter((ltm) => ltm.playlistName?.toLowerCase() === key);
  return (of.find((ltm) => inRange(ltm.builds, build)) ?? of[0])?.playlistId ?? null;
};
// A playlist's PlaylistName by its id, lowercased as the stats v2 names have it (services/fortnite/stats.js), or null for
// an id Core has no name for: the default playlists', else the requesting build's LTM, else the latest LTM with the id
// from before the build (8.20 has Close Encounters Solo, 44, from Season 7, where 3.5.1 gave 44 to Impact), else any.
export const playlistNameOfId = (playlistId, build = currentBuild()) => {
  const id = Number(playlistId);
  const named = Object.entries(defaultPlaylistIds).find(([, defaultId]) => defaultId === id);
  if (named) return named[0];
  const of = ltms.filter((ltm) => ltm.playlistId === id && ltm.playlistName);
  const earlier = of.filter((ltm) => compareToBound(build, ltm.builds[0]) >= 0);
  const ltm = of.find((entry) => inRange(entry.builds, build)) ?? earlier[earlier.length - 1] ?? of[0];
  return ltm?.playlistName.toLowerCase() ?? null;
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

const seasonOf = (build) => (Number(build) >= build800 ? 8 : Number(build) >= build700 ? 7 : Number(build) >= build6000 ? 6 : Number(build) >= build500 ? 5 : Number(build) >= build40 ? 4 : Number(build) >= build30 ? 3
  : Number(build) >= build111 ? 2 : 1);
const day = (date) => Date.parse(`${date}T00:00:00Z`);
// An LTM's original windows ([] for none): {builds, start, end, season}, start and end in ms of Epic's calendar (UTC), end
// the moment after it. A window's start or end is a day ("YYYY-MM-DD") or a function of the settings (Close Encounters'
// hour, Solid Gold v2 around it).
const momentOf = (value, settingsValue) => {
  const resolved = typeof value === "function" ? value(settingsValue) : value;
  return typeof resolved === "number" ? resolved : day(resolved);
};
const seasonOfBound = (bound) => (typeof bound === "number" ? seasonOf(bound) : versionParts(bound)[0]);
// A window the settings leave empty (Fortnitemares Duos' and Squads' second, without the outage) is none.
const windowsOf = (ltm, settingsValue) => [].concat(ltm.original ?? []).map(({ builds, start, end }) =>
  ({ builds, start: momentOf(start, settingsValue), end: momentOf(end, settingsValue), season: seasonOfBound(builds[0]) }))
  .filter(({ start, end }) => start < end);

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

// Whether the build's lobby offers the LTM now: always on the build it is new in. A tournament playlist is never a lobby
// mode: its event decides (services/matchmaking/ticket.js).
export function ltmOn(id, build, settingsValue = settingsProvider(), now = new Date()) {
  const ltm = byId.get(id);
  if (!ltm || !hasLtm(id, build) || ltm.tournament || ltm.arena) return false;
  // A game mode always on where the build has it (7.00's Creative, #375), whatever the settings say.
  if (ltm.alwaysOn || isNewIn(ltm, build)) return true;
  // 6.21's Fortnitemares modes (Core-Backend #354): the Leaky Lake's state, not the dates; off once the Butterfly has
  // happened, by the admin's switch before it.
  const lake = ltm.untilButterfly ? leakyLakeState(now, build) : null;
  if (lake === "after") return false;
  // 7.20's Ice Storm modes (Core-Backend #354): from the Ice Storm, not before it. Before the storm the default modes stay;
  // after it each is on by its switch, and by its Original dates too while those are on and the storm is on Epic's
  // dates (on the admin's own times the storm's moment is the admin's, and the dates' start would hide the modes).
  const island = ltm.fromIceStorm ? iceKingState(now, build) : null;
  if (island === "before") return false;
  if (island === "after" && !iceKingOnEpicDates()) return ltm.defaultOn ? settingsValue?.matchmakingModes?.[id] !== false : settingsValue?.matchmakingModes?.[id] === true;
  const modes = lake === "before" ? settingsValue?.matchmakingModes : ltmModes(build, settingsValue, now);
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

// Season 5's lobby (Core-Backend #314): from 5.0 (CL-4204761) the mode select lists UFortGameInstance's FrontEndPlaylistData
// (Config, {PlaylistName, PlaylistAccess: {bForcePlaylistOff, bEnabled, bVisibleWhenDisabled, bIsDefaultPlaylist,
// AdvertiseType (5.0: bDisplayAsNew), bDisplayAsLimitedTime, DisplayPriority}, AccessOverrides}), which the shipped
// DefaultGame.ini of 5.0, 5.10, 5.21, 5.30, 5.40 and 5.41 sets to the default Solo, Duo and Squad, Playlist_50v50 and
// Playlist_Playground, all enabled (read from their paks). So those builds' lobbies offered 50v50 and Playground whatever
// the admin panel said, and a ticket for one that was off was refused ("We couldn't connect to the match"). The hotfix
// (services/fortnite/cloudstorage.js) clears the list and sets it again: the defaults as shipped, and each of the build's
// LTMs enabled while it is on (ltmOn, as the ticket checks it) and hidden while it is off. Each entry: {name, enabled,
// priority, ltm}.
export const frontEndPlaylistBuild = build500;
const shippedPriority = { Playlist_50v50: 10, Playlist_Playground: 15, Playlist_PlaygroundV2: 16 };
export function ltmFrontEndPlaylists(build, settingsValue = settingsProvider(), now = new Date()) {
  if (Number(build) < frontEndPlaylistBuild) return [];
  const seen = new Set();
  // Season 8's Arena (#420) is no FrontEndPlaylistData entry: its tile is the events service's (tournaments/arena.js).
  return ltms.filter((ltm) => ltm.playlistName && !ltm.arena && hasLtm(ltm.id, build) && !seen.has(ltm.playlistName) && seen.add(ltm.playlistName))
    .map((ltm, index) => ({ name: ltm.playlistName, enabled: ltmOn(ltm.id, build, settingsValue, now),
      priority: shippedPriority[ltm.playlistName] ?? 20 + index, ltm }));
}

// The LTMs that take a default mode's place in the build's lobby now (Core-Backend #348: 6.20's and 6.21's Fortnitemares
// Solo, Duos and Squads, each `replaces` its default; 7.20's Ice Storm Solo, Duos and Squads the same): each of them that
// is on (ltmOn), while the admin panel lets them (settings fortnitemaresReplacesDefaults, on unless false). Returns
// {<default PlaylistName>: ltm}; a default whose LTM is off stays as shipped.
export const replacesDefaultsOn = (settingsValue) => settingsValue?.fortnitemaresReplacesDefaults !== false;
export function defaultReplacements(build, settingsValue = settingsProvider(), now = new Date()) {
  if (Number(build) < frontEndPlaylistBuild || !replacesDefaultsOn(settingsValue)) return {};
  return Object.fromEntries(ltms.filter((ltm) => ltm.replaces && ltmOn(ltm.id, build, settingsValue, now)).map((ltm) => [ltm.replaces, ltm]));
}

// The bucket a 7.20 match is assigned with (CoreV2 #490): in the half hour before the Ice Storm (events/icestorm.js
// iceKingStormSoon, which has why) the default Solo's, Duos' and Squads' matches are their Ice Storm playlist's (282 to
// 284, `replaces`), so the storm's Ice Legion comes to them; the lobby keeps the normal three until the storm. Only while
// that Ice Storm mode is on by its switch and the Ice Storm modes take the defaults' place (settings
// fortnitemaresReplacesDefaults). From 4.4 a bucket names its playlist, lowercased ("4727874:0:NAE:playlist_defaultsolo");
// the server sets the playlist by that name (CoreV2 AFortGameModeAthena::OnGivenMatchAssignment). Any other bucket, build
// or time: the bucket as it is.
export function iceStormMatchBucket(bucketId, build, settingsValue = settingsProvider(), now = new Date()) {
  const parts = String(bucketId ?? "").split(":");
  if (parts.length < 4 || !replacesDefaultsOn(settingsValue) || !iceKingStormSoon(now, build)) return bucketId;
  const ltm = ltms.find((entry) => entry.fromIceStorm && entry.replaces?.toLowerCase() === parts[3].toLowerCase() && hasLtm(entry.id, build));
  if (!ltm || settingsValue?.matchmakingModes?.[ltm.id] === false) return bucketId;
  parts[3] = ltm.playlistName.toLowerCase();
  return parts.join(":");
}

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
const versions = { [build110]: "1.10", [build111]: "1.11", [build21]: "2.1", [build23]: "2.3", [build24]: "2.4", [build242]: "2.4.2", [build25]: "2.5", [build30]: "3.0", [build31]: "3.1", [build311]: "3.1.1", [build32]: "3.2", [build33]: "3.3", [build351]: "3.5.1", [build352]: "3.5.2", [build36]: "3.6", [build40]: "4.0", [build41]: "4.1", [build42]: "4.2", [build440]: "4.4.0", [build441]: "4.4.1", [build442]: "4.4.2", [build450]: "4.5.0", [build45]: "4.5", [build500]: "5.0.0", [build50]: "5.0", [build5100]: "5.10.0", [build510]: "5.10", [build521]: "5.21", [build530]: "5.30", [build540]: "5.40", [build541]: "5.41", [build6000]: "6.00.0", [build600]: "6.00", [build6010]: "6.01.0", [build601]: "6.01", [build6020]: "6.02.0", [build602]: "6.02", [build6100]: "6.10.0", [build6101]: "6.10.1", [build610]: "6.10", [build620]: "6.20", [build621]: "6.21", [build622]: "6.22", [build630]: "6.30", [build631]: "6.31", [build700]: "7.00", [build710]: "7.10", [build720]: "7.20", [build730]: "7.30", [build740]: "7.40" };
const boundName = (bound) => (typeof bound === "number" ? versions[bound] ?? buildVersions[bound] ?? String(bound) : bound);
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
  const moments = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((season) => [season, seasonMoment(now, null, season).getTime()]));
  return {
    originalDates: settingsValue?.ltmOriginalDates === true,
    // Close Encounters' day: the whole of it or one hour (#258).
    closeEncounters: closeEncountersSetting(settingsValue),
    // Whether 6.20's and 6.21's Fortnitemares modes take Solo's, Duos' and Squads' place while on (#348).
    fortnitemaresReplacesDefaults: replacesDefaultsOn(settingsValue),
    // Whether Original dates replays Fortnitemares Duos' and Squads' launch-day outage on 6.20 (#367).
    fortnitemaresOutage: fortnitemaresOutageOn(settingsValue),
    seasonMoments: Object.fromEntries(Object.entries(moments).map(([season, moment]) => [season, new Date(moment).toISOString()])),
    // Neither a tournament playlist (the Tournaments tab's) nor a game mode always on (7.00's Creative, #375) has a switch.
    list: ltms.filter((ltm) => !ltm.tournament && !ltm.arena && !ltm.alwaysOn).map((ltm) => ({
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
      newIn: newInBuilds(ltm).map(boundName).join(" and ") || null,
      ...originalOf(ltm, settingsValue, moments)
    }))
  };
}

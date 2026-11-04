import { currentBuild } from "../builds/context.js";
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
const build110 = 3790078;
const build111 = 3807424;
const build21 = 3825894;
const build23 = 3847564;
const build24 = 3858292;
const build242 = 3870737;
const build25 = 3889387;
const build30 = 3901517;
const build31 = 3915963;
const build32 = 3935073;

export const ltms = [
  { id: "fiftyFifty", name: "50v50", playlistId: 11, eventFlag: null, builds: [build110, build25], seasons: [1, 2], defaultOn: true,
    original: { builds: [build110, build111], start: "2017-12-08", end: "2017-12-19" },
    teams: "2 Teams × 50", description: "Two teams of 50, each from its own Battle Bus." },
  { id: "highExplosives", quest: "athenaevent2_playmatches", name: "High Explosives", playlistId: 13, queue: 2, eventFlag: "Event2", builds: [build111, build32], seasons: [2, 3],
    original: { builds: [build111, build111], start: "2017-12-28", end: "2018-01-03" },
    teams: "100 Teams × 4", description: "Rocket Launchers, Snowball Launchers and grenades only; no traps (Athena/Events/RocketsAndGrenades loot)." },
  { id: "sneakySilencers", quest: "athenaevent5_playmatches", name: "Sneaky Silencers", playlistId: 12, queue: 5, eventFlag: "Event5", builds: [build111, build32], seasons: [2, 3],
    original: { builds: [build111, build111], start: "2018-01-05", end: "2018-01-09" },
    teams: "100 Teams × 4", description: "Silenced weapons only (Athena/Events/SneakySilencers loot)." },
  { id: "sniperShootout", quest: "athenaevent7_playmatches", name: "Sniper Shootout", playlistId: 18, queue: 7, eventFlag: "Event7", builds: [build111, build32], seasons: [2, 3],
    original: { builds: [build23, build24], start: "2018-01-29", end: "2018-02-03" },
    teams: "100 Teams × 4", description: "Ready, aim, fire! Sniper Rifles only (Athena/Events/SnipersOnly loot)." },
  { id: "shootingTest", quest: "athenaevent1_playmatches", name: "Shooting Test #1", playlistId: 15, queue: 1, eventFlag: "Event1", builds: [build24, build25], seasons: [2],
    original: { builds: [build24, build242], start: "2018-02-02", end: "2018-02-13" },
    teams: "100 Teams × 1 (2.4: × 4)", description: "Weapon accuracy for a more precise aim: first-shot accuracy, headshot and fall-off changes." },
  { id: "speedyStorm", quest: "athenaevent3_playmatches", name: "Speedy Storm", playlistId: 14, queue: 3, eventFlag: "Event3", builds: [build21, build32], seasons: [2, 3],
    original: null,
    teams: "100 Teams × 4", description: "The storm waits 30 s between circles, not 90 to 200 (Athena/Events/FasterRings game data); the normal loot." },
  { id: "takeToTheSkies", quest: "athenaevent6_playmatches", name: "Take To The Skies", playlistId: 16, queue: 6, eventFlag: "Event6", builds: [build21, build32], seasons: [2, 3],
    original: null,
    teams: "100 Teams × 4 (3.0: × 2)", description: "Loot with Launch Pads on the floor (Athena/Events/TakeToTheSkies loot)." },
  { id: "lotsaLoot", quest: "athenaevent4_playmatches", name: "Lotsa Loot", playlistId: 17, queue: 4, eventFlag: "Event4", builds: [build21, build32], seasons: [2, 3],
    original: null,
    teams: "100 Teams × 4", description: "More loot (Athena/Events/LotsaLoot loot tiers and game data); its lobby tile reads \"Luxurious Loot\"." },
  { id: "blitz", quest: "athenaevent8_playmatches", name: "Blitz", playlistId: 19, queue: 8, eventFlag: "Event8", builds: [build242, build32], seasons: [2, 3],
    original: null,
    teams: "100 Teams × 4", description: "Shorter matches: a smaller first storm circle, its own loot and resource rates (Athena/Events/Blitz tables)." },
  { id: "fiveByTwenty", quest: "athenaevent22_playmatches", name: "5x20", playlistId: 22, queue: 22, eventFlag: null, builds: [build30, build32], seasons: [3],
    original: null,
    teams: "5 Teams × 20", description: "Five teams of twenty (Playlist_5x20, a large team game with its own game data)." },
  { id: "highJump", quest: "athenaevent23_playmatches", name: "High Jump", playlistId: 23, queue: 23, eventFlag: null, builds: [build30, build32], seasons: [3],
    original: null,
    teams: "100 Teams × 1", description: "Solo (Playlist_HighJump, no tables of its own)." },
  { id: "useItOrLoseIt", quest: "athenaevent25_playmatches", name: "Use It & Lose It", playlistId: 25, queue: 25, eventFlag: null, builds: [build30, build32], seasons: [3],
    original: null,
    teams: "100 Teams × 4", description: "Its own loot and game data (Athena/Events/UseIt tables)." },
  { id: "steadyStorm", name: "Steady Storm", playlistId: 26, queue: 26, eventFlag: null, builds: [build30, build32], seasons: [3],
    original: null,
    teams: "100 Teams × 1", description: "Solo; the storm closes from the warmup on (Athena/Events/SteadyStorm game data)." },
  { id: "solidGold", quest: "athenaevent27_playmatches", name: "Solid Gold", playlistId: 27, queue: 27, eventFlag: null, builds: [build30, build32], seasons: [3],
    original: null,
    teams: "100 Teams × 4", description: "Its own loot tables and resource rates (Athena/Events/SolidGold tables)." },
  { id: "skySupply", quest: "athenaevent30_playmatches", name: "Sky Supply", playlistId: 30, queue: 30, eventFlag: null, builds: [build30, build32], seasons: [3],
    original: null,
    teams: "100 Teams × 1", description: "Solo, with its own loot and game data (Athena/Events/SkySupply tables)." },
  { id: "shotguns", quest: "athenaevent31_playmatches", name: "Shotguns", playlistId: 31, queue: 31, eventFlag: null, builds: [build30, build32], seasons: [3],
    original: null,
    teams: "100 Teams × 4", description: "Shotguns only (Athena/Events/Shotguns tables)." },
  { id: "blitzSolo", quest: "athenaevent8_playmatches", name: "Blitz (Solo)", playlistId: 36, queue: 36, tagQueue: 8, eventFlag: null, builds: [build31, build32], seasons: [3],
    original: null,
    teams: "100 Teams × 1", description: "Blitz alone (Playlist_Blitz_Child_Solo, Blitz's tables); its matches count Blitz's challenge." },
  { id: "blitzDuo", quest: "athenaevent8_playmatches", name: "Blitz (Duo)", playlistId: 37, queue: 37, tagQueue: 8, eventFlag: null, builds: [build31, build32], seasons: [3],
    original: null,
    teams: "100 Teams × 2", description: "Blitz in duos (Playlist_Blitz_Child_Duo, Blitz's tables); its matches count Blitz's challenge." }
];
export const ltmIds = ltms.map(({ id }) => id);
const byId = new Map(ltms.map((ltm) => [ltm.id, ltm]));
export const ltmOfPlaylist = (playlistId) => ltms.find((ltm) => ltm.playlistId === Number(playlistId)) ?? null;
// The event queue's number of each event playlist ({12: 5, 13: 2, 14: 3, 15: 1, 16: 6, 17: 4, 18: 7, 19: 8}, and 3.0's
// N: N from 22 on): the matchmaking button's AthenaEvent<N> → playlist switch read backwards, so the N of the playlist's
// Athena.Playlist.Event.<N> and complete_athena_event_<N>; 3.1's Blitz children (36, 37) take Blitz's, 8 (tagQueue).
export const eventQueueOfPlaylist = Object.fromEntries(ltms.filter((ltm) => ltm.queue).map((ltm) => [ltm.playlistId, ltm.tagQueue ?? ltm.queue]));

const inRange = ([first, last], build) => Number(build) >= first && Number(build) <= last;
const seasonOf = (build) => (Number(build) >= build30 ? 3 : Number(build) >= build111 ? 2 : 1);
const day = (date) => Date.parse(`${date}T00:00:00Z`);

// Whether a build's data has the LTM.
export const hasLtm = (id, build) => Boolean(byId.get(id)) && inRange(byId.get(id).builds, build);

// Whether the LTM's original window holds the season's replay now, for a build Epic ran it on.
export function inOriginalWindow(id, build, now = new Date()) {
  const ltm = byId.get(id);
  if (!ltm?.original || !inRange(ltm.original.builds, build)) return false;
  const moment = seasonMoment(now, null, seasonOf(build)).getTime();
  return moment >= day(ltm.original.start) && moment < day(ltm.original.end);
}

// The matchmaking modes in force ({solo, duo, ..., <ltm id>: boolean}): the admin's, with each LTM's by its original
// window while Original dates is on. settingsValue is the settings store's value.
export function ltmModes(build, settingsValue, now = new Date()) {
  const modes = settingsValue?.matchmakingModes;
  if (settingsValue?.ltmOriginalDates !== true) return modes;
  return { ...(modes ?? {}), ...Object.fromEntries(ltms.map(({ id }) => [id, inOriginalWindow(id, build, now)])) };
}

// The settings store's value, for work that has none at hand (the quest login).
let settingsProvider = () => undefined;
export function configureLtms(provider) {
  settingsProvider = typeof provider === "function" ? provider : () => provider;
}

// Whether the build's lobby offers the LTM now.
export function ltmOn(id, build, settingsValue = settingsProvider(), now = new Date()) {
  const ltm = byId.get(id);
  if (!ltm || !hasLtm(id, build)) return false;
  const modes = ltmModes(build, settingsValue, now);
  return ltm.defaultOn ? modes?.[id] !== false : modes?.[id] === true;
}

// The event queues the build's lobby offers now (the region state's EventFlagsForcedOn).
export const ltmEventFlags = (build, settingsValue, now = new Date()) =>
  ltms.filter((ltm) => ltm.eventFlag && ltmOn(ltm.id, build, settingsValue, now)).map((ltm) => ltm.eventFlag);

// The event queues past AthenaEvent8 the build's lobby offers now (3.0's), which have no event flag: the DefaultGame.ini
// hotfix sets their UFortGlobals bEvent<N>ForceEnabled.
export const ltmForcedQueues = (build, settingsValue = settingsProvider(), now = new Date()) =>
  ltms.filter((ltm) => ltm.queue && !ltm.eventFlag && ltmOn(ltm.id, build, settingsValue, now)).map((ltm) => ltm.queue);

// The event quests of the LTMs the requesting build offers now (running) or doesn't (events/fiftyfifty.js
// athenaEventQuestsOf).
// A quest several LTMs share (Blitz's, 3.1's Blitz children too) runs while any of them is on.
export function ltmQuests({ running }, build = currentBuild(), now = new Date()) {
  const settings = settingsProvider();
  const on = new Set(ltms.filter((ltm) => ltm.quest && ltmOn(ltm.id, build, settings, now)).map((ltm) => ltm.quest));
  if (running) return [...on];
  return [...new Set(ltms.filter((ltm) => ltm.quest && !on.has(ltm.quest)).map((ltm) => ltm.quest))];
}

// When an LTM next starts or ends on the build's replay while Original dates is on (for the calendar's cacheExpire), or
// null.
export function nextLtmChange(build, settingsValue, now = new Date()) {
  if (settingsValue?.ltmOriginalDates !== true) return null;
  const season = seasonOf(build);
  const times = ltms.filter((ltm) => ltm.original && inRange(ltm.original.builds, build))
    .flatMap((ltm) => [ltm.original.start, ltm.original.end]).map((date) => nextReplayOf(day(date), now, null, season).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

// The admin panel's list (its Battle Royale Game Modes, after solo, duos and squads): each LTM with its window and
// builds, whether it is on by hand, and whether its window holds each season's replay now.
const versions = { [build110]: "1.10", [build111]: "1.11", [build21]: "2.1", [build23]: "2.3", [build24]: "2.4", [build242]: "2.4.2", [build25]: "2.5", [build30]: "3.0", [build31]: "3.1", [build32]: "3.2" };
const buildRange = ([first, last]) => (first === last ? versions[first] : `${versions[first]} to ${versions[last]}`);
export function ltmSchedule(settingsValue, now = new Date()) {
  const modes = settingsValue?.matchmakingModes ?? {};
  const moments = { 1: seasonMoment(now, null, 1).getTime(), 2: seasonMoment(now, null, 2).getTime(), 3: seasonMoment(now, null, 3).getTime() };
  return {
    originalDates: settingsValue?.ltmOriginalDates === true,
    seasonMoments: Object.fromEntries(Object.entries(moments).map(([season, moment]) => [season, new Date(moment).toISOString()])),
    list: ltms.map((ltm) => ({
      id: ltm.id,
      name: ltm.name,
      playlistId: ltm.playlistId,
      eventFlag: ltm.eventFlag,
      queue: ltm.queue ?? null,
      seasons: ltm.seasons,
      builds: buildRange(ltm.builds),
      teams: ltm.teams,
      description: ltm.description,
      enabled: ltm.defaultOn ? modes[ltm.id] !== false : modes[ltm.id] === true,
      // null for an LTM with no original window here (no window: off while Original dates is on).
      original: ltm.original && { builds: buildRange(ltm.original.builds), start: ltm.original.start, end: ltm.original.end,
        last: new Date(day(ltm.original.end) - 86400000).toISOString().slice(0, 10) },
      inWindow: Object.fromEntries(ltm.seasons.map((season) => [season, Boolean(ltm.original) &&
        moments[season] >= day(ltm.original.start) && moments[season] < day(ltm.original.end)]))
    }))
  };
}

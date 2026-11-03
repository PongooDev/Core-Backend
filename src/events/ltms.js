import { nextReplayOf, seasonMoment } from "../store/itemshop.js";

// Battle Royale's limited-time modes of Seasons 1 and 2 (Core-Backend #190), and when they run.
//
// From 1.11 (CL-3807424) to 2.5 (CL-3889387) the lobby has eight event queues, EFortAthenaPlaylist::AthenaEvent1 to 8,
// MCP playlists 12 to 19. Each one's tile is its mission generator (the matchmaking widget's Event<N>MissionGen):
// 1.11's and 2.1's World/MissionGens/TestMissionGens, 2.3's on World/MissionGens/Athena, MissionGen_AthenaEvent1_
// SneakySilencers, _AthenaEvent2_Explosives ("High Explosives"), _AthenaEvent3_SpeedyCircles, _AthenaEvent4_ShootingTest,
// _AthenaEvent5_Skies, _AthenaEvent6_Loot, _AthenaEvent7_Snipers ("Sniper Shootout": "Ready, aim, fire! Sniper Rifles
// only.") and _AthenaEvent8. None is a playlist asset; Epic ran them from its servers, as it ran Shooting Test #1
// (events/shootingtest.js):
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
// - Sneaky Silencers (Event1, 12): 1.11's 1/1 hotfix notes, "available January 5 and ends on January 8".
// - Sniper Shootout (Event7, 18): "introduced on January 29th 2018" ("the only available weapons are Sniper Rifles"), to
//   2 February, through 2.3 (25 January) and 2.4 (31 January).
// - Shooting Test #1 (Event4, 15): 2 to 12 February 2018, 2.4 and 2.4.2 (2.5 shipped on 13 February).
//
// The admin panel's Matchmaking tab turns each on by hand (matchmakingModes, off by default but 50v50), or, with
// "Original dates" on (settings ltmOriginalDates), runs each only in its original window on the season's replay
// (store/itemshop.js seasonMoment: Season 1's on 1.8 to 1.10, Season 2's from 1.11) and only on the builds Epic ran it
// on. Each window is whole UTC days of Epic's calendar, its end the day after its last.
const build110 = 3790078;
const build111 = 3807424;
const build23 = 3847564;
const build24 = 3858292;
const build242 = 3870737;
const build25 = 3889387;

export const ltms = [
  { id: "fiftyFifty", name: "50v50", playlistId: 11, eventFlag: null, builds: [build110, build25], seasons: [1, 2], defaultOn: true,
    original: { builds: [build110, build111], start: "2017-12-08", end: "2017-12-19" },
    teams: "2 Teams × 50", description: "Two teams of 50, each from its own Battle Bus." },
  { id: "highExplosives", name: "High Explosives", playlistId: 13, eventFlag: "Event2", builds: [build111, build25], seasons: [2],
    original: { builds: [build111, build111], start: "2017-12-28", end: "2018-01-03" },
    teams: "100 Teams × 4", description: "Rocket Launchers, Snowball Launchers and grenades only; no traps (Athena/Events/RocketsAndGrenades loot)." },
  { id: "sneakySilencers", name: "Sneaky Silencers", playlistId: 12, eventFlag: "Event1", builds: [build111, build25], seasons: [2],
    original: { builds: [build111, build111], start: "2018-01-05", end: "2018-01-09" },
    teams: "100 Teams × 4", description: "Silenced weapons only (Athena/Events/SneakySilencers loot)." },
  { id: "sniperShootout", name: "Sniper Shootout", playlistId: 18, eventFlag: "Event7", builds: [build111, build25], seasons: [2],
    original: { builds: [build23, build24], start: "2018-01-29", end: "2018-02-03" },
    teams: "100 Teams × 4", description: "Ready, aim, fire! Sniper Rifles only (Athena/Events/SnipersOnly loot)." },
  { id: "shootingTest", name: "Shooting Test #1", playlistId: 15, eventFlag: "Event4", builds: [build24, build25], seasons: [2],
    original: { builds: [build24, build242], start: "2018-02-02", end: "2018-02-13" },
    teams: "100 Teams × 1 (2.4: × 4)", description: "Weapon accuracy for a more precise aim: first-shot accuracy, headshot and fall-off changes." }
];
export const ltmIds = ltms.map(({ id }) => id);
const byId = new Map(ltms.map((ltm) => [ltm.id, ltm]));
export const ltmOfPlaylist = (playlistId) => ltms.find((ltm) => ltm.playlistId === Number(playlistId)) ?? null;

const inRange = ([first, last], build) => Number(build) >= first && Number(build) <= last;
const seasonOf = (build) => (Number(build) >= build111 ? 2 : 1);
const day = (date) => Date.parse(`${date}T00:00:00Z`);

// Whether a build's data has the LTM.
export const hasLtm = (id, build) => Boolean(byId.get(id)) && inRange(byId.get(id).builds, build);

// Whether the LTM's original window holds the season's replay now, for a build Epic ran it on.
export function inOriginalWindow(id, build, now = new Date()) {
  const ltm = byId.get(id);
  if (!ltm || !inRange(ltm.original.builds, build)) return false;
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

// Whether the build's lobby offers the LTM now.
export function ltmOn(id, build, settingsValue, now = new Date()) {
  const ltm = byId.get(id);
  if (!ltm || !hasLtm(id, build)) return false;
  const modes = ltmModes(build, settingsValue, now);
  return ltm.defaultOn ? modes?.[id] !== false : modes?.[id] === true;
}

// The event queues the build's lobby offers now (the region state's EventFlagsForcedOn).
export const ltmEventFlags = (build, settingsValue, now = new Date()) =>
  ltms.filter((ltm) => ltm.eventFlag && ltmOn(ltm.id, build, settingsValue, now)).map((ltm) => ltm.eventFlag);

// When an LTM next starts or ends on the build's replay while Original dates is on (for the calendar's cacheExpire), or
// null.
export function nextLtmChange(build, settingsValue, now = new Date()) {
  if (settingsValue?.ltmOriginalDates !== true) return null;
  const season = seasonOf(build);
  const times = ltms.filter((ltm) => inRange(ltm.original.builds, build))
    .flatMap((ltm) => [ltm.original.start, ltm.original.end]).map((date) => nextReplayOf(day(date), now, null, season).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

// The admin panel's list: each LTM with its window and builds, whether it is on by hand, and whether its window holds
// each season's replay now.
const versions = { [build110]: "1.10", [build111]: "1.11", [build23]: "2.3", [build24]: "2.4", [build242]: "2.4.2", [build25]: "2.5" };
const buildRange = ([first, last]) => (first === last ? versions[first] : `${versions[first]} to ${versions[last]}`);
export function ltmSchedule(settingsValue, now = new Date()) {
  const modes = settingsValue?.matchmakingModes ?? {};
  const moments = { 1: seasonMoment(now, null, 1).getTime(), 2: seasonMoment(now, null, 2).getTime() };
  return {
    originalDates: settingsValue?.ltmOriginalDates === true,
    seasonMoments: Object.fromEntries(Object.entries(moments).map(([season, moment]) => [season, new Date(moment).toISOString()])),
    list: ltms.map((ltm) => ({
      id: ltm.id,
      name: ltm.name,
      playlistId: ltm.playlistId,
      eventFlag: ltm.eventFlag,
      seasons: ltm.seasons,
      builds: buildRange(ltm.builds),
      teams: ltm.teams,
      description: ltm.description,
      enabled: ltm.defaultOn ? modes[ltm.id] !== false : modes[ltm.id] === true,
      original: { builds: buildRange(ltm.original.builds), start: ltm.original.start, end: ltm.original.end,
        last: new Date(day(ltm.original.end) - 86400000).toISOString().slice(0, 10) },
      inWindow: Object.fromEntries(ltm.seasons.map((season) => [season,
        moments[season] >= day(ltm.original.start) && moments[season] < day(ltm.original.end)]))
    }))
  };
}

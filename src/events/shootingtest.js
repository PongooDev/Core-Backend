import { buildGameData } from "../gamedata/read.js";

// Shooting Test #1 (Core-Backend #189), Battle Royale's limited-time playlist of 2 February 2018: "This alternative
// gameplay test modifies weapon accuracy for a more precise aim" (MissionGen_AthenaEvent4_ShootingTest's
// AthenaLTMConfig). It isn't a playlist asset: 2.4 (CL-3858292) to 2.5 (CL-3889387) ship it as the lobby's fourth event
// queue, EFortAthenaPlaylist::AthenaEvent4, MCP playlist 15 (Athena_GameMode's PlaylistDataTables number Event1 to 8
// 12 to 19, Sneaky Silencers 12 ... Blitz 19; 15 is the one without loot tables of its own), and its gameplay is native.
// Epic ran it from its servers, with nothing in a patch:
// - The calendar turned the queue on. UFortGlobalUIContext::IsEvent4QueueEnabled (2.4.2 0x20BA120) is UFortGameInstance's
//   bBattleRoyaleEvent4QueueEnabled (true in 2.4's to 2.5's DefaultGame.ini), the player's region not in its
//   RegionsWithBattleRoyaleEvent4QueueDisabled, and, with the seasonal event manager there, "Event4" (0x20B3770 names
//   AthenaEvent1-8 Event1-8) in the region's FFortMatchmakingRegionState EventFlagsForcedOn and not in its
//   EventFlagsForcedOff; or UFortGlobals' bEvent4ForceEnabled (false). The region state is the calendar's
//   client-matchmaking channel (services/fortnite/calendar.js), so the LTM tile shows while that lists Event4.
// - A ranged weapon in playlist 15 reads its stats from the player pawn's tables (2.4.2 0x9AFC00, 2.4 0x99D0F0: the
//   game state's CurrentPlaylistId == 15): with UFortGlobals' bShootingTest3Enabled (false in the paks) from
//   PlayerPawn_Athena's PrototypeShootingModelPerfectAimWhenTargetingMinSpread, AthenaRangedWeapons_ShootingModel3, with
//   the weapon's perfect aim at its minimum spread (the notes' first-shot accuracy, the red reticle), else from
//   PrototypeShootingModel, AthenaRangedWeapons_ShootingModel2, with Athena recoil and perfect ADS aim. Epic hotfixed
//   the tables and each next build shipped them: 2.4's ShootingModel tables don't have the test's values yet, 2.4.2's hold the
//   test's as the Fortnite Wiki lists them (headshots at 200%, shotguns' at 150%; damage falling off to 70% past a
//   weapon's range; SMGs +2; the Semi-Auto Sniper at 75/78 and the Scoped AR at 25/26), and 2.5's ShootingModel3 holds
//   2.4.2's notes' changes, which 2.4.2's ShootingModel2 doesn't ("Shotgun headshot
//   damage increased to 200% (was 150%)", "Scoped Assault Rifle is now 100% accurate when zoomed in": SpreadDownsights
//   0, "Scoped Assault Rifle no longer has damage fall-off"). So 2.4.2 played ShootingModel3: bShootingTest3Enabled was
//   on. Each build gets the hotfix that brings its table to the next build's ([AssetHotfix], the table whole, with
//   2.5's Crossbow rows for 2.4.2's Crossbow), and bShootingTest3Enabled.
// - "The Shooting Test #1 Limited-Time Mode has been switched to Solo only" (2.4.2's notes). The servers' own team table
//   still makes 15 a squads playlist (GetMaxTeamInfoForPlaylist, 2.4.2 0x7F3790, 2.5 0xD49FA0: 100 teams of 4), so the
//   matchmaking service made the teams: from 2.4.2 each player is a team of their own, as in Solo; 2.4's are squads.
// The admin panel's Matchmaking tab turns it on (matchmakingModes.shootingTest, off by default, as Epic's LTMs ended).
export const shootingTestMode = "shootingTest";
export const shootingTestPlaylist = 15;
export const shootingTestEventFlag = "Event4";
const firstBuild = 3858292;
const soloBuild = 3870737;
const lastBuild = 3889387;

export const hasShootingTest = (changelist) => Number(changelist) >= firstBuild && Number(changelist) <= lastBuild;

// Whether the build's lobby offers it now.
export const shootingTestOn = (changelist, modes) => hasShootingTest(changelist) && modes?.[shootingTestMode] === true;

// The playlist's teams ({maxTeamCount, maxTeamSize, maxSquadSize}, matchmaking/service.js) on the build: solo from 2.4.2,
// squads before.
export const shootingTestTeams = (changelist) => (Number(changelist) >= soloBuild
  ? { maxTeamCount: 100, maxTeamSize: 1, maxSquadSize: 1 }
  : { maxTeamCount: 100, maxTeamSize: 4, maxSquadSize: 4 });

// The client-matchmaking region state's part that turns the queue on (every region's, services/fortnite/calendar.js).
export const shootingTestRegionState = () => ({ EventFlagsForcedOn: [shootingTestEventFlag] });

// UFortGlobals' setting ([/Script/FortniteGame.FortGlobals]) for the builds with the playlist.
export const shootingTestGlobals = (changelist) => (hasShootingTest(changelist) ? ["bShootingTest3Enabled=true"] : []);

// The build whose shipped ShootingModel3 is the one each build's hotfix brings in: 2.4 takes 2.4.2's, 2.4.2 takes 2.5's,
// and 2.5 ships its own.
const tableSource = { [firstBuild]: String(soloBuild), [soloBuild]: String(lastBuild) };
const tables = new Map();
function shippedTable(build) {
  if (!tables.has(build)) tables.set(build, buildGameData(build, "athena", {}).shootingModel ?? null);
  return tables.get(build);
}

// The [AssetHotfix] table the build takes ([{table, rows: [{Name, ...row}]}], events/contentupdates.js), or none.
export function shootingTestHotfixTables(changelist) {
  const source = tableSource[Number(changelist)];
  const model = source ? shippedTable(source) : null;
  if (!model) return [];
  return [{ table: model.table, rows: Object.entries(model.rows).map(([Name, row]) => ({ Name, ...row })) }];
}

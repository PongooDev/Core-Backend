import { currentBuild } from "../builds/context.js";
import { currentEventsConfig, seasonalEventsOn } from "./events.js";

// Season 3's sky and map ("Meteor Strike": the comet, the TVs' static, the meteors), which no event flag drives: no
// EventFlag.* in 3.6's (CL-4019403) paks or exe is Battle Royale's map's (events/events.js lists them all). The map's
// event actor, Athena/Events/BP_Athena_Event_Components, does it all:
// - The comet: on the dedicated server, CometPosition = MapRangeClamped(days from UtcNow to 30 April 2018, 20, 1, 0, 1),
//   replicated (OnRep_CometPosition -> SetupComet: CometMidTransform to CometEndTransform, C_Comet_Scale_Curve). It is the
//   gameserver's clock, not the backend's: 3.6 (24 to 30 April) saw 0.74 to 1, and any later date is 1, the comet at its
//   closest, as on the season's last day. Its shooting stars (P_Comet_ShootingStars, round(CometPosition * 3) + 1 of
//   them) follow it.
// - The rest reads the global AthenaGameData curve table (Athena/Balance/DataTables/AthenaGameData), whose rows 3.6's paks
//   ship at 0 for Epic's hotfixes to raise: Default.MeteorSpawnLevel (the server, > 0: SpawnMeteor, a multicast
//   P_Comet_ShootingStar_Large, every MapRangeClamped(level, 1, 2, 27, 8) * 0.7-2 s: level 1 to 2 is "progressively getting
//   worse"), Default.SkyboxAudioEnabled (the client, 1: Ambient_SkyboxLoop_Cue), Default.EasterEnabled (the rainbow) and
//   Default.StPatricksDayEnabled (the green river); and the TVs (Athena_Prop_Living_Television_01, the client) read
//   Default.BroadcastEnabled (1: the screen's Broadcast parameter, TV_StaticLoop_Athena_Cue and its static layers).
// The Fortnite Wiki's Season 3: "televisions around the island broadcasting static. For the last few days of the season,
// small meteor fragments would crash into the island", which is 3.6's week. So 3.6's DefaultGame.ini sets those rows
// with UE 4.20's [AssetHotfix] RowUpdate (events/contentupdates.js curveRowHotfixLines), by the admin's phase (events
// config meteorStrike; 🟡 the dates each started aren't recorded, so the phase is the admin's, default "meteors"):
// - "none": the paks' own rows (the comet and its shooting stars only);
// - "broadcast": the TVs' static and the skybox audio;
// - "meteors": and meteors at level 1;
// - "impact": and meteors at level 2, the most often.
// Easter's rainbow and St. Patrick's river (3.1 to 3.3's holidays) stay off.
export const meteorStrikeBuild = 4019403;
export const meteorStrikePhases = ["none", "broadcast", "meteors", "impact"];
export const defaultMeteorStrikePhase = "meteors";
const gameData = "/Game/Athena/Balance/DataTables/AthenaGameData.AthenaGameData";

export const sanitizeMeteorStrike = (value, current = defaultMeteorStrikePhase) =>
  (typeof value === "string" && meteorStrikePhases.includes(value.trim().toLowerCase()) ? value.trim().toLowerCase() : current);

// The phase the requesting build serves: null where it isn't 3.6 or the seasonal events are off.
export function meteorStrikePhase(changelist = currentBuild()) {
  if (Number(changelist) !== meteorStrikeBuild || !seasonalEventsOn()) return null;
  return sanitizeMeteorStrike(currentEventsConfig()?.meteorStrike);
}

// The AthenaGameData rows the phase sets: [{table, row, column, value}] (the column is the curve's key time, 0, the level
// EvaluateCurveTableRow reads).
export function meteorStrikeRows(changelist = currentBuild()) {
  const phase = meteorStrikePhase(changelist);
  if (!phase || phase === "none") return [];
  const level = { broadcast: 0, meteors: 1, impact: 2 }[phase];
  return [
    { table: gameData, row: "Default.BroadcastEnabled", column: "0", value: 1 },
    { table: gameData, row: "Default.SkyboxAudioEnabled", column: "0", value: 1 },
    ...(level ? [{ table: gameData, row: "Default.MeteorSpawnLevel", column: "0", value: level }] : [])
  ];
}

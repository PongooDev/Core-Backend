import { currentBuild } from "../builds/context.js";

// Content Update v4.40's Final Fight: Teams of 20 (PongooDev/CoreV2#325, events/ltms.js finalFight): 4.4.2's
// Playlist_Final_20 plays Athena/Playlists/Final's AthenaGameData, whose circles its paks ship as before the notes' changes:
// Default.SafeZone.01 (the first circle) waits 240 s, closes in 60 s to a 120,000 radius, and Default.SafeZone.02 is 80,000.
// The notes: "Circle 1: Time before the Storm starts closing in from 240s to 180s. Time for Storm to fully close in from 60s
// to 90s. Circle size from 120,000 units to 100,000 units. Circle 2: Circle size from 80,000 units to 65,000 units. Circle 3:
// Unchanged." Those "from" values are the paks', so Epic set the new ones by hotfix, as the backend does here: [AssetHotfix]
// RowUpdate lines on that curve table (events/contentupdates.js curveRowHotfixLine, at the curve's key time 0), served to
// 4.4.2's client and gameserver whether or not the mode is on (only Playlist_Final_* reads the table). 4.4.0 and 4.4.1 have
// no Final Fight (it came with 4.4.2's content update), so they get none.
export const finalFightBuild = 4132537;
const finalGameData = "/Game/Athena/Playlists/Final/AthenaGameData.AthenaGameData";
export const finalFightCircles = [
  { row: "Default.SafeZone.01.WaitTime", value: 180 },
  { row: "Default.SafeZone.01.ShrinkTime", value: 90 },
  { row: "Default.SafeZone.01.Radius", value: 100000 },
  { row: "Default.SafeZone.02.Radius", value: 65000 }
];

// The curve rows the requesting build's hotfix sets for Final Fight: [{table, row, column, value}].
export const finalFightRows = (changelist = currentBuild()) => (Number(changelist) === finalFightBuild
  ? finalFightCircles.map(({ row, value }) => ({ table: finalGameData, row, column: "0", value })) : []);

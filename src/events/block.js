import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows } from "./datedflags.js";
import { currentEventsConfig } from "./events.js";

// Season 7's The Block (PongooDev/CoreV2#476): the slab that landed on Risky Reels and showed a community-built Creative
// island each update. It isn't downloaded from Epic's island storage: every build it shows is a level in the paks, placed
// by the map's own blueprints, and the calendar's client-events channel picks which. How the two builds play it (FModel,
// each build's paks):
// - Athena_Terrain streams Athena_POI_Foundations (always loaded), whose level Blueprint and BP_SlabScripting_2
//   (Athena/Prototype/Blueprints/Slab/BP_SlabScripting, replicated, always relevant) run it. On the server
//   BP_SlabScripting watches its calendar names with a FortAsyncAction_CalendarEventWatcher each; the first one active
//   (OnEventActive) sets SlabPOIChanged, and only the first (LevelStateSetup): a match keeps the Block it started with.
//   OnRep_SlabPOIChanged then tells the level Blueprint (bound at its BeginPlay, or called at once when the value came
//   first), which acts only with authority.
// - 7.00 (CL-4629139) watches R0 and R1 from BeginPlay. R0 sets 0: LevelShouldBeHidden(false), and the level Blueprint's
//   HideLevel turns Risky Reels' plot on (LF_Athena_POI_25x30_2, Athena_POI_DriveIn_001, Dynamic_StartDisabled:
//   ABuildingFoundation::SetDynamicFoundationEnabled(true), which CoreV2 restores from 6.20). R1 sets 1:
//   LevelShouldBeHidden(true), and HideLevel's SpawnSlabBP spawns BP_SlabMesh (the slab, at 110336, 35726, -570) and two
//   BP_BlockSign (all replicated). 7.00 has none of the community builds. With neither event on, neither Risky Reels nor
//   the slab is there: an empty crater (CoreV2#476's report).
// - 7.10 (CL-4667333) watches slab1 to slab4 once the match's playlist has loaded (the game state's OnCurrentPlaylistLoaded),
//   unless its HotfixSlabDisabled (AthenaGameData Default.Slab.Disabled, 0 in its paks) reads 1. slabN sets N - 1 and
//   LoadSlabPOI turns plot SLAB_N on (each an LF_Athena_POI_25x25, Dynamic_StartDisabled, streaming Athena/Maps/Block/
//   7_10's level): SLAB_1 Block_25x25_Grimy_Greens, SLAB_2 _Risky_Runways, SLAB_3 _Risky_Market (Mysterious Markets),
//   SLAB_4 _Risky_FFA (DM Arena), in the order the Fortnite Wiki dates them. Disabled turns SLAB_BLANK on
//   (Athena/Maps/Block/POI_Block_Blank: the slab and its signs) and watches nothing. With no slab event and the switch off,
//   no plot: the empty crater again. 7.10's paks no longer have Risky Reels.
// So this serves each build its own names by Epic's dates on Season 7's replay (events/datedflags.js block700 and
// block710; the admin panel's two cards set custom times). 7.10's blank Block isn't served: a Core gameserver loads its
// match's playlist before it takes the hotfix (7.00's: the playlist's data at frame 393, the hotfix at 506, the calendar
// at 526), so a Default.Slab.Disabled row would come after BP_SlabScripting had read it; and 7.10 shipped with Grimy Greens
// up, so its dates start with it. The calendar comes after both builds' watchers are made, and a match keeps what it
// started with, so a change shows from the next match. It is the map, not an event: served whatever the Seasonal Events
// switch and the event mode say, and never off.
export const block700Build = 4629139;
export const block710Build = 4667333;
const blockEvents = { [block700Build]: "block700", [block710Build]: "block710" };

export const block700Event = datedEvent("block700");
export const block710Event = datedEvent("block710");
// The build's own (null: a build without BP_SlabScripting's calendar names).
export const blockEventOf = (changelist = currentBuild()) => datedEvent(blockEvents[Number(changelist)]) ?? null;

// The build's Block as calendar events in parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from
// the part that holds now on (the next changes), as events/distantfog.js's.
export function blockStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  const event = blockEventOf(changelist);
  if (!event) return [];
  const nowMs = now.getTime();
  const windows = datedWindows(event, datedSettings(config)[event.id], nowMs, seasonMoment(now, null, event.season).getTime());
  return datedParts(windows, nowMs, event.parts);
}

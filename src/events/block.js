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
// - 7.20 (CL-4727874) the same way with two: SLAB_1 streams Athena/Maps/Block/7_20's Block_25x25_LoomingLlama, SLAB_2
//   Block_25x25_OmegaPyramid (Athena_POI_Foundations' plots), BP_SlabScripting watching slab1 and slab2. 7.20's paks no
//   longer have 7.10's four.
// - 7.30 (CL-4834550) the same way, BP_SlabScripting watching slab1, slab2 and slab3: SLAB_1 streams Athena/Maps/Block/
//   7_30's Block_25x25_CoLLAMAsseum, SLAB_2 Block_25x25_StreetFestival, SLAB_3 POI_Block_Blank (the blank Block, which
//   Epic didn't show in 7.30: not served). 7.30's paks no longer have 7.20's two.
// - 7.40 (CL-5046157) the same way: SLAB_1 streams Athena/Maps/Block/7_30's Block_25x25_OilyOaks ("Oily Oaks",
//   MrSlickWillyz), SLAB_2 7_40's Block_25x25_ColossalCompound ("Colossal Compound", Aril_lian1), SLAB_3 POI_Block_Blank
//   (not served). 7.40's paks no longer have 7.30's two.
// - 8.00 (CL-5203069) the same way (CoreV2 #550): SLAB_1 streams Athena/Maps/Block/8_00's Block_25x25_CrypticCastle
//   ("Cryptic Castle", HellraiserGaming), SLAB_2 Block_25x25_TurtleTemple ("Turtle Temple", BOTIMUS-PRIME), SLAB_3
//   POI_Block_Blank (not served). 8.00's paks no longer have 7.40's two. Without a slab name its crater stays empty.
// - 8.20 (CL-5625478) the same way: SLAB_1 streams Athena/Maps/Block/8_20's Block_25x25_TropicalTreetops ("Tropical
//   Treetops", GingerJay91), SLAB_2 Block_25x25_MysteriousMansion ("Mysterious Mansion", FurryNenja), SLAB_3
//   POI_Block_Blank (not served); BP_SlabScripting still watches slab1 to slab3. 8.20's paks no longer have 8.00's two.
// - 8.30 (CL-5793395) the same way: SLAB_1 streams Athena/Maps/Block/8_30's Block_25x25_LlamaSphinx ("Llama Sphinx",
//   Prudiz), SLAB_2 Block_25x25_CordialCourtyard ("Cordial Courtyard", GonzoTheWizard), SLAB_3 POI_Block_Blank (not
//   served); BP_SlabScripting watches slab1 to slab3 as 8.20's. 8.30's paks no longer have 8.20's two.
// - 8.40 (CL-6005771): 8.30's Block exactly (the same two 8_30 levels on the same slabs, the same BP_SlabScripting), so it
//   plays block830's dates, the Fortnite Wiki's Cordial Courtyard from its own day, 17 April.
// - 8.50 (CL-6058028) the same way: SLAB_1 streams Athena/Maps/Block/8_50's Block_25x25_TrickyTracks ("Tricky Tracks",
//   Callum5tewart), SLAB_2 Block_25x25_AlienSanctuary ("Alien Sanctuary", Pr0Spartaner). 8.50's paks no longer have 8.30's
//   two (they keep 8_10's Harmony Hotel, which no slab streams).
// So this serves each build its own names by Epic's dates on Season 7's replay (events/datedflags.js block700 and
// block710, block720, block730, block740, block800, block820, block830 and block850; the admin panel's cards set custom times). 7.10's blank Block isn't served: a Core gameserver loads its
// match's playlist before it takes the hotfix (7.00's: the playlist's data at frame 393, the hotfix at 506, the calendar
// at 526), so a Default.Slab.Disabled row would come after BP_SlabScripting had read it; and 7.10 shipped with Grimy Greens
// up, so its dates start with it. The calendar comes after both builds' watchers are made, and a match keeps what it
// started with, so a change shows from the next match. It is the map, not an event: served whatever the Seasonal Events
// switch and the event mode say, and never off.
export const block700Build = 4629139;
export const block710Build = 4667333;
export const block720Build = 4727874;
export const block730Build = 4834550;
export const block740Build = 5046157;
export const block800Build = 5203069;
export const block820Build = 5625478;
export const block830Build = 5793395;
export const block840Build = 6005771;
export const block850Build = 6058028;
const blockEvents = { [block700Build]: "block700", [block710Build]: "block710", [block720Build]: "block720", [block730Build]: "block730",
  [block740Build]: "block740", [block800Build]: "block800", [block820Build]: "block820",
  [block830Build]: "block830", [block840Build]: "block830",
  [block850Build]: "block850" };

export const block700Event = datedEvent("block700");
export const block710Event = datedEvent("block710");
export const block720Event = datedEvent("block720");
export const block730Event = datedEvent("block730");
export const block740Event = datedEvent("block740");
export const block800Event = datedEvent("block800");
export const block820Event = datedEvent("block820");
export const block830Event = datedEvent("block830");
export const block850Event = datedEvent("block850");
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

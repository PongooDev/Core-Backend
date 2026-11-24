import { currentBuild } from "../builds/context.js";
import { seasonMoment } from "../store/itemshop.js";
import { datedEvent, datedParts, datedSettings, datedWindows } from "./datedflags.js";
import { currentEventsConfig, seasonalEventsOn } from "./events.js";

// The Unvaulting, Season 8's end-of-season live event (8.51, CL-6165369; 4 May 2019, 18:00 UTC). The Fortnite Wiki: the
// Vault under Loot Lake opened, players voted by pickaxing one of six crystals (Bouncers, the Drum Gun, the Grappler, the
// Infinity Blade, Planes, the Tactical SMG), the Drum Gun won and was unvaulted, and the volcano erupted, its three rocks
// hitting Retail Row, Polar Peak and Tilted Towers. How 8.51 plays it (its client paks decompiled; the gameserver's part is
// PongooDev/CoreV2's):
// - Athena/Prototype/Blueprints/White/BP_SnowScripting, placed in Athena_POI_Foundations, waits for the mesh network
//   (FortAsyncAction_MeshNetworkReady) and acts by the node type: a game server (Edge), once the playlist has loaded
//   (not in Creative or Playground), watches GWS1, GWS0 and GWLevel with FortAsyncAction_CalendarEventWatcher (only
//   OnEventActive acts); the mesh's root watches WarmupEvents (GWW1 to GWW5) and BP_SnowBase's runes their GW1 to GW5.
// - GWS1 is the countdown: its TimeUntilEnd sets ServerWorldSecondsAtEvent (replicated: the beacon's clock over the Vault),
//   re-read every 15 seconds and 300 seconds before the end. With under 30 minutes left it sets the time of day to reach
//   18:00 at the end and the final circle over the Vault (66048, -43008), and ImmunityLeadUpTime (60 s) before the end
//   makes everyone invincible with no safe zone. So GWS1 ends at the event.
// - GWS0 is the event: its TimeSinceBegin is how far in a match joins it (the gateway sequence plays from there within
//   TeleportToPillarsTime, 60 s; later joiners are pushed back with the storm), then the vote on the pillars
//   (BP_DirtShell_Pillars: 150 s at most, AutoCompleteTimeHotfix), the outro (SnowOutroMap, 35 s after the vote, 60 s
//   long, its three foundation swaps at 14.93, 32.15 and 53.94 s), the reversed storm and the ash.
// - GWLevel streams in Next2, the sky above the Vault the players are taken to (never streamed out).
// - PGW is the island after it: BP_SnowScripting's UseNewTOD (TODM_BR_S8Hot2, the ash sky) and the three
//   BP_CalendarDynamicPOISelect (map key PGW, root and inner nodes) swap Retail Row's (LF_Athena_StreamingTest20_GE),
//   Polar Peak's (IcebergFoundation_GE) and Tilted Towers' (LF_Athena_POI_50x51_GE) foundations for their hit ones.
// - GW5 is the fifth rune over the volcano (BP_SnowAlwaysRelevant streams Athena/Maps/Test/S8/HappyMap while it is active,
//   on game servers and clients) and GWW5 its hologram (the root's warm-up). 8.51's class defaults have the first four
//   runes done (ChallengeStates Complete, Complete, Complete, Complete, Uninitialized), as 8.51 shipped after them.
// - The vote's result isn't the calendar's: BP_DirtShell_Pillars' winner (the crystal hit most) is UnvaultedItemName,
//   kept in the mesh network's metadata (key SnowScripting) with the pillars' time, and a game server's
//   OnRep_UnvaultedItemName sets its loot weights (SetNamedWeightForContainerLootRoll, the GW.* rows of AthenaGameData:
//   GW.DrumGun 0.85; 8.51's AthenaLootPackages_Client rows name them as NamedWeightMult). Nothing of it is the backend's.
// So the backend's half is the calendar (services/fortnite/calendar.js): those six names, each in activeEvents with its
// activeSince and activeUntil, in states whose validFrom is when they change (events/datedflags.js unvaulting): Epic's
// dates on Season 8's replay (the default), the admin's times, or off (the island as it was before, no countdown). A
// running Core gameserver fetches the calendar within 5 seconds of a change (CoreV2's AFortGameModeAthena::
// AskEventCalendarRevision), so "Start now" (or a time) on the event's step plays it in the matches running then; a time a
// few minutes ahead gives them the countdown's last minutes too. Not with the seasonal events off or in another event mode.
export const unvaultingEvent = datedEvent("unvaulting");
export const unvaultingBuild = 6165369;

// The Unvaulting's calendar events as parts [{validFrom (ms), events: [{eventType, activeSince, activeUntil}]}], from the
// part that holds now on: on 8.51 with the seasonal events on, in the Automatic mode.
export function unvaultingStates(now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) {
  if (Number(changelist) !== unvaultingBuild || !seasonalEventsOn() || (config?.mode ?? "auto") !== "auto") return [];
  const nowMs = now.getTime();
  const windows = datedWindows(unvaultingEvent, datedSettings(config).unvaulting, nowMs,
    seasonMoment(now, null, unvaultingEvent.season).getTime());
  return datedParts(windows, nowMs, unvaultingEvent.parts);
}

// The Unvaulting's names served now (none outside its steps).
export const unvaultingFlagsNow = (now = new Date(), changelist = currentBuild(), config = currentEventsConfig()) =>
  (unvaultingStates(now, changelist, config)[0]?.events ?? []).map(({ eventType }) => eventType);

import { getItem } from "../gamedata/items.js";
import { getQuest } from "../gamedata/quests.js";
import { seasonMoment } from "../store/itemshop.js";
import { frostnite2018, isEventActive } from "./events.js";
import { snowflakeTickets } from "./winter2017.js";

export { frostnite2018 };

// Frostnite (7.10, CL-4667333; events.js frostnite2018, EventFlag.Frostnite, run to 7.30), Save the World's winter event of
// 2018. Update v7.10: "Frostnite is a new experience in 7.10, testing player's survival in a long winter night ... Keep
// the Burner filled with scavenged BluGlo ... Keep an eye out for the Krampus Smashers who dwell in these cold regions
// ... The longer you survive the more Snowflake Tickets you will earn! Tickets can be spent on the new Winter Llama.
// Added several event quests that can be completed by playing Frostnite. Be on the lookout for weekly challenges in the
// coming weeks!" Its missions are on the map in a theater of their own (world/frostnite.js); its tickets are 2017's
// Snowflake Tickets again (AccountResource:EventCurrency_Snowballs, events/winter2017.js), which 7.10's quests give.

// The Winter Llama (CardPack_Event_2018_Winter, "Guarantees at least one Epic or better limited time Medieval weapon or
// Holiday Hero!"; Update v7.10: Jolly Headhunter and Sgt. Winter "available in the Winter Llama", "Added the Medieval
// weapons set, available in Winter Llamas"), store/catalog.js.
export const winterLlama2018 = "CardPack:cardpack_event_2018_winter";

// The event's quests nothing in 7.10's data grants (Epic's servers handed them out), granted at quest login while it
// runs: every WinterQuest_2018 quest no other quest names as a reward.
// - Frostnite's own (their stats' context is the theater's tag, Stat.Theater.Endless, world/frostnite.js): Collect_BluGlo
//   (200 BluGlo into the Burner), Collect_Treasure, CraftTraps, Exploration, and Survive_15m, _30m and _45m, the notes'
//   Jingle Jess ("Frostnite quest reward for surviving 15 minutes"), Ginger Blaster (30) and Sentry Gunner Krampus (45).
// - The holiday's, in every mission: CompleteMissionAlerts, KillCoalLobbers, KillEvilHelpers, KillMallSantas,
//   KillMistMonsters, KillKrampus, KillLoneKrampus (Frostnite's Lone Krampus targets), SaveSurvivors.
// - Its questline: Reactive_Fetch_PackingPresents starts it; Hidden_1 to _7 each wait for the stage before
//   (questcomplete_<quest>) and grant the next (the trees, the decorations, the deployed trees, the fridges, the present,
//   the Frozen Troll, and Landmark_CelebrateNewYear, Legendary hero HID_Commando_025). Nothing grants _2 to _7, so all
//   seven are given at the start, as Into the Storm's Hidden_1 (events/storm2018.js).
// - Hidden_WatchVideo counts the event's video (a hidden quest, no reward).
export const frostniteQuests = [
  "winterquest_2018_frostnite_collect_bluglo",
  "winterquest_2018_frostnite_collect_treasure",
  "winterquest_2018_frostnite_crafttraps",
  "winterquest_2018_frostnite_exploration",
  "winterquest_2018_frostnite_survive_15m",
  "winterquest_2018_frostnite_survive_30m",
  "winterquest_2018_frostnite_survive_45m",
  "winterquest_2018_completemissionalerts",
  "winterquest_2018_killcoallobbers",
  "winterquest_2018_killevilhelpers",
  "winterquest_2018_killmallsantas",
  "winterquest_2018_killmistmonsters",
  "winterquest_2018_killkrampus",
  "winterquest_2018_killlonekrampus",
  "winterquest_2018_savesurvivors",
  "winterquest_2018_reactive_fetch_packingpresents",
  ...Array.from({ length: 7 }, (_, index) => `winterquest_2018_hidden_${index + 1}`),
  "winterquest_2018_hidden_watchvideo"
];

// The weekly Frostnite challenges ("Be on the lookout for weekly challenges in the coming weeks!"). Each week is a
// challenge mission (MissionGen_Endless_Challenge_*, its MissionInfo's modifiers) and a quest pair: the week's _Minor quest
// (survive 30 minutes of it, its stat's context Stat.Theater.Endless.Week0<n>) gives a Legendary schematic and, hidden,
// its _Major (three times), which gives a Frostnite banner and 500 Snowflake Tickets. The Fortnite Wiki's Frostnite gives
// the weeks' dates: Slip Out from 30 December 2018 ("Touching snow or ice will cause players to slide") and Burn Bright
// from 8 January 2019 ("Time between enemy waves is drastically reduced"), 7.10's two; then New Wave Holiday (15 January,
// Update v7.20), Cold Chaos (22 January), Uncharted Territory (29 January), Trap Attack (5 February) and Top It Off (14
// February), whose missions 7.10 already ships. A build runs a week once Season 7's replay is past its day (🟡 00:00
// UTC: the hour isn't recorded) and its data has both the week's mission and its quest, the newest such week at a time:
// 7.10 runs week 1 and then week 2, and keeps week 2 on (its data has no later quest).
export const frostniteWeeks = [
  { week: 1, from: "2018-12-30T00:00:00.000Z", name: "Slip Out", generator: "MissionGen_Endless_Challenge_SlipOut" },
  { week: 2, from: "2019-01-08T00:00:00.000Z", name: "Burn Bright", generator: "MissionGen_Endless_Challenge_BurnBright" },
  { week: 3, from: "2019-01-15T00:00:00.000Z", name: "New Wave Holiday", generator: "MissionGen_Endless_Challenge_NewWaveHoliday" },
  { week: 4, from: "2019-01-22T00:00:00.000Z", name: "Cold Chaos", generator: "MissionGen_Endless_Challenge_ColdChaos" },
  { week: 5, from: "2019-01-29T00:00:00.000Z", name: "Uncharted Territory", generator: "MissionGen_Endless_Challenge_UnchartedTerritory" },
  { week: 6, from: "2019-02-05T00:00:00.000Z", name: "Trap Attack", generator: "MissionGen_Endless_Challenge_TrapAttack" },
  { week: 7, from: "2019-02-14T00:00:00.000Z", name: "Top It Off", generator: "MissionGen_Endless_Challenge_TopItOff2" }
];
export const frostniteWeekQuest = (week) => `winterquest_2018_frostnite_survive_challenge_week${week}_minor`;
const weekQuests = (week) => [frostniteWeekQuest(week), `winterquest_2018_frostnite_survive_challenge_week${week}_major`];

// The week the requesting build runs now (null before the first), of those its world data has the mission of
// (hasGenerator: world/frostnite.js passes its data's check).
export function frostniteWeekNow(now = new Date(), hasGenerator = () => true) {
  const moment = seasonMoment(now, null, 7).getTime();
  return [...frostniteWeeks].reverse().find(({ week, from, generator }) => moment >= Date.parse(from) && getQuest(frostniteWeekQuest(week))
    && hasGenerator(generator)) ?? null;
}

// Every week's quests, for the event's quest line (events/quests.js).
export const frostniteLineQuests = [...frostniteQuests, ...frostniteWeeks.flatMap(({ week }) => weekQuests(week))];

// The requesting build's Frostnite quests, when the event runs there: with the week's challenge quest.
export function frostniteEventQuests(now = new Date()) {
  if (!isEventActive(frostnite2018)) return [];
  const week = frostniteWeekNow(now);
  return [...frostniteQuests, ...(week ? [frostniteWeekQuest(week.week)] : [])].filter((questId) => getQuest(questId));
}

// Its Event Store (store/eventstore.js). Update v7.10: "Cloaked Shadow Ninja added to the Event Store ... Legendary
// variant of Skirmisher subclass ... Available December 19 at 7 PM Eastern Time" (Hero:HID_Ninja_020_SR_T01, "Cloaked
// Shadow", new in 7.10's data), at a legendary hero's 2,800 Gold, one (🟡 the notes give no price: Fortnitemares 2018's
// legendary heroes'; from 7.10's release, not 20 December 00:00 UTC). Its trackers are Winter2018.* (Core's name).
export const frostniteEventItems = [{ templateId: "Hero:hid_ninja_020_sr_t01", price: 2800, limit: 1 }];
// 🟡 When the event's store closes: Frostnite ran past 7.20 to Season 7's end (its weekly challenges to 7.40), so its items
// count down to Season 8's first day, 28 February 2019, on Season 7's replay.
export const frostnite2018StoreEnd = "2019-02-28T00:00:00.000Z";

// Frostnite's tickets "the longer you survive": a run's rewards are its zone's Frostnite Rewards pack
// (ZCP_Endless_T01-T08, "Event Tickets, Gold, and an assortment of Rare items, based on how long you survive!",
// world/frostnite.js and cardpacks/contents.js), and how long it lasted is the wave badges the gameserver reports with
// EndPrimaryMission (EndlessMode_Badge_Wave_01 to _30, Mission_Endless' GrantRewardBadge for each wave won: "Frostnite -
// Wave N Completed"). Neither carries an amount in the data (Epic's servers rolled them), so Core's (🟡): each wave badge
// gives snowflakePerWave Snowflake Tickets (profiles/badges.js), a full 30-wave run 300.
export const snowflakePerWave = 10;
export const isFrostniteWaveBadge = (templateId) => /^worlditem:endlessmode_badge_wave_\d\d$/i.test(templateId ?? "");
export const frostniteWaveTickets = (templateId, count) => (isFrostniteWaveBadge(templateId) && getItem(snowflakeTickets)
  ? [{ templateId: snowflakeTickets, quantity: snowflakePerWave * count }] : []);

// Frostnite's backpack. "Survive as long as you can without your gear or resources, using your survival skills,
// schematics, and basic starting weapons ... You don't keep any weapons or traps when the experience concludes" (Update
// v7.10), and the loading screen's "Your backpack and starting gear is limited". The gameserver keeps a player's world
// inventory in the world profile theater<TheaterSlot>: AFortGameMode::TheaterSlot (+0x578 on 7.10) is the theater's
// FFortTheaterMapData TheaterSlot, the world info's theaterSlot, and the profile id is built from it ("theater%d", 7.10
// 0x11C4BA0 reads it through the game mode's slot 0x12B, 0xC2DF30: mov eax, [rcx+578h]). So Frostnite's theater
// (world/frostnite.js) says theaterSlot 1 and its runs keep their own backpack, theater1, which the starting inventory
// Mission_Endless gives (GiveStartingInventoryToPlayers) and its supply drops fill (🟡 the slot is Core's reading: the
// notes say the gear isn't the player's, not which profile Epic used). A run's end (its EndPrimaryMission, won or lost)
// is noted on that profile, and the next run's world profile lock (the gameserver's LockProfiles at the player's
// registration, services/mcp/commands/server.js) empties it first: the run's last save (at unregistration, after
// EndPrimaryMission) never reaches the next run, and a player who reconnects mid-run keeps what they had.
export const frostniteTheaterSlot = 1;
export const frostniteWorldProfile = `theater${frostniteTheaterSlot}`;

// Notes that a player's Frostnite run ended (EndPrimaryMission of a Frostnite mission): Core's stat on the backpack
// profile, a tracked change, so the profile is saved with it.
export const frostniteRunEndedStat = "core_frostnite_run_ended";
export function noteFrostniteRunEnded(session) {
  const tracker = session.profile(frostniteWorldProfile);
  if (tracker.profile.stats?.attributes?.[frostniteRunEndedStat] !== true) tracker.setStat(frostniteRunEndedStat, true);
}

// At the gameserver's lock: empties the Frostnite backpack of a run that ended. Returns how many items went.
export function clearEndedFrostniteRun(session) {
  const tracker = session.profile(frostniteWorldProfile);
  if (tracker.profile.stats?.attributes?.[frostniteRunEndedStat] !== true) return 0;
  const itemIds = Object.keys(tracker.profile.items ?? {});
  for (const itemId of itemIds) tracker.removeItem(itemId);
  tracker.removeStat(frostniteRunEndedStat);
  return itemIds.length;
}

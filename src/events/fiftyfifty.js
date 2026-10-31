import { getAthenaQuest } from "../gamedata/athena.js";
import { regionCodes } from "../matchmaking/regions.js";
import { fiftyFifty, isEventActive } from "./events.js";

export { fiftyFifty };

// 50v50, Battle Royale's limited-time playlist from 1.10 (CL-3790078), run as the event its flag names (events.js).
//
// The lobby's Match Type lists it ("50v50", Fortnite.FortAthenaMatchmakingWidget SquadPlaylistFiftyFifty) with the
// "50v50 Now Available!" bang over it while UFortGlobalUIContext::IsFiftyFiftyQueueEnabled (1.10 0x20C62C0; the widget's
// list 0x21469A0, AthenaMatchmakingWidget's RefreshBang): UFortGameInstance's bBattleRoyaleFiftyFiftyQueueEnabled, the
// player's region not in its RegionsWithBattleRoyaleFiftyFiftyQueueDisabled, and UFortGlobals' b50v50ForceEnabled or
// its b50v50CalenderEventEnabled with the region's FFortMatchmakingRegionState bFiftyFiftyEnabled. That state is the
// calendar's client-matchmaking channel (FFortMatchmakingEventsState {Region: {<region id>: FFortMatchmakingRegionState
// {bDuosEnabled, bFiftyFiftyEnabled, EventFlagsForcedOn, EventFlagsForcedOff}}}, UFortSeasonalEventManager 0x7EA110);
// a region it doesn't list has the struct's defaults, duos on and 50v50 off. 1.10's DefaultGame.ini turns the queue and
// the calendar switch on and the force off, so the calendar decides (services/fortnite/calendar.js). Ready then queues
// bucket <netcl>:0:<region>:11 (0x2142C20 maps EFortAthenaPlaylist::AthenaFiftyFifty to playlist 11, sending the Squad
// Fill choice as player.option.fillTeam), which matchmaking/service.js forms into two teams of 50.

// The event's quest, which nothing in the game data grants (Epic's servers handed it out while 50v50 ran): Play 50v50
// Matches (AthenaEvent_FiftyFifty_PlayMatches, EFortQuestType::AthenaEvent, QuestCategoryTable BREvent): three matches
// for 1000 season XP. 1.10's lobby challenges list it under their event quests (DailyQuestsPanel's EventQuestList) and
// collect it after the dailies (ClaimNextCompletedQuestReward of AthenaDailyQuest, then AthenaEvent).
export const fiftyFiftyQuests = ["athenaevent_fiftyfifty_playmatches"];

// Battle Royale's event quests (the athena quest log's), by event.
const athenaEventQuests = [{ name: fiftyFifty, quests: fiftyFiftyQuests }];

// The requesting build's Battle Royale event quests its data has, of the events it runs now (granted at quest login)
// or of those it doesn't (whose unfinished quests leave the quest log, as Save the World's do, events/quests.js).
export function athenaEventQuestsOf({ running }) {
  return athenaEventQuests.filter(({ name }) => isEventActive(name) === running)
    .flatMap(({ quests }) => quests).filter((questId) => getAthenaQuest(questId));
}

// The calendar's client-matchmaking state while 50v50 runs: every region with it on, duos staying on as the struct's
// default has them. The client looks its own region up (UQosRegionManager::GetRegionId: NA, EU, OCE, BR, ASIA or a
// hidden one in 1.10's Datacenters, or what -McpRegion forces), case-insensitively as FString map keys are, so each
// spelling Core knows is listed.
export function fiftyFiftyRegions() {
  return Object.fromEntries(regionCodes().map((region) => [region, { bDuosEnabled: true, bFiftyFiftyEnabled: true }]));
}

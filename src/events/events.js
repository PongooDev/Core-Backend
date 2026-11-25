import { AsyncLocalStorage } from "node:async_hooks";
import { currentBuild } from "../builds/context.js";
import { buildVersions } from "../builds/detect.js";
import { season4Overrides } from "./season4flags.js";

// The seasonal events Core runs. A build runs the event its own update shipped, for as long as it is played: Epic
// switched events on and off from its servers (its event flags and calendar), so which builds run one is Core's choice.
//
// Fortnitemares (Halloween 2017) shipped with 1.8 (CL-3724489) and ran through its patches 1.8.1 (CL-3729133) and
// 1.8.2 (CL-3741772), and 1.9 (CL-3757339), whose notes extend it to 29 November. 1.9.1 (CL-3775276) ended it. Its content waits for EventFlag.Fortnitemares, the only event flag 1.8's paks add (1.7.2's are
// EventFlag.FirstStorm and EventFlag.Horde): the front end's "View Event" button and the event's quest pages
// (HomeScreenNextQuest UpdateButtonBasedOnEventStatus: BorderQuestMapToggle shows when the quest manager's
// IsEventFlagActive("EventFlag.Fortnitemares") or the player holds ProtoEnableQuest).
export const fortnitemares = "EventFlag.Fortnitemares";

// The Mutant Storms (events/mutantstorms.js) came back with 1.9.1 (CL-3775276), whose notes end Fortnitemares and
// return them; their content waits for EventFlag.Vindertech, the flag 1.9.1's StormCategory mission alerts require.
// 1.10 (CL-3790078) keeps them (its notes change how their alerts appear, world/theaters.js) under another flag: its
// StormCategory rows require EventFlag.ActiveStorms, and no 1.10 data names EventFlag.Vindertech. So the event is
// named apart from its flags (mutantStorms), each build running it under the flag its own data asks for.
export const mutantStorms = "MutantStorms";

// Battle Royale's 50v50 (events/fiftyfifty.js), the limited-time playlist 1.10 (CL-3790078) shipped: its
// BR_Playlist_50v50 (AthenaCustomPlaylistEvent, PlaylistId 11) requires EventFlag.BR.Allow50v50, and its quest
// (Athena/Items/Quests/Events/Winter2017_50v50) is the event's. 1.9 and 1.9.1 have the playlist's code but no asset or
// quest, and their DefaultGame.ini turns the queue off (UFortGameInstance bBattleRoyaleFiftyFiftyQueueEnabled=false);
// 1.10's turns it on and leaves the rest to the calendar (UFortGlobals b50v50CalenderEventEnabled=true). 1.11
// (CL-3807424) keeps its quest, and its notes fix 50v50's screen ("Improved visibility of the number of players remaining
// on each team in 50v50 mode"), so it runs there too.
export const fiftyFifty = "EventFlag.BR.Allow50v50";

// Survive the Holidays (events/winter2017.js), Save the World's winter event 1.11 (CL-3807424) shipped: "The Fortnite
// Guide to Holiday Survival is here!" Its content waits for EventFlag.Winter2017, the flag 1.11's MiniBossCategory and
// Survival3Day/7DayCategory mission alerts require. Its notes end the Mutant Storms ("With the end of the Mutant Storms
// event, every 1,000 unspent Storm Tickets will be converted to a storm llama", events/stormllamas.js) and keep storms on
// the map without tickets ("Note that while Mutant Storms are also present on the map to provide evolution materials,
// these do not reward event tickets", "You can now complete up to four Mutant Storms per day"): 1.11's StormLowCategory
// rows (quota 4) require EventFlag.PassiveStorms, its StormCategory rows still EventFlag.ActiveStorms, which it doesn't
// run.
export const winter2017 = "EventFlag.Winter2017";
export const passiveStorms = "EventFlag.PassiveStorms";

// Battle Royale's winter lobby (1.11, CL-3807424; Core-Backend #145: "Battle royal does not have the winter background").
// 1.11's LobbyBG_Winter (Items/Events/Shared, LobbyBackgroundTakeoverEvent) puts the lobby in Frontend_Lobby_Winter while
// its RequiredEventTag, EventFlag.LobbyWinterDecor, is on, as LobbyBG_Halloween did with EventFlag.LobbyHalloweenDecor;
// the seasonal event manager takes its flags from the calendar's client-events state (services/fortnite/calendar.js).
// The holiday Battle Bus (BR_Decor_WinterBus's EventFlag.WinterBattleBus) flew all through Season 2's Winterfest, as
// players' 1.11 matches show (CoreV2 #176); the gameserver takes its flags from the same calendar. Its supply drops came
// down gift-wrapped too (BR_Decor_SupplyDropGift's EventFlag.SupplyDropGift, CoreV2 #176). The last winter event,
// BR_Winter_CandyCaneGuns' EventFlag.BR.CandyCaneGuns, changes the match's weapons and is left off (🟡: nothing found
// says when Epic ran it).
export const lobbyWinterDecor = "EventFlag.LobbyWinterDecor";
export const winterBattleBus = "EventFlag.WinterBattleBus";
export const supplyDropGift = "EventFlag.SupplyDropGift";

// 2.1 (CL-3825894, 10 January 2018) keeps all of 1.11's events: its data has the same mission alerts, quests, event
// items and playlists, and its notes end none of them. The next update ended them: 2.2.0's notes end the Battle Royale
// Winter event on 18 January (and remove "the winter theme from the pre-game lobby"), and "The Save the World winter
// event has been extended until January 24".
//
// 2.2 (CL-3841827, 18 January 2018) so runs Save the World's half: Survive the Holidays (its MiniBoss and Survival
// alerts still require EventFlag.Winter2017, its Event Store and Holiday Survival Llamas are 1.11's) and the ticketless
// storms (its StormLowCategory rows still require EventFlag.PassiveStorms), but not Battle Royale's: no winter lobby,
// holiday Battle Bus or gift-wrapped supply drops ("Thank you all for being a part of our 2017 Battle Royale Winter
// event!"). 50v50 stays: 2.2's BR_Playlist_50v50 still waits for EventFlag.BR.Allow50v50, its quest
// (AthenaEvent_FiftyFifty_PlayMatches) is still there, and its notes end only the winter event.
// The Save the World home screen's winter "View Event" tile is this event's: 2.2's HomeScreenNextQuest
// (UpdateButtonBasedOnEventStatus) shows BorderQuestMapToggle while IsEventFlagActive("EventFlag.Winter2017") or the
// player holds ProtoEnableQuest, and the button opens Winter2017_QuestMapWidget (the event's quest map, with
// WinterEvent2017QuestMapTile's WinterQuest_2017 side quests). Survive the Holidays outlived 2.2: Epic's 2.3.0 notes
// (24 January 2018) say "The Save the World Winter event ends on January 25", so 2.2 showed the tile all its life.
//
// 2.3 (CL-3847564, 25 January 2018) ends Survive the Holidays: "The Save the World Winter event ends on January 25" and
// "As the snow from Survive the Holidays melts, the Mutant Storms return!" Its data is 2.2's (the same mission alert
// rows, quests, llamas and playlists: what changed was Epic's servers'), so the return is the storms its StormCategory
// rows wait for, EventFlag.ActiveStorms (1.10's flag), under an event of its own, mutantStorms2018
// (events/mutantstorms.js): "Hydraulic Weapons and Storm Zone Heroes have returned, and are available in the Storm
// Llamas", the first storms' Hydraulic quests and Storm Llama rather than 1.9.1's Vindertech ones. Survive the Holidays
// and its ticketless storms (EventFlag.PassiveStorms, "storms on the map without tickets" while no Mutant Storms ran)
// stop at 2.2 (🟡: 2.3's notes name no ticketless storms), so 2.3's Snowflake Tickets become Holiday Survival Llamas
// (events/winter2017.js). 50v50 stays: 2.3's BR_Playlist_50v50 and its quest are 2.2's, and its notes end no playlist.
//
// 2.4 (CL-3858292, 31 January 2018) runs the same storms: its notes end no event and start none (no Valentine's or
// Lunar New Year: those were 2.5's, and 2.4's data has no flag, quest or llama for them), and its data writes down what
// Epic's servers did on 2.3. Its StormCategory rows are 2.3's (EventFlag.ActiveStorms); its Mini-Boss rows
// (MiniBossCategory, MissionAlert_MiniBoss) wait for a flag of their own, EventFlag.ActiveMiniBosses, in place of
// EventFlag.Winter2017; and its storms have quests of their own (Quests/Events/MutantStorms2018, events/mutantstorms.js).
// So 2.4 runs mutantStorms2018 on both flags. Its General rows now carry the Mini-Boss modifier (MinibossTG) behind
// EventFlag.PassiveMiniBosses, but a General alert is no Mini-Boss one to the game (its category's tag is
// Stat.MissionAlert.General, not the Stat.MissionAlert.MiniBoss the Mini-Boss quest counts, nor MissionAlert.Visual.
// Miniboss), and 2.3's notes say the Mini-Boss alerts replaced the generic ones, so that flag stays off (🟡 Core's
// choice). 50v50 stays: 2.4's BR_Playlist_50v50 and quest are 2.3's, and its notes end no playlist.
//
// 2.4.2 (CL-3870737, 8 February 2018) runs on as 2.4 did: its notes end no event and start none ("For our Save the World
// fans, our new Valentines themed quest starts next week!": the Valentine's event is 2.5's, "Upcoming Releases: Patch
// 2.5.0 - Valentine's Event"), and its data keeps 2.4's flags (its StormCategory rows on EventFlag.ActiveStorms, its
// Mini-Boss rows on EventFlag.ActiveMiniBosses), the storms' quests and the 50v50 playlist. Its data already has the
// Valentine's quests (LoveQuest_2018_Reactive_*) and spring's (SpringQuest_2018_*), but no flag or quest line starts
// them, and its notes don't, so they stay off.
//
// 2.5 (CL-3889387, 13 February 2018) ends the storms and starts Spring It On! (events/spring2018.js): "Mutant Storm and
// Miniboss Mission Alerts are not tied to this event. Both have returned to their lower "passive" levels of activity, and
// neither awards event tickets. Up to 3 Mutant Storms in Stonewood, 10 in other locations. | Quota: 4 per day. Up to 3
// Miniboss Alerts in Stonewood, 6 in other locations. | Quota: 3 per day." Its alert rows are 2.4's: the passive storms
// are its StormLowCategory rows (EventFlag.PassiveStorms, quota 4), the passive Mini-Bosses its General rows, which
// carry the Mini-Boss modifier (MinibossTG) behind EventFlag.PassiveMiniBosses (quota 3); its StormCategory and
// MiniBossCategory rows (EventFlag.ActiveStorms, EventFlag.ActiveMiniBosses) stay off, so mutantStorms2018 ends with
// 2.4.2 and its Storm Tickets become Storm Llamas (events/stormllamas.js). Spring It On! runs on the flags 2.5's home
// screen and quest map look for (HomeScreenNextQuest UpdateButtonBasedOnEventStatus, Spring2018_QuestMapWidget
// RefreshPagesEnabled: IsEventFlagActive of EventFlag.Spring2018Valentines and EventFlag.Spring2018Phase1 to Phase4):
// the Valentine's phase and the first, Lunar New Year's (13 and 16 February; 🟡: Phase2 to Phase4 are left to the later
// updates, as nothing in 2.5's notes starts them). 50v50 stays: 2.5's BR_Playlist_50v50 and quest are 2.4.2's, and its
// notes end no playlist.
//
// 3.0 (CL-3901517, 21 February 2018) runs on as 2.5: its alert rows are 2.5's (the passive storms and Mini-Bosses), and
// Spring It On! continues: "'Spring It On!' event chapter, 'Luck Explosion' unlocks! Ring in the Lunar New Year with
// explosive new quests and activities. Get your Dragon Weapon of choice as the quest line reward." Its quest map
// (Spring2018_QuestMapWidget) shows Luck Explosion's pages (Spring2018_MapPage_02a and _02b) from EventFlag.Spring2018Phase1
// with Love Storm's, Brave Beginnings' from Phase2 (3.1's notes: "Spring it On! continues, adding new questline 'Brave
// Beginnings'"), Luck of the Storm's from Phase3 and The Dreaded Clusterhusk's from Phase4, so 3.0 runs
// EventFlag.Spring2018Valentines and Phase1, as 2.5 already did (Core ran Luck Explosion from 2.5, before its notes'
// 3.0). 3.0's data extends the chapter (Reactive_Fountains between the lanterns and the Firework Clusters, then
// EvolveDragonWeapon, KillHusksDragonWeapon and KillMistMonstersDragonWeapon), reached through the quests 2.5's line
// already grants. 50v50 ends with 2.5: 3.0's Athena_GameMode has no playlist class for playlist 11 (events/ltms.js).
//
// 3.1 (CL-3915963, 28 February 2018) runs on as 3.0 (its alert rows and categories are 3.0's) and adds Spring It On!'s
// next chapter: "'Spring it On!' continues, adding new questline 'Brave Beginnings'. ... Join the brave survivor on her
// mission to join in the battle against the storm as a defender." 3.1's Spring2018_QuestMapWidget (RefreshPagesEnabled)
// shows Brave Beginnings' pages (Spring2018_MapPage_03a, _03b, "Spring It On! - Brave Beginnings") from
// EventFlag.Spring2018Phase2, which also keeps Love Storm's and Luck Explosion's (pages 0 to 5), so 3.1 runs Phase2 too.
// Page 03a's first tile is SpringQuest_2018_Reactive_RescueVal, Val's line, which Core already grants from 2.5
// (events/spring2018.js; 🟡: before its notes' 3.1), so the chapter needs no new quest. Phase3 (Luck of the Storm) and
// Phase4 (The Dreaded Clusterhusk) stay off: nothing in 3.1's notes starts them.
export const mutantStorms2018 = "MutantStorms2018";
export const activeMiniBosses = "EventFlag.ActiveMiniBosses";
export const passiveMiniBosses = "EventFlag.PassiveMiniBosses";
export const spring2018 = "Spring2018";
export const spring2018Valentines = "EventFlag.Spring2018Valentines";
export const spring2018Phase1 = "EventFlag.Spring2018Phase1";
export const spring2018Phase2 = "EventFlag.Spring2018Phase2";
// 3.3 (CL-3942182, 15 March 2018): "Next chapter of Spring it On! unlocks - 'Luck of the Storm'." The quest map shows Luck of
// the Storm's pages from EventFlag.Spring2018Phase3 (3.0's RefreshPagesEnabled, with Phase1, Phase2 and Phase4), so 3.3 runs
// Phase3 too, and Spring It On! (Phase1, Phase2, the passive storms and Mini-Bosses, group missions) runs on as 3.2's. Its
// line starts at SpringQuest_2018_Reactive_PotsOfGold (events/spring2018.js), which leads through the clovers and the
// Leprechaun traps to the Pub quest (an Epic Leprechaun survivor and a choice of three Legendary St. Patrick's heroes, in
// 3.2's data already). Phase4 (The Dreaded Clusterhusk) stays off: nothing in 3.3's notes starts it.
export const spring2018Phase3 = "EventFlag.Spring2018Phase3";
// 3.2 (CL-3935073): "Every Group Mission now has a Mission Alert that awards Firecracker Tickets." 3.2's MissionAlerts
// adds MissionAlert_GroupMissionCategory_01-04 (category GroupMissionCategory, loot tier group MissionAlert_GroupMission,
// tile difficulty 5-11, 12-21, 22-31, 32-50), which require EventFlag.GroupMission; 3.1's data has no such row or flag
// (world/theaters.js places them).
export const groupMission = "EventFlag.GroupMission";

// 3.5.1 (CL-4000805, ++Fortnite+Release-3.5, 11 April 2018; Core has no 3.4) ends Spring It On! and runs Into the Storm.
// 3.4's notes closed Spring It On! ("'Spring It On!' comes to a close", The Three Husketeers), and 3.5's paks have no
// Spring2018_QuestMapWidget left: the home screen's event map is IntoTheStorm2018_QuestMapWidget, whose RefreshPagesEnabled
// shows "Into the Storm: Opening Act" (pages 1 to 3) from EventFlag.Storm2018Phase1 and "Into the Storm: Encore" (pages 4
// and 5) from EventFlag.Storm2018Phase2, and HomeScreenNextQuest's UpdateButtonBasedOnEventStatus shows "View Event" while
// either runs. 3.5's notes start the first: "New Questline: Into the Storm: Opening Act", so 3.5.1 runs Storm2018Phase1
// (Phase2, the Encore, was a later update's) and none of Spring It On!'s flags. Its other halves:
// - "Survive the Storm returns!": 3.5's Survival3DayCategory and Survival7DayCategory alert rows (quota 3 and 1, the notes'
//   "Three 3-Day Survivals" and "One 7-Day Survival per 24 hours") require EventFlag.SurviveTheStorm, where 1.11 to 3.3's
//   required EventFlag.Winter2017.
// - "Mutant Storms are more active during this event and award between 100 and 240 Storm Tickets ... Quota: 10 per 24
//   hours": the StormCategory rows (quota 10, EventFlag.ActiveStorms), not the passive StormLowCategory ones
//   (EventFlag.PassiveStorms, quota 4), which stop with 3.3.
// - "Opt-in difficulty boost and group missions do not award tickets during this event": EventFlag.GroupMission (the
//   Firecracker Ticket group mission alerts) stops with 3.3.
// The passive Mini-Bosses (General rows, EventFlag.PassiveMiniBosses) run on: 3.5's notes keep Mini-Boss alerts ("can no
// longer be selected if you have not unlocked the mission"). The event's quests, llama and book pages are
// events/storm2018.js's.
// 3.5.2 (CL-4008490, 19 April 2018) is that later update: Content Update v3.50's "Into the Storm: Encore (Save the World)
// Venture into the storm with Lars ... unlock your choice of one of the new Cyberpunk Heroes". Its paks hold 3.5.1's data
// (the Encore's quests, StormQuest_2018_Hidden_1 to Landmark_Observe, were in 3.5.1's already), so it runs all of 3.5.1's
// flags and Storm2018Phase2 too, which shows the event map's Encore pages.
// 3.6 (CL-4019403, 24 April 2018) runs on as 3.5.2: Into the Storm ran from 11 April to 1 May (the Fortnite Wiki's Into the
// Storm), and 3.6's paks name the same Save the World flags as 3.5.2's, no new one (every EventFlag.* in 3.6's paks:
// MissionAlerts' ActiveMiniBosses, ActiveStorms, Fortnitemares, GroupMission, Horde, PassiveMiniBosses, PassiveStorms and
// SurviveTheStorm; IntoTheStorm2018_QuestMapWidget's, its tile's and HomeScreenNextQuest's Storm2018Phase1 and Phase2;
// Items/Events' BR.Allow50v50, BR.CandyCaneGuns, BR.DisallowDuo/Solo/Squad, LobbyHalloweenDecor, LobbyWinterDecor and
// SupplyDropGift; CCNodePages' Horde. The exe names none: its strings are the manager's, ActiveEventFlags,
// IsEventFlagActive, EventFlagsForcedOn). Season 3's sky and map (the comet, the TVs' static, the meteors) wait for no
// flag: events/meteorstrike.js.
export const storm2018 = "Storm2018";
export const storm2018Phase1 = "EventFlag.Storm2018Phase1";
export const storm2018Phase2 = "EventFlag.Storm2018Phase2";
export const surviveTheStorm = "EventFlag.SurviveTheStorm";
export const activeStorms = "EventFlag.ActiveStorms";

// 4.0 (CL-4039451, 1 May 2018, Season 4) ends Into the Storm and runs Blockbuster (events/blockbuster2018.js): "Blockbuster
// Event - Part 1: Origin Story ... Join Spitfire and Lok as they investigate the comet". Every EventFlag.* in 4.0's paks (a
// byte scan of every uasset, umap, uexp and ini, the Athena umaps whole; the exe and the Dumper-7 SDK name none, only the
// manager's ActiveEventFlags, IsEventFlagActive, EventFlagsForcedOn/OffByHotfix):
// - Save the World: MissionAlerts' ActiveMiniBosses, ActiveStorms, Fortnitemares, GroupMission, Horde, PassiveMiniBosses,
//   PassiveStorms and SurviveTheStorm (3.6's rows, the same categories and quotas); CCNodePages' Horde; and, new,
//   Blockbuster2018Phase1, Phase2 and Phase3 (HomeScreenNextQuest's "View Event", EventQuestMapSideBarData and
//   Blockbuster2018_QuestMapWidget, which shows Part 1's page from Phase1 and Part 2's from Phase2; Phase3 only the side
//   bar). 3.6's Storm2018Phase1 and Phase2 are gone with IntoTheStorm2018_QuestMapWidget.
// - Battle Royale and the lobby: Items/Events' BR.Allow50v50, BR.CandyCaneGuns, BR.DisallowDuo/Solo/Squad, SupplyDropGift,
//   LobbyHalloweenDecor and LobbyWinterDecor (3.6's), and, new, LobbySeason4 (Items/Events/Shared/LobbyBG_Season4, a
//   LobbyBackgroundTakeoverEvent: the lobby in Maps/UI/Frontend_Lobby_Season4 while it is on).
// None drives Battle Royale's map: the comet crater and the Hop Rocks are 4.0's map itself (events/meteorstrike.js has
// what the hotfix rows do).
// So 4.0 runs Blockbuster2018Phase1 (Part 2, "A Hero Is Born", came with 30 May's update, the Fortnite Wiki's
// Blockbuster), the Season 4 lobby, and its notes' alerts: "Miniboss Mission Alerts are more common during this event and
// award between 50 and 120 Blockbuster Tickets ... Quota: 10 per day" (MiniBossCategory, EventFlag.ActiveMiniBosses,
// quota 10, in place of the passive General rows) and "Mutant Storm Mission Alerts have returned to normal levels and no
// longer reward event tickets" (StormLowCategory, EventFlag.PassiveStorms; 🟡 the data's quota is 4, the notes say 3).
// Survive the Storm (EventFlag.SurviveTheStorm) ends with Into the Storm.
// 4.1 (CL-4053532, 8 May 2018) runs on as 4.0: its notes ("Infinity Gauntlet Limited Time Mashup", the HackSAW in the
// Weekly Store) start no Save the World event or part, and its quests are 4.0's exactly (gamedata/4053532 changes no
// quest), so Blockbuster stays at Part 1. Every EventFlag.* in 4.1's paks (the same byte scan, 303,609 files): Items/Events'
// BR.Allow50v50, BR.CandyCaneGuns, BR.DisallowDuo/Solo/Squad, SupplyDropGift, LobbyHalloweenDecor, LobbyWinterDecor and
// LobbySeason4; CCNodePages' Horde; HomeScreenNextQuest's, EventQuestMapSideBarData's and Blockbuster2018_QuestMapWidget's
// Blockbuster2018Phase1, Phase2 and Phase3: 4.0's set, no new flag. The mission alert flags (ActiveMiniBosses,
// ActiveStorms, Fortnitemares, GroupMission, PassiveMiniBosses, PassiveStorms, SurviveTheStorm) are gone from the paks only
// because 4.1 cooks DefaultGameData's MissionAlerts out of the client (tools/extractor: its alert rows are 4.0's), and
// the backend still places those alerts, so they run on. So 4.1 serves 4.0's four: Blockbuster2018Phase1 (Phase2, Part 2
// "A Hero Is Born", is 30 May's, two updates on), ActiveMiniBosses, PassiveStorms and LobbySeason4. No flag drives
// Battle Royale's map (events/meteorstrike.js has 4.1's curve rows).
// 4.2 (CL-4072250, 16 May 2018) runs on as 4.1: Update v4.20's notes bring the Perk Recombobulator, its resources in the
// Event Store and the Quad Launcher in the Weekly Store (store/eventstore.js), Elemental Storm Mission Alerts
// (world/theaters.js) and repeatable perk quests, but start no Save the World event part (Blockbuster's Part 2, "A Hero
// Is Born", is 30 May's 4.3). Every EventFlag.* in 4.2's paks (the same byte scan, 305,034 files) is 4.1's set exactly:
// the five BR.* playlist and decor flags, SupplyDropGift, LobbyHalloweenDecor, LobbyWinterDecor, LobbySeason4, Horde and
// Blockbuster2018Phase1 to 3. So 4.2 serves 4.1's four: Blockbuster2018Phase1, ActiveMiniBosses, PassiveStorms and
// LobbySeason4. No flag drives Battle Royale's map (events/meteorstrike.js has 4.2's curve rows).
// 4.2 also runs EventFlag.GroupMission again (Core-Backend #277): its MissionAlerts rows are 4.0's (cooked out of the
// client), whose GroupMissionCategory rows (quota 10, repeatable) wait for that flag, and without it 4.2's group missions
// had no alert. Spring It On!'s Firecracker Tickets are long gone, so outside that event the alert pays the zone's
// evolution materials instead (world/theaters.js). The flag is the MissionAlerts table's, not the client's: no pak
// checks it.
// 4.4.0 (CL-4117433, 12 June 2018), 4.4.1 (CL-4127312, 14 June) and 4.4.2 (CL-4132537, 19 June; 4.4.2's data serves the
// other two, gamedata/read.js laterData): Update v4.40's notes open Save the World's "Blockbuster Part 3: The Cloaked
// Star", and Part 2, "A Hero Is Born", came with 4.3 (30 May, Update v4.30: "Blockbuster returns with part two"), which
// Core skips. Every EventFlag.* in 4.4.2's paks (the same byte scan, 211,927 files of its Battle Royale only archive): Items/
// Events' BR.CandyCaneGuns, SupplyDropGift, LobbyHalloweenDecor, LobbyWinterDecor and LobbySeason4; CCNodePages' Horde;
// Blockbuster2018_QuestMapWidget's, EventQuestMapSideBarData's and HomeScreenNextQuest's Blockbuster2018Phase1, Phase2 and
// Phase3, and EventQuestMapSideBarData's Phase4 (Part 4, 4.5's). 4.2's BR.Allow50v50 and BR.DisallowDuo/Solo/Squad are
// gone with their Items/Events assets. So 4.4 serves Blockbuster2018Phase1 to Phase3 (the quest map shows Part 1's page
// from Phase1 and Part 2's from Phase2; Phase3 is Part 3's), 4.2's group missions, ActiveMiniBosses and PassiveStorms
// (its MissionAlerts rows are still 4.0's, cooked out of the client), and LobbySeason4. No flag drives Battle Royale's
// map (events/meteorstrike.js has 4.4's curve rows).
// 4.5 (CL-4159770, 27 June 2018, and CL-4166199; CL-4166199's data serves both, gamedata/read.js laterData): Update
// v4.50's "Blockbuster Event Part 4 (Save the World): Discover how the quadrilogy ends in the finale of the Blockbuster
// event". Every EventFlag.* in CL-4166199's paks (the same byte scan, 215,808 files of its Battle Royale only archive):
// 4.4.2's (BR.CandyCaneGuns, SupplyDropGift, LobbyHalloweenDecor, LobbyWinterDecor, LobbySeason4, Horde, Blockbuster2018Phase1
// to Phase4, now on Blockbuster2018QuestMap's pages too) and Battle Royale's map's: BP_GeodeScripting's
// BR_S4_Geode_Begin, _Countdown and _Over and BP_Athena_Event_Components' BR_S4_Rift_Growth (the rocket launch, served
// from the calendar by its time: events/rocketlaunch.js), and Athena_OdditiesActors' BR_S4_Oddity_01 to _08 _Tell and
// _Event (the rifts of July 2018: events/season4flags.js, by the admin's choice). So 4.5 serves 4.4's flags and
// Blockbuster2018Phase4 (Part 4: The Finale).
// Every one of Season 4's flags is in events/season4flags.js's catalog, where the admin panel switches each on or off over
// what a build serves by itself (Core-Backend #296).
// 5.0 (CL-4204761, 12 July 2018, and CL-4214610; CL-4214610's data serves both, gamedata/read.js laterData), Season 5:
// "Blockbuster is over and the Road Trip event begins!" Every EventFlag.* in CL-4214610's paks (the same byte scan, 207,626
// files of its Battle Royale only archive): 4.5's Items/Events ones (BR.CandyCaneGuns, SupplyDropGift, LobbyHalloweenDecor,
// LobbyWinterDecor, LobbySeason4), CCNodePages' Horde, EventQuestMapSideBarData's Blockbuster2018Phase1 to Phase4, and,
// new, LobbySeason5 (Items/Events/Shared/LobbyBG_Season5: the lobby in Maps/UI/Frontend_Lobby_Season5) and RoadTrip2018
// (Save the World's Road Trip quest map: RoadTrip2018QuestMap, QuestMapScreen, EventQuestMapSideBarData). 4.5's rocket
// flags (BP_GeodeScripting's BR_S4_Geode_*) and Athena_OdditiesActors' BR_S4_Oddity_* are gone; BP_Athena_Event_Components
// still watches BR_S4_Rift_Growth (the sky's crack), but Season 5 began with the crack gone and rifts on the map, so 5.0
// isn't served it (events/rocketlaunch.js stays 4.5's). So 5.0 serves LobbySeason5, the one flag that changes Battle
// Royale's lobby, and 4.2's group missions and the ticketless storms (its MissionAlerts rows are still 4.0's, cooked out of
// the client). Blockbuster's flags and its Mini-Boss alerts end with 4.5.
// 5.0 also runs Road Trip (roadTrip2018, events/roadtrip2018.js, Core-Backend #298), Update v5.00's "Challenge the Horde is
// back!", on Epic's dates: from 5.0's release (12 July 2018), the build it shipped with. Its flags are RoadTrip2018 (the
// Road Trip quest map's pages) and Horde, which CCNodePages' Horde page (the Horde Skill Tree) and the HordeCategory
// MissionAlerts row (MissionAlert_HordeCategory_01, the Challenge the Horde alerts: world/horde.js) wait for. The event's
// quests, tickets, llama and Event Store go with RoadTrip2018, the horde theater and its alerts with Horde, so the admin
// panel switches each (events/season4flags.js).
// 5.10 (CL-4225813, 24 July 2018, and CL-4240749, Content Update v5.10's of 31 July; CL-4240749's data serves both,
// gamedata/read.js laterData), the Birthday update: "Celebrate #Fortnite1st with friends. Find birthday cake throughout
// the world and earn special cosmetics by completing challenges and quests in-game." Every EventFlag.* in CL-4240749's
// paks (the same byte scan, 236,598 files of its Battle Royale only archive): 5.0's, and, new, Anniversary2018_BR (the
// EventName of Schedule_Birthday2018_BR, the Birthday Challenges: profiles/athena.js), BirthdayBattleBus
// (Items/Events/Athena/BR_Decor_BirthdayBus: "The Battlebus and Supply Drops have been decorated to celebrate
// #Fortnite1st") and SupplyDropBDay (BR_Decor_SupplyDropBDay), served together as the Birthday event (birthday2018; Save
// the World's Birthday quests and llama go with it, events/birthday2018.js), and two of Battle Royale's map,
// BP_Athena_Event_Components' BR_S5_Rift_Shrink and DriveIn_Projector's BR_S5_RiskyReels_Event, which nothing dates
// (🟡), so 5.10 doesn't serve them by itself (events/season4flags.js switches them). The Fortnite Wiki's Fortnite 1st
// Birthday ran from 24 July to 7 August 2018, both modes, Update v5.20's day: so it is 5.10's two builds' own.
// 5.10 keeps 5.0's LobbySeason5, group missions, ticketless storms, Road Trip and Horde ("Birthday Llama ... Cost: 1,000
// Road Trip tickets"; "Gold reward doubled across all Horde reward tiers").
// 5.21 (CL-4288479, Update v5.21, 15 August 2018; Core has no 5.20, Update v5.20 of 7 August, so 5.21 stands for both).
// Every EventFlag.* in its paks (the same byte scan, 223,827 uasset, umap, uexp and ini files of its full install): 5.10's
// seventeen, and, new, Athena_GameplayActors' BR_S5_Oddity_Tomato_Tell and _Event, Tomato Town's rift (the Fortnite Wiki's
// Tomato Town: "A rift started forming on top of Uncle Pete's Pizza Pit" on 15 August, and on 19 August "The rift spits
// out a small stone tomato head statue", Prop_Tomato_Stone), served by those dates on Season 5's replay through the
// calendar (events/tomatorift.js). 5.21 keeps 5.10's LobbySeason5, group missions, ticketless storms, Road Trip and
// Horde (Update v5.20's and v5.21's Weekly Horde Challenges: world/horde.js). The Birthday ended with 5.10 (7 August,
// Update v5.20's day), so 5.21 doesn't serve its three flags by itself. The Cube ("Kevin") isn't 5.21's: the Fortnite
// Wiki's Crack Closure has its lightning strike from 23 August and the Cube appear on 24 August, both Update v5.30's,
// and 5.21's paks hold no cube; the sky's crack stays BR_S5_Rift_Shrink's, which nothing dates (🟡, by its switch).
// 5.30 (CL-4305896, Update v5.30, 23 August 2018). Every EventFlag.* in its paks (the same byte scan, 228,385 files of its
// full install): 5.21's less Anniversary2018_BR (Schedule_Birthday2018_BR is gone) and the Tomato Town rift's two (Update
// v5.30 made Tomato Town Tomato Temple), and, new, the Cube ("Kevin"): BP_Athena_Event_Components' BR_S5_Rift_Corrupt (the
// sky's crack turns purple) and BR_S5_Cube_Lightning (its lightning strikes the hill by Paradise Palms), and
// Athena/Prototype/Blueprints/Cube/CUBE's BR_S5_Cube_Lightning, _TurnOn (the cube appears), _StartMove, _MoveTo1 to _7
// (rolling to its seven runes), _Rune1 to _7 (printing each rune), _MoveToLake and _Lake (Loot Lake): served by the Fortnite
// Wiki's dates on Season 5's replay through the calendar (events/cube.js). 5.30 keeps LobbySeason5, group missions,
// ticketless storms, Road Trip and Horde (Update v5.30's Weekly Horde Challenge 3 and Content Update v5.30's 4:
// world/horde.js); the Birthday's battle bus and supply drop flags stay by switch only.
// 5.40 (CL-4352937, Update v5.40, 6 September 2018; Content Update v5.40's and Update v5.41's items are in its paks).
// Every EventFlag.* in its paks (the same byte scan, 185,685 of its 200,355 files; its pakchunk1000 is on a key of its own
// and isn't read): the Cube's rune legs and runes (CUBE's EventsToBindTo: _MoveTo1 to _8 with _Rune1 to _7; its eighth leg,
// BR_S5_Cube_MoveTo8, is 5.30's _MoveToLake, and Cube_Dest_Scripting's BR_S5_Cube_Destination its _Lake), _TurnOn and
// _StartMove, without 5.30's crack (BR_S5_Rift_Corrupt, BR_S5_Cube_Lightning: it closed on 24 August) or the sky's
// BR_S5_Rift_Shrink; and, new, EventFlag.LTM_Heist, the High Stakes event's (Schedule_LTM_Heist, the High Stakes
// Challenges, with the Getaway LTM: events/highstakes.js), served by its dates on Season 5's replay. Its paks no longer
// name the mission alert flags (ActiveMiniBosses ... GroupMission, PassiveStorms): its install has almost no mission infos
// (cooked server-only), and its alerts are 5.30's (the extractor's fifth argument), so they run on to 5.40 as 5.30's
// data has them, but for EventFlag.GroupMission: Update v5.40's "New Mega Alerts now show up on all group missions"
// (MegaAlertCategory, new in its MissionAlertCategories: gamedata/world.js, world/theaters.js; Core-Backend #317), and a
// tile carries one alert, so 5.40's group missions carry Mega Alerts in place of the group alerts. LobbySeason5, Road
// Trip and Horde (Update v5.40's Weekly Horde Challenge 5, Content Update v5.40's 6 and Update v5.41's 7: world/horde.js)
// run on too.
// 5.41 (CL-4363240, Update v5.41, 18 September 2018). Every EventFlag.* in its paks (the same byte scan, 232,519 of its
// 249,208 files: a full install, its pakchunk1000 again on a key of its own) is 5.40's, name for name: the Cube's legs,
// runes, _MoveTo8 and _Destination, and LTM_Heist. So the Cube and High Stakes run on 5.41 by their dates as on 5.40 (High
// Stakes ended with Update v5.41, 18 September: on Season 5's replay its window is before 5.41's, as the Cube's journey
// on 5.30 runs past it). Its mission infos are back in its paks, but its DefaultGameData still names no MissionAlerts: its
// alerts are 5.40's (5.30's rows), and its MissionAlertCategories keeps MegaAlertCategory, so its group missions carry
// Mega Alerts too. LobbySeason5, Road Trip and Horde (Update v5.41's Weekly Horde Challenge 7: world/horde.js) run on.
// 6.00 (CL-4395664 and CL-4402180, Update v6.00, 27 September 2018; CL-4402180's data serves both, gamedata/read.js
// laterData), Season 6, "Darkness Rises". Every EventFlag.* in CL-4402180's paks (the same byte scan, all 335,787 files of
// its full install, its pakchunk1000 and 1001 read with FModel's dynamic keys): 5.41's less LTM_Heist's and the lobby
// decor's (LobbyHalloweenDecor, LobbyWinterDecor, LobbySeason4), the Cube's legs and runes still in CUBE (and
// Cube_Dest_Scripting's _Destination), and, new, LobbySeason6 (Items/Events/Shared/LobbyBG_Season6: the lobby in
// Maps/UI/Frontend_Lobby_Season6) and Fortnitemares, FortnitemaresPhase1 and Phase2 (the quest map's Fortnitemares pages,
// Update v6.20's event). Its map's floating island (Athena/Prototype/Blueprints/Island/BP_IslandScripting, placed in
// Athena_POI_Foundations) has flags the client's paks don't name: on the server it loads the server-only
// BP_IslandServerOnly, whose EventBindings are the island's calendar events (EventFlag.BR_S6_Island_Rune0 to _Rune7 and
// _MoveTo1 to _MoveTo8), and it replicates the position the active one gives (IslandPosition, CubeletGrowthstage). The
// CL-4402180 client paks lack BP_IslandServerOnly; Core-ServerAssets' CL-4395664 pak has it. Those flags are served by
// Epic's Season 6 dates on Season 6's replay (events/island.js). Season 6 began with
// the Cube risen under the floating island over Leaky Lake, so the Cube's Season 5 flags and High Stakes end with 5.41
// (events/cube.js, events/highstakes.js), Road Trip and Challenge the Horde with Season 5 (roadTrip2018End, 🟡 the Horde's
// end: Update v6.00 names neither), and LobbySeason5 with LobbySeason6. 6.00 serves LobbySeason6 and the ticketless
// storms, and Save the World's Cram Session (events/cramsession2018.js): "Mini-Boss Mission Alerts are active, and up to 10
// can be completed per day", so EventFlag.ActiveMiniBosses (MiniBossCategory, quota 10). Its group missions keep 5.40's
// Mega Alerts (Update v6.00: "MEGA Alerts will now show the correct reward quantities"). Fortnitemares isn't 6.00's (24
// October, Update v6.20's day): by the admin's switch only.
// 6.01 (CL-4417689 and CL-4424678, Update v6.01, 3 October 2018; CL-4424678's data serves both). Every EventFlag.* in
// CL-4424678's paks (the same byte scan, all 336,321 files of its 15 paks; its pakchunk1000 and 1001, Dark Bomber and her
// back bling, read with their keys of the published keychain, store/keychain.json) is 6.00's scan, name for name, less
// BirthdayBattleBus (its Battle Bus item, BBID_BirthdayBus, is gone): the Cube's, Blockbuster's four, Fortnitemares' three,
// Horde, LTM_Heist (Schedule_LTM_Heist is still cooked, as in 6.00), LobbySeason5 and LobbySeason6, RoadTrip2018,
// SupplyDropBDay, SupplyDropGift, BR.CandyCaneGuns and Risky Reels'. Update v6.01 names no event of its own, and its
// Weekly Store runs "during Cram Session" still (store/eventstore.js), so 6.01 serves what 6.00 does: LobbySeason6, the
// ticketless storms and Cram Session's ActiveMiniBosses. Its floating island is 6.00's by the same flags (events/island.js,
// which has what 6.01's BP_IslandScripting changed).
// 6.02 (CL-4442095 and CL-4461277, Update v6.02, 10 October 2018; CL-4461277's data serves both). Every EventFlag.* in
// CL-4461277's paks (the same byte scan, all 337,735 files of the 13 paks that mount; its pakchunk1000 is on a key neither
// FModel's settings nor the published keychain has, and isn't read) is 6.01's scan, name for name: 34 names. Update v6.02
// names no event of its own ("Noble Launcher has returned to the Weekly Store" is Cram Session's Weekly Store still), so
// 6.02 serves what 6.01 does: LobbySeason6, the ticketless storms and Cram Session's ActiveMiniBosses, and the floating
// island by the same flags (events/island.js).
// 6.10 (CL-4464155, CL-4476098 and CL-4480234, Update v6.10, 16 October 2018; CL-4480234's data serves all three). Every
// EventFlag.* in CL-4480234's paks (the same byte scan, all 246,029 uasset, umap, uexp, ini and json files of its 8 paks,
// which all mount) is 6.02's scan, name for name: 34 names. Update v6.10 names no event flag of its own: its Save the World
// "Beta Storms" are a mission alert (MissionAlertCategories' new NewMissionIntroductionCategory, quota 5) whose alert rows
// aren't in the client's files (DefaultGameData still names no MissionAlerts), so none is generated, and Fortnitemares came
// with Update v6.20. So 6.10 serves what 6.02 does: LobbySeason6, the ticketless storms and Cram Session's
// ActiveMiniBosses, and the floating island, whose own BP_IslandServerOnly binds one more flag there, BR_S6_Island_Rune8
// (events/island.js).
// 6.20 (CL-4497486, Update v6.20, 24 October 2018: "Trick or Treat", Fortnitemares). Every EventFlag.* in its paks (the
// same byte scan, all 331,618 uasset, umap, uexp, ini and json files of its 14 paks; its pakchunk1000, Bunnymoon, read with
// its key of the published keychain) is 6.10's scan less BR.CandyCaneGuns (BR_Winter_CandyCaneGuns is gone) and three new
// ones, 36 names:
// - EventFlag.LTM_Fortnitemares: Athena/Items/ChallengeBundleSchedules/LTM/Schedule_FortNitemares's EventName, the
//   Fortnitemares Challenges (profiles/athena.js settleEventSchedules gives the schedule while the flag is served);
// - EventFlag.LobbySeason6Halloween: Items/Events/Shared/LobbyBG_Season6Halloween (Battle Royale's lobby
//   Frontend_Lobby_Season6_B, Save the World's Frontend_Lobby_Season6), EventPriority 3 over LobbySeason6's 2;
// - EventFlag.HalloweenBattleBus: Items/Events/Athena/BR_Decor_HalloweenBus, the Battle Bus as BBID_HalloweenBus.
// Save the World's Fortnitemares pages (QuestMapScreen's EventFlag.Fortnitemares, FortnitemaresQuestMap's and
// EventQuestMapSideBarData's FortnitemaresPhase1 and Phase2) are 6.00's flags still. Update v6.20: "Fortnitemares Part 1 is
// now available! ... Venture into the creepy lands of Hexsylvania and experience the 'Vlad Moon Rising' questline", and
// "Miniboss Mission Alerts have been returned to their normal reward amounts, and once again grant Event Tickets (Candy)
// instead of Gold": Hexsylvania's zone themes, generators and difficulties are back in its paks (6.10's had none), so 6.20
// runs Fortnitemares by its build (fortnitemares: Fortnitemares and FortnitemaresPhase1, Part 1; 🟡 Phase2 is Part 2,
// which the Fortnite Wiki's Fortnitemares 2018 has "released in two parts" after 6.20, so by the admin's switch only),
// ActiveMiniBosses with Candy (fortnitemares2018, world/theaters.js) and Cram Session is over (events/cramsession2018.js).
// Battle Royale's Fortnitemares (the Cube Monsters) is no calendar flag: the scan finds none in its Deimos content (the
// playlists' GameplayMod_DeimosAI, _DeimosMissions, _DeimosRiftDrop and _DeimosDifficulty* mutators, Athena/Deimos's rifts
// and AI director), which the Deimos playlists bring (events/ltms.js fortnitemares2018*). Its lobby, bus and challenges'
// flags are served by the build, with LobbySeason6 (the floating island, events/island.js, keeps 6.10's flags).
// 6.20's island scripting, now read whole: its BP_IslandServerOnly (Core-ServerAssets' CL-4497486 pak, installed beside
// 6.20's paks) lists EventBindings (the island's _MoveTo and _Rune flags), EventBinding1 ["POI0", "POI1"] and EventBinding2
// "EventFlag.BR_S6_Island_Crack", and 6.20's BP_IslandScripting watches only the last two: EventBinding1 with a
// FortAsyncAction_CalendarMultiEventWatcher, whose first event active in a match sets the Leaky Lake's state from its last
// digit (0: the Cube Monsters' days, IsDeimosActive, the house glowing at the Cube; 1: after the Cube), and EventBinding2,
// whose progress (TimeSinceBegin over its whole span) is the Cube's CrackProgress. So 6.20 serves POI0 by itself (the
// island exploded on 24 October, Fortnitemares' first day), and POI1 and the crack by their switches only.
//
// 6.21 (CL-4526925, Update v6.21, 1 November 2018: "Fortnitemares in Battle Royale ends on Sunday, November 4 at 1 PM
// Eastern Time ... be in-match at that time to witness the event"). Every EventFlag.* in its paks (the same byte scan, all
// 204,092 uasset, umap, uexp, ini and json files of its 6 paks; its install has no pakchunk1, and the same tool finds 6.20's
// 36 names in 6.20's 14) is 6.20's 36 and two new ones, 38 names:
// - EventFlag.LTM_LilKevin: Athena/Items/ChallengeBundleSchedules/LTM/Schedule_LTM_LilKevin's EventName, the Lil' Kev
//   challenges (QuestBundle_LTM_LilKevin: play 15 matches, earn 5,000 season XP, outlast 500 opponents; Lil' Kev,
//   BID_147_LilKev, in GB_FortnitemaresChallenges). The Fortnite Wiki's Lil' Kev quotes Epic's tweet of 4 November, the
//   Butterfly's day: "Login anytime before 1PM ET (6PM UTC) Nov 5 to unlock the Lil' Kev challenge pack";
// - EventFlag.Fortnitemares_Part4: BP_HauntedObject_Rework (Fortnitemares' haunted furniture) watches it with a
//   FortAsyncAction_CalendarEventWatcher whose handlers only keep the event's times and close a gate nothing reads.
// Two calendar names that aren't EventFlag.* matter more. 6.21's AFortMission_RiftSpawners (the Cube Monsters' spawners)
// gains RequiredEventFlag, and both Deimos missions (Deimos_Mission_RiftSpawners_Static and _Dynamic) name "POI0": when the
// mission starts, its native EvaluateEventCalendar (0x107D190) asks the game instance's seasonal event manager
// IsEventFlagActive (0x11B8FB0, what UFortSeasonalEventManager::execIsEventFlagActive calls) and, the flag off, clears
// bCalendarAllowsSpawning and shuts the spawners down (0x107C050: every ActiveRiftSpawnerData's encounter ended, the
// AssociatedSupplyDropIDs' SupplyDrop_Deimos stopped). So without POI0 a 6.21 Fortnitemares match has no Cube Monsters.
// 6.21's BP_IslandScripting keeps 6.20's two bindings, adds EventBinding3 (the Cube draining: EventFlag.BR_S6_Island_Drain,
// read from 6.21's server-only BP_IslandServerOnly in Core-ServerAssets' CL-4526925 pak with CUE4Parse) and plays the
// Butterfly: POI1 turning active in a match that began on POI0 runs BP_Butterfly's ButterflySequence (the Cube's flash, the
// In-Between, the Mutator_ButterflyEvent that Athena_GameMode now registers in every match as a core gameplay modifier, the
// DeimosShutoff mission event), and in POI0's last 30 minutes the storm heads for the Butterfly's place
// (Mutator.Butterfly.StormLocation). The admin panel can play it on its time, as Epic did (events/butterfly.js).
// 6.21 serves by itself 6.20's (Fortnitemares and FortnitemaresPhase1, ActiveMiniBosses with Candy, LTM_Fortnitemares,
// LobbySeason6Halloween, HalloweenBattleBus, POI0, PassiveStorms, LobbySeason6), Fortnitemares_Part4 and LTM_LilKevin; POI1,
// the crack and FortnitemaresPhase2 by their switches. FortnitemaresPhase2 stays a switch: 6.21's data holds Part 2's heroes
// (HID_Ninja_019, HID_Outlander_018) and the Candy Corn LMG (SID_Assault_LMG_Halloween), but no Part 2 quest (its
// quests.json is 6.20's but for three rewards), and Update v6.22 (6 November) is the one that says "Jump in and explore
// Fortnitemares Part 2". Epic's POI0 ended and POI1 began at the Butterfly, 4 November 18:00 UTC. By default Core serves POI0
// for as long as 6.21 runs, as its Fortnitemares modes are on by default, and the admin's switches play the Butterfly (POI0
// off and POI1 on, in a running match); the admin panel's Butterfly schedule (events/butterfly.js, off by default) plays it
// on Epic's dates or the admin's time instead, with the Cube's crack and drain before it.
//
// 6.22 (CL-4543176, Update v6.22, 6 November 2018: "Fortnitemares has come to an end in Battle Royale but the storyline
// continues in Save the World. Jump in and explore Fortnitemares Part 2"). Every EventFlag.* in its paks (the same byte
// scan, all 337,490 uasset, umap, uexp, ini and json files of its 13 paks, pakchunk1 and the language paks with them) is
// 6.21's 38 less Fortnitemares_Part4 (BP_HauntedObject_Rework is gone), 37 names, none new. Its BP_IslandScripting is
// 6.21's byte for byte (POI0 and POI1, the crack and the drain); its Cube Monsters' missions (Deimos_Mission_RiftSpawners_
// Static and _Dynamic) set no RequiredEventFlag, so Team Terror's spawners (events/ltms.js teamTerror) run without POI0.
// Its data gives Part 2 its rewards (HalloweenQuest_KillVlad: Sanguine Dusk, Hero:HID_Outlander_018; the fetch quests'
// Candy, the Candy Corn LMG's schematic and a choice of four Fortnitemares heroes), so 6.22 serves FortnitemaresPhase2 (the
// quest map's Part 2 page) by itself, with Part 1's Fortnitemares, FortnitemaresPhase1 and the Mini-Bosses with Candy; and,
// after the Butterfly, the Leaky Lake's POI1 (Epic's state from 4 November 18:00 UTC: a match begins after the Cube, and
// plays no Butterfly). Battle Royale's Fortnitemares is over: its lobby (LobbySeason6Halloween) and bus
// (HalloweenBattleBus) stop at 6.21 and are switches on 6.22, as POI0 is. 🟡 Its challenges (LTM_Fortnitemares, and 6.21's
// LTM_LilKevin) are served on: Update v6.22 doesn't end them, and Team Terror's tag (Athena.Playlist.Deimos.50) is under
// the Athena.Playlist.Deimos their stats count in. LobbySeason6 and PassiveStorms run on.
//
// 6.30 (CL-4573096, Update v6.30, 14 November 2018, and its Content Update of 20 November). Every EventFlag.* in its paks
// (the same byte scan, all 213,874 uasset, umap, uexp, ini and json files of its 9 paks, the two keyed ones with them) is
// 6.22's less EventFlag.Horde, 36 names, none new. Its client paks no longer have the island's scripting
// (Athena/Prototype/Blueprints/Island: BP_IslandScripting, the Butterfly): nothing in them watches POI0, POI1, the crack
// or the drain, so 6.30 serves none of them (🟡 its server-only pak, Core-ServerAssets' CL-4573096, wasn't read). Save
// the World's Fortnitemares is still in its data (Hexsylvania's four zone themes, its 62 quests, Part 2's rewards: its
// quest map watches Fortnitemares, FortnitemaresPhase1 and FortnitemaresPhase2) and Update v6.30 still fixes "Hexylvania
// Takers", so 6.30 serves 6.22's Fortnitemares flags, the Mini-Bosses with Candy and Battle Royale's two challenge
// schedules (🟡 the notes end none of them), LobbySeason6 and PassiveStorms.
//
// 6.31 (CL-4573279, Update v6.31, 27 November 2018). Every EventFlag.* in its paks (the same byte scan, all 372,486
// uasset, umap, uexp, ini and json files of its 15 paks, the keyed pakchunk1000 with them) is 6.30's, the same 36 names,
// none new and none gone. Its Save the World data keeps Fortnitemares (Hexsylvania's zone themes and quests, Part 2's
// rewards) and Update v6.31 ends none of it, so 6.31 serves 6.30's flags (🟡 Epic's end of Save the World's Fortnitemares
// isn't in the notes).
//
// 7.00 (CL-4629139, Update v7.00, 6 December 2018), Season 7. Every EventFlag.* in its paks (the same byte scan, all
// 407,616 uasset, umap, uexp and ini files of its 16 paks, the keyed pakchunk1000 and 1001 with them): 6.31's 36 names less
// none, and two more: EventFlag.LobbySeason7 (Items/Events/Shared/LobbyBG_Season7, a LobbyBackgroundTakeoverEvent of
// EventPriority 3 over LobbyBG_Season6's 2: Battle Royale's lobby is Maps/UI/Frontend_Lobby_Winter_BR and Save the World's
// Frontend_Lobby_Winter2018, the snowy Season 7 lobby of Core-Backend #383's screenshot; 7.10's and 7.20's paks list the same
// four LobbyBG assets, Season 5's to Season 7's, so it is the only Season 7 lobby there) and EventFlag.WinterBattleBus (1.11's
// holiday bus flag, back in the paks). Season 7 ends Season 6's events: 7.00 serves LobbySeason7 (LobbySeason6, Battle
// Royale's Fortnitemares and Lil' Kev challenges, PassiveStorms and Save the World's Fortnitemares and its Mini-Bosses with
// Candy end with 6.31; they still switch by hand, events/season4flags.js), and Save the World's "Season 7 Warmup":
// "Mutant Storm mission alerts are now more numerous, will grant Snowflake Tickets and additional Survivor/Hero/Schematic XP
// when completed, and have a quota of 10 per 24 hour period" (EventFlag.ActiveStorms, the StormCategory rows, quota 10, with
// Snowflake Tickets: world/theaters.js) and "Miniboss mission alerts have returned to normal. Fewer are available on the
// map, quota of 3 per 24 hours, no event tickets" (EventFlag.PassiveMiniBosses). Its Legendary Troll Stash Llama for 1,000
// Snowflake Tickets (CardPack_Jackpot_Winter2018_Tickets, new in its data) and the Event Store's Airheart aren't offered yet
// (🟡). The Winter bus and the gift supply drops (SupplyDropGift) aren't 7.00's own (Content Update v7.10's holidays): by
// their switches only.
//
// 7.10 (CL-4667333, Update v7.10, 18 December 2018), Season 7. Every EventFlag.* in its paks (the same byte scan, all
// 320,285 uasset, umap, uexp and ini files its paks mount, the keyed pakchunk1001 to 1015 with them; pakchunk1000's key
// isn't in the keychain): 7.00's less EventFlag.Fortnitemares (Hexsylvania's quest map's) and EventFlag.WinterBattleBus
// (the Winter Bus is a locker item in 7.10, BBID_WinterBus), and two more: EventFlag.LTM_14DaysOfFortnite (the 14 Days
// of Fortnite challenges' schedule and bundle, Schedule_14DaysOfFortnite: events/fourteendays.js serves it on its dates)
// and EventFlag.Frostnite (Save the World's Frostnite: "Frostnite is a new experience in 7.10, testing player's
// survival in a long winter night", served by 7.10 itself). 7.10 keeps 7.00's LobbySeason7 and the Season 7 Warmup's
// alerts (🟡 Update v7.10 ends neither).
//
// 7.20 (CL-4727874, Update v7.20, 15 January 2019), Season 7. Every EventFlag.* in its paks (the same byte scan, the
// 249,959 uasset, umap, uexp and ini files its paks mount, the keyed pakchunk1000, 1002, 1004 and 1005 with them;
// pakchunk1001's and 1003's keys aren't in the keychain): 7.10's and one more, EventFlag.LTM_WinterDeimos (the Ice Storm
// Challenges' schedule and bundle, Schedule_WinterDeimos: events/icestorm.js serves it on its dates). 7.20 keeps 7.10's
// LobbySeason7, the Season 7 Warmup's alerts and Frostnite (Update v7.20's "Weekly Frostnite Challenge 3"; 🟡 it ends
// none of them); the 14 Days of Fortnite "has ended", by its switch only. Its Ice Storm modes are playlists, not flags
// (events/ltms.js).
//
// 7.30 (CL-4834550, Update v7.30, 29 January 2019), Season 7. Every EventFlag.* in its paks (the same byte scan, the
// 445,201 uasset, umap, uexp and ini files its paks mount, the keyed pakchunk1001, 1002, 1004, 1005, 1007 and 1008 with
// them; pakchunk1000's, 1003's and 1006's keys aren't in the keychain): 7.20's and one more, EventFlag.LTE_Festivus (the
// Showtime Challenges' schedule and bundle, Schedule_Festivus: events/festivus.js serves it on its dates). 7.30 keeps
// 7.20's LobbySeason7, the Season 7 Warmup's alerts and Frostnite (Content Update v7.30's "Weekly Frostnite Challenge 6";
// 🟡 Update v7.30 ends none of them); the 14 Days of Fortnite and the Ice Storm Challenges are its switches only.
//
// 7.40 (CL-5046157, Update v7.40, 14 February 2019), Season 7's last. Every EventFlag.* in its paks (the same byte scan,
// the 448,427 uasset, umap, uexp and ini files its paks mount, the keyed pakchunk1003 and 1004 with them; pakchunk1000's,
// 1001's and 1002's keys aren't in the keychain): 7.30's and one more, EventFlag.LTE_S7_OverTime (the Overtime Challenges'
// schedule and bundle, Season7_OT_Schedule: events/overtime.js serves it on its dates). 7.40 keeps 7.30's LobbySeason7, the
// Season 7 Warmup's alerts and Frostnite (Content Update v7.40's "Frostnite Weekly Challenge 8: Final Frost"; 🟡 Update
// v7.40 ends none of them); the 14 Days of Fortnite, the Ice Storm Challenges and the Showtime Challenges are its switches
// only. Its map's other events are plain calendar names (below): the Block's slab1 and slab2, the earthquakes' EQ, EQ2
// and EQH and the Wailing Woods' heat, HP and HP1 (events/s8leadup.js).
//
// 8.00 (CL-5203069, Update v8.00, 28 February 2019), Season 8's first. Every EventFlag.* in its paks (the same byte
// scan, the 498,353 files its paks mount; pakchunk1000's and 1002's keys aren't in the keychain): 7.40's and two more,
// EventFlag.LobbySeason8 (Items/Events/Shared/LobbyBG_Season8, the lobby background takeover that puts the frontend
// lobby in Maps/UI/Frontend_Lobby_Season8_B; without the flag the lobby has no background at all) and
// EventFlag.Spring2019 (Save the World's Spring 2019 quest map: QuestMap2's Spring2019QuestMap). 8.00 serves
// LobbySeason8, Spring 2019's Love Storm (events/spring2019.js) and nothing of 7.40's season: the Season 7 lobby, the
// Season 7 Warmup's alerts, Frostnite, the 14 Days of Fortnite, the Ice Storm and Showtime Challenges and the Overtime
// Challenges all end with 7.40 (their flags are still cooked into 8.00's paks, unused). Its map's plain calendar names
// are 7.40's (the Block's slabs, the earthquakes' EQ, EQ2 and EQH, the Wailing Woods' HP and HP1).
//
// 8.30 (CL-5793395, Update v8.30, 10 April 2019). Every EventFlag.* in its paks (the same byte scan, 509,020 files; the
// keychain opens all its keyed paks but 1001): 8.20's and one more, EventFlag.LTE_BootyBay, Buccaneer's Bounty's
// challenges (events/buccaneersbounty.js). It serves 8.20's: LobbySeason8, Spring 2019's Love Storm and Yarrr!, and High
// Stakes by its dates. Its Block watches slab1 to slab3 as 8.20's (events/block.js).
//
// 8.40 (CL-6005771, Update v8.40, 17 April 2019). Every EventFlag.* in its paks (the same byte scan, 515,808 files; the
// keychain opens all its keyed paks but 1002): 8.30's and two more, EventFlag.LTM_Goose, the Air Royale Challenges
// (events/airroyale.js), and EventFlag.BR_S5_RiskyReels_Event, which only a new Risky Reels poster deco names (the Block's
// Season 5 flag, not an 8.40 event; not served). It serves 8.30's: LobbySeason8, Spring 2019's Love Storm and Yarrr!, and
// High Stakes and Buccaneer's Bounty by their dates. Its Block is 8.30's (events/block.js).
//
// 8.50 (CL-6058028, Update v8.50, 25 April 2019). Every EventFlag.* in its paks (the same byte scan, 524,750 files; the
// keychain opens all its keyed paks, 1000 to 1011, but 1003): 8.40's and two more, EventFlag.LTM_Ashton, the Endgame
// Challenges (events/endgame.js), and EventFlag.LTE_S8_ExtraCredit, which no schedule names (Season8_ExtraCredit_Schedule,
// Season 8's Overtime Challenges of 3 to 8 May 2019, Update v8.51's days, names only CalendarEvent_Season8_ExtraCredit;
// not served). It serves 8.40's: LobbySeason8, Spring 2019's Love Storm and Yarrr!, and High Stakes, Buccaneer's Bounty
// and Air Royale by their dates. Its Block streams 8_50's two levels (events/block.js).
//
// 8.51 (CL-6165369, Update v8.51, 1 May 2019). Every EventFlag.* in its paks (the same byte scan, 522,988 files; the
// keychain opens all its keyed paks, 1000 to 1009, but 1002) is 8.50's, and so are its CalendarEvent_* names. It serves
// 8.50's: LobbySeason8, Spring 2019's Love Storm and Yarrr!, High Stakes, Buccaneer's Bounty, Air Royale and the Endgame
// Challenges by their dates, and the Season 8 Overtime Challenges (EventFlag.LTE_S8_ExtraCredit, events/extracredit.js),
// whose schedule 8.51 is the first to have when Season 8's replay reaches them. Its own event is the Unvaulting
// (events/unvaulting.js), whose names are plain ones (below). Its Block is 8.50's (events/block.js).
//
// 9.00 (CL-6337466, Update v9.00, 9 May 2019), Season 9's first. Every EventFlag.* and CalendarEvent_* in its paks (the
// same byte scan, 552,950 files; the keychain opens pakchunk1002, not 1000 or 1001) is 8.51's, less EventFlag.Spring2019,
// and six more: EventFlag.LobbySeason9 (Items/Events/Shared/LobbyBG_Season9, Season 9's lobby background; it is also the
// EventName of Season9_Fortbyte_Schedule, whose Fortbytes unlock DaysFromEventStart: events/fortbytes.js),
// EventFlag.LTM_Wax and CalendarEvent_Season9_Wax (Schedule_LTM_Wax, Wick's Bounty's challenges: Update v9.01's LTM, 15 May
// 2019, whose quests 9.00's paks don't have; not served), and Save the World's EventFlag.Season9 and EventFlag.Season9.Phase1
// (QuestMap2's Season9AQuestMap), whose S9_* quest line isn't served yet, and EventFlag.Outpost (QuestMapData's Wargames
// callout, events/wargames.js). It serves LobbySeason9, EventFlag.Outpost and nothing of Season 8's: its lobby, Spring 2019,
// the Season 8 challenges' events and the Unvaulting end with 8.51. Neo Tilted, Mega Mall and the Slipstreams are 9.00's map itself: no calendar name gates them.
export const ltm14DaysOfFortnite = "EventFlag.LTM_14DaysOfFortnite";
export const ltmWinterDeimos = "EventFlag.LTM_WinterDeimos";
export const lteFestivus = "EventFlag.LTE_Festivus";
export const lteS7Overtime = "EventFlag.LTE_S7_OverTime";
// Save the World's Spring 2019 (events/spring2019.js): EventFlag.Spring2019 and Love Storm's Phase1 on 8.00 to 8.51,
// Yarrr!'s Phase2 on 8.20 to 8.51, each from its update's day on Season 8's replay.
export const spring2019 = "Spring2019";
export const spring2019Flag = "EventFlag.Spring2019";
export const spring2019Phase1 = "EventFlag.Spring2019.Phase1";
export const spring2019Phase2 = "EventFlag.Spring2019.Phase2";
// 8.20's Season 8 High Stakes Challenges (events/highstakes2019.js).
export const ltmHighStakes = "EventFlag.LTM_HighStakes";
// 8.30's Buccaneer's Bounty Challenges (events/buccaneersbounty.js).
export const lteBootyBay = "EventFlag.LTE_BootyBay";
// 8.40's Air Royale Challenges (events/airroyale.js).
export const ltmGoose = "EventFlag.LTM_Goose";
// 8.50's Endgame Challenges (events/endgame.js).
export const ltmAshton = "EventFlag.LTM_Ashton";
// 8.51's Season 8 Overtime Challenges (events/extracredit.js).
export const lteS8ExtraCredit = "EventFlag.LTE_S8_ExtraCredit";
export const frostnite = "EventFlag.Frostnite";
export const frostnite2018 = "Frostnite2018";
export const blockbuster2018 = "Blockbuster2018";
export const blockbuster2018Phase1 = "EventFlag.Blockbuster2018Phase1";
export const blockbuster2018Phase2 = "EventFlag.Blockbuster2018Phase2";
export const blockbuster2018Phase3 = "EventFlag.Blockbuster2018Phase3";
export const blockbuster2018Phase4 = "EventFlag.Blockbuster2018Phase4";
export const lobbySeason4 = "EventFlag.LobbySeason4";
export const lobbySeason5 = "EventFlag.LobbySeason5";
export const lobbySeason6 = "EventFlag.LobbySeason6";
export const lobbySeason7 = "EventFlag.LobbySeason7";
export const lobbySeason8 = "EventFlag.LobbySeason8";
export const lobbySeason9 = "EventFlag.LobbySeason9";
// Save the World's Wargames (9.00, PongooDev/CoreV2#655, events/wargames.js): QuestMapData's "WARGAMES" event callout
// (EventCalloutQuestFlag EventFlag.Outpost) and the event's quests.
export const wargames = "Wargames";
export const wargamesFlag = "EventFlag.Outpost";
// 7.00's Save the World Season 7 Warmup (above): the Mutant Storms with Snowflake Tickets, the Mini-Bosses without tickets.
export const season7Warmup2018 = "Season7Warmup2018";
// 6.20's (above): Fortnitemares 2018, its Battle Royale challenges', lobby's and bus's flags and Save the World's quest map.
export const fortnitemares2018 = "Fortnitemares2018";
export const ltmFortnitemares = "EventFlag.LTM_Fortnitemares";
export const lobbySeason6Halloween = "EventFlag.LobbySeason6Halloween";
export const halloweenBattleBus = "EventFlag.HalloweenBattleBus";
export const fortnitemaresPhase1 = "EventFlag.FortnitemaresPhase1";
export const fortnitemaresPhase2 = "EventFlag.FortnitemaresPhase2";
// 6.20's and 6.21's island scripting's calendar names (above): the Leaky Lake's state (POI0, the Cube Monsters' days; POI1,
// after the Butterfly) and the Cube's cracks; 6.21's Lil' Kev challenges and Fortnitemares' Part 4 flag.
export const islandPoi = (state) => `POI${state}`;
export const islandCrack = "EventFlag.BR_S6_Island_Crack";
// 6.21's third binding (BP_IslandServerOnly's EventBinding3): the Cube draining, a drip each hour (events/butterfly.js).
export const islandDrain = "EventFlag.BR_S6_Island_Drain";
export const ltmLilKevin = "EventFlag.LTM_LilKevin";
export const fortnitemaresPart4 = "EventFlag.Fortnitemares_Part4";
// 6.00's Save the World mini-event (events/cramsession2018.js).
export const cramSession2018 = "CramSession2018";
export const roadTrip2018 = "RoadTrip2018";
export const roadTrip2018Flag = "EventFlag.RoadTrip2018";
export const hordeFlag = "EventFlag.Horde";
export const birthday2018 = "Birthday2018";
export const anniversary2018BR = "EventFlag.Anniversary2018_BR";
export const birthdayBattleBus = "EventFlag.BirthdayBattleBus";
export const supplyDropBDay = "EventFlag.SupplyDropBDay";
export const tomatoRiftTell = "EventFlag.BR_S5_Oddity_Tomato_Tell";
export const tomatoRiftEvent = "EventFlag.BR_S5_Oddity_Tomato_Event";
// 5.30's Cube (events/cube.js).
export const riftCorrupt = "EventFlag.BR_S5_Rift_Corrupt";
export const cubeLightning = "EventFlag.BR_S5_Cube_Lightning";
export const cubeTurnOn = "EventFlag.BR_S5_Cube_TurnOn";
export const cubeStartMove = "EventFlag.BR_S5_Cube_StartMove";
export const cubeMoveTo = (rune) => `EventFlag.BR_S5_Cube_MoveTo${rune}`;
export const cubeRune = (rune) => `EventFlag.BR_S5_Cube_Rune${rune}`;
export const cubeMoveToLake = "EventFlag.BR_S5_Cube_MoveToLake";
export const cubeLake = "EventFlag.BR_S5_Cube_Lake";
// 5.40's: the Cube at Loot Lake (Cube_Dest_Scripting; its leg there is cubeMoveTo(8)), and the High Stakes event.
export const cubeDestination = "EventFlag.BR_S5_Cube_Destination";
// 6.00's floating island (BP_IslandServerOnly's EventBindings, events/island.js): rune 0 is Loot Lake.
export const islandRune = (stop) => `EventFlag.BR_S6_Island_Rune${stop}`;
export const islandMoveTo = (stop) => `EventFlag.BR_S6_Island_MoveTo${stop}`;
// 6.31's iceberg (BP_Distant_Fog's FogApproachEvent and FogApproachOverlapEvent, events/distantfog.js): the two names its
// defaults hold, plainly, with no "EventFlag." prefix, because it hands them to a CalendarEventWatcher as strings. 6.31 is
// the only build whose Athena_Background carries SM_Iceberg (6.30's has the floes and the fog, and no iceberg).
export const distantFogApproach = "BR_S6_Approach_03";
export const distantFogOverlap = "BR_S6_Approach_Overlap";
// 6.30's snowstorm: the same blueprint's two names in 6.30's paks (CL-4573096), its own and not 6.31's, so each build
// watches only its pair.
export const distantFogApproach630 = "BR_S6_Approach_01";
export const distantFogOverlap630 = "BR_S6_Approach_02";
// Season 7's The Block (BP_SlabScripting's calendar names, events/block.js): 7.00's R0 (Risky Reels stands) and R1 (the
// Block has landed on it), 7.10's slab1 to slab4 (its four community builds), 7.20's slab1 and slab2 (its two), 7.30's and 7.40's slab1 to slab3 (their two and the blank Block). Plain names with no "EventFlag." prefix:
// the blueprint hands them to a CalendarEventWatcher as strings.
export const blockRiskyReels = "R0";
export const blockLanded = "R1";
export const blockSlab = (number) => `slab${number}`;
// 7.20's Ice King and his Ice Storm (events/icestorm.js has how 7.20 plays it): the calendar names its blueprints hand to a
// CalendarEventWatcher or to UFortKismetLibrary::GetCalendarEventInformation as strings, plain, with no "EventFlag."
// prefix. BP_MooneyLoader (Athena_POI_Foundations) streams the event's levels: LoadLevel MooneyMap (the sphere over Polar
// Peak, the Ice King, BP_MooneyScripting), LoadSequence MooneySequenceMap (the storm's level sequence). BP_MooneyScripting:
// WDK the Ice King showing in the sphere, warning the TVs' weather warning, Countdown and R0 the TVs' countdown to the storm
// (R0 its last five minutes' correction; 7.00's Block used the same name, events/block.js, which 7.20's no longer watches),
// WD0 the sphere's clock (its last 24 hours less 12 minutes), WD1 the last 12 minutes, WD2 the storm itself. SP (storm
// past) is read at a match's start by BP_MooneyScripting (the Ice King's visuals hidden) and BP_SnowSetup (Athena_Terrain:
// the island under snow).
export const iceKingLoadLevel = "LoadLevel";
export const iceKingLoadSequence = "LoadSequence";
export const iceKingVisible = "WDK";
export const iceKingWarning = "warning";
export const iceKingCountdown = "Countdown";
export const iceKingCountdownCheck = "R0";
export const iceKingClock = "WD0";
export const iceKingLeadUp = "WD1";
export const iceKingStorm = "WD2";
export const iceKingStormPast = "SP";
// 7.30's BP_SnowSetup reads SP1 when SP isn't active: the island's storm snow melting, Snow_Amount 1 less SP1's progress
// (its TimeSpanRatio) at a match's start, Season 7's own snow once it is gone (events/icestorm.js iceStormMeltStates).
export const iceStormSnowMelt = "SP1";
// The Ice Legion's spawners (CoreV2 #490): the Ice Storm playlists' W_Deimos_Mission_RiftSpawners_Dynamic (Mutator_DeimosMissions_W)
// has RequiredEventFlag WDSPAWN, the only use of the name in 7.20's paks. AFortMission_RiftSpawners::EvaluateEventCalendar
// (7.20 0x11B0B60) turns the mission's spawners (the Ice Shards its supply drop SupplyDrop_Deimos brings) on while the
// calendar has it and off while it doesn't, again on each OnActiveEventsChanged. At the storm BP_MooneyScripting's
// DeimosTurnOn mission event turns them on (the mission's handler 0x11BD280 -> 0x11C5380), and the calendar has to have
// WDSPAWN from then on or its next change turns them off. Plain, like the event's other names.
export const iceKingIceLegion = "WDSPAWN";
// 7.30's Showtime, Marshmello's concert at Pleasant Park (events/festivus.js has how 7.30 plays it), plain names too:
// FLevel, read by Athena_POI_Foundations' level Blueprint at a match's start (Pleasant Park's field with the stage,
// PleasentParkFestivus, instead of PleasentParkDefault) and watched by BP_FestivusManager in the concert's playlists (its
// sub-level); F0, the countdown to the show (BP_FestivusManager shows it from 29 hours before F0's end); F1, the show.
export const festivusLevel = "FLevel";
export const festivusCountdown = "F0";
export const festivusShow = "F1";
// The lead-up to Season 8 (events/s8leadup.js has how 7.30 and 7.40 play it), plain names: BP_S8LeadupEvents (placed in
// Athena_SP_VFX, 7.30 and 7.40) watches EQ, the earthquakes' tremors spread over its span; 7.40's also reads EQ2 (the
// cracks, by the hours since it began) and EQH (every crack, after EQ2); 7.40's BP_SnowSetup reads HP1 (the Wailing Woods
// burnt through) and else HP (the heat spreading over its span).
export const s8Tremors = "EQ";
export const s8Cracks = "EQ2";
export const s8Cracked = "EQH";
export const s8Heat = "HP";
export const s8Burnt = "HP1";
// 8.51's Unvaulting (events/unvaulting.js has how 8.51 plays it), plain names: BP_SnowScripting (placed in
// Athena_POI_Foundations) watches GWS1 (the countdown to the vault opening, which ends at the event), GWS0 (the event, from
// its start), GWLevel (streams in Next2, the sky above the vault) and reads PGW (after the event: the volcano's ash sky);
// BP_CalendarDynamicPOISelect reads PGW for the eruption's three foundation swaps; BP_SnowAlwaysRelevant streams HappyMap
// (the fifth rune over the volcano) while GW5 is active, and the root's BP_SnowScripting watches GWW5 (its hologram).
export const unvaultingRuneWarmup = "GWW5";
export const unvaultingRune = "GW5";
export const unvaultingCountdown = "GWS1";
export const unvaultingLevel = "GWLevel";
export const unvaultingEvent = "GWS0";
export const unvaultingAfter = "PGW";
export const highStakes2018 = "HighStakes2018";
export const ltmHeist = "EventFlag.LTM_Heist";
const build40 = 4039451;
const build41 = 4053532;
const build42 = 4072250;
const build440 = 4117433;
const build442 = 4132537;
const build450 = 4159770;
const build45 = 4166199;
const build500 = 4204761;
const build50 = 4214610;
const build5100 = 4225813;
const build510 = 4240749;
const build521 = 4288479;
const build530 = 4305896;
const build541 = 4363240;
const build6000 = 4395664;
const build610 = 4480234;
const build620 = 4497486;
const build621 = 4526925;
const build622 = 4543176;
const build630 = 4573096;
const build631 = 4573279;
const build700 = 4629139;
const build710 = 4667333;
const build720 = 4727874;
const build730 = 4834550;
const build740 = 5046157;
const build800 = 5203069;
const build820 = 5625478;
const build850 = 6058028;
const build851 = 6165369;
const build900 = 6337466;

const events = [
  { name: fortnitemares, flag: fortnitemares, firstBuild: 3724489, lastBuild: 3757339 },
  // 6.20's and 6.21's Fortnitemares (above): Save the World's Part 1 (Hexsylvania, its quests and Candy,
  // events/fortnitemares.js), its Mini-Bosses with Candy, Battle Royale's challenges, lobby and bus, and the Leaky Lake's
  // POI0 (which 6.21's Cube Monsters' spawners need); 6.21's Part 4 flag and the Lil' Kev challenges. 6.22's: Save the
  // World's Part 2 (FortnitemaresPhase2) with Part 1's, the challenges, and the Leaky Lake after the Butterfly (POI1).
  // 6.30's: 6.22's but POI1 (its paks have no island scripting). 6.31's: 6.30's.
  { name: fortnitemares, flag: fortnitemares, firstBuild: build620, lastBuild: build631 },
  { name: fortnitemares, flag: fortnitemaresPhase1, firstBuild: build620, lastBuild: build631 },
  { name: fortnitemares, flag: fortnitemaresPhase2, firstBuild: build622, lastBuild: build631 },
  { name: fortnitemares2018, flag: activeMiniBosses, firstBuild: build620, lastBuild: build631 },
  { name: fortnitemares2018, flag: ltmFortnitemares, firstBuild: build620, lastBuild: build631 },
  { name: fortnitemares2018, flag: lobbySeason6Halloween, firstBuild: build620, lastBuild: build621 },
  { name: fortnitemares2018, flag: halloweenBattleBus, firstBuild: build620, lastBuild: build621 },
  { name: fortnitemares2018, flag: islandPoi(0), firstBuild: build620, lastBuild: build621 },
  { name: fortnitemares2018, flag: islandPoi(1), firstBuild: build622, lastBuild: build622 },
  { name: fortnitemares2018, flag: fortnitemaresPart4, firstBuild: build621, lastBuild: build621 },
  { name: fortnitemares2018, flag: ltmLilKevin, firstBuild: build621, lastBuild: build631 },
  { name: mutantStorms, flag: "EventFlag.Vindertech", firstBuild: 3775276, lastBuild: 3775276 },
  { name: mutantStorms, flag: "EventFlag.ActiveStorms", firstBuild: 3790078, lastBuild: 3790078 },
  { name: mutantStorms2018, flag: "EventFlag.ActiveStorms", firstBuild: 3847564, lastBuild: 3870737 },
  { name: mutantStorms2018, flag: activeMiniBosses, firstBuild: 3858292, lastBuild: 3870737 },
  { name: fiftyFifty, flag: fiftyFifty, firstBuild: 3790078, lastBuild: 3889387 },
  { name: winter2017, flag: winter2017, firstBuild: 3807424, lastBuild: 3841827 },
  { name: passiveStorms, flag: passiveStorms, firstBuild: 3807424, lastBuild: 3841827 },
  { name: passiveStorms, flag: passiveStorms, firstBuild: 3889387, lastBuild: 3942182 },
  { name: passiveMiniBosses, flag: passiveMiniBosses, firstBuild: 3889387, lastBuild: 3942182 },
  { name: spring2018, flag: spring2018Valentines, firstBuild: 3889387, lastBuild: 3942182 },
  { name: spring2018, flag: spring2018Phase1, firstBuild: 3889387, lastBuild: 3942182 },
  { name: spring2018, flag: spring2018Phase2, firstBuild: 3915963, lastBuild: 3942182 },
  { name: groupMission, flag: groupMission, firstBuild: 3935073, lastBuild: 3942182 },
  // 4.2's group mission alerts (Core-Backend #277, world/theaters.js), until 5.40's Mega Alerts take every group mission
  // (Core-Backend #317).
  { name: groupMission, flag: groupMission, firstBuild: build42, lastBuild: build530 },
  { name: spring2018, flag: spring2018Phase3, firstBuild: 3942182, lastBuild: 3942182 },
  { name: passiveMiniBosses, flag: passiveMiniBosses, firstBuild: 4000805, lastBuild: 4019403 },
  { name: storm2018, flag: activeStorms, firstBuild: 4000805, lastBuild: 4019403 },
  { name: storm2018, flag: surviveTheStorm, firstBuild: 4000805, lastBuild: 4019403 },
  { name: storm2018, flag: storm2018Phase1, firstBuild: 4000805, lastBuild: 4019403 },
  { name: storm2018, flag: storm2018Phase2, firstBuild: 4008490, lastBuild: 4019403 },
  { name: blockbuster2018, flag: blockbuster2018Phase1, firstBuild: build40, lastBuild: build45 },
  { name: blockbuster2018, flag: blockbuster2018Phase2, firstBuild: build440, lastBuild: build45 },
  { name: blockbuster2018, flag: blockbuster2018Phase3, firstBuild: build440, lastBuild: build45 },
  { name: blockbuster2018, flag: blockbuster2018Phase4, firstBuild: build450, lastBuild: build45 },
  { name: blockbuster2018, flag: activeMiniBosses, firstBuild: build40, lastBuild: build45 },
  { name: passiveStorms, flag: passiveStorms, firstBuild: build40, lastBuild: build631 },
  { name: lobbySeason4, flag: lobbySeason4, firstBuild: build40, lastBuild: build45 },
  { name: lobbySeason5, flag: lobbySeason5, firstBuild: build500, lastBuild: build541 },
  { name: lobbySeason6, flag: lobbySeason6, firstBuild: build6000, lastBuild: build631 },
  // 7.00's (above): the Season 7 lobby and Save the World's Season 7 Warmup; 7.10's to 7.40's too, and their Frostnite.
  { name: lobbySeason7, flag: lobbySeason7, firstBuild: build700, lastBuild: build740 },
  // 8.00's (above): Season 8's lobby background, the frontend's lobby map (LobbyBG_Season8); 8.20's to 8.51's too.
  { name: lobbySeason8, flag: lobbySeason8, firstBuild: build800, lastBuild: build851 },
  // 9.00's (above): Season 9's lobby background (LobbyBG_Season9), and the Fortbytes' event.
  { name: lobbySeason9, flag: lobbySeason9, firstBuild: build900, lastBuild: build900 },
  // 9.00's Wargames (Update v9.00: "Introducing: Wargames!", events/wargames.js).
  { name: wargames, flag: wargamesFlag, firstBuild: build900, lastBuild: build900 },
  { name: spring2019, flag: spring2019Flag, firstBuild: build800, lastBuild: build851 },
  { name: spring2019, flag: spring2019Phase1, firstBuild: build800, lastBuild: build851 },
  { name: spring2019, flag: spring2019Phase2, firstBuild: build820, lastBuild: build851 },
  { name: season7Warmup2018, flag: activeStorms, firstBuild: build700, lastBuild: build740 },
  { name: season7Warmup2018, flag: passiveMiniBosses, firstBuild: build700, lastBuild: build740 },
  { name: frostnite2018, flag: frostnite, firstBuild: build710, lastBuild: build740 },
  { name: cramSession2018, flag: activeMiniBosses, firstBuild: build6000, lastBuild: build610 },
  { name: roadTrip2018, flag: roadTrip2018Flag, firstBuild: build500, lastBuild: build541 },
  { name: hordeFlag, flag: hordeFlag, firstBuild: build500, lastBuild: build541 },
  { name: birthday2018, flag: anniversary2018BR, firstBuild: build5100, lastBuild: build510 },
  { name: birthday2018, flag: birthdayBattleBus, firstBuild: build5100, lastBuild: build510 },
  { name: birthday2018, flag: supplyDropBDay, firstBuild: build5100, lastBuild: build510 },
  { name: lobbyWinterDecor, flag: lobbyWinterDecor, firstBuild: 3807424, lastBuild: 3825894 },
  { name: winterBattleBus, flag: winterBattleBus, firstBuild: 3807424, lastBuild: 3825894 },
  { name: supplyDropGift, flag: supplyDropGift, firstBuild: 3807424, lastBuild: 3825894 }
];

const runsOn = (event, number) => number >= event.firstBuild && number <= event.lastBuild;

// The storms a build runs when the admin panel forces the Mutant Storms (or a custom EventFlag.ActiveStorms): 2.3's
// return (mutantStorms2018: the Hydraulic quests, the Storm Llama, the Mini-Bosses and the Event Store) from 2.3
// (CL-3847564), whose data has no Vindertech quests or llama, else 1.9.1's Vindertech storms (mutantStorms). From 2.4
// (CL-3858292) the Mini-Bosses have their flag too.
const storms2018Build = 3847564;
const miniBossFlagBuild = 3858292;
const forcedStorms = (changelist) => (Number(changelist) >= storms2018Build ? mutantStorms2018 : mutantStorms);
const forcedMiniBosses = (changelist) => Number(changelist) >= miniBossFlagBuild;

// The Birthday Challenges' modes that schedule its flag apart from the build (events/datedflags.js; "build" is the default).
const birthdayDatedModes = ["dates", "custom", "off"];
// 6.21's Butterfly on a schedule (events/butterfly.js; "off", its default, and "before" leave POI0 the build's own): POI0
// is then one of its steps, served until the Butterfly, not the build's own for good.
const butterflyScheduledModes = ["dates", "custom"];

// An event whose flags come on by date within its builds registers when each is served (events/spring2019.js): that
// module reads the season's replay clock (store/itemshop.js), whose imports lead back here, so it can't be imported here.
const flagSchedules = new Map();
export function scheduleEventFlags(name, served) {
  flagSchedules.set(name, served);
}

let eventsConfigProvider = null;

export function configureEvents(provider) {
  eventsConfigProvider = typeof provider === "function" ? provider : () => provider;
}

export function currentEventsConfig() {
  const held = heldEvents.getStore();
  if (held?.has(heldConfig)) return held.get(heldConfig);
  const config = (eventsConfigProvider ? eventsConfigProvider() : null) ?? { mode: "auto" };
  held?.set(heldConfig, config);
  return config;
}

// One computation's events config and event flags, read once (Core-Backend #428). The world info rolls every theater's
// missions and alerts and asks for event flags per alert row (gamedata/world.js missionAlertTier): read afresh, that was
// 128,000 settings copies and 12,000 flag lists on 8.40 (Spring 2019's chapters each read the season's clock), seconds
// of blocked event loop per world/info and twice that per world/validate, which held up every other request.
const heldEvents = new AsyncLocalStorage();
const heldConfig = Symbol("config");
export const withEventsHeld = (fn) => (heldEvents.getStore() ? fn() : heldEvents.run(new Map(), fn));
// A change to the config during the hold (a season's start recorded the day it is first served: app.js
// configureSeasonStarts) is read afresh from then on.
export const releaseHeldEvents = () => heldEvents.getStore()?.clear();
// Every game request reads them once too: a profile command asks per quest and per item granted (QueryProfile and
// ClientQuestLogin on an 8.40 campaign profile read them thousands of times). The admin panel, which changes them,
// reads them afresh.
export const holdEvents = (req, res, next) => (req.path.startsWith("/admin") ? next() : withEventsHeld(next));

// Whether the host runs the seasonal events (settings.seasonalEvents, the admin panel's Seasonal Events switch,
// Core-Backend #66), for everything a request does. Switched off, no build runs one: no event flags, quests, theater or
// event offers. Work that no request started runs them.
const eventsSetting = new AsyncLocalStorage();
export const seasonalEvents = (enabled) => (req, res, next) => eventsSetting.run(enabled(), next);

// Whether the seasonal events run for this request at all: the Seasonal Events switch and the events mode (not "off").
export const seasonalEventsOn = () => eventsSetting.getStore() !== false && currentEventsConfig()?.mode !== "off";

// The event flags the requesting build runs (none outside a request).
export function activeEventFlags(changelist = currentBuild()) {
  const held = heldEvents.getStore();
  if (!held) return eventFlagsOf(changelist);
  const key = `flags:${changelist}`;
  if (!held.has(key)) held.set(key, eventFlagsOf(changelist));
  return [...held.get(key)];
}

function eventFlagsOf(changelist) {
  if (eventsSetting.getStore() === false) return [];
  const config = currentEventsConfig();
  if (config?.mode === "off") return [];
  // Forcing a Save the World event leaves the build's Battle Royale 50v50 running (1.10 to 2.5).
  const fiftyFiftyFlags = Number.isInteger(Number(changelist)) && runsOn(events.find((event) => event.name === fiftyFifty), Number(changelist))
    ? [fiftyFifty] : [];
  if (config?.mode === "force_fortnitemares") return [fortnitemares, ...fiftyFiftyFlags];
  if (config?.mode === "force_mutantstorms") {
    const num = Number(changelist);
    if (num >= 3790078) return ["EventFlag.ActiveStorms", ...(forcedMiniBosses(num) ? [activeMiniBosses] : []), ...fiftyFiftyFlags];
    if (Number.isInteger(num)) return ["EventFlag.Vindertech"];
    return ["EventFlag.Vindertech", "EventFlag.ActiveStorms"];
  }
  if (config?.mode === "force_winter2017") {
    return [winter2017, passiveStorms, lobbyWinterDecor, winterBattleBus, supplyDropGift, ...fiftyFiftyFlags];
  }
  if (config?.mode === "custom") {
    return Array.isArray(config.customFlags) ? config.customFlags : [];
  }
  const number = Number(changelist);
  if (!Number.isInteger(number)) return [];
  // The Season 4 flags the admin panel switched on or off (events/season4flags.js), over the build's own.
  const { on, off } = season4Overrides(changelist, config);
  // The Birthday Challenges' flag on Epic's dates, the admin's own times or off (the admin panel's Event challenges,
  // Core-Backend #316: events/datedflags.js, events/birthday2018.js birthdayChallengeStates) isn't the build's own then.
  const birthdayDated = birthdayDatedModes.includes(config?.datedFlags?.birthday?.mode);
  const butterflyScheduled = number === build621 && butterflyScheduledModes.includes(config?.datedFlags?.butterfly?.mode);
  const own = events.filter((event) => runsOn(event, number) && !(birthdayDated && event.flag === anniversary2018BR)
    && !(butterflyScheduled && event.flag === islandPoi(0)) && (flagSchedules.get(event.name)?.(event.flag, number) ?? true))
    .map((event) => event.flag);
  // 6.21's Butterfly held before the event (Core-Backend #354, events/butterfly.js): the map's pre-event state over the
  // switches, POI0 served and none of what comes after it.
  const butterflyHeld = number === build621 && config?.datedFlags?.butterfly?.mode === "before";
  const held = butterflyHeld ? [islandPoi(1), islandCrack, islandDrain] : [];
  return [...new Set([...own, ...on])].filter((flag) => !held.includes(flag) && !(off.includes(flag) && !(butterflyHeld && flag === islandPoi(0))));
}

// Whether the requesting build runs an event, by its name (fortnitemares, mutantStorms) or by an event flag (a mission
// alert row's RequiredEventFlag).
export function isEventActive(nameOrFlag, changelist = currentBuild()) {
  if (eventsSetting.getStore() === false) return false;
  const config = currentEventsConfig();
  if (config?.mode === "off") return false;
  if (nameOrFlag === fiftyFifty && (config?.mode === "force_fortnitemares" || config?.mode === "force_mutantstorms" || config?.mode === "force_winter2017")) {
    return activeEventFlags(changelist).includes(fiftyFifty);
  }
  if (config?.mode === "force_fortnitemares") {
    return nameOrFlag === fortnitemares || nameOrFlag === "EventFlag.Fortnitemares";
  }
  if (config?.mode === "force_mutantstorms") {
    return nameOrFlag === forcedStorms(changelist) || nameOrFlag === "EventFlag.Vindertech" || nameOrFlag === "EventFlag.ActiveStorms"
      || (nameOrFlag === activeMiniBosses && forcedMiniBosses(changelist));
  }
  if (config?.mode === "force_winter2017") {
    return nameOrFlag === winter2017 || nameOrFlag === "EventFlag.Winter2017"
      || nameOrFlag === passiveStorms || nameOrFlag === "EventFlag.PassiveStorms"
      || nameOrFlag === lobbyWinterDecor || nameOrFlag === "EventFlag.LobbyWinterDecor"
      || nameOrFlag === winterBattleBus || nameOrFlag === "EventFlag.WinterBattleBus"
      || nameOrFlag === supplyDropGift || nameOrFlag === "EventFlag.SupplyDropGift";
  }
  if (config?.mode === "custom") {
    const flags = Array.isArray(config.customFlags) ? config.customFlags : [];
    if (flags.includes(nameOrFlag)) return true;
    if (nameOrFlag === fortnitemares && flags.includes(fortnitemares)) return true;
    if (nameOrFlag === forcedStorms(changelist) && (flags.includes("EventFlag.Vindertech") || flags.includes("EventFlag.ActiveStorms"))) return true;
    return false;
  }
  const flags = activeEventFlags(changelist);
  // A flag served by the build (one the admin panel switched on among them) is active.
  if (flags.includes(nameOrFlag)) return true;
  return events.some((event) => flags.includes(event.flag) && runsOn(event, Number(changelist))
    && (event.name === nameOrFlag || event.flag === nameOrFlag));
}

// Whether the requesting build comes after an event's last build: the event is over there for good (1.9.1's notes:
// "The Fortnitemares event has ended"), whatever the Seasonal Events switch says.
export function hasEventEnded(name, changelist = currentBuild()) {
  const config = currentEventsConfig();
  if (config?.mode === "force_fortnitemares" && (name === fortnitemares || name === "EventFlag.Fortnitemares")) return false;
  if (config?.mode === "force_winter2017" && (name === winter2017 || name === "EventFlag.Winter2017")) return false;
  const number = Number(changelist);
  const runs = events.filter((candidate) => candidate.name === name || candidate.flag === name);
  // An event that runs again later (Fortnitemares: 1.8 to 1.9, and 6.20) has ended on the builds between its runs, as it
  // had before the later run was known, and isn't over on a build that runs it.
  return runs.length > 0 && Number.isInteger(number) && runs.some((event) => number > event.lastBuild)
    && !runs.some((event) => runsOn(event, number));
}

// An event's runs, oldest first: its builds, with the ranges of its rows merged where they overlap or follow each other
// with no build Core knows between them (Spring It On!'s phases are one run, the Mutant Storms' 1.9.1 and 1.10 one), and
// split where builds that don't run it come between (Fortnitemares: 1.8 to 1.9 in 2017, then 6.20 and 6.21 in 2018).
export function eventRuns(name) {
  const ranges = events.filter((event) => event.name === name).map(({ firstBuild, lastBuild }) => ({ firstBuild, lastBuild }))
    .sort((a, b) => a.firstBuild - b.firstBuild);
  const known = Object.keys(buildVersions).map(Number);
  const runs = [];
  for (const range of ranges) {
    const last = runs.at(-1);
    if (last && !known.some((build) => build > last.lastBuild && build < range.firstBuild)) last.lastBuild = Math.max(last.lastBuild, range.lastBuild);
    else runs.push({ ...range });
  }
  return runs;
}

// The run of an event the requesting build belongs to: the last that began at or before it (a build after a run, or
// between two, that the admin panel makes run the event plays the run before it), the first for an earlier build.
export function eventRunOf(name, changelist = currentBuild()) {
  const runs = eventRuns(name);
  const number = Number(changelist);
  const begun = Number.isInteger(number) ? runs.filter((run) => run.firstBuild <= number) : [];
  return begun.at(-1) ?? runs[0];
}

// When the client is told an event ends: never, as far as Core goes (FDateTime's largest day).
export const eventsActiveUntil = "9999-12-31T23:59:59.999Z";

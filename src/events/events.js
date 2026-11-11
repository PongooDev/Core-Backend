import { AsyncLocalStorage } from "node:async_hooks";
import { currentBuild } from "../builds/context.js";
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
export const blockbuster2018 = "Blockbuster2018";
export const blockbuster2018Phase1 = "EventFlag.Blockbuster2018Phase1";
export const blockbuster2018Phase2 = "EventFlag.Blockbuster2018Phase2";
export const blockbuster2018Phase3 = "EventFlag.Blockbuster2018Phase3";
export const blockbuster2018Phase4 = "EventFlag.Blockbuster2018Phase4";
export const lobbySeason4 = "EventFlag.LobbySeason4";
export const lobbySeason5 = "EventFlag.LobbySeason5";
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
const build540 = 4352937;

const events = [
  { name: fortnitemares, flag: fortnitemares, firstBuild: 3724489, lastBuild: 3757339 },
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
  { name: passiveStorms, flag: passiveStorms, firstBuild: build40, lastBuild: build540 },
  { name: lobbySeason4, flag: lobbySeason4, firstBuild: build40, lastBuild: build45 },
  { name: lobbySeason5, flag: lobbySeason5, firstBuild: build500, lastBuild: build540 },
  { name: roadTrip2018, flag: roadTrip2018Flag, firstBuild: build500, lastBuild: build540 },
  { name: hordeFlag, flag: hordeFlag, firstBuild: build500, lastBuild: build540 },
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

let eventsConfigProvider = null;

export function configureEvents(provider) {
  eventsConfigProvider = typeof provider === "function" ? provider : () => provider;
}

export function currentEventsConfig() {
  return (eventsConfigProvider ? eventsConfigProvider() : null) ?? { mode: "auto" };
}

// Whether the host runs the seasonal events (settings.seasonalEvents, the admin panel's Seasonal Events switch,
// Core-Backend #66), for everything a request does. Switched off, no build runs one: no event flags, quests, theater or
// event offers. Work that no request started runs them.
const eventsSetting = new AsyncLocalStorage();
export const seasonalEvents = (enabled) => (req, res, next) => eventsSetting.run(enabled(), next);

// Whether the seasonal events run for this request at all: the Seasonal Events switch and the events mode (not "off").
export const seasonalEventsOn = () => eventsSetting.getStore() !== false && currentEventsConfig()?.mode !== "off";

// The event flags the requesting build runs (none outside a request).
export function activeEventFlags(changelist = currentBuild()) {
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
  const own = events.filter((event) => runsOn(event, number) && !(birthdayDated && event.flag === anniversary2018BR)).map((event) => event.flag);
  return [...new Set([...own, ...on])].filter((flag) => !off.includes(flag));
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
  return runs.length > 0 && Number.isInteger(number) && number > Math.max(...runs.map((event) => event.lastBuild));
}

// When the client is told an event ends: never, as far as Core goes (FDateTime's largest day).
export const eventsActiveUntil = "9999-12-31T23:59:59.999Z";

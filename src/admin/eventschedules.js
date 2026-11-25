import { datedEvent, datedModesOf, shiftedDatedSchedule, validDatedSchedule } from "../events/datedflags.js";
import { spacedOdditySchedule } from "../events/season4flags.js";

// The admin panel's Events page, in plain words (Core-Backend #351): each event as players know it, the builds it is on, its
// state now ("on now", "scheduled", "off", "follows Epic's dates") and one control (Off, Epic's dates, Custom start/end, Start
// now). It is a view over the stores the events already have (events config rocketLaunch, season4Flags.oddities,
// datedFlags, stormDestruction, contentUpdates, meteorStrike and the event mode), so their own routes and saved settings are
// unchanged; scheduleEventPatch turns the one control into those stores' settings.

// Each event: kind "build" (it runs on its builds by itself, as Epic ran it; the event mode above them switches it), or one
// with a schedule of its own. ranges are the changelists players see it on (the "what players see now" line).
export const eventCards = [
  { id: "fortnitemares2017", kind: "build", seasons: [1], name: "Fortnitemares 2017", builds: "1.8 – 1.9", ranges: [[3724489, 3757339]], force: "force_fortnitemares",
    about: "Save the World's Halloween: Hexsylvania, Candy, the Fortnitemares Llama and its quests.", flags: ["EventFlag.Fortnitemares"] },
  { id: "mutantStorms", kind: "build", seasons: [1, 2], name: "Mutant Storms", builds: "1.9.1 – 1.10, 2.3 – 2.4.2", ranges: [[3775276, 3790078], [3847564, 3870737]],
    force: "force_mutantstorms", about: "Save the World's storm mission alerts with Storm Tickets, the Vindertech (1.9.1 – 1.10) or Hydraulic (2.3 – 2.4.2) quests and llamas.",
    flags: ["EventFlag.Vindertech", "EventFlag.ActiveStorms", "EventFlag.ActiveMiniBosses"] },
  { id: "winter2017", kind: "build", seasons: [2], name: "Survive the Holidays (Winterfest 2017)", builds: "1.11 – 2.2", ranges: [[3807424, 3841827]], force: "force_winter2017",
    about: "Mini-Boss alerts, Snowflake Tickets and Holiday Survival Llamas; in Battle Royale (1.11 – 2.1) the winter lobby, the holiday Battle Bus and gift supply drops.",
    flags: ["EventFlag.Winter2017", "EventFlag.PassiveStorms", "EventFlag.LobbyWinterDecor", "EventFlag.WinterBattleBus", "EventFlag.SupplyDropGift"] },
  { id: "spring2018", kind: "build", seasons: [2, 3], name: "Spring It On!", builds: "2.5 – 3.3", ranges: [[3889387, 3942182]],
    about: "Valentine's and Lunar New Year quests, Firecracker Tickets and the Spring Llama; Brave Beginnings from 3.1, Luck of the Storm on 3.3.",
    flags: ["EventFlag.Spring2018Valentines", "EventFlag.Spring2018Phase1", "EventFlag.Spring2018Phase2", "EventFlag.Spring2018Phase3", "EventFlag.PassiveStorms", "EventFlag.PassiveMiniBosses"] },
  { id: "contentUpdates", kind: "contentUpdates", seasons: [2], name: "Season 2 loot updates", builds: "1.11 – 2.4", ranges: [[3807424, 3858292]],
    about: "Epic's loot hotfixes of Season 2 (new and vaulted items). A gameserver takes them when it starts.", flags: [] },
  { id: "storm2018", kind: "build", seasons: [3], name: "Into the Storm", builds: "3.5.1 – 3.6", ranges: [[4000805, 4019403]],
    about: "Survive the Storm's return, Mutant Storm alerts with Storm Tickets and the Into the Storm Llama; the Encore from 3.5.2.",
    flags: ["EventFlag.Storm2018Phase1", "EventFlag.Storm2018Phase2", "EventFlag.SurviveTheStorm", "EventFlag.ActiveStorms", "EventFlag.PassiveMiniBosses"] },
  { id: "meteorStrike", kind: "choice", seasons: [3], name: "Meteor shower (Season 3's finale)", builds: "3.6", ranges: [[4019403, 4019403]],
    about: "How far the comet's meteor shower has gone. Restart the game and the server after a change.", flags: [] },
  { id: "blockbuster2018", kind: "build", seasons: [4], name: "Blockbuster", builds: "4.0 – 4.5", ranges: [[4039451, 4166199]],
    about: "Save the World's Blockbuster quest line (Parts 1 to 4), Mini-Boss alerts with Blockbuster Tickets, the Blockbuster Llama; the Season 4 lobby.",
    flags: ["EventFlag.Blockbuster2018Phase1", "EventFlag.Blockbuster2018Phase2", "EventFlag.Blockbuster2018Phase3", "EventFlag.Blockbuster2018Phase4", "EventFlag.ActiveMiniBosses", "EventFlag.PassiveStorms", "EventFlag.LobbySeason4"] },
  { id: "rocket", kind: "rocket", seasons: [4], name: "Rocket launch (Blast Off)", builds: "4.5", ranges: [[4159770, 4166199]], startLabel: "Launches at",
    about: "The villain lair's rocket counts down, launches, cracks the sky and leaves the lair gone. Matches running then play it.",
    flags: ["EventFlag.BR_S4_Geode_Countdown", "EventFlag.BR_S4_Geode_Begin", "EventFlag.BR_S4_Geode_Over", "EventFlag.BR_S4_Rift_Growth"] },
  { id: "oddities", kind: "oddities", seasons: [4], name: "Rifts of July (objects vanish and appear)", builds: "4.5", ranges: [[4159770, 4166199]],
    startLabel: "First rift forms", endLabel: "Last object rifted",
    about: "Eight rifts take the map's objects away (the Durrr Burger head, the Tomato Head …) or bring new ones in, one a day.",
    flags: ["EventFlag.BR_S4_Oddity_01_Tell … _08_Tell", "EventFlag.BR_S4_Oddity_01_Event … _08_Event"] },
  { id: "roadTrip2018", kind: "build", seasons: [5], name: "Road Trip and Challenge the Horde", builds: "5.0 – 5.41", ranges: [[4204761, 4363240]],
    about: "Save the World's Road Trip quests, Road Trip Tickets and llama, and Challenge the Horde; the Season 5 lobby.",
    flags: ["EventFlag.RoadTrip2018", "EventFlag.Horde", "EventFlag.LobbySeason5"] },
  { id: "birthday", kind: "dated", dated: "birthday", seasons: [5], name: "Birthday Challenges (Fortnite's 1st Birthday)", builds: "5.10 – 5.21", ranges: [[4225813, 4288479]],
    key: "challenges", endOfKey: true, startLabel: "Challenges start", endLabel: "Challenges end",
    about: "The Birthday Challenges (a back bling, emoticon and spray), the birthday Battle Bus and supply drops, and Save the World's Birthday quests and llama." },
  { id: "tomatoRift", kind: "dated", dated: "tomatoRift", seasons: [5], name: "Tomato Town's rift", builds: "5.21", ranges: [[4288479, 4288479]],
    key: "tell", endStep: "event", startLabel: "Rift forms", endLabel: "Stone tomato head appears",
    about: "A rift forms over Uncle Pete's Pizza Pit, then spits out a stone tomato head." },
  { id: "cube", kind: "dated", dated: "cube", seasons: [5], name: "The Cube (Kevin)", builds: "5.30 – 5.41", ranges: [[4305896, 4363240]],
    key: "spawn", endStep: "lake", nowLeadSeconds: 30, startLabel: "The Cube appears", endLabel: "It sinks into Loot Lake",
    about: "The purple crack and its lightning (5.30), the Cube appearing, rolling to its seven runes and sinking into Loot Lake (5.40 – 5.41)." },
  { id: "highStakes", kind: "dated", dated: "highStakes", seasons: [5], name: "High Stakes", builds: "5.40 – 5.41", ranges: [[4352937, 4363240]],
    key: "challenges", endOfKey: true, startLabel: "Challenges start", endLabel: "Challenges end",
    about: "The High Stakes Challenges (play The Getaway, damage Jewel carriers, pick up Jewels)." },
  { id: "stormDestruction", kind: "storm", seasons: [5], name: "Storm Destruction (the storm destroys builds)", builds: "5.40 – 5.41", ranges: [[4352937, 4363240]],
    about: "The storm's edge flashes and destroys structures in the last four circles. Restart the game and the server after a change.", flags: ["Athena.bMegaStormEnabled (hotfix)"] },
  { id: "cramSession2018", kind: "build", seasons: [6], name: "Cram Session", builds: "6.00 – 6.10", ranges: [[4395664, 4480234]],
    about: "Save the World's Season 6 mini-event: Mini-Boss alerts with Gold, its quest lines and Weekly Store weapons; the Season 6 lobby.",
    flags: ["EventFlag.ActiveMiniBosses", "EventFlag.PassiveStorms", "EventFlag.LobbySeason6"] },
  // Its flags are served to 6.20 too, but 6.20's island scripting watches POI0, POI1 and the crack instead (events/events.js).
  { id: "island", kind: "dated", dated: "island", seasons: [6], name: "Floating island", builds: "6.00 – 6.10", ranges: [[4395664, 4480234]],
    key: "lake", endStep: "home", startLabel: "Rises over Loot Lake", endLabel: "Back over Loot Lake",
    about: "The island over Loot Lake floats to the seven runes the Cube lifted and back. Needs the build's server-assets pak." },
  // 6.30's: the same BP_Distant_Fog with its own two events and the snowstorm without the iceberg (events/distantfog.js).
  { id: "distantFog630", kind: "dated", dated: "distantFog630", seasons: [6], name: "The Ice King's snowstorm", builds: "6.30", ranges: [[4573096, 4573096]],
    key: "approach", endStep: "overlap", startLabel: "The snowstorm drifts in", endLabel: "It reaches 6.30's end point",
    about: "The snowstorm the iceberg comes in, in the distance off the island's south-west: 6.30's BP_Distant_Fog slides its fog bank along a spline while BR_S6_Approach_01 is active (its progress is the event's own) and BR_S6_Approach_02 holds it at 6.30's end point; with neither on it is hidden. 6.30's backdrop has the fog but no iceberg (that is 6.31's). 🟡 Epic's hours aren't recorded: the approach runs from Update v6.30's day (14 November 2018) to Update v6.31's (27 November), then it holds at the end point to Season 6's end." },
  // 6.31's alone: its Athena_Background has BP_Distant_Fog's SM_Iceberg, which the two events slide in (events/distantfog.js).
  { id: "distantFog", kind: "dated", dated: "distantFog", seasons: [6], name: "The Ice King's iceberg", builds: "6.31", ranges: [[4573279, 4573279]],
    key: "approach", endStep: "overlap", startLabel: "The iceberg drifts in", endLabel: "It reaches the island",
    about: "The iceberg in the distance off the island's south-west, at the end of Season 6: BP_Distant_Fog slides its SM_Iceberg along a spline while BR_S6_Approach_03 is active (its progress is the event's own), and BR_S6_Approach_Overlap puts it at 6.31's end point at once. 6.31 is the only build whose backdrop has the iceberg. 🟡 Epic's hours aren't recorded: the approach runs from Update v6.31's day (27 November 2018) to 5 December, the overlap the last day before Season 7." },
  { id: "fortnitemares2018", kind: "build", seasons: [6], name: "Fortnitemares 2018", builds: "6.20 – 6.31", ranges: [[4497486, 4573279]],
    about: "The Cube Monsters' modes, the Fortnitemares Challenges, the Halloween lobby and Battle Bus; Save the World's Fortnitemares Part 1 (Hexsylvania, Candy), and on 6.22 to 6.31 Part 2 (Battle Royale's Fortnitemares is over there: its challenges stay).",
    flags: ["EventFlag.Fortnitemares", "EventFlag.FortnitemaresPhase1", "EventFlag.FortnitemaresPhase2 (6.22 – 6.31)", "EventFlag.ActiveMiniBosses", "EventFlag.LTM_Fortnitemares", "EventFlag.LobbySeason6Halloween (6.20, 6.21)", "EventFlag.HalloweenBattleBus (6.20, 6.21)", "POI0 (6.20, 6.21)", "POI1 (6.22)", "EventFlag.LTM_LilKevin (6.21 – 6.31)", "EventFlag.Fortnitemares_Part4 (6.21)"] },
  { id: "butterfly", kind: "dated", dated: "butterfly", seasons: [6], name: "The Butterfly (the Cube's end)", builds: "6.21", ranges: [[4526925, 4526925]],
    key: "butterfly", startLabel: "The Butterfly happens",
    about: "The Cube cracks and drains into the lake, then bursts: every player in a match goes to the In-Between and back. Matches running then play it. Fortnitemares' modes end with it and Solo, Duos and Squads come back; Before the event puts the map back as it was, the Fortnitemares modes with it." },
  // 7.00's (events/events.js): Save the World's Season 7 Warmup.
  { id: "season7Warmup2018", kind: "build", seasons: [7], name: "Season 7 Warmup", builds: "7.00 – 7.40", ranges: [[4629139, 5046157]],
    about: "Save the World's start of Season 7: Mutant Storm alerts with Snowflake Tickets (10 a day), Mini-Boss alerts back to normal (no tickets), the Frostbite in the Weekly Store; the Season 7 lobby.",
    flags: ["EventFlag.ActiveStorms", "EventFlag.PassiveMiniBosses", "EventFlag.LobbySeason7"] },
  // The Block (events/block.js): the map's, so `always`: served with the seasonal events off or another event mode, and
  // never off (that leaves an empty crater no build showed).
  { id: "block700", kind: "dated", dated: "block700", seasons: [7], name: "The Block", builds: "7.00", ranges: [[4629139, 4629139]], always: true,
    key: "block", startLabel: "The Block lands",
    about: "The slab that crushed Risky Reels. 7.00 shows Risky Reels until the Block lands (The Game Awards 2018, 7 December 01:30 UTC on Season 7's replay), then the blank Block with its signs; 7.00 has none of the community builds. A match keeps what it started with, so a change shows from the next match. 🟡 Epic's minute isn't recorded: the show's start." },
  { id: "block710", kind: "dated", dated: "block710", seasons: [7], name: "The Block's community builds", builds: "7.10", ranges: [[4667333, 4667333]], always: true,
    key: "slab1", endStep: "slab4", startLabel: "Grimy Greens goes up", endLabel: "DM Arena goes up",
    about: "7.10's four community-built islands on the Block, each a level in its paks: Grimy Greens (KAANCITAK; 7.10 shipped with it on 18 December, so it is up from the replay's first day), Risky Runways (AKE, 23 December), Mysterious Markets (Bludriv, 30 December), DM Arena (KojackNumber2, 8 January, on to the season's end). A match keeps the one it started with, so a change shows from the next match; with none on (a custom schedule's gap) the Block is empty. 🟡 The Fortnite Wiki's days, no hours (00:00 UTC)." },
  // 7.10's (events/fourteendays.js, events/events.js): the 14 Days of Fortnite's challenges on their dates, and Frostnite.
  { id: "fourteenDays", kind: "dated", dated: "fourteenDays", seasons: [7], name: "The 14 Days of Fortnite", builds: "7.10", ranges: [[4667333, 4667333]],
    key: "challenges", endStep: "extended", startLabel: "Challenges start", endLabel: "Extension ends",
    about: "The 14 Days of Fortnite challenges: the first at the start, one more each day for thirteen days, a gift each and the 14 Days ribbon for all fourteen (from 19 December 2018, 9 AM ET, to 2 January, and back for 7 to 14 January). Its modes are the Battle Royale game modes' (Original dates).",
    flags: ["EventFlag.LTM_14DaysOfFortnite", "CalendarEvent_Season7_14DaysOfFortnite"] },
  { id: "frostnite2018", kind: "build", seasons: [7], name: "Frostnite", builds: "7.10 – 7.40", ranges: [[4667333, 5046157]],
    about: "Save the World's Frostnite: the quest map's Frostnite page, its theater on the world map (the Endless missions at every Frostnite difficulty, each week's challenge from Slip Out on, its own backpack), its WinterQuest_2018 quests, the Winter Llama for Snowflake Tickets and Cloaked Shadow in the Event Store.",
    flags: ["EventFlag.Frostnite"] },
  // 7.20's (events/block.js, events/icestorm.js): the Block's two builds, and the Ice Storm Challenges on their dates.
  { id: "block720", kind: "dated", dated: "block720", seasons: [7], name: "The Block's community builds", builds: "7.20", ranges: [[4727874, 4727874]], always: true,
    key: "slab1", endStep: "slab2", startLabel: "Looming Llama goes up", endLabel: "Omega Pyramid goes up",
    about: "7.20's two community-built islands on the Block, each a level in its paks: Looming Llama (Stormhawk; 7.20 shipped with it on 15 January, so it is up from the replay's first day) and Omega Pyramid (Directingpete, Content Update v7.20, 22 January, on to the season's end). A match keeps the one it started with, so a change shows from the next match. 🟡 The Fortnite Wiki's days, no hours (00:00 UTC)." },
  { id: "iceStorm", kind: "dated", dated: "iceStorm", seasons: [7], name: "The Ice Storm Challenges", builds: "7.20", ranges: [[4727874, 4727874]],
    key: "challenges", endOfKey: true, startLabel: "Challenges start", endLabel: "Challenges end",
    about: "The Ice Storm Challenges: three at the start, two more each day for five days (destroy the Ice Legion), the Blue Metallic wrap for six and the Winter's Thorn glider for all (from the Ice Storm, 19 January 2019, 11 AM PST, to 28 January). Its modes, the Ice Storm's Solo, Duos and Squads, are the Battle Royale game modes' (Original dates). 🟡 The end is the wiki's last day.",
    flags: ["EventFlag.LTM_WinterDeimos", "CalendarEvent_Season7_WinterDeimos"] },
  // 7.20's Ice King (events/icestorm.js): held before the event by default, started by the admin (Core-Backend #354), and its
  // snow (7.20's two states, SP's). Two ways to start it (CoreV2 #490): Start now plays the storm 30 seconds on in the
  // matches running (already on their playlist, so the default modes' get no Ice Legion), and Start in 5 minutes
  // (soonLeadSeconds) gives the time to queue a match, which then is the Ice Storm's (events/ltms.js iceStormMatchBucket)
  // and gets the Ice Legion after the storm. A match's playlist is set when it is assigned, so no admin change can give a
  // running default match the Ice Legion's missions.
  { id: "iceKing", kind: "dated", dated: "iceKing", seasons: [7], name: "The Ice King's Ice Storm", builds: "7.20", ranges: [[4727874, 4727874]],
    key: "storm", nowLeadSeconds: 30, soonLeadSeconds: 300, soonLabel: "Start in 5 minutes", startLabel: "The Ice Storm starts",
    nowConfirm: "Start the Ice Storm in 30 seconds? The matches running now play it, but they started on the normal Solo, Duos and Squads, so no Ice Fiends come to them. For the Ice Fiends, use Start in 5 minutes and then start a new match.",
    soonConfirm: "Start the Ice Storm in 5 minutes? Start a Solo, Duos or Squads match after this: it runs as the Ice Storm's mode, plays the storm, and the Ice Fiends and Brutes come right after it. A match already running plays the storm without them.",
    about: "The ice sphere over Polar Peak, the Ice King in it, the TVs' weather warning and countdown, the sphere's 24-hour clock, then the storm: the Ice King breaks out, the storm pauses, a blizzard covers the island in snow and the Ice Legion comes. To see the storm and the Ice Fiends: press Start in 5 minutes, then start a Solo, Duos or Squads match and stay alive until about 2 minutes after the storm. Matches started in the half hour before the storm are the Ice Storm's (the lobby still shows Solo, Duos and Squads), and only those get the Ice Legion (7.20's own rule: the Ice Legion's spawners are in the Ice Storm playlists). Start now plays the storm 30 seconds later in the match you're already in, without the Ice Legion: that match started on the normal playlist. Custom picks the storm's time yourself (the same rule: start the match after setting it). A match that starts after the storm starts under snow, without the storm, on the Ice Storm modes with the Ice Legion. To play the storm again, set Before the event first. 🟡 Epic's hours before the storm aren't recorded." },
  { id: "iceKingSnow", kind: "choice", choice: "iceKingSnow", seasons: [7], name: "The Ice Storm's snow", builds: "7.20", ranges: [[4727874, 4727874]],
    about: "The island's snow on 7.20. 7.20 has two snow states (no stages in between: the melting came with later updates): Season 7's own snow, and the whole island under snow after the storm. Follows the storm by default. A match keeps the snow it started with; the storm itself spreads the snow over the island in the matches running then." },
  // 7.30's (events/block.js, events/icestorm.js, events/festivus.js): the Block's two builds, the Ice Storm's snow melting,
  // Showtime and its challenges on their dates.
  { id: "block730", kind: "dated", dated: "block730", seasons: [7], name: "The Block's community builds", builds: "7.30", ranges: [[4834550, 4834550]], always: true,
    key: "slab1", endStep: "slab2", startLabel: "CoLLAMAsseum goes up", endLabel: "Streat Festival goes up",
    about: "7.30's two community-built islands on the Block, each a level in its paks: CoLLAMAsseum (Zarbot; 7.30 shipped with it on 29 January, so it is up from the replay's first day) and Streat Festival (NIBLL, the wiki's Lunar Street Festival, 5 February, on to the season's end). A match keeps the one it started with, so a change shows from the next match. 🟡 The Fortnite Wiki's days, no hours (00:00 UTC)." },
  { id: "iceStormMelt", kind: "dated", dated: "iceStormMelt", seasons: [7], name: "The Ice Storm's snow melting", builds: "7.30", ranges: [[4834550, 4834550]],
    key: "melt", startLabel: "The snow starts melting", endLabel: "The snow is gone",
    about: "The island's snow on 7.30: under the Ice Storm's snow as 7.30 shipped (from the replay's first day to Update v7.30's day, 29 January), then melting to Season 7's own snow by 1 February (the Fortnite Wiki's \"The snow melted\"). A match keeps the snow it started with: the further into the melt it starts, the less snow. Off leaves Season 7's own snow. 7.30 has no Ice King: its paks no longer have the sphere's or the storm's levels. 🟡 The days', no hours (00:00 UTC).",
    flags: ["SP", "SP1"] },
  { id: "festivus", kind: "dated", dated: "festivus", seasons: [7], name: "Showtime (Marshmello's concert)", builds: "7.30", ranges: [[4834550, 4834550]],
    key: "show", startLabel: "The show starts",
    about: "The stage on Pleasant Park's field from Update v7.30's day (29 January) to the encore, the countdown to each show, and the two ten-minute shows (2 February 2019, 11 AM and 11 PM PST). The concert itself plays only in Party at Pleasant Park, the Battle Royale game mode of its own (Original dates); every other match has the stage from its start. A match keeps the field it started with. 🟡 The stage's hours aren't recorded (00:00 UTC on the 29th).",
    flags: ["FLevel", "F0", "F1"] },
  { id: "showtime", kind: "dated", dated: "showtime", seasons: [7], name: "The Showtime Challenges", builds: "7.30", ranges: [[4834550, 4834550]],
    key: "challenges", endOfKey: true, startLabel: "Challenges start", endLabel: "Challenges end",
    about: "The Showtime Challenges: search a Showtime poster (Mello Made It Right) at the start, and from the next day visit the Showtime venue (Keep It Mello) and use Keep It Mello at Trucker's Oasis, the Ice Cream Parlor and Frozen Lake (Marshy Smasher); the Showtime banner for all three (from 30 January to 2 February 2019). 🟡 The wiki's days, 00:00 UTC.",
    flags: ["EventFlag.LTE_Festivus", "CalendarEvent_Season7_Festivus"] },
  // 7.40's (events/block.js, events/overtime.js, events/s8leadup.js): the Block's two builds, the Overtime Challenges and
  // the lead-up to Season 8 (its tremors on 7.30 too) on their dates.
  { id: "block740", kind: "dated", dated: "block740", seasons: [7], name: "The Block's community builds", builds: "7.40", ranges: [[5046157, 5046157]], always: true,
    key: "slab1", endStep: "slab2", startLabel: "Oily Oaks goes up", endLabel: "Colossal Compound goes up",
    about: "7.40's two community-built islands on the Block, each a level in its paks: Oily Oaks (MrSlickWillyz; 7.40 shipped with it on 14 February, so it is up from the replay's first day) and Colossal Compound (Aril_lian1, Content Update v7.40, 19 February, on to the season's end). A match keeps the one it started with, so a change shows from the next match. 🟡 The Fortnite Wiki's days, no hours (00:00 UTC)." },
  { id: "overtime", kind: "dated", dated: "overtime", seasons: [7], name: "The Overtime Challenges", builds: "7.40", ranges: [[5046157, 5046157]],
    key: "challenges", endOfKey: true, startLabel: "Challenges start", endLabel: "Challenges end",
    about: "Share the Love's Overtime Challenges: four free ones at the start and more on the 3rd, 6th and 9th day; 13 of them give the Season 8 Battle Pass token and the Overtime banner, some the Valentine wrap, the True Form and Season 7 loading screens and the Vines contrail; Battle Pass owners also get Powder's, Trog's and Onesie's styles (Battle Pass tiers 47, 71 and 87, then 5, 10 and 15 free challenges). From Update v7.40's day, 14 February 2019, to the season's end (the Fortnite Wiki's 14 to 28 February). 🟡 00:00 UTC. The Season 8 Battle Pass itself isn't given: no build Core supports has Season 8; the token stays on the account.",
    flags: ["EventFlag.LTE_S7_OverTime", "CalendarEvent_Season7_OverTime"] },
  { id: "earthquakes", kind: "dated", dated: "earthquakes", seasons: [7], name: "The earthquakes (Season 8's lead-up)", builds: "7.30 – 7.40", ranges: [[4834550, 5046157]],
    key: "cracks", startLabel: "The cracking starts",
    about: "The Prisoner's earthquakes. Tremors shake the island from Content Update v7.30's day (5 February 2019; 7.30 and 7.40). On 7.40 the ground then cracks open crack by crack at Epic's hours from the cracking's start: the first two on 14 February (southwest of Tomato Temple and of the Block, Lazy Bridge partly falling in), then one or two a day, the 26th through Tilted Towers on 27 February, bringing down its News HQ; after that every crack stays open. A match keeps the cracks it started with and opens the next at its hour. Custom picks the cracking's start (the cracks keep Epic's spacing). 🟡 The cracking's start, 12 February 09:00 UTC, is the one that puts the cracks on the wiki's days at the hours Epic's 2026 replay showed; the tremors' days have no hours (00:00 UTC).",
    flags: ["EQ", "EQ2", "EQH"] },
  { id: "s8Heat", kind: "dated", dated: "s8Heat", seasons: [7], name: "The Wailing Woods drying up", builds: "7.40", ranges: [[5046157, 5046157]],
    key: "heat", endStep: "burnt", startLabel: "The woods start drying", endLabel: "The woods are burnt brown",
    about: "The heat before the volcano: the Wailing Woods' grass browns from 24 February 2019 (the west first) and the forest, the Block and parts of Tomato Temple and Lonely Lodge are all brown by 27 February, to the season's end. A match keeps the colour it started with. 🟡 The Fortnite Wiki's days, no hours (00:00 UTC).",
    flags: ["HP", "HP1"] },
  // 7.40 to 8.20's (events/siphon.js, PongooDev/CoreV2#557): not an event flag, AthenaGameData and AthenaResourceRates rows.
  { id: "siphon", kind: "choice", choice: "siphon", seasons: [7, 8], name: "Siphon and material changes (Solo, Duos, Squads)", builds: "7.40 – 8.20", ranges: [[5046157, 5625478]], always: true,
    about: "Update v7.40's Pop-up Cup rules in the core modes: 50 health or shield and 50 of each material per elimination, a 500 cap on each material and 40% more from harvesting. On in 7.40 and 8.00, as Epic ran them; Update v8.20 took it out of the core modes (Arena kept it), so 8.20 has it off. Restart the game and the server after a change. On 8.20 off leaves its paks' 500 cap and the materials dropped on elimination, which no hotfix row can take out of the core modes alone.",
    flags: ["AthenaGameData Default.Siphon.* (hotfix)"] },
  // 8.00's (events/events.js): Season 8's lobby; its other new flag, EventFlag.Spring2019, is Save the World's (the
  // spring2019 card).
  // 8.00's Block (events/block.js): its two builds on their dates.
  { id: "block800", kind: "dated", dated: "block800", seasons: [8], name: "The Block's community builds", builds: "8.00", ranges: [[5203069, 5203069]], always: true,
    key: "slab1", endStep: "slab2", startLabel: "Cryptic Castle goes up", endLabel: "Turtle Temple goes up",
    about: "8.00's two community-built islands on the Block, each a level in its paks: Cryptic Castle (HellraiserGaming; 8.00 shipped with it on 28 February 2019, so it is up from the replay's first day) and Turtle Temple (BOTIMUS-PRIME, v8.01, 6 March, on to the season's end). A match keeps the one it started with, so a change shows from the next match. 🟡 The Fortnite Wiki's days, no hours (00:00 UTC)." },
  // 8.20's Block (events/block.js): its two builds on their dates, Tropical Treetops coming back after the Mansion's day.
  { id: "block820", kind: "dated", dated: "block820", seasons: [8], name: "The Block's community builds (8.20)", builds: "8.20", ranges: [[5625478, 5625478]], always: true,
    key: "slab1", endStep: "slab2", startLabel: "Tropical Treetops goes up", endLabel: "Mysterious Mansion goes up",
    about: "8.20's two community-built islands on the Block, each a level in its paks: Tropical Treetops (GingerJay91; Update v8.20, 27 March 2019; 8.20 came out mid-season, so it is up from the replay's first day) and Mysterious Mansion (FurryNenja, 2 April, which Epic quickly took down for Tropical Treetops again: back from 3 April to the season's end). Harmony Hotel is in 8.20's paks too, but no slab streams it, so it can't be shown. A match keeps the one it started with, so a change shows from the next match. 🟡 The Fortnite Wiki's days, no hours (00:00 UTC); how long the Mansion stood isn't recorded." },
  // 8.30's Block (events/block.js): Llama Sphinx, then Cordial Courtyard on 8.40's day (both in 8.30's paks); 8.40's is 8.30's.
  { id: "block830", kind: "dated", dated: "block830", seasons: [8], name: "The Block's community builds (8.30, 8.40)", builds: "8.30 – 8.40", ranges: [[5793395, 6005771]], always: true,
    key: "slab1", endStep: "slab2", startLabel: "Llama Sphinx goes up", endLabel: "Cordial Courtyard goes up",
    about: "8.30's two community-built islands on the Block, each a level in its paks: Llama Sphinx (Prudiz; Update v8.30, 10 April 2019; 8.30 came out mid-season, so it is up from the replay's first day) and Cordial Courtyard (GonzoTheWizard, 17 April, Update v8.40's day, on to the season's end). A match keeps the one it started with, so a change shows from the next match. 🟡 The Fortnite Wiki's days, no hours (00:00 UTC)." },
  // 9.00's Block (events/block.js): Modern Mansion, then Custom Car Carpet on 9.01's day (both in 9.00's paks).
  { id: "block900", kind: "dated", dated: "block900", seasons: [9], name: "The Block's community builds (9.00)", builds: "9.00", ranges: [[6337466, 6337466]], always: true,
    key: "slab1", endStep: "slab2", startLabel: "Modern Mansion goes up", endLabel: "Custom Car Carpet goes up",
    about: "9.00's two community-built islands on the Block, each a level in its paks: Maka's Modern Mansion (MakaMakes_YT; Update v9.00, 9 May 2019, Season 9's first day) and Custom Car Carpet (Rallred84, 15 May, Update v9.01's day, on to the season's end). A match keeps the one it started with, so a change shows from the next match. 🟡 The Fortnite Wiki's days, no hours (00:00 UTC)." },
  // 8.50's Block (events/block.js): Tricky Tracks, then Alien Sanctuary on 8.51's day (both in 8.50's paks); 8.51's is 8.50's.
  { id: "block850", kind: "dated", dated: "block850", seasons: [8], name: "The Block's community builds (8.50, 8.51)", builds: "8.50 – 8.51", ranges: [[6058028, 6165369]], always: true,
    key: "slab1", endStep: "slab2", startLabel: "Tricky Tracks goes up", endLabel: "Alien Sanctuary goes up",
    about: "8.50's two community-built islands on the Block, each a level in its paks: Tricky Tracks (Callum5tewart; Update v8.50, 25 April 2019; 8.50 came out mid-season, so it is up from the replay's first day) and Alien Sanctuary (Pr0Spartaner, 2 May, Update v8.51's day, on to the season's end). A match keeps the one it started with, so a change shows from the next match. 🟡 The Fortnite Wiki's days, no hours (00:00 UTC)." },
  // 8.20's High Stakes Challenges (events/highstakes2019.js); 8.30's to 8.51's paks have them too.
  { id: "highStakes2019", kind: "dated", dated: "highStakes2019", seasons: [8], name: "High Stakes (Season 8)", builds: "8.20 – 8.51", ranges: [[5625478, 6165369]],
    key: "challenges", endOfKey: true, startLabel: "Challenges start", endLabel: "Challenges end",
    about: "Season 8's High Stakes Challenges, with the Getaway back (Schedule_LTM_Heist_V2: play and win the Getaway, use a Grappler; the Heist back bling and its styles), 14 to 19 March 2019 by the Fortnite Wiki. 8.20 came out on 27 March, after them, so on Season 8's replay they run before 8.20's day; the admin's times or the switch serve them whenever. 🟡 00:00 UTC, to the last day's end.",
    flags: ["EventFlag.LTM_HighStakes", "CalendarEvent_Season8_HighStakes"] },
  // 8.30's Buccaneer's Bounty Challenges (events/buccaneersbounty.js); 8.40's to 8.51's paks have them too.
  { id: "buccaneersBounty", kind: "dated", dated: "buccaneersBounty", seasons: [8], name: "Buccaneer's Bounty", builds: "8.30 – 8.51", ranges: [[5793395, 6165369]],
    key: "challenges", endOfKey: true, startLabel: "Challenges start", endLabel: "Challenges end",
    about: "Update v8.30's Buccaneer's Bounty Challenges (Schedule_PirateParty): visit pirate camps for the Plunder glider, then one more each day: Buried Treasure for the Pirate Parrot spray, top 10s in squads with a friend, and be the cannonball; all four give the Boobytrapped emote. 10 to 16 April 2019 by the Fortnite Wiki; the day's mode is the Battle Royale Game Modes list's. 🟡 00:00 UTC, to the last day's end.",
    flags: ["EventFlag.LTE_BootyBay", "CalendarEvent_Season8_BootyBay"] },
  // 8.40's Air Royale Challenges (events/airroyale.js); 8.50's and 8.51's paks have them too.
  { id: "airRoyale", kind: "dated", dated: "airRoyale", seasons: [8], name: "Air Royale Challenges", builds: "8.40 – 8.51", ranges: [[6005771, 6165369]],
    key: "challenges", endOfKey: true, startLabel: "Challenges start", endLabel: "Challenges end",
    about: "Update v8.40's Air Royale Challenges (Schedule_LTM_Goose): play Air Royale, deal damage to Stormwings with SMGs, pistols and assault rifles, collect sky chests, destroy Stormwings, outlast, place top 5; three at the start and three more on the third and fifth days, for the Callsign Skull, Falcon and Wolf wraps, and Callsign Hornet for all nine. 17 to 24 April 2019 by the Fortnite Wiki; the mode itself is events/ltms.js's Air Royale. 🟡 00:00 UTC, to the last day's end.",
    flags: ["EventFlag.LTM_Goose", "CalendarEvent_Season8_AirRoyale"] },
  // 8.50's Endgame Challenges (events/endgame.js); 8.51's paks have them too.
  { id: "endgame", kind: "dated", dated: "endgame", seasons: [8], name: "Endgame Challenges", builds: "8.50 – 8.51", ranges: [[6058028, 6165369]],
    key: "challenges", endOfKey: true, startLabel: "Challenges start", endLabel: "Challenges end",
    about: "Update v8.50's Endgame Challenges (Schedule_LTM_Ashton): deal damage hovering with Iron Man's Repulsors, collect Infinity Stones and play Endgame at the start, then three more on each of the third, fifth and seventh days (Stormbreaker throws, the Chitauri Jetpack, eliminations in different matches, Captain America's Shield, the Chitauri Laser Rifle and Energy Launcher, Hawkeye's grapple, wins as the Chitauri or Thanos and as the heroes); the banners, sprays, emoticons and the Assemble loading screen, and any 10 for the Avengers Quinjet glider. 25 April to 5 May 2019 by the Fortnite Wiki; the mode itself is events/ltms.js's Endgame. 🟡 00:00 UTC, to the last day's end.",
    flags: ["EventFlag.LTM_Ashton", "CalendarEvent_Season8_Ashton"] },
  // 8.51's Season 8 Overtime Challenges (events/extracredit.js) and the Unvaulting (events/unvaulting.js).
  { id: "extraCredit", kind: "dated", dated: "extraCredit", seasons: [8], name: "Season 8 Overtime Challenges", builds: "8.51", ranges: [[6165369, 6165369]],
    key: "challenges", endOfKey: true, startLabel: "Challenges start", endLabel: "Challenges end",
    about: "Season 8's Overtime Challenges (Season8_ExtraCredit_Schedule): collect coins in featured Creative islands and place top 10 in squads with a friend at the start, then two more on each of the third and fifth days (damage, top 15 in duos with a friend, outlast, top 25 in solo), and the Battle Pass's three two-stage ones (tiers 23, 71 and 87, then 2, 4 and 6 free ones) for Sidewinder's, Ember's and Master Key's new styles; any 6 for the Season 8 loading screen. 3 to 8 May 2019 by the Fortnite Wiki. 🟡 00:00 UTC, to the last day's end.",
    flags: ["EventFlag.LTE_S8_ExtraCredit", "CalendarEvent_Season8_ExtraCredit"] },
  { id: "unvaulting", kind: "dated", dated: "unvaulting", seasons: [8], name: "The Unvaulting (live event)", builds: "8.51", ranges: [[6165369, 6165369]],
    key: "event", startLabel: "The Vault opens",
    about: "Season 8's live event, 4 May 2019 at 2 PM ET (18:00 UTC): the fifth rune's hologram (30 April) and the rune over the volcano (1 May), the 24-hour countdown over the Vault, the sky above it streamed in for the event's half hour, the event (the Vault opens, every player votes by pickaxing a crystal, the volcano erupts) and the island after it (the ash sky; Retail Row, Polar Peak and Tilted Towers hit) to the season's end. Every Battle Royale match running then plays it, not Creative or Playground; the Unvaulting playlist is events/ltms.js's. The vote's winner and its loot are the game server's, not the calendar's (Epic's chose the Drum Gun). Start now or a time on the event's step plays it then, the steps before it at Epic's spacing: a time a few minutes ahead lets running matches show the countdown's end. Off leaves the island as it was before. 🟡 The rune days' hours (00:00 UTC), the sky level's half hour and the event's 10 minutes aren't recorded.",
    flags: ["GWW5", "GW5", "GWS1", "GWLevel", "GWS0", "PGW"] },
  { id: "unvaultedItem", kind: "choice", choice: "unvaultedItem", seasons: [8], name: "The Unvaulting's unvaulted item", builds: "8.51", ranges: [[6165369, 6165369]],
    about: "What the island has unvaulted after the Unvaulting, in every 8.51 match from the event's end on: its loot weight goes on the match's chests, floor loot and supply drops (Planes: every Stormwing spawner spawns its plane). By default the first 8.51 game server whose vote ends reports its winner and every later match takes it; until one has, Epic's own result, the Drum Gun. Pick an item to set it yourself. During the event each match still plays its own vote." },
  // 8.00's to 8.51's Save the World Spring 2019 (events/spring2019.js, Core-Backend #408).
  { id: "spring2019", kind: "choice", choice: "spring2019", seasons: [8], name: "Love Storm and Yarrr! (Save the World)", builds: "8.00 – 8.51", ranges: [[5203069, 6165369]],
    about: "Save the World's spring event of 2019 on the quest map's event pages. Love Storm (Update v8.00, 28 February 2019): the LoveQuest_2019 line with its trebuchet landmark, on 8.00 to 8.51. Yarrr! (Update v8.20, 27 March 2019): the PirateQuest_2019 line with the Pirate Cove and Walk the Plank landmarks, Corsair, Jack's Revenge and Blakebeard the Blackhearted, on 8.20 to 8.51; 8.40 adds Bunny Brawler Luna and Dashing Hare Ken to the Event Store (17 April), 8.50 Cottontail Eagle Eye and Miss Bunny Penny (25 April). The quests pay Spring Tickets and Gold; each landmark mission is on a tile in every campaign theater that only a player holding its quest sees. Epic's dates follow Season 8's replay, so Yarrr! is on from its 27 March to the season's end. 🟡 No hours (00:00 UTC) and no recorded end (both run to the season's end).",
    flags: ["EventFlag.Spring2019", "EventFlag.Spring2019.Phase1", "EventFlag.Spring2019.Phase2 (8.20 – 8.51)"] },
  { id: "season8Lobby", kind: "build", seasons: [8], name: "Season 8 lobby", builds: "8.00 – 8.51", ranges: [[5203069, 6165369]],
    about: "Battle Royale's Season 8 lobby: EventFlag.LobbySeason8 turns on the lobby background takeover (Items/Events/Shared/LobbyBG_Season8), which puts the frontend's lobby in Maps/UI/Frontend_Lobby_Season8_B; without the flag the lobby has no background at all. 8.00 to 8.51 carry no other Battle Royale lobby flag.",
    flags: ["EventFlag.LobbySeason8"] },
  // 9.00's (events/events.js): Season 9's lobby, which is also the Fortbytes' event (events/fortbytes.js).
  { id: "season9Lobby", kind: "build", seasons: [9], name: "Season 9 lobby and Fortbytes", builds: "9.00", ranges: [[6337466, 6337466]],
    about: "Battle Royale's Season 9 lobby: EventFlag.LobbySeason9 turns on the lobby background takeover (Items/Events/Shared/LobbyBG_Season9). It is also the event of the Battle Pass's Fortbytes (Season9_Fortbyte_Schedule): each Fortbyte unlocks its set number of days after the flag's start, Season 9's first day on its replay.",
    flags: ["EventFlag.LobbySeason9"] },
  // 9.00's Save the World Wargames (events/wargames.js, PongooDev/CoreV2#655).
  { id: "wargames", kind: "build", seasons: [9], name: "Wargames (Save the World)", builds: "9.00", ranges: [[6337466, 6337466]],
    about: "Save the World's Wargames: the Storm Shield computer's simulations (Torn Apart, Hot Spots, Denied, Safety Zone) and its nine challenges (the hotfix's bEnableIronCity), the quest map's Wargames callout, the Boot Camp, simulation and challenge quests and their repeatables, and a Daily Challenge quest a day in each zone whose first Storm Shield Defense is done, up to 4. Its rewards are Event Tickets, Gold, the simulations' banners and each zone's Wargames Rewards pack.",
    flags: ["EventFlag.Outpost"] }
];
export const eventCard = (id) => eventCards.find((card) => card.id === id);

const modeLabels = { off: "Off", before: "Before the event", dates: "Epic's dates", custom: "Custom", build: "As the build ran it", launch: "After the rocket launch", always: "Always on",
  season: "Epic's dates", all: "All on" };
export const meteorStrikePhases = [["none", "Comet only"], ["broadcast", "TVs show static"], ["meteors", "Meteors"], ["impact", "Meteors at their most"]];
export const iceKingSnowPhases = [["event", "Follows the storm"], ["none", "Season 7's own snow"], ["full", "Island under snow"]];
export const siphonPhases = [["build", "As Epic ran it"], ["on", "On"], ["off", "Off"]];
export const spring2019Phases = [["dates", "Epic's dates"], ["on", "On"], ["off", "Off"]];
export const unvaultedItemPhases = [["vote", "The servers' vote (the Drum Gun until one reports)"], ["GW.DrumGun", "Drum Gun"], ["GW.Tac", "Tactical SMG"],
  ["GW.Grappler", "Grappler"], ["GW.Bouncer", "Bouncer"], ["GW.Sword", "Infinity Blade"], ["Plane", "Planes"]];
// The choice cards' settings: the events config's key, its phases and its default.
const choices = { meteorStrike: { phases: meteorStrikePhases, fallback: "meteors" }, iceKingSnow: { phases: iceKingSnowPhases, fallback: "event" },
  siphon: { phases: siphonPhases, fallback: "build" }, spring2019: { phases: spring2019Phases, fallback: "dates" },
  unvaultedItem: { phases: unvaultedItemPhases, fallback: "vote" } };
const choiceOf = (card) => choices[card.choice ?? "meteorStrike"];
const eventModeNames = { force_fortnitemares: "forces Fortnitemares 2017", force_mutantstorms: "forces the Mutant Storms", force_winter2017: "forces Survive the Holidays",
  custom: "serves only the flags listed under Advanced" };

const ms = (iso) => (iso ? Date.parse(iso) : null);
const onAt = (window, now) => Boolean(window) && ms(window.startAt) <= now && (window.endAt === null || now < ms(window.endAt));

// A schedule of steps ([{label, startAt, endAt}], null endAt: stays on) as plain words at nowMs: the step on now (the last
// that is), the next to start, or over.
function stepsState(steps, now) {
  const on = steps.filter((step) => onAt(step, now));
  const next = steps.filter((step) => step.startAt && ms(step.startAt) > now).sort((a, b) => ms(a.startAt) - ms(b.startAt))[0];
  if (on.length) {
    const current = on.at(-1);
    return { tone: "on", nowLabel: current.label, text: `On now: ${current.label}${next ? `. Next: ${next.label}, {at}` : ""}`, at: next?.startAt ?? null };
  }
  if (next) return { tone: "scheduled", text: `Scheduled: ${next.label}, {at}`, at: next.startAt };
  const ends = steps.filter((step) => step.endAt).map((step) => step.endAt).sort();
  return { tone: "over", text: steps.length ? "Over: ended {at}" : "Nothing scheduled", at: ends.at(-1) ?? null };
}

const datesPrefix = (state) => ({ ...state, tone: state.tone === "on" ? "on" : "dates", text: `Follows Epic's dates. ${state.text}` });

// Each event's state now, from the stores' own status views (the overview's): rocket (events/rocketlaunch.js
// rocketLaunchStatus), dated (events/datedflags.js datedFlagsStatus), season4 (events/oddities.js season4FlagsStatus), storm
// (events/stormdestruction.js stormDestructionStatus), the events config and whether the seasonal events run at all.
export function eventSchedules({ now = new Date(), config = {}, seasonalEvents = true, rocket, dated, season4, storm, links = {} }) {
  const nowMs = now.getTime();
  const mode = config.mode ?? "auto";
  const blocked = !seasonalEvents ? "Off: the Seasonal Events switch (Settings) is off" : mode === "off" ? "Off: the event mode is All off" : null;
  const datedById = Object.fromEntries((dated?.events ?? []).map((event) => [event.id, event]));

  const stateOf = (card) => {
    if (card.kind === "build") {
      if (mode === "auto") return { tone: "dates", nowLabel: "on", text: `Follows Epic's: runs on ${card.builds} by itself` };
      if (card.force === mode) return { tone: "on", nowLabel: "forced on", text: "On now: forced on every build by the event mode" };
      return { tone: "off", text: `Not running: the event mode ${eventModeNames[mode] ?? mode}` };
    }
    if (card.kind === "contentUpdates") {
      const updates = config.contentUpdates?.mode ?? "season";
      return updates === "all" ? { tone: "on", nowLabel: "all on", text: "On now: every update" } : { tone: "dates", text: "Follows Epic's dates on Season 2's replay" };
    }
    if (card.kind === "choice") {
      const { phases, fallback } = choiceOf(card);
      const key = card.choice ?? "meteorStrike";
      const phase = phases.find(([id]) => id === (config[key] ?? fallback)) ?? phases.find(([id]) => id === fallback);
      if (key === "siphon") {
        return phase[0] === "build" ? { tone: "dates", nowLabel: "on", onRanges: [[5046157, 5203069]], text: "Follows Epic's: on in 7.40 and 8.00, off in 8.20 (Update v8.20 took it out of the core modes)" }
          : phase[0] === "on" ? { tone: "on", nowLabel: "on", text: "On now: on 7.40, 8.00 and 8.20" } : { tone: "off", text: "Off" };
      }
      if (key === "spring2019") {
        if (phase[0] === "off") return { tone: "off", text: "Off" };
        if (phase[0] === "on") return { tone: "on", nowLabel: "on", text: "On now: Love Storm on 8.00 and 8.20, Yarrr! on 8.20" };
        return { tone: "dates", nowLabel: "on", text: "Follows Epic's dates on Season 8's replay: Love Storm all season (8.00 and 8.20), Yarrr! from 27 March (8.20)" };
      }
      if (key === "unvaultedItem") {
        return phase[0] === "vote" ? { tone: "dates", text: "Follows the vote: the first 8.51 server's winner, the Drum Gun until one reports" }
          : { tone: "on", nowLabel: phase[1].toLowerCase(), text: `On now: ${phase[1]}, whatever the vote` };
      }
      if (key === "iceKingSnow") {
        return phase[0] === "event" ? { tone: "dates", text: "Follows the storm: Season 7's own snow before it, the island under snow after it" }
          : { tone: "on", nowLabel: phase[1].toLowerCase(), text: `On now: ${phase[1]}, whatever the storm` };
      }
      return { tone: phase[0] === "none" ? "off" : "on", nowLabel: phase[1].toLowerCase(), text: `On now: ${phase[1]}` };
    }
    if (card.kind === "storm") {
      if (!storm || storm.mode === "off" || storm.percent === 0) return { tone: "off", text: "Off" };
      if (storm.mode === "always") return { tone: "on", nowLabel: `${storm.percent}% of matches`, text: `On now: in ${storm.percent}% of 5.40 and 5.41 matches` };
      return storm.inDates ? { tone: "on", nowLabel: `${storm.percent}% of matches`, text: `Follows Epic's dates. On now: in ${storm.percent}% of 5.40 matches` }
        : { tone: "dates", text: "Follows Epic's dates (7 September on Season 5's replay, 5.40 only): off now" };
    }
    if (card.kind === "rocket") {
      const r = rocket ?? { mode: "off", phase: "unscheduled" };
      const prefix = r.mode === "dates" ? (state) => datesPrefix(state) : (state) => state;
      if (r.mode === "off") return { tone: "off", text: "Off: the rocket waits in its lair" };
      if (r.phase === "scheduled") return prefix({ tone: "scheduled", text: "Scheduled: launches {at}", at: r.launch });
      if (r.phase === "countdown") return prefix({ tone: "on", nowLabel: "counting down", text: "On now: counting down to the launch, {at}", at: r.launch });
      if (r.phase === "launching") return prefix({ tone: "on", nowLabel: "launching", text: "On now: the rocket is launching" });
      if (r.phase === "rift") return prefix({ tone: "on", nowLabel: "launched, the sky's crack grows", text: "On now: launched, the sky's crack grows until {at}", at: r.riftEnd });
      if (r.phase === "over") return prefix({ tone: "over", nowLabel: "launched", text: "Over: launched {at}", at: r.launch });
      return { tone: "off", text: "Off" };
    }
    if (card.kind === "oddities") {
      const s4 = season4 ?? { oddities: "off", rifts: [] };
      if (s4.oddities === "off") return { tone: "off", text: "Off: no rifts (switch them one by one under Advanced)" };
      if (mode !== "auto") return { tone: "off", text: "Paused: runs in the Automatic event mode only" };
      const rifts = s4.rifts.filter((rift) => rift.tellAt);
      if (!rifts.length) return { tone: "off", text: s4.oddities === "launch" ? "Waits for the rocket launch" : "Nothing scheduled" };
      const forming = rifts.find((rift) => ms(rift.tellAt) <= nowMs && nowMs < ms(rift.eventAt));
      const done = rifts.filter((rift) => ms(rift.eventAt) <= nowMs).length;
      const next = rifts.flatMap((rift) => [{ label: `rift ${rift.number} forms`, at: rift.tellAt }, { label: `rift ${rift.number} strikes`, at: rift.eventAt }])
        .filter(({ at }) => ms(at) > nowMs).sort((a, b) => ms(a.at) - ms(b.at))[0];
      const then = next ? `. Next: ${next.label}, {at}` : "";
      const result = forming ? { tone: "on", nowLabel: `rift ${forming.number} forming`, text: `On now: rift ${forming.number} is forming (${done} of ${rifts.length} struck)${then}`, at: next?.at ?? null }
        : done && next ? { tone: "on", nowLabel: `${done} of ${rifts.length} rifts struck`, text: `On now: ${done} of ${rifts.length} rifts struck${then}`, at: next.at }
        : next ? { tone: "scheduled", text: `Scheduled: ${next.label}, {at}`, at: next.at }
        : { tone: "over", text: "Over: every rift has struck" };
      return s4.oddities === "dates" ? datesPrefix(result) : s4.oddities === "launch" ? { ...result, text: `After the rocket launch. ${result.text}` } : result;
    }
    // A dated event (events/datedflags.js).
    const event = datedById[card.dated];
    if (!event) return { tone: "off", text: "Off" };
    if (event.mode === "off") {
      return { tone: "off", text: card.id === "butterfly" ? "Off: 6.21 keeps Fortnitemares' Cube Monsters' days (POI0) on; the Butterfly plays only by the flag switches under Advanced" : "Off" };
    }
    if (event.mode === "build") return { tone: "dates", nowLabel: "on", onRanges: [[4225813, 4240749]], text: "As the build ran it: on in 5.10 (counting down to 7 August on Season 5's replay), off in 5.21" };
    if (mode !== "auto" && !card.always) return { tone: "off", text: "Paused: runs in the Automatic event mode only" };
    // The Butterfly held before the event (Core-Backend #354): the map's pre-event state, with 6.21's Fortnitemares modes.
    if (event.mode === "before") {
      if (card.id === "iceKing") {
        return { tone: "on", nowLabel: "before the event", text: "On now: before the event: the ice sphere over Polar Peak and the normal Solo, Duos and Squads; the storm waits for Start now, a time or Epic's dates" };
      }
      return { tone: "on", nowLabel: "before the event", text: "On now: the map before the event (Fortnitemares' Cube Monsters' days, POI0), and the Fortnitemares modes back with it; the Butterfly doesn't play" };
    }
    const state = stepsState(event.steps.map((step) => ({ label: step.label, ...(step.current ?? { startAt: null, endAt: null }) })).filter((step) => step.startAt), nowMs);
    return event.mode === "dates" ? datesPrefix(state) : state;
  };

  // The control's modes and the custom pickers' times now.
  const controlOf = (card) => {
    if (card.kind === "build") return { modes: [] };
    if (card.kind === "contentUpdates") return { mode: config.contentUpdates?.mode ?? "season", modes: ["season", "all"] };
    if (card.kind === "choice") {
      const { phases, fallback } = choiceOf(card);
      return { mode: config[card.choice ?? "meteorStrike"] ?? fallback, modes: phases.map(([id]) => id), labels: Object.fromEntries(phases) };
    }
    if (card.kind === "storm") return { mode: storm?.mode ?? "dates", modes: ["off", "dates", "always"], percent: storm?.percent ?? 10 };
    if (card.kind === "rocket") {
      return { mode: rocket?.mode ?? "off", modes: ["off", "dates", "custom"], now: true, startAt: rocket?.launch ?? rocket?.at ?? null, countdownHours: rocket?.countdownHours ?? 48,
        original: rocket?.original ?? null };
    }
    if (card.kind === "oddities") {
      const rifts = (season4?.rifts ?? []).filter((rift) => rift.tellAt);
      return { mode: season4?.oddities ?? "off", modes: ["off", "dates", "launch", "custom"], now: true, startAt: rifts[0]?.tellAt ?? null, endAt: rifts.at(-1)?.eventAt ?? null };
    }
    const event = datedById[card.dated];
    const own = datedEvent(card.dated);
    const key = event?.steps.find((step) => step.step === card.key);
    const endRef = card.endOfKey ? key : card.endStep ? event?.steps.find((step) => step.step === card.endStep) : null;
    const shown = (step) => step?.current ?? step?.custom ?? step?.dates ?? null;
    return { mode: event?.mode ?? "off", modes: event?.modes ?? ["off", "dates", "custom"], now: true, startAt: shown(key)?.startAt ?? null,
      endAt: card.endOfKey ? shown(key)?.endAt ?? null : card.endStep ? shown(endRef)?.startAt ?? null : null, steps: own?.steps.length ?? 0 };
  };

  return eventCards.map((card) => {
    const control = controlOf(card);
    const state = blocked && card.kind !== "contentUpdates" && !card.always ? { tone: "off", text: blocked } : stateOf(card);
    return {
      id: card.id, kind: card.kind, name: card.name, builds: card.builds, seasons: card.seasons, about: card.about, ranges: card.ranges,
      flags: card.flags ?? datedEvent(card.dated)?.steps.flatMap((step) => step.flags).filter((flag, index, all) => all.indexOf(flag) === index) ?? [],
      startLabel: card.startLabel ?? null, endLabel: card.endOfKey || card.endStep || card.kind === "oddities" ? card.endLabel : null,
      ...control, modeLabels: Object.fromEntries((control.modes ?? []).map((id) => [id, control.labels?.[id] ?? modeLabels[id] ?? id])),
      // Start now's confirmation when the card has its own, and a second button from soonLeadSeconds on (the Ice King's).
      nowConfirm: card.nowConfirm ?? null,
      soon: control.now && card.soonLeadSeconds ? { seconds: card.soonLeadSeconds, label: card.soonLabel, confirm: card.soonConfirm ?? null } : null,
      state, links: links[card.id] ?? []
    };
  });
}

// What players on each build see now: the events on now there, in plain words ("No event" without one).
export function buildsNow(builds, cards, storm) {
  return builds.map(({ version, cl }) => {
    const on = cards.filter((card) => (card.state.onRanges ?? card.ranges).some(([first, last]) => cl >= first && cl <= last))
      .filter((card) => card.kind === "storm" ? storm?.builds?.[cl] === true : card.state.nowLabel)
      .map((card) => (card.kind === "build" || card.state.nowLabel === "on" ? card.name : `${card.name}: ${card.state.nowLabel}`));
    return { version, cl, sees: on.length ? on.join(" · ") : "No event: the base game" };
  });
}

// The one control as the stores' settings: {event, mode, startAt?, endAt?, countdownHours?, percent?} to an events config
// patch ({rocketLaunch}, {season4Flags}, {datedFlags}, {stormDestruction}, {contentUpdates}, {meteorStrike} or {iceKingSnow}),
// or {error}.
// "now" is the custom mode from now (the key moment now, or nowLeadSeconds on), and "soon" from soonLeadSeconds on for a
// card that has it (the Ice King's Start in 5 minutes). The current events config fills a custom mode chosen without
// times with the ones it has.
export function scheduleEventPatch(body, config = {}, now = new Date()) {
  const card = eventCard(body?.event);
  if (!card || card.kind === "build") return { error: `event must be one of ${eventCards.filter(({ kind }) => kind !== "build").map(({ id }) => id).join(", ")}` };
  const modes = card.kind === "rocket" ? ["off", "dates", "custom", "now"] : card.kind === "oddities" ? ["off", "dates", "launch", "custom", "now"]
    : card.kind === "storm" ? ["off", "dates", "always"] : card.kind === "contentUpdates" ? ["season", "all"] : card.kind === "choice" ? choiceOf(card).phases.map(([id]) => id)
    : [...datedModesOf(datedEvent(card.dated)), "now", ...(card.soonLeadSeconds ? ["soon"] : [])];
  const mode = body.mode;
  if (!modes.includes(mode)) return { error: `mode must be ${modes.join(", ")}` };
  const time = (value) => (value === undefined || value === null || value === "" ? null : typeof value === "string" && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : NaN);
  const fromNow = mode === "now" || mode === "soon";
  const start = fromNow ? now.getTime() + ((mode === "soon" ? card.soonLeadSeconds : card.nowLeadSeconds) ?? 0) * 1000 : time(body.startAt);
  const end = fromNow ? null : time(body.endAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return { error: "startAt and endAt must be dates and times" };
  if (start !== null && end !== null && end <= start) return { error: "The end must be after the start" };
  const iso = (value) => new Date(value).toISOString();

  if (card.kind === "contentUpdates") return { patch: { contentUpdates: { mode } } };
  if (card.kind === "choice") return { patch: { [card.choice ?? "meteorStrike"]: mode } };
  if (card.kind === "storm") {
    const percent = body.percent === undefined ? undefined : Number(body.percent);
    if (percent !== undefined && !(Number.isInteger(percent) && percent >= 0 && percent <= 100)) return { error: "percent must be 0 to 100" };
    return { patch: { stormDestruction: { mode, ...(percent === undefined ? {} : { percent }) } } };
  }
  if (card.kind === "rocket") {
    const hours = body.countdownHours === undefined ? {} : { countdownHours: body.countdownHours };
    if (mode === "off" || mode === "dates") return { patch: { rocketLaunch: { mode, ...hours } } };
    if (start === null) return config.rocketLaunch?.at ? { patch: { rocketLaunch: { mode: "custom", ...hours } } } : { error: "Pick the launch time" };
    return { patch: { rocketLaunch: { mode: "custom", at: iso(start), ...hours } } };
  }
  if (card.kind === "oddities") {
    if (mode !== "custom" && mode !== "now") return { patch: { season4Flags: { oddities: mode } } };
    if (start === null) return config.season4Flags?.schedule?.length ? { patch: { season4Flags: { oddities: "custom" } } } : { error: "Pick when the first rift forms" };
    // Eight rifts a spacing apart, each object going a spacing after its rift forms: the last object at start + 8 spacings.
    const spacingHours = end === null ? 24 : (end - start) / 8 / 3600000;
    const schedule = spacedOdditySchedule({ startAt: iso(start), spacingHours, warningHours: spacingHours });
    if (!schedule) return { error: "The rifts' times must be at most 30 days apart" };
    return { patch: { season4Flags: { oddities: "custom", schedule } } };
  }
  // A dated event: Epic's steps from its key moment, stretched or squeezed to the end when one is given.
  const event = datedEvent(card.dated);
  if (mode !== "custom" && !fromNow) return { patch: { datedFlags: { [event.id]: { mode } } } };
  if (start === null) {
    return validDatedSchedule(event, config.datedFlags?.[event.id]?.schedule ?? [])?.length ? { patch: { datedFlags: { [event.id]: { mode: "custom" } } } }
      : { error: `Pick when ${card.startLabel.toLowerCase()}` };
  }
  const key = event.steps.find(({ id }) => id === card.key);
  const endRef = card.endOfKey ? key.end : card.endStep ? event.steps.find(({ id }) => id === card.endStep).start : null;
  if (end !== null && endRef === null) return { error: `${card.name} takes a start time only` };
  const scale = end === null ? 1 : (end - start) / (endRef - key.start);
  const schedule = shiftedDatedSchedule(event, { startAt: iso(start), step: card.key, scale });
  if (!schedule) return { error: "That end is too near or too far from the start (from a thousandth to ten times Epic's length)" };
  return { patch: { datedFlags: { [event.id]: { mode: "custom", schedule } } } };
}

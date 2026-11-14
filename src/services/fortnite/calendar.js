import { createHash } from "node:crypto";
import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { currentBuild } from "../../builds/context.js";
import { activeEventFlags, currentEventsConfig, eventsActiveUntil, isEventActive, ltmFortnitemares, ltmLilKevin } from "../../events/events.js";
import { fiftyFifty, fiftyFiftyRegions } from "../../events/fiftyfifty.js";
import { ltmEventFlags, ltmModes, nextLtmChange } from "../../events/ltms.js";
import { regionCodes } from "../../matchmaking/regions.js";
import { eventStoreEnds } from "../../store/eventstore.js";
import { hasItemShop, seasonEnd, weeklyStoreEnd } from "../../store/itemshop.js";
import { hasSeasonShop } from "../../store/seasonshop.js";
import { athenaSeason } from "../../gamedata/athena.js";
import { challengeSeasonBegin, weekPlan } from "../../profiles/challenges.js";
import { seasonTemplateId } from "../../profiles/seasons.js";
import { rocketLaunchStates } from "../../events/rocketlaunch.js";
import { mergeTimedStates, odditiesStates } from "../../events/oddities.js";
import { tomatoRiftStates } from "../../events/tomatorift.js";
import { birthdayActiveUntil, birthdayChallengeStates } from "../../events/birthday2018.js";
import { cubeStates } from "../../events/cube.js";
import { highStakesStates } from "../../events/highstakes.js";
import { islandStates } from "../../events/island.js";
import { butterflyStates } from "../../events/butterfly.js";
import { fortnitemaresActiveUntil, lilKevinActiveUntil } from "../../events/fortnitemares2018.js";

// 1.8's event calendar (ScheduledEvents' FCalendarDownload): {currentTime, channels: {<channel>: FEventsTimeline
// {cacheExpire, states: [FEventChannelState {validFrom, activeEvents: [{eventName, activeUntil}], state}]}}}. The
// client reads its client-events channel (1.8 sub_70EEC0) and asks again at cacheExpire; without an answer it asked
// many times a second. The events active are the ones Core runs on the requesting build (events/events.js), named by
// their event flag, as RequestEventFlags and ClientQuestLogin tell the quest manager (🟡: 1.8 takes its flags from
// those MCP notifications; nothing found in it reads the calendar's event names).
//
// The state is the channel's FFortClientEventsState {seasonId, seasonEnd, weeklyStoreEnd} (sub_70EEC0 registers
// "client-events" with it). Its weeklyStoreEnd is what the Battle Royale store's weekly countdown counts to
// (GetWeeklyStoreEndDate 0x2E82B70), so 1.8 and later get the item shop's (store/itemshop.js), and the calendar is good
// no later than then, so that the client asks again for the next one. Its seasonEnd is what 1.8.2's Season Shop counts
// down to (GetSeasonStoreEndDate, store/seasonshop.js), sent to the builds with one.
//
// 1.10 (CL-3790078, UE 4.19) names an active event FEventRecord {EventType, ActiveUntil} where 1.8 to 1.9.1 have
// EventName, and gives the calendar to its UFortSeasonalEventManager (0x7F0BF0 registers both channels). Its
// client-events state's base, FFortRotationalContentEventsState, holds ActiveEventFlags: the event flags the manager runs
// its event items on (0x7E02C0: these, plus the player's region's EventFlagsForcedOn less its EventFlagsForcedOff, plus
// the hotfix's EventFlagsForcedOnByHotfix less ...OffByHotfix), BR_Playlist_50v50's EventFlag.BR.Allow50v50 among them.
// Its client-matchmaking channel (FFortMatchmakingEventsState) switches 50v50's queue on by region while that event runs
// (events/fiftyfifty.js), and from 1.11 the lobby's event queues (EventFlagsForcedOn Event1 to Event8: Sneaky
// Silencers, High Explosives, Shooting Test #1, Sniper Shootout) while the admin panel has them on, by hand or by their
// original dates (events/ltms.js). With the dates on, the calendar is good no later than the next LTM's start or end.
//
// 1.11 (CL-3807424) sends the season in the client-events state (1.10 has the field and gets none, as its profile has no
// season_num: profiles/seasons.js): FFortClientEventsState {SeasonNumber (+0x140),
// SeasonTemplateId (+0x148), SeasonEnd, WeeklyStoreEnd, StwEventStoreEnd, StwWeeklyStoreEnd}. Its season is Season 2
// (gamedata AthenaSeason2, profiles/seasons.js): seasonNumber 2, seasonTemplateId "AthenaSeason:athenaseason2", and its
// Battle Pass tab counts down to seasonEnd (AthenaSeasonTab: GetSeasonStoreEndDate). Its event flags turn the winter
// lobby on (EventFlag.LobbyWinterDecor, events/events.js). Save the World's Event Store (1.11 to 3.3, 3.5.1) counts down to
// stwEventStoreEnd and stwWeeklyStoreEnd (store/eventstore.js).
//
// 4.5 (CL-4159770, CL-4166199) runs Blast Off, the rocket launch, from this channel (events/rocketlaunch.js): with a
// launch time set, client-events holds a state for each part of it from the one now on (validFrom its start), each
// naming the build's flags and the rocket's calendar events (EventFlag.BR_S4_Geode_Countdown, _Begin, _Over and
// EventFlag.BR_S4_Rift_Growth) with their activeSince and activeUntil, which the map's FortAsyncAction_CalendarEventWatcher
// counts to; and it is good no later than the next part. The rifts of July 2018 (Athena_OdditiesActors' _Tell and _Event
// flags, events/oddities.js) join those parts the same way when the admin panel schedules them, and so does 5.21's Tomato
// Town rift (Athena_GameplayActors' BR_S5_Oddity_Tomato_Tell and _Event, events/tomatorift.js) on Season 5's replay, and
// 5.30's Cube (its crack, lightning, rolls, runes and the lake: events/cube.js; 5.40's and 5.41's too), and 5.40's High
// Stakes (EventFlag.LTM_Heist, events/highstakes.js; 5.41's too), and 6.00's floating island (EventFlag.BR_S6_Island_*,
// events/island.js) on Season 6's replay, and 6.21's Butterfly (POI0, the Cube's crack and drain, POI1: events/butterfly.js)
// when the admin panel schedules it.
export const calendarCacheMinutes = 60;
const seasonalEventManagerBuild = 3790078;

// Core's: the calendar's revision, which changes whenever the admin panel changes what the timeline serves (the events
// config, the rocket launch among it, the Seasonal Events switch and the LTM queues and their original dates). A
// gameserver fetches the timeline once and then at its cacheExpire plus up to an hour (4.5's automatic refresh), so a
// running match would see an admin's change that late; CoreV2 asks here every few seconds and, when the revision
// changes, calls AFortGameState::Client_RefreshEventCalendar, the game's multicast that has the server and its players
// fetch the timeline at once.
//   GET /fortnite/api/game/v2/calendar/revision -> {revision: "<12 hex digits>"}
// What the timeline serves on its own as time passes (the next part of a scheduled launch, an LTM's window) is in the
// states and cacheExpire the server already has, so it changes no revision.
export function calendarRevision(settingsValue) {
  const value = settingsValue ?? {};
  const inputs = { events: value.events ?? null, seasonalEvents: value.seasonalEvents !== false,
    matchmakingModes: value.matchmakingModes ?? null, ltmOriginalDates: value.ltmOriginalDates === true,
    ltmCloseEncounters: value.ltmCloseEncounters ?? null };
  return createHash("sha1").update(JSON.stringify(inputs)).digest("hex").slice(0, 12);
}

export function calendarRoutes({ tokens, settings }) {
  const router = express.Router();

  router.get("/fortnite/api/calendar/v1/timeline", requireAuth(tokens), (req, res) => {
    const now = new Date();
    const weeklyEnd = hasItemShop() ? weeklyStoreEnd(now) : undefined;
    const season = athenaSeason();
    const seasonEnds = hasSeasonShop() || season ? seasonEnd(now) : undefined;
    const stwEnds = eventStoreEnds(now);
    // From 3.0, the season's start, which the challenges tab counts the locked weeks from (profiles/challenges.js).
    const seasonBegin = challengeSeasonBegin(now);
    const challengeChange = seasonBegin ? weekPlan(now).changes : null;
    const cacheMinutes = Math.max(5, Math.min(120, Number(currentEventsConfig()?.calendarCacheMinutes ?? calendarCacheMinutes)));
    const ltmChange = nextLtmChange(currentBuild(), settings?.get?.(), now);
    // The rocket launch's parts, the rifts' (events/oddities.js), 5.21's Tomato Town rift (events/tomatorift.js), 5.30's
    // Cube (events/cube.js), 5.40's High Stakes (events/highstakes.js), 6.00's floating island (events/island.js), 6.21's
    // Butterfly (events/butterfly.js) and the Birthday Challenges on the admin's times (events/birthday2018.js) as one schedule.
    const rocket = mergeTimedStates(rocketLaunchStates(now), odditiesStates(now), tomatoRiftStates(now), cubeStates(now), highStakesStates(now),
      islandStates(now), butterflyStates(now), birthdayChallengeStates(now));
    const rocketChange = rocket[1]?.validFrom ?? null;
    const cacheExpire = new Date(Math.min(now.getTime() + cacheMinutes * 60000, weeklyEnd?.getTime() ?? Infinity, rocketChange ?? Infinity,
      seasonEnds?.getTime() ?? Infinity, ltmChange?.getTime() ?? Infinity, challengeChange?.getTime() ?? Infinity, ...Object.values(stwEnds).map((end) => end.getTime()))).toISOString();
    const seasonal = Number(currentBuild()) >= seasonalEventManagerBuild;
    const flags = activeEventFlags();
    // The Birthday's, Fortnitemares' and the Lil' Kev challenges count down to their event's end (events/birthday2018.js,
    // events/fortnitemares2018.js); every other flag never ends.
    const untilOf = (flag) => (flag === ltmFortnitemares ? fortnitemaresActiveUntil(flag, now)
      : flag === ltmLilKevin ? lilKevinActiveUntil(flag, now) : birthdayActiveUntil(flag, now));
    const activeEvents = flags.map((flag) => ({ [seasonal ? "eventType" : "eventName"]: flag, activeUntil: untilOf(flag) }));
    const state = {
      ...(seasonal ? { activeEventFlags: flags } : {}),
      ...(season ? { seasonNumber: season.seasonNumber, seasonTemplateId: seasonTemplateId() } : {}),
      ...(seasonBegin ? { seasonBegin } : {}),
      ...(seasonEnds ? { seasonEnd: seasonEnds.toISOString() } : {}),
      ...(weeklyEnd ? { weeklyStoreEnd: weeklyEnd.toISOString() } : {}),
      ...Object.fromEntries(Object.entries(stwEnds).map(([name, end]) => [name, end.toISOString()]))
    };
    const validFrom = "2017-01-01T00:00:00.000Z";
    // A part of the rocket launch or the rifts: the build's events and flags with theirs (its first part from validFrom).
    const states = rocket.length
      ? rocket.map((part, index) => ({
        validFrom: index === 0 ? validFrom : new Date(part.validFrom).toISOString(),
        activeEvents: [...activeEvents, ...part.events.map(({ eventType, activeSince, activeUntil }) =>
          ({ [seasonal ? "eventType" : "eventName"]: eventType, activeUntil, activeSince }))],
        state: { ...state, ...(seasonal ? { activeEventFlags: [...flags, ...part.events.map(({ eventType }) => eventType)] } : {}) }
      }))
      : [{ validFrom, activeEvents, state }];
    res.json({
      channels: {
        "client-events": { states, cacheExpire },
        ...((() => {
          const modes = ltmModes(currentBuild(), settings?.get?.(), now);
          const duosEnabled = modes ? modes.duo !== false : true;
          const fiftyFiftyEnabled = isEventActive(fiftyFifty) && (modes ? modes.fiftyFifty !== false : true);
          const eventFlags = ltmEventFlags(currentBuild(), settings?.get?.(), now);
          if (isEventActive(fiftyFifty) || !duosEnabled || (modes && modes.fiftyFifty === false) || eventFlags.length) {
            const region = Object.fromEntries(regionCodes().map((r) => [r, { bDuosEnabled: duosEnabled, bFiftyFiftyEnabled: fiftyFiftyEnabled,
              ...(eventFlags.length ? { EventFlagsForcedOn: eventFlags } : {}) }]));
            return { "client-matchmaking": { states: [{ validFrom, activeEvents: [], state: { region } }], cacheExpire } };
          }
          return {};
        })())
      },
      eventsTimeOffsetHrs: 0,
      cacheIntervalMins: cacheMinutes,
      currentTime: now.toISOString()
    });
  });

  router.get("/fortnite/api/game/v2/calendar/revision", requireAuth(tokens), (req, res) => {
    res.json({ revision: calendarRevision(settings?.get?.()) });
  });

  return router;
}

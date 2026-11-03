import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { currentBuild } from "../../builds/context.js";
import { activeEventFlags, currentEventsConfig, eventsActiveUntil, isEventActive } from "../../events/events.js";
import { fiftyFifty, fiftyFiftyRegions } from "../../events/fiftyfifty.js";
import { ltmEventFlags, ltmModes, nextLtmChange } from "../../events/ltms.js";
import { regionCodes } from "../../matchmaking/regions.js";
import { eventStoreEnds } from "../../store/eventstore.js";
import { hasItemShop, seasonEnd, weeklyStoreEnd } from "../../store/itemshop.js";
import { hasSeasonShop } from "../../store/seasonshop.js";
import { athenaSeason } from "../../gamedata/athena.js";
import { seasonTemplateId } from "../../profiles/seasons.js";

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
// lobby on (EventFlag.LobbyWinterDecor, events/events.js). Save the World's Event Store (1.11 to 3.0) counts down to
// stwEventStoreEnd and stwWeeklyStoreEnd (store/eventstore.js).
export const calendarCacheMinutes = 60;
const seasonalEventManagerBuild = 3790078;

export function calendarRoutes({ tokens, settings }) {
  const router = express.Router();

  router.get("/fortnite/api/calendar/v1/timeline", requireAuth(tokens), (req, res) => {
    const now = new Date();
    const weeklyEnd = hasItemShop() ? weeklyStoreEnd(now) : undefined;
    const season = athenaSeason();
    const seasonEnds = hasSeasonShop() || season ? seasonEnd(now) : undefined;
    const stwEnds = eventStoreEnds(now);
    const cacheMinutes = Math.max(5, Math.min(120, Number(currentEventsConfig()?.calendarCacheMinutes ?? calendarCacheMinutes)));
    const ltmChange = nextLtmChange(currentBuild(), settings?.get?.(), now);
    const cacheExpire = new Date(Math.min(now.getTime() + cacheMinutes * 60000, weeklyEnd?.getTime() ?? Infinity,
      seasonEnds?.getTime() ?? Infinity, ltmChange?.getTime() ?? Infinity, ...Object.values(stwEnds).map((end) => end.getTime()))).toISOString();
    const seasonal = Number(currentBuild()) >= seasonalEventManagerBuild;
    const flags = activeEventFlags();
    const activeEvents = flags.map((flag) => ({ [seasonal ? "eventType" : "eventName"]: flag, activeUntil: eventsActiveUntil }));
    const state = {
      ...(seasonal ? { activeEventFlags: flags } : {}),
      ...(season ? { seasonNumber: season.seasonNumber, seasonTemplateId: seasonTemplateId() } : {}),
      ...(seasonEnds ? { seasonEnd: seasonEnds.toISOString() } : {}),
      ...(weeklyEnd ? { weeklyStoreEnd: weeklyEnd.toISOString() } : {}),
      ...Object.fromEntries(Object.entries(stwEnds).map(([name, end]) => [name, end.toISOString()]))
    };
    const validFrom = "2017-01-01T00:00:00.000Z";
    res.json({
      channels: {
        "client-events": { states: [{ validFrom, activeEvents, state }], cacheExpire },
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

  return router;
}

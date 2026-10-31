import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { currentBuild } from "../../builds/context.js";
import { activeEventFlags, eventsActiveUntil, isEventActive } from "../../events/events.js";
import { fiftyFifty, fiftyFiftyRegions } from "../../events/fiftyfifty.js";
import { hasItemShop, seasonEnd, weeklyStoreEnd } from "../../store/itemshop.js";
import { hasSeasonShop } from "../../store/seasonshop.js";

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
// (events/fiftyfifty.js).
export const calendarCacheMinutes = 60;
const seasonalEventManagerBuild = 3790078;

export function calendarRoutes({ tokens }) {
  const router = express.Router();

  router.get("/fortnite/api/calendar/v1/timeline", requireAuth(tokens), (req, res) => {
    const now = new Date();
    const weeklyEnd = hasItemShop() ? weeklyStoreEnd(now) : undefined;
    const seasonEnds = hasSeasonShop() ? seasonEnd(now) : undefined;
    const cacheExpire = new Date(Math.min(now.getTime() + calendarCacheMinutes * 60000, weeklyEnd?.getTime() ?? Infinity,
      seasonEnds?.getTime() ?? Infinity)).toISOString();
    const seasonal = Number(currentBuild()) >= seasonalEventManagerBuild;
    const flags = activeEventFlags();
    const activeEvents = flags.map((flag) => ({ [seasonal ? "eventType" : "eventName"]: flag, activeUntil: eventsActiveUntil }));
    const state = {
      ...(seasonal ? { activeEventFlags: flags } : {}),
      ...(seasonEnds ? { seasonEnd: seasonEnds.toISOString() } : {}),
      ...(weeklyEnd ? { weeklyStoreEnd: weeklyEnd.toISOString() } : {})
    };
    const validFrom = "2017-01-01T00:00:00.000Z";
    res.json({
      channels: {
        "client-events": { states: [{ validFrom, activeEvents, state }], cacheExpire },
        ...(isEventActive(fiftyFifty)
          ? { "client-matchmaking": { states: [{ validFrom, activeEvents: [], state: { region: fiftyFiftyRegions() } }], cacheExpire } }
          : {})
      },
      eventsTimeOffsetHrs: 0,
      cacheIntervalMins: calendarCacheMinutes,
      currentTime: now.toISOString()
    });
  });

  return router;
}

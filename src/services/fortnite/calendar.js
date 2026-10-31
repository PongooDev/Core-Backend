import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { activeEventFlags, currentEventsConfig, eventsActiveUntil } from "../../events/events.js";
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
export const calendarCacheMinutes = 60;

export function calendarRoutes({ tokens }) {
  const router = express.Router();

  router.get("/fortnite/api/calendar/v1/timeline", requireAuth(tokens), (req, res) => {
    const now = new Date();
    const weeklyEnd = hasItemShop() ? weeklyStoreEnd(now) : undefined;
    const seasonEnds = hasSeasonShop() ? seasonEnd(now) : undefined;
    const cacheMinutes = Math.max(5, Math.min(120, Number(currentEventsConfig()?.calendarCacheMinutes ?? calendarCacheMinutes)));
    const cacheExpire = new Date(Math.min(now.getTime() + cacheMinutes * 60000, weeklyEnd?.getTime() ?? Infinity,
      seasonEnds?.getTime() ?? Infinity)).toISOString();
    const activeEvents = activeEventFlags().map((eventName) => ({ eventName, activeUntil: eventsActiveUntil }));
    const state = {
      ...(seasonEnds ? { seasonEnd: seasonEnds.toISOString() } : {}),
      ...(weeklyEnd ? { weeklyStoreEnd: weeklyEnd.toISOString() } : {})
    };
    res.json({
      channels: {
        "client-events": { states: [{ validFrom: "2017-01-01T00:00:00.000Z", activeEvents, state }], cacheExpire }
      },
      eventsTimeOffsetHrs: 0,
      cacheIntervalMins: cacheMinutes,
      currentTime: now.toISOString()
    });
  });

  return router;
}

import express from "express";
import { requireAuth } from "../../accounts/auth.js";

// 1.8's event calendar (ScheduledEvents' FCalendarDownload): {currentTime, channels: {<channel>: FEventsTimeline
// {cacheExpire, states: [FEventChannelState {validFrom, activeEvents: [{eventName, activeUntil}], state}]}}}. The
// client reads its client-events channel (1.8 sub_70EEC0) and asks again at cacheExpire; without an answer it asked
// many times a second. Core runs no events (as RequestEventFlags answers 1.7.2), so none is active.
export const calendarCacheMinutes = 60;

export function calendarRoutes({ tokens }) {
  const router = express.Router();

  router.get("/fortnite/api/calendar/v1/timeline", requireAuth(tokens), (req, res) => {
    const now = new Date();
    const cacheExpire = new Date(now.getTime() + calendarCacheMinutes * 60000).toISOString();
    res.json({
      channels: {
        "client-events": { states: [{ validFrom: "2017-01-01T00:00:00.000Z", activeEvents: [], state: {} }], cacheExpire }
      },
      eventsTimeOffsetHrs: 0,
      cacheIntervalMins: calendarCacheMinutes,
      currentTime: now.toISOString()
    });
  });

  return router;
}

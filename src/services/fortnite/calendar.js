import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { activeEventFlags, eventsActiveUntil } from "../../events/events.js";

// 1.8's event calendar (ScheduledEvents' FCalendarDownload): {currentTime, channels: {<channel>: FEventsTimeline
// {cacheExpire, states: [FEventChannelState {validFrom, activeEvents: [{eventName, activeUntil}], state}]}}}. The
// client reads its client-events channel (1.8 sub_70EEC0) and asks again at cacheExpire; without an answer it asked
// many times a second. The events active are the ones Core runs on the requesting build (events/events.js), named by
// their event flag, as RequestEventFlags and ClientQuestLogin tell the quest manager (🟡: 1.8 takes its flags from
// those MCP notifications; nothing found in it reads the calendar's event names).
export const calendarCacheMinutes = 60;

export function calendarRoutes({ tokens }) {
  const router = express.Router();

  router.get("/fortnite/api/calendar/v1/timeline", requireAuth(tokens), (req, res) => {
    const now = new Date();
    const cacheExpire = new Date(now.getTime() + calendarCacheMinutes * 60000).toISOString();
    const activeEvents = activeEventFlags().map((eventName) => ({ eventName, activeUntil: eventsActiveUntil }));
    res.json({
      channels: {
        "client-events": { states: [{ validFrom: "2017-01-01T00:00:00.000Z", activeEvents, state: {} }], cacheExpire }
      },
      eventsTimeOffsetHrs: 0,
      cacheIntervalMins: calendarCacheMinutes,
      currentTime: now.toISOString()
    });
  });

  return router;
}

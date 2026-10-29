import { AsyncLocalStorage } from "node:async_hooks";
import { currentBuild } from "../builds/context.js";

// The seasonal events Core runs. A build runs the event its own update shipped, for as long as it is played: Epic
// switched events on and off from its servers (its event flags and calendar), so which builds run one is Core's choice.
//
// Fortnitemares (Halloween 2017) shipped with 1.8 (CL-3724489) and ran through its patches 1.8.1 (CL-3729133) and
// 1.8.2 (CL-3741772), and 1.9 (CL-3757339), whose notes extend it to 29 November. Its content waits for EventFlag.Fortnitemares, the only event flag 1.8's paks add (1.7.2's are
// EventFlag.FirstStorm and EventFlag.Horde): the front end's "View Event" button and the event's quest pages
// (HomeScreenNextQuest UpdateButtonBasedOnEventStatus: BorderQuestMapToggle shows when the quest manager's
// IsEventFlagActive("EventFlag.Fortnitemares") or the player holds ProtoEnableQuest).
export const fortnitemares = "EventFlag.Fortnitemares";

const events = [
  { flag: fortnitemares, firstBuild: 3724489, lastBuild: 3757339 }
];

// Whether the host runs the seasonal events (settings.seasonalEvents, the admin panel's Seasonal Events switch,
// Core-Backend #66), for everything a request does. Switched off, no build runs one: no event flags, quests, theater or
// event offers. Work that no request started runs them.
const eventsSetting = new AsyncLocalStorage();
export const seasonalEvents = (enabled) => (req, res, next) => eventsSetting.run(enabled(), next);

// The event flags the requesting build runs (none outside a request).
export function activeEventFlags(changelist = currentBuild()) {
  if (eventsSetting.getStore() === false) return [];
  const number = Number(changelist);
  if (!Number.isInteger(number)) return [];
  return events.filter((event) => number >= event.firstBuild && number <= event.lastBuild).map((event) => event.flag);
}

export const isEventActive = (flag, changelist = currentBuild()) => activeEventFlags(changelist).includes(flag);

// When the client is told an event ends: never, as far as Core goes (FDateTime's largest day).
export const eventsActiveUntil = "9999-12-31T23:59:59.999Z";

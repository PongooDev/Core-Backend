import { grantCodeRewards, itemName, rewardItem } from "../friendcodes/rewards.js";
import { log } from "../log.js";
import { openSession } from "../profiles/session.js";
import { notifyProfiles } from "../services/mcp/profile.js";
import { leaderboardOf } from "./store.js";

// An event's prizes (Core-Backend #361): its payoutTable (tournaments/store.js validatePayoutTable), given through the
// profile code a redeem code's rewards use (friendcodes/rewards.js grantCodeRewards: V-Bucks as Currency:MtxGiveaway in
// profile0, a cosmetic into the locker), once per player per event (the event's paid, by payoutKey).
// - A points prize ("value") is given the moment a player's points reach it: when the game server's report of their
//   match scores (services/fortnite/battleroyale.js recordresults, on the session it already has open), as Epic's MCP
//   granted an in-game tournament's rewardTable when the window's score reached its pointsEarned. Saving the prizes
//   gives those already reached at once.
// - A placement prize ("rank") is given when the event is over (settleEvent): to each player whose final rank is within
//   it among those who qualified (the ruleset's minimumMatches; a tie shares the rank, so both are paid). Its triggers
//   are the admin's End event and, for an event with an end, an engine timer at that moment (createPayoutSettler),
//   plus the backend's start for an event that ended while it was down.

// A row's key in the event's paid: a kind's thresholds are its own, so the kind and threshold name the row.
export const payoutKey = (row) => `${row.scoringType}:${row.threshold}`;

// The items of a table no build has (rewardItem), for the admin's answer: a prize can't promise them.
export const unknownPayoutItems = (table) => (Array.isArray(table) ? table : [])
  .flatMap((row) => (Array.isArray(row?.items) ? row.items : [])).filter((templateId) => !rewardItem(templateId));

const isOver = (event, now) => Boolean(event.endedAt) || (event.endsAt ? Date.parse(event.endsAt) <= now.getTime() : false);

// The rows of an event a player is owed and hasn't been given: points prizes their points reach, and with final (the
// event over) placement prizes their qualified rank is within. board: the event's leaderboard (leaderboardOf), when
// there's one at hand.
export function payoutsDue(event, accountId, { final = false, board = leaderboardOf(event) } = {}) {
  const table = event.payoutTable ?? [];
  if (!table.length) return [];
  const row = board.find((entry) => entry.accountId === accountId);
  if (!row) return [];
  const paid = event.paid?.[accountId] ?? {};
  return table.filter((prize) => !Object.hasOwn(paid, payoutKey(prize)) && (prize.scoringType === "value"
    ? row.points >= prize.threshold
    : final && row.qualified && row.rank <= prize.threshold));
}

// Gives prizes into an open session; answers what was given, for the log. The V-Bucks add up across rows.
export function grantPayouts(session, rows) {
  if (!rows.length) return [];
  return grantCodeRewards(session, {
    vbucks: rows.reduce((total, row) => total + row.vbucks, 0),
    items: rows.flatMap((row) => row.items.map((templateId) => ({ templateId, quantity: 1 })))
  });
}

// Gives a player what an event owes them on the session the caller has open (recordresults'), and notes it. The caller
// commits the session.
export function payPlayerOnSession(store, event, session, options = {}, now = new Date()) {
  const due = payoutsDue(event, session.accountId, options);
  if (!due.length) return [];
  const given = grantPayouts(session, due);
  store.markPaid(event.id, session.accountId, due.map(payoutKey), now);
  log("Tournaments", `${session.accountId} given ${event.name}'s prizes (${due.map(payoutKey).join(", ")}): ${given.join(", ") || "nothing new"}`);
  return due;
}

// Gives every player of an event what it owes them, each on a session of their own, saved and sent to their client
// (context: profiles, stomp, tournaments). final: the event is over, so placement prizes are given too.
export function payEvent(context, event, { final = false } = {}, now = new Date()) {
  const { tournaments: store, profiles } = context;
  if (!store || !profiles || !(event?.payoutTable ?? []).length) return 0;
  const board = leaderboardOf(event);
  let players = 0;
  for (const { accountId } of board) {
    if (!payoutsDue(event, accountId, { final, board }).length) continue;
    if (context.accounts && !context.accounts.get(accountId)) continue;
    try {
      const session = openSession(profiles, accountId);
      if (payPlayerOnSession(store, event, session, { final, board }, now).length) players += 1;
      session.commit();
      notifyProfiles(context, session);
    } catch (err) {
      log("Tournaments", `${event.name}'s prizes for ${accountId} couldn't be given: ${err.stack ?? err}`);
    }
  }
  return players;
}

// An event over: its placement prizes (and any points prize not yet given) go out, once.
export function settleEvent(context, eventId, now = new Date()) {
  const event = context.tournaments?.get(eventId);
  if (!event || event.payoutsSettledAt || !isOver(event, now)) return false;
  payEvent(context, event, { final: true }, now);
  context.tournaments.markSettled(event.id, now);
  return true;
}

// The engine timer for the placement prizes of events with an end (setTimeout, as tournaments/showdown.js's lobby
// refresh): set for the next end of an event not yet settled, settling every event over when it fires, and set again.
// schedule() also settles the events that ended while the backend was down. A delay longer than setTimeout allows is
// cut short and only sets the next one.
const maxTimerMs = 2 ** 31 - 1;
export function createPayoutSettler(context, { now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null;
  const unsettled = () => (context.tournaments?.list?.() ?? []).filter((event) => !event.payoutsSettledAt && (event.payoutTable ?? []).length);
  const settleOver = () => {
    const at = now();
    for (const event of unsettled()) if (isOver(event, at)) settleEvent(context, event.id, at);
  };
  const schedule = () => {
    if (timer) clearTimer(timer);
    timer = null;
    settleOver();
    const at = now().getTime();
    const ends = unsettled().map((event) => Date.parse(event.endsAt ?? "")).filter((end) => end > at);
    if (!ends.length) return null;
    const next = Math.min(...ends);
    timer = setTimer(() => {
      timer = null;
      schedule();
    }, Math.min(next - at + 1, maxTimerMs));
    timer?.unref?.();
    return next;
  };
  return {
    schedule,
    stop() {
      if (timer) clearTimer(timer);
      timer = null;
    }
  };
}

// What an event's prizes read as, row by row ("Reach 30 points: 500 V-Bucks", "Top 3: 1,000 V-Bucks, Renegade Raider"),
// for the panel and the game's EVENT DETAILS text.
export function payoutLines(event) {
  return (event.payoutTable ?? []).map((row) => {
    const rewards = [...(row.vbucks ? [`${row.vbucks.toLocaleString("en-US")} V-Bucks`] : []),
      ...row.items.map((templateId) => {
        const item = rewardItem(templateId);
        return item ? itemName(item) : templateId;
      })];
    const when = row.scoringType === "value" ? `Reach ${row.threshold.toLocaleString("en-US")} point${row.threshold === 1 ? "" : "s"}` : row.threshold === 1 ? "1st place" : `Top ${row.threshold}`;
    return `${when}: ${rewards.join(", ")}`;
  });
}

// An event's points prizes as its window's rewardTable (FShowdownEventData's RewardTable: [{pointsEarned,
// mcpTokenRewards}]), lowest first: the points and the template ids of the items they give. The client reads it into the
// window, but no screen of 6.10 to 6.31 shows it (UFortShowdownDetailView has no reward getter; the EVENT DETAILS text,
// tournaments/showdown.js, names the prizes instead), and Core gives the prizes, not the client.
export const rewardTableOf = (event) => (event.payoutTable ?? []).filter((row) => row.scoringType === "value")
  .map((row) => ({ pointsEarned: row.threshold, mcpTokenRewards: [...row.items] }));

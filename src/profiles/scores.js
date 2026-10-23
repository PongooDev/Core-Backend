// The XP notifications of the players an EarnScore names besides the one it is sent through.
//
// The gameserver sends one EarnScore for every player in the zone, through one player's account profile ("Sending
// EarnScore command via account %s for %d players", sub_4EBCB0), after setting each listed player's
// bIsFinalizingExperience. Its earnScore handler (AFortPlayerController 0x762AE0, server only: 0x751A70 checks
// Role == ROLE_Authority) adds an ExperienceDelta to that controller's own player state and finalizes it; the results
// screen reads the sum of the deltas once the player is finalized. The handler is bound per player
// (FOnlineNotificationHandler player binding with the PC's unique id, 0x73ECC0 -> 0x36B47F0), and the MCP response
// parser (0x3903DB0) reads only `type` and `primary` from a notification and addresses it to the profile group's own
// account. So a response reaches only the player whose profile sent the command, and each other player's XP has to
// come in a response to a command sent through their own profile. Profile notifications over STOMP don't reach the
// server either: its per-player StompClientMcp connects as that player and fails ("user account <id> invalid on
// connect", 0x37DE7B0; its dedicated server branch needs a name the only constructor call, 0x37D4F33, leaves empty).
//
// Core (inferred: how Epic's MCP handed them over): EarnScore keeps each other player's earnScore and levelUp
// notifications here, and the player's next dedicated_server response carries them. At zone end that is their
// EndPrimaryMission, which CoreV2 sends right after EarnScore; as each player's commands go out on their own MCP queue,
// an EndPrimaryMission for a live game session that has had no EarnScore yet waits for it (up to waitMs). Kept in
// memory; ones nobody collects within holdMs are dropped, so they can't land in a later zone's results.
const defaultHoldMs = 60_000;
const defaultWaitMs = 2_000;

export function createHeldScores({ holdMs = defaultHoldMs, waitMs = defaultWaitMs } = {}) {
  const held = new Map();
  const scored = new Map();
  const waiting = new Map();
  const fresh = (at) => Date.now() - at <= holdMs;

  const forget = () => {
    for (const [accountId, entry] of held) if (!fresh(entry.at)) held.delete(accountId);
    for (const [sessionId, at] of scored) if (!fresh(at)) scored.delete(sessionId);
  };

  return {
    // Notifications for a player the EarnScore wasn't sent through.
    hold(accountId, notifications) {
      if (!notifications.length) return;
      forget();
      const entry = held.get(accountId) ?? { at: Date.now(), notifications: [] };
      entry.at = Date.now();
      entry.notifications.push(...notifications);
      held.set(accountId, entry);
    },

    // Whether the player's next response will carry an earnScore notification.
    hasEarnScore(accountId) {
      const entry = held.get(accountId);
      return Boolean(entry && fresh(entry.at) && entry.notifications.some((notification) => notification.type === "earnScore"));
    },

    take(accountId) {
      const entry = held.get(accountId);
      held.delete(accountId);
      return entry && fresh(entry.at) ? entry.notifications : [];
    },

    // An EarnScore for this game session has been handled.
    scored(sessionId) {
      if (!sessionId) return;
      forget();
      scored.set(sessionId, Date.now());
      for (const resolve of waiting.get(sessionId) ?? []) resolve();
      waiting.delete(sessionId);
    },

    // Resolves once the session has had an EarnScore, or after waitMs.
    waitForScore(sessionId) {
      const at = sessionId && scored.get(sessionId);
      if (!sessionId || (at && fresh(at)) || !(waitMs > 0)) return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          waiting.get(sessionId)?.delete(done);
          resolve();
        };
        const timer = setTimeout(done, waitMs);
        if (!waiting.has(sessionId)) waiting.set(sessionId, new Set());
        waiting.get(sessionId).add(done);
      });
    }
  };
}

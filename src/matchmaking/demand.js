// Which builds have players waiting for a server none of the running ones can take (Core-Launcher #18): the launcher
// moves an idle server over to such a build, so a player on another build than the hosted one still gets a match.
//
// Battle Royale's players (matchmaking/service.js) wait in the matchmaker's queue until a server takes their match:
// the matchmaker counts them itself. Before it (and Save the World's missions) a client searches for an empty server
// (services/matchmaking/sessions.js, matchMakingRequest with maxCurrentPlayers 0), which waits up to emptyServerWaitMs
// and then answers with none; the client then asks again or gives up. So a build counts as wanted while one of its
// searches is waiting, and for holdMs after the last one found nothing, long enough for a server to boot in between.
export const defaultDemandHoldMs = 60_000;

export function createDemand({ now = Date.now, holdMs = defaultDemandHoldMs } = {}) {
  // build (its changelist, as a string) -> { searching: open searches, lastAt: when one last found nothing }
  const builds = new Map();
  const entry = (build) => {
    const key = String(build);
    if (!builds.has(key)) builds.set(key, { searching: 0, lastAt: 0 });
    return builds.get(key);
  };

  const demand = {
    // A search on <build> for an empty server found none and waits for one: returns its end, called once with
    // whether it found one in the end.
    searching(build) {
      if (!build) return () => {};
      const wanted = entry(build);
      wanted.searching++;
      wanted.lastAt = now();
      let open = true;
      return (found = false) => {
        if (!open) return;
        open = false;
        wanted.searching--;
        if (found) demand.found(build);
        else wanted.lastAt = now();
      };
    },

    // A search on <build> found an empty server: the build has one now, so its earlier misses no longer count.
    found(build) {
      const wanted = build ? builds.get(String(build)) : null;
      if (wanted && wanted.searching === 0) wanted.lastAt = 0;
    },

    // [{ build, mode: "saveTheWorld", players }]: each build with searches waiting or a miss within holdMs, with how
    // many are waiting. These searches are Save the World's (and every mode's before Battle Royale's matchmaker).
    list() {
      const at = now();
      const wanted = [];
      for (const [build, { searching, lastAt }] of builds) {
        if (searching > 0 || at - lastAt < holdMs) wanted.push({ build, mode: "saveTheWorld", players: Math.max(1, searching) });
        else builds.delete(build);
      }
      return wanted;
    }
  };
  return demand;
}

// The matchmaker's waiting players and the empty-server searches' together, each build and mode listed once, the most
// wanted first.
export function mergeDemand(...lists) {
  const merged = new Map();
  for (const { build, mode, players } of lists.flat()) {
    if (!build) continue;
    const key = `${build}|${mode}`;
    const entry = merged.get(key) ?? { build: String(build), mode, players: 0 };
    entry.players += players;
    merged.set(key, entry);
  }
  return [...merged.values()].sort((left, right) => right.players - left.players || left.build.localeCompare(right.build) || left.mode.localeCompare(right.mode));
}

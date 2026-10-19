// Client-kept counters (FFortPersistentGameplayStatValue {statName, statValue}) in the gameplay_stats stat, by name.
export function setGameplayStats({ req, tracker }) {
  const stats = [...(tracker.profile.stats.attributes.gameplay_stats ?? [])];
  let changed = false;
  for (const { statName, statValue } of Array.isArray(req.body?.gameplayStats) ? req.body.gameplayStats : []) {
    if (typeof statName !== "string" || !statName || !Number.isInteger(statValue)) continue;
    const existing = stats.find((stat) => stat.statName === statName);
    if (existing?.statValue === statValue) continue;
    if (existing) existing.statValue = statValue;
    else stats.push({ statName, statValue });
    changed = true;
  }
  if (changed) tracker.setStat("gameplay_stats", stats.map((stat) => ({ ...stat })));
}

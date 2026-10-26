// IncrementNamedCounterStat {counterName} (1.7.2's UFortMcpProfileAccount): profile0's named_counters stat maps each
// counter to FFortNamedCounterStat, which the client reads (sub_70F330) as "currentCount" (a number) and
// "lastIncrementedTime" (an ISO 8601 date).
export function incrementNamedCounterStat({ req, session }) {
  const counterName = String(req.body?.counterName ?? "");
  if (!counterName) return;
  const tracker = session.profile("profile0");
  const counters = tracker.profile.stats.attributes.named_counters ?? {};
  const currentCount = (counters[counterName]?.currentCount ?? 0) + 1;
  tracker.setStat("named_counters", { ...counters, [counterName]: { currentCount, lastIncrementedTime: new Date().toISOString() } });
}

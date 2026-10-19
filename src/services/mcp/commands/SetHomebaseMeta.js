// The homebase flag (UFortMcpProfileAccount::SetHomebaseMeta {townName, flagPattern, flagColor}).
export function setHomebaseMeta({ req, session }) {
  const { townName, flagPattern, flagColor } = req.body ?? {};
  const tracker = session.profile("profile0");
  const homebase = tracker.profile.stats.attributes.homebase;
  const next = { ...homebase };
  if (typeof townName === "string") next.townName = townName;
  if (Number.isInteger(flagPattern)) next.flagPattern = flagPattern;
  if (Number.isFinite(flagColor)) next.flagColor = flagColor;
  if (JSON.stringify(next) !== JSON.stringify(homebase)) tracker.setStat("homebase", next);
}

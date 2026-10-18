export function setHomebaseName({ req, session }) {
  const name = req.body?.homebaseName;
  if (typeof name !== "string") return;
  const tracker = session.profile("profile0");
  const homebase = tracker.profile.stats.attributes.homebase;
  if (homebase.townName !== name) tracker.setStat("homebase", { ...homebase, townName: name });
}

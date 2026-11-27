// 9.30's (CL-7095426) UFortMcpProfileAthena::SetContextTutorialInformation {index, count} (the 9.30 SDK's
// FortMcpProfileAthena_SetContextTutorialInformation: uint8 Index, int32 Count; new in 9.30 with the default playlists'
// ContextTutorial modifier, AFortAthenaMutator_ContextTutorial and its EFortContextTutorialTypes tips, AllSeen 0 to
// ImproveAccuracy 28). The client keeps how often it has shown each tip in athena's context_tutorial_<index>: 9.30's
// reader (0x11526B0) builds that name from the static "context_tutorial_" (0x5959DC0) and the index, and reads the stat
// as an int. So the command stores count there. 🟡 A request whose index isn't an EFortContextTutorialTypes value below
// Count (29) or whose count isn't a whole number from 0 changes nothing (Epic's refusal isn't recorded).
const tutorialTypes = 29;

export function setContextTutorialInformation({ req, profile, tracker, profileId }) {
  if (profileId !== "athena") return;
  const index = req.body?.index;
  const count = req.body?.count;
  if (!Number.isInteger(index) || index < 0 || index >= tutorialTypes) return;
  if (!Number.isInteger(count) || count < 0) return;
  const stat = `context_tutorial_${index}`;
  if (profile.stats.attributes[stat] !== count) tracker.setStat(stat, count);
}

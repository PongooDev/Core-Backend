import { skipTutorial as completeOnboarding } from "../../../profiles/progress.js";

export function skipTutorial({ session }) {
  completeOnboarding(session);
}

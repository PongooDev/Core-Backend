import { perBuild } from "../gamedata/read.js";
import { hasTag } from "./progress.js";

// What the skill tree has unlocked: the gameplay tags of every HomebaseNode the account owns (exported per node from
// the HomebaseNodeGameplayEffectDataTable's GrantedTagsContainer).
const tagsByNode = perBuild((read) => new Map(Object.entries(read("homebasenodes", {}).nodes ?? {}).map(([id, node]) => [id.toLowerCase(), node.tags ?? []])));

export function unlockedTags(profile) {
  return Object.values(profile.items)
    .filter((item) => item.templateId.toLowerCase().startsWith("homebasenode:"))
    .flatMap((item) => tagsByNode().get(item.templateId.slice("homebasenode:".length).toLowerCase()) ?? []);
}

// Every required tag (a recipe's RequiredCatalysts) is unlocked, a child tag counting for its parent.
export function hasUnlocked(profile, required) {
  const owned = unlockedTags(profile);
  return required.every((tag) => hasTag(owned, tag));
}

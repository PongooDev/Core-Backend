import { perBuild } from "../gamedata/read.js";
import { isDone, questIdOf } from "../profiles/quests.js";
import { fortnitemares, isEventActive } from "./events.js";
import { fortnitemaresQuests } from "./fortnitemares.js";

// An event's quests leave with it (Core-Backend #127). Epic's were limited time quests: each one's Category is the
// event's row of QuestCategoryTable (LTE_Fortnitemares, "Event: Fortnitemares", for every quest in
// Quests/Events/Halloween2017 and the ReactiveQuest_Halloween_* / _Find* quests they start), and when the event ended
// its servers took the unfinished ones out of the quest log; the finished ones, and their rewards, stayed.
//
// The quests that start an event (the ones Core grants while it runs, events/fortnitemares.js) and every quest they
// lead to are the event's quest line: the quests granted by an event quest's rewards (rewards, hidden rewards,
// reward choices), and the quests that grant one (the Vlad World variants, HalloweenQuest_2017_CompleteMissions_2-14,
// which Core doesn't grant but whose hidden reward is the event's TrainHero), from the requesting build's quest data.
// For 1.8 to 1.9.1's Fortnitemares that is the 56 quests of the LTE_Fortnitemares category.
const questLines = [{ flag: fortnitemares, starting: fortnitemaresQuests }];

const questRewards = (quest) => [...(quest?.rewards ?? []), ...(quest?.hiddenRewards ?? []), ...(quest?.selectableRewards ?? []).flat()]
  .filter((reward) => reward.templateId.toLowerCase().startsWith("quest:"))
  .map((reward) => reward.templateId.slice("quest:".length).toLowerCase());

const data = perBuild((read) => {
  const quests = read("quests", {});
  const grants = new Map(Object.keys(quests).map((questId) => [questId, questRewards(quests[questId])]));
  const grantedBy = new Map();
  for (const [questId, granted] of grants) {
    for (const child of granted) grantedBy.set(child, [...(grantedBy.get(child) ?? []), questId]);
  }
  const lineOf = (starting) => {
    const line = new Set();
    const pending = starting.filter((questId) => quests[questId]);
    while (pending.length) {
      const questId = pending.pop();
      if (line.has(questId)) continue;
      line.add(questId);
      pending.push(...(grants.get(questId) ?? []).filter((child) => quests[child]), ...(grantedBy.get(questId) ?? []));
    }
    return line;
  };
  return { quests, lines: questLines.map(({ flag, starting }) => ({ flag, quests: lineOf(starting) })) };
});

// The quests of an event's quest line in the requesting build's data.
export function eventQuestLine(flag) {
  return data().lines.find((line) => line.flag === flag)?.quests ?? new Set();
}

// The quests of the events the requesting build doesn't run now (the build is past them, or the admin panel's
// Seasonal Events switch is off), but not those of an event it runs.
function endedEventQuests() {
  const ended = new Set();
  const running = new Set();
  for (const line of data().lines) {
    for (const questId of line.quests) (isEventActive(line.flag) ? running : ended).add(questId);
  }
  for (const questId of running) ended.delete(questId);
  return ended;
}

// Takes an ended event's unfinished quests out of the account's quest log (profile0), with their pins; the client hears
// of it as the command's itemRemoved changes. Completed and claimed ones stay. Only quests the requesting build's data
// has go: a build without the event's quests (1.7.2) never shows them, so it leaves them for the builds that do.
export function removeEndedEventQuests(session) {
  const ended = endedEventQuests();
  if (!ended.size) return [];
  const tracker = session.profile("profile0");
  const removed = Object.entries(tracker.profile.items)
    .filter(([, item]) => ended.has(questIdOf(item) ?? "") && !isDone(item))
    .map(([itemId]) => itemId);
  for (const itemId of removed) tracker.removeItem(itemId);

  const settings = tracker.profile.stats.attributes.client_settings;
  const pinned = settings?.pinnedQuestInstances;
  if (removed.length && Array.isArray(pinned) && pinned.some((itemId) => removed.includes(itemId))) {
    tracker.setStat("client_settings", { ...settings, pinnedQuestInstances: pinned.filter((itemId) => !removed.includes(itemId)) });
  }
  return removed;
}

// When an event runs again, the quests it took away come back the way the event gave them: the quests its starting
// quests' login grant brings (ClientQuestLogin) and those a claimed quest of its line grants as a reward that the
// account no longer holds (the next quests of a chain removed half way), which ClientQuestLogin grants from this list.
// They start over. Reward choices are left out: which one the player took isn't kept.
export function eventQuestsToRestore(profile) {
  const { quests, lines } = data();
  const running = lines.filter((line) => isEventActive(line.flag));
  if (!running.length) return [];
  const held = new Set(Object.values(profile.items).map((item) => questIdOf(item)).filter(Boolean));
  const restore = new Set();
  for (const item of Object.values(profile.items)) {
    const questId = questIdOf(item);
    if (item.attributes?.quest_state !== "Claimed" || !running.some((line) => line.quests.has(questId))) continue;
    for (const child of questRewards({ rewards: quests[questId].rewards, hiddenRewards: quests[questId].hiddenRewards })) {
      if (!held.has(child) && quests[child]) restore.add(child);
    }
  }
  return [...restore];
}

// Whether a quest belongs to an event the requesting build doesn't run now: nothing grants it then (profiles/items.js),
// not even the claim of a quest the event left finished.
export const isEndedEventQuest = (questId) => endedEventQuests().has(questId.toLowerCase());

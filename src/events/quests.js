import { inBuild } from "../builds/context.js";
import { perBuild } from "../gamedata/read.js";
import { isDone, questIdOf } from "../profiles/quests.js";
import { birthday2018, blockbuster2018, cramSession2018, eventRunOf, eventRuns, fortnitemares, isEventActive, mutantStorms, mutantStorms2018, roadTrip2018, spring2018, storm2018, winter2017 } from "./events.js";
import { blockbusterQuests } from "./blockbuster2018.js";
import { cramSessionQuests } from "./cramsession2018.js";
import { fortnitemaresQuests } from "./fortnitemares.js";
import { roadTripLineQuests } from "./roadtrip2018.js";
import { birthdayQuests } from "./birthday2018.js";
import { mutantStorms2018Quests, mutantStormsQuests } from "./mutantstorms.js";
import { luckOfTheStormQuests, springQuests } from "./spring2018.js";
import { intoTheStormQuests } from "./storm2018.js";
import { winterQuests } from "./winter2017.js";

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
// 1.9.1's Mutant Storms quest line is the Vindertech quests (LTE_Vindertech); 1.11's Survive the Holidays' the winter
// quests (WinterQuest_2017_*); 2.3's storms' the FirstStorm quests and the repeatable Mini-Boss quest, which so stays
// on 2.3 when the rest of the winter line goes; 2.4's (and 2.4.2's) its own MutantStormsQuest_2018 line; 2.5's Spring It
// On! the LoveQuest_2018 and SpringQuest_2018 chains it starts; 3.5.1's Into the Storm the StormQuest_2018 quests; 4.0's Blockbuster the BlockbusterQuest_2018 quests;
// 5.0's Road Trip the HordeQuest progression and its hidden zone gates (and 5.21's to 5.41's Weekly Horde Challenges', events/roadtrip2018.js); 5.10's Birthday its two
// AnniversaryQuest_2018 quests (events/birthday2018.js); 6.00's Cram Session its four AutumnQuest lines and its five
// repeatable GenericQuests (events/cramsession2018.js).
// A function: roadtrip2018.js reads Season 5's replay clock (store/itemshop.js), whose imports come back here.
const questLines = () => [{ flag: fortnitemares, starting: fortnitemaresQuests }, { flag: mutantStorms, starting: mutantStormsQuests },
  { flag: winter2017, starting: winterQuests }, { flag: mutantStorms2018, starting: mutantStorms2018Quests },
  { flag: spring2018, starting: [...springQuests, ...luckOfTheStormQuests] }, { flag: storm2018, starting: intoTheStormQuests },
  { flag: blockbuster2018, starting: blockbusterQuests }, { flag: roadTrip2018, starting: roadTripLineQuests },
  { flag: birthday2018, starting: birthdayQuests }, { flag: cramSession2018, starting: cramSessionQuests }];

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
  return { quests, lines: questLines().map(({ flag, starting }) => ({ flag, quests: lineOf(starting) })) };
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

// Takes the quests that match out of the account's quest log (profile0), with their pins; the client hears of it as the
// command's itemRemoved changes.
function removeQuests(tracker, matches) {
  const removed = Object.entries(tracker.profile.items).filter(([, item]) => matches(item)).map(([itemId]) => itemId);
  for (const itemId of removed) tracker.removeItem(itemId);

  const settings = tracker.profile.stats.attributes.client_settings;
  const pinned = settings?.pinnedQuestInstances;
  if (removed.length && Array.isArray(pinned) && pinned.some((itemId) => removed.includes(itemId))) {
    tracker.setStat("client_settings", { ...settings, pinnedQuestInstances: pinned.filter((itemId) => !removed.includes(itemId)) });
  }
  return removed;
}

// Takes an ended event's unfinished quests out of the account's quest log. Completed and claimed ones stay. Only quests
// the requesting build's data has go: a build without the event's quests (1.7.2) never shows them, so it leaves them for
// the builds that do.
export function removeEndedEventQuests(session) {
  const ended = endedEventQuests();
  if (!ended.size) return [];
  return removeQuests(session.profile("profile0"), (item) => ended.has(questIdOf(item) ?? "") && !isDone(item));
}

// A returning event starts its quest line over (Core-Backend #347). Fortnitemares came back with 6.20 (2018) on the
// quests of its 2017 run (1.8 to 1.9): 6.20's data has every quest of 1.9's 56-quest line under the same template id,
// the same Quests/Events/Halloween2017 and ReactiveQuests assets in the same LTE_Fortnitemares category (QuestCategoryTable's row has no
// date or run; the quests have no ExpirationDuration), re-authored for 2018: the reactive quests' 50 V-Bucks
// (Currency:mtxgiveaway) became Gold (AccountResource:eventcurrency_scaling), KillMistMonsters counts
// kill_mist_monster_halloween_outlander for 2017's kill_smasher_halloween_outlander, the Taker quest gives 250 Candy for
// its trap choice, Hidden_5's hidden reward leads to the new HalloweenQuest_KillVlad ("Vlad Moon Rising", Update v6.20),
// and the Epic and Legendary hero choices are gone. MCP grants a quest once per template (grantQuest), so the 2018 line
// could only start again for an account whose 2017 instances were gone: Epic's servers cleared them when the new run
// began (🟡 how, a removal or a reset in place, is its service's; Core removes them, so the line starts from its first
// quests the way a new account's does).
// Once per account and run: the first time a build of a later run of a recurring event loads the quest log while the
// event runs, every quest of its line goes, finished or not, with its pins; the event's starting quests come back with
// the quest login (events/fortnitemares.js eventQuests), the rest as the player gets through the line again. Rewards
// already claimed stay. The account then notes the run (coreMigrations eventRun.<event>.<first build>, Core's, never
// sent), so progress in the current run is kept from then on, on every build of the run (6.21 is 6.20's run). An
// event's first run removes nothing, and an earlier run's build played after a later one leaves the quests as they are.
// The note is saved with the removals (a profile with no quest of the line has nothing to lose, and is checked again).
export function startEventRuns(session) {
  const tracker = session.profile("profile0");
  const removed = [];
  for (const line of data().lines) {
    const runs = eventRuns(line.flag);
    if (runs.length < 2 || !line.quests.size || !isEventActive(line.flag)) continue;
    const run = eventRunOf(line.flag);
    if (run.firstBuild === runs[0].firstBuild) continue;
    const note = `eventRun.${line.flag}.${run.firstBuild}`;
    if ((tracker.profile.coreMigrations ?? []).includes(note)) continue;
    const quests = runQuestLines(line, runs.filter((earlier) => earlier.firstBuild <= run.firstBuild));
    removed.push(...removeQuests(tracker, (item) => quests.has(questIdOf(item) ?? "")));
    tracker.profile.coreMigrations = [...(tracker.profile.coreMigrations ?? []), note];
  }
  return removed;
}

// An event's quests in every run up to the requesting build's: its line in the requesting build's data and in the data
// of each run's first and last build. A run's own data may trace a shorter line than an earlier run's: 6.20's
// ReactiveQuest_GatherCollect_Halloween_2 no longer grants HalloweenQuest_2017_Hidden_3, so 6.20's quests trace 42 of
// 1.9's 56: nothing in 6.20's (or 6.21's) data grants Hidden_3 to _5, GatherCollect 3 to 5, Fetch 3 to 6 or Destroy 7 to
// 10 (nor Hidden_5's new KillVlad). The 2017 instances of those go too, so the quest map's later pages start over as well.
function runQuestLines(line, runs) {
  const quests = new Set(line.quests);
  for (const { firstBuild, lastBuild } of runs) {
    for (const build of [firstBuild, lastBuild]) {
      for (const questId of inBuild(String(build), () => eventQuestLine(line.flag))) quests.add(questId);
    }
  }
  return quests;
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

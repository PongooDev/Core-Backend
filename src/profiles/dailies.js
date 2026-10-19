import crypto from "node:crypto";
import { McpError } from "../errors.js";
import { questIds, getQuest } from "../gamedata/quests.js";
import { grant } from "./progress.js";
import { findQuestItem, questIdOf } from "./quests.js";

// Daily quests. They start once the player holds Quest:dailyquesttrigger (a hidden reward of outpostquest_t1_l3, the
// third Stonewood storm shield defense); its pack (Quest:dailyquestpack) names no quests, Epic chose them on its
// servers. Core's rule: on the first quest login of each UTC day, claimed dailies are cleared, one new daily (a quest of
// type DailyQuest the player doesn't hold) is added while fewer than 3 are open, and the daily reroll is restored.
const dailyIds = questIds().filter((id) => getQuest(id).type === "DailyQuest");
const maxOpen = 3;
const rerollsPerDay = 1;

const dayOf = (iso) => (iso ?? "").slice(0, 10);

function heldDailies(tracker) {
  return Object.entries(tracker.profile.items).filter(([, item]) => getQuest(questIdOf(item) ?? "")?.type === "DailyQuest");
}

function newDaily(session) {
  const tracker = session.profile("profile0");
  const held = new Set(heldDailies(tracker).map(([, item]) => questIdOf(item)));
  const choices = dailyIds.filter((id) => !held.has(id));
  if (!choices.length) return null;
  const [granted] = grant(session, `Quest:${choices[crypto.randomInt(choices.length)]}`, 1);
  return granted?.itemId ?? null;
}

export function refreshDailyQuests(session, now = new Date()) {
  const tracker = session.profile("profile0");
  if (!findQuestItem(tracker.profile, "dailyquesttrigger")) return;
  const manager = tracker.profile.stats.attributes.quest_manager ?? {};
  if (dayOf(manager.dailyLoginInterval) >= now.toISOString().slice(0, 10)) return;

  for (const [itemId, item] of heldDailies(tracker)) {
    if (item.attributes.quest_state === "Claimed") tracker.removeItem(itemId);
  }
  if (heldDailies(tracker).length < maxOpen) newDaily(session);
  tracker.setStat("quest_manager", { ...manager, dailyLoginInterval: now.toISOString(), dailyQuestRerolls: rerollsPerDay });
}

// FortRerollDailyQuest {questId}: an open daily for another, once a day. The client is told the new quest's item id
// (FFortDailyQuestRerollNotification {newQuestId}).
export function rerollDailyQuest(session, itemId, notifications) {
  const tracker = session.profile("profile0");
  const item = typeof itemId === "string" && tracker.profile.items[itemId];
  if (!item || getQuest(questIdOf(item) ?? "")?.type !== "DailyQuest" || item.attributes.quest_state !== "Active") {
    throw new McpError("errors.com.epicgames.fortnite.item_not_found", `No open daily quest ${itemId}`);
  }
  const manager = tracker.profile.stats.attributes.quest_manager ?? {};
  if (!(manager.dailyQuestRerolls > 0)) throw new McpError("errors.com.epicgames.fortnite.no_rerolls_remaining", "No daily quest rerolls left today");

  const newQuestId = newDaily(session);
  if (!newQuestId) throw new McpError("errors.com.epicgames.fortnite.item_not_found", "No other daily quest to give");
  tracker.removeItem(itemId);
  tracker.setStat("quest_manager", { ...manager, dailyQuestRerolls: manager.dailyQuestRerolls - 1 });
  notifications.push({ type: "dailyQuestReroll", primary: true, newQuestId });
}

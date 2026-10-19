import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { notFound, sendError } from "../errors.js";
import { getNode, nodeIds } from "../gamedata/homebase.js";
import { getItem, itemIds } from "../gamedata/items.js";
import { getQuest, questIds } from "../gamedata/quests.js";
import { grant, skipTutorial } from "../profiles/progress.js";
import { questIdOf, tutorialCompleted } from "../profiles/quests.js";
import { openSession } from "../profiles/session.js";
import { requireLoopback, requirePanelRequest } from "./local.js";

const panel = path.join(path.dirname(fileURLToPath(import.meta.url)), "panel.html");

function loadIfExists(profiles, accountId, profileId) {
  return profiles.exists(accountId, profileId) ? profiles.load(accountId, profileId) : null;
}

function summary(account, profiles) {
  const profile = loadIfExists(profiles, account.id, "profile0");
  return {
    id: account.id,
    displayName: account.displayName,
    created: account.created,
    lastLogin: account.lastLogin ?? null,
    level: profile?.stats.attributes.level ?? null,
    tutorialCompleted: profile ? tutorialCompleted(profile) : false
  };
}

function inventory(profile) {
  return Object.entries(profile?.items ?? {})
    .filter(([, item]) => !questIdOf(item))
    .map(([itemId, item]) => ({ itemId, templateId: item.templateId, quantity: item.quantity, level: item.attributes.level ?? null }))
    .sort((a, b) => a.templateId.localeCompare(b.templateId));
}

function details(account, profiles) {
  const profile = loadIfExists(profiles, account.id, "profile0");
  const quests = Object.entries(profile?.items ?? {})
    .filter(([, item]) => questIdOf(item))
    .map(([itemId, item]) => {
      const quest = getQuest(questIdOf(item));
      const objectives = (quest?.objectives ?? []).map(({ name, count }) => ({ name, count, progress: item.attributes[`completion_${name}`] ?? 0 }));
      return { itemId, questId: questIdOf(item), type: quest?.type ?? null, state: item.attributes.quest_state, objectives };
    })
    .sort((a, b) => (a.type === "Onboarding" ? 0 : 1) - (b.type === "Onboarding" ? 0 : 1) || a.questId.localeCompare(b.questId));

  return {
    ...summary(account, profiles),
    homebaseName: profile?.stats.attributes.homebase?.townName ?? "",
    quests,
    items: inventory(profile),
    worldItems: inventory(loadIfExists(profiles, account.id, "theater0"))
  };
}

export function adminRoutes({ accounts, profiles }) {
  const router = express.Router();
  router.use("/admin", requireLoopback, requirePanelRequest);

  router.get("/admin", (req, res) => res.sendFile(panel));

  router.get("/admin/api/accounts", (req, res) => {
    const list = accounts.list().map((account) => summary(account, profiles));
    list.sort((a, b) => (b.lastLogin ?? b.created).localeCompare(a.lastLogin ?? a.created));
    res.json(list);
  });

  router.get("/admin/api/accounts/:accountId", (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    res.json(details(account, profiles));
  });

  router.get("/admin/api/items", (req, res) => {
    res.json([...itemIds(), ...questIds().map((id) => `Quest:${id}`), ...nodeIds().map((id) => `HomebaseNode:${id.toLowerCase()}`)].sort());
  });

  // Test helper: give an item the normal way, so quests that wait on it move on too.
  router.post("/admin/api/accounts/:accountId/grant", (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    const templateId = String(req.body?.templateId ?? "").trim();
    const quantity = Number(req.body?.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
      return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", "Quantity must be 1 to 1000000");
    }
    const [type, name = ""] = templateId.split(":");
    const known = type.toLowerCase() === "quest" ? Boolean(getQuest(name))
      : type.toLowerCase() === "homebasenode" ? Boolean(getNode(name))
      : Boolean(getItem(templateId));
    if (!known) return sendError(res, 400, "errors.com.epicgames.common.invalid_parameter", `Unknown item ${templateId}`);

    const session = openSession(profiles, account.id);
    const granted = grant(session, templateId, quantity);
    session.commit();
    res.json({ granted: granted.length, ...details(account, profiles) });
  });

  router.post("/admin/api/accounts/:accountId/skip-tutorial", (req, res) => {
    const account = accounts.get(req.params.accountId);
    if (!account) return notFound(res, req.originalUrl);
    const session = openSession(profiles, account.id);
    skipTutorial(session);
    session.commit();
    res.json(details(account, profiles));
  });

  return router;
}

import { abandonExpedition, collectExpedition, refreshExpeditions as refreshBoard, startExpedition } from "../../../expeditions/expeditions.js";

export function refreshExpeditions({ session }) {
  refreshBoard(session);
}

export function startExpeditionCommand({ req, session }) {
  startExpedition(session, req.body ?? {});
}

export function collectExpeditionCommand({ req, session, notifications }) {
  collectExpedition(session, req.body?.expeditionId, notifications);
}

export function abandonExpeditionCommand({ req, session }) {
  abandonExpedition(session, req.body?.expeditionId);
}

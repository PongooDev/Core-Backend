import { convertItem, recycleItem, upgradeItem } from "../../../profiles/upgrades.js";

export function upgradeItemCommand({ req, session }) {
  upgradeItem(session, req.body?.targetItemId);
}

export function convertItemCommand({ req, session }) {
  convertItem(session, req.body?.targetItemId, req.body?.conversionIndex ?? 0);
}

export function recycleItemCommand({ req, session }) {
  recycleItem(session, req.body?.targetItemId);
}

export function recycleItemBatchCommand({ req, session }) {
  for (const itemId of Array.isArray(req.body?.targetItemIds) ? req.body.targetItemIds : []) recycleItem(session, itemId);
}

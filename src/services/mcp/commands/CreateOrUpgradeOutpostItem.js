import { createOutpost } from "../../../profiles/outposts.js";

export function createOrUpgradeOutpostItem({ req, session }) {
  createOutpost(session, req.params.accountId, req.body?.templateId);
}

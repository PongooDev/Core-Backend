import { activateConsumable as activate } from "../../../profiles/boosts.js";

// ActivateConsumable {targetItemId, targetAccountId}. A gift's notification waits for the target's next command.
export function activateConsumable({ req, session, sessionFor, context }) {
  const { targetItemId, targetAccountId } = req.body ?? {};
  const accountId = req.params.accountId;
  const target = typeof targetAccountId === "string" && targetAccountId ? sessionFor(targetAccountId) : session;
  const gift = activate(session, accountId, targetItemId, targetAccountId, target);
  if (gift) context.mailbox.send(targetAccountId, gift);
}

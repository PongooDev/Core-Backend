import { heldGiftBoxes } from "../../../profiles/giftboxes.js";

// RemoveGiftBox {giftBoxItemId} (3.0's FRemoveGiftBox, UFortMcpContext::RemoveGiftBox; later builds send
// giftBoxItemIds): the gift box the player has seen goes (profiles/giftboxes.js). 3.0 sends it to profile0, its
// UFortMcpProfileAccount's command, where the boxes are. An id that isn't a gift box the profile holds is passed over,
// as a box already gone.
export function removeGiftBox({ req, tracker }) {
  const ids = [req.body?.giftBoxItemId, ...(Array.isArray(req.body?.giftBoxItemIds) ? req.body.giftBoxItemIds : [])]
    .filter((id) => typeof id === "string" && id);
  for (const id of new Set(ids)) {
    if (heldGiftBoxes(tracker.profile).some(([itemId]) => itemId === id)) tracker.removeItem(id);
  }
}

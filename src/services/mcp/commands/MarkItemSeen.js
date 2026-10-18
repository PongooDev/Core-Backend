export function markItemSeen({ req, profile, tracker }) {
  for (const itemId of req.body?.itemIds ?? []) {
    if (profile.items[itemId] && profile.items[itemId].attributes.item_seen !== 1) tracker.setItemAttribute(itemId, "item_seen", 1);
  }
}

// UFortAccountItem.favorite is an int32.
export function setItemFavoriteStatus({ req, profile, tracker }) {
  const itemId = req.body?.targetItemId;
  const favorite = req.body?.bFavorite ? 1 : 0;
  if (profile.items[itemId] && (profile.items[itemId].attributes.favorite ?? 0) !== favorite) {
    tracker.setItemAttribute(itemId, "favorite", favorite);
  }
}

// 4.0's (CL-4039451) locker: "You can now mark cosmetic items as favorites in the Locker" (the Random slot then picks among
// them). Its UFortMcpProfileSubgame::SetItemFavoriteStatusBatch (new in 4.0's exe; 3.6's has only SetItemFavoriteStatus)
// sends {itemIds, itemFavStatus}: the items and, by index, whether each is a favorite.
export function setItemFavoriteStatusBatch({ req, profile, tracker }) {
  const itemIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds : [];
  const statuses = Array.isArray(req.body?.itemFavStatus) ? req.body.itemFavStatus : [];
  itemIds.forEach((itemId, index) => {
    const favorite = statuses[index] ? 1 : 0;
    if (typeof itemId === "string" && profile.items[itemId] && (profile.items[itemId].attributes.favorite ?? 0) !== favorite) {
      tracker.setItemAttribute(itemId, "favorite", favorite);
    }
  });
}

// UFortAccountItem.favorite is an int32.
export function setItemFavoriteStatus({ req, profile, tracker }) {
  const itemId = req.body?.targetItemId;
  const favorite = req.body?.bFavorite ? 1 : 0;
  if (profile.items[itemId] && (profile.items[itemId].attributes.favorite ?? 0) !== favorite) {
    tracker.setItemAttribute(itemId, "favorite", favorite);
  }
}

export function markNewQuestNotificationSent({ req, profile, tracker }) {
  for (const itemId of req.body?.itemIds ?? []) {
    const item = profile.items[itemId];
    if (item?.templateId.toLowerCase().startsWith("quest:") && item.attributes.sent_new_notification !== true) {
      tracker.setItemAttribute(itemId, "sent_new_notification", true);
    }
  }
}

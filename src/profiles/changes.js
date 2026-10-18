export function trackChanges(profile) {
  const changes = [];

  return {
    profile,
    changes,

    addItem(itemId, item) {
      profile.items[itemId] = item;
      changes.push({ changeType: "itemAdded", itemId, item });
    },

    removeItem(itemId) {
      delete profile.items[itemId];
      changes.push({ changeType: "itemRemoved", itemId });
    },

    setQuantity(itemId, quantity) {
      profile.items[itemId].quantity = quantity;
      changes.push({ changeType: "itemQuantityChanged", itemId, quantity });
    },

    setItemAttribute(itemId, attributeName, attributeValue) {
      profile.items[itemId].attributes[attributeName] = attributeValue;
      changes.push({ changeType: "itemAttrChanged", itemId, attributeName, attributeValue });
    },

    setStat(name, value) {
      profile.stats.attributes[name] = value;
      changes.push({ changeType: "statModified", name, value });
    }
  };
}

export function fullProfile({ version, wipeNumber, stats, items }) {
  return { version, wipeNumber, stats, items };
}

import { isForeignTemplate } from "../gamedata/templates.js";

// The template of the item each item change is about, kept off the change itself (which goes to the client as is).
const changeTemplates = new WeakMap();

export function trackChanges(profile) {
  const changes = [];
  const record = (change, templateId) => {
    changeTemplates.set(change, templateId);
    changes.push(change);
  };

  return {
    profile,
    changes,

    addItem(itemId, item) {
      profile.items[itemId] = item;
      record({ changeType: "itemAdded", itemId, item }, item.templateId);
    },

    removeItem(itemId) {
      const templateId = profile.items[itemId]?.templateId;
      delete profile.items[itemId];
      record({ changeType: "itemRemoved", itemId }, templateId);
    },

    setQuantity(itemId, quantity) {
      profile.items[itemId].quantity = quantity;
      record({ changeType: "itemQuantityChanged", itemId, quantity }, profile.items[itemId].templateId);
    },

    setItemAttribute(itemId, attributeName, attributeValue) {
      profile.items[itemId].attributes[attributeName] = attributeValue;
      record({ changeType: "itemAttrChanged", itemId, attributeName, attributeValue }, profile.items[itemId].templateId);
    },

    // The delta says null for an attribute that's gone.
    removeItemAttribute(itemId, attributeName) {
      delete profile.items[itemId].attributes[attributeName];
      record({ changeType: "itemAttrChanged", itemId, attributeName, attributeValue: null }, profile.items[itemId].templateId);
    },

    setStat(name, value) {
      profile.stats.attributes[name] = value;
      changes.push({ changeType: "statModified", name, value });
    }
  };
}

// What a client of the requesting build is sent: everything but the items whose template only other builds have
// (src/gamedata/templates.js); the saved profile keeps them.
export function fullProfile({ version, wipeNumber, stats, items }, isHidden = isForeignTemplate) {
  const hidden = Object.keys(items).filter((itemId) => isHidden(items[itemId].templateId));
  if (hidden.length) {
    items = { ...items };
    for (const itemId of hidden) delete items[itemId];
  }
  return { version, wipeNumber, stats, items };
}

export function visibleChanges(changes, isHidden = isForeignTemplate) {
  return changes.filter((change) => !(changeTemplates.has(change) && isHidden(changeTemplates.get(change))));
}

import { athenaCosmetics, athenaVariantTokens } from "../gamedata/athena.js";
import { log } from "../log.js";

// 4.0's (CL-4039451) cosmetic styles (Core-Backend: Season 4's progressive outfits): Carbide and Omega
// (CID_115_Athena_Commando_M_CarbideBlue, CID_116_..._CarbideBlack) have ItemVariants, a FortCosmeticCharacterPartVariant
// whose channel (Cosmetics.Variant.Channel.Progressive) has six options, Stage0 (bIsDefault, bStartUnlocked) to Stage5,
// and the Battle Pass's progressive challenges (Quest_BR_LevelUp_SeasonLevel_ProgressiveA/B_01 to _05: season level 10,
// 20, 30, 40 and 65) give a CosmeticVariantToken (VTID_002 to _011, FortVariantTokenType) for each stage: cosmetic_item,
// VariantChanelTag, VariantNameTag (tools/extractor: athena.json cosmetics[].variants, variantTokens).
//
// The athena profile keeps a cosmetic's styles as its item's variants attribute, [{channel, active, owned}], the
// FMcpVariantReader 4.0's UFortMcpProfileAthena reads (Channel, Active, Owned: FStrings, the tags' last part, the client
// putting "Cosmetics.Variant.Channel." and "Cosmetics.Variant.Property." back in front: both prefixes are in 4.0's exe).
// EquipBattleRoyaleCustomization takes the same struct as variantUpdates, the locker's style picker.

// A cosmetic's styles as the profile names them, each channel at its default with its start-unlocked options; [] for a
// cosmetic without any.
export const defaultVariants = (templateId) => (athenaCosmetics()[cosmeticKey(templateId)]?.variants ?? [])
  .map(({ channel, default: active, unlocked }) => ({ channel, active, owned: [...new Set([active, ...unlocked])] }));

const cosmeticKey = (templateId) => Object.keys(athenaCosmetics()).find((id) => id.toLowerCase() === String(templateId).toLowerCase());
const findHeld = (profile, templateId) => Object.keys(profile.items)
  .find((itemId) => profile.items[itemId].templateId.toLowerCase() === String(templateId).toLowerCase());

// The item's variants with every channel the data names (a cosmetic granted before its build's data had styles has none).
function variantsOf(item) {
  const held = Array.isArray(item.attributes.variants) ? item.attributes.variants : [];
  const channels = defaultVariants(item.templateId);
  const merged = channels.map((channel) => {
    const kept = held.find((entry) => entry?.channel === channel.channel);
    return kept ? { channel: channel.channel, active: kept.active ?? channel.active, owned: [...new Set([...channel.owned, ...(kept.owned ?? [])])] } : channel;
  });
  return [...merged, ...held.filter((entry) => !channels.some((channel) => channel.channel === entry?.channel))];
}

// A CosmeticVariantToken reward: its style owned on its cosmetic's item. Returns whether the token is one the requesting
// build's data has. A token for a cosmetic the locker lacks is kept (profile.coreVariantTokens, Core's, never sent) and
// unlocks the style once the cosmetic comes (applyHeldVariantTokens).
export function grantVariantToken(session, tokenId) {
  const token = athenaVariantTokens()[Object.keys(athenaVariantTokens()).find((id) => id.toLowerCase() === String(tokenId).toLowerCase())];
  if (!token) return false;
  const tracker = session.profile("athena");
  const { profile } = tracker;
  const itemId = findHeld(profile, token.cosmetic);
  if (!itemId) {
    profile.coreVariantTokens = [...new Set([...(profile.coreVariantTokens ?? []), String(tokenId).toLowerCase()])];
    log("Battle Royale", `${session.accountId} got the style ${token.variant} of ${token.cosmetic}, which the locker lacks yet`);
    return true;
  }
  const variants = variantsOf(profile.items[itemId]);
  const channel = variants.find((entry) => entry.channel === token.channel);
  const updated = channel ? variants.map((entry) => (entry === channel ? { ...entry, owned: [...new Set([...entry.owned, token.variant])] } : entry))
    : [...variants, { channel: token.channel, active: token.variant, owned: [token.variant] }];
  if (JSON.stringify(updated) !== JSON.stringify(profile.items[itemId].attributes.variants)) {
    tracker.setItemAttribute(itemId, "variants", updated);
    log("Battle Royale", `${session.accountId} unlocked ${token.cosmetic}'s style ${token.variant}`);
  }
  return true;
}

// The tokens kept for a cosmetic now in the locker.
export function applyHeldVariantTokens(session) {
  const { profile } = session.profile("athena");
  const kept = profile.coreVariantTokens ?? [];
  if (!kept.length) return;
  const tokens = athenaVariantTokens();
  const ready = kept.filter((tokenId) => {
    const token = tokens[Object.keys(tokens).find((id) => id.toLowerCase() === tokenId)];
    return token && findHeld(profile, token.cosmetic);
  });
  if (!ready.length) return;
  profile.coreVariantTokens = kept.filter((tokenId) => !ready.includes(tokenId));
  for (const tokenId of ready) grantVariantToken(session, tokenId);
}

// EquipBattleRoyaleCustomization's variantUpdates on the slotted item: each channel's active style, when the item owns it.
export function applyVariantUpdates(session, itemId, updates) {
  if (!itemId || !Array.isArray(updates) || !updates.length) return;
  const tracker = session.profile("athena");
  const item = tracker.profile.items[itemId];
  if (!item) return;
  const variants = variantsOf(item);
  if (!variants.length) return;
  const updated = variants.map((entry) => {
    const update = updates.find((candidate) => candidate?.channel === entry.channel);
    return update && typeof update.active === "string" && entry.owned.includes(update.active) ? { ...entry, active: update.active } : entry;
  });
  if (JSON.stringify(updated) !== JSON.stringify(item.attributes.variants)) tracker.setItemAttribute(itemId, "variants", updated);
}

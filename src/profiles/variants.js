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
//
// From 6.00 (CL-4402180, Season 6) Battle Pass tiers give tokens too (Core-Backend #332): AthenaSeason6's
// BookXpSchedulePaid has VTID_033_PetCarrier_Dog_StyleB at tier 59, VTID_035_PetCarrier_Dragon_StyleB at 74,
// VTID_034_PetCarrier_Dog_StyleC at 90 and VTID_036_PetCarrier_Dragon_StyleC at 98 (Bonesy's and Scales' Material Mat1 and
// Mat2, "Unlock at Tier 59" in the locker; bCreateGiftbox false, the tier's GB_BattlePass lists them), given as a challenge's
// are (profiles/seasons.js). Calamity's and Dire's stages and colours are their progressive challenges' rewards
// (Quest_BR_S6_Gain_SeasonXP_ProgressiveA/B_*, Quest_BR_S6_Complete_WeeklyChallenges_ProgressiveA/B_*: profiles/athena.js).

// A cosmetic's styles as the profile names them, each channel at its default with every option the player owns with the
// cosmetic (Core-Backend #259): Epic gave a cosmetic's owners every style no challenge or token gates, so an option is
// owned from the start unless a CosmeticVariantToken of the build's data unlocks it (Carbide's and Omega's Stage1 to
// Stage5, the progressive challenges' rewards); the default and the start-unlocked (bStartUnlocked) ones always are.
// [] for a cosmetic without any.
export const defaultVariants = (templateId) => {
  const key = cosmeticKey(templateId);
  const gated = tokenGatedVariants(key);
  return (athenaCosmetics()[key]?.variants ?? []).map(({ channel, default: active, options = [], unlocked = [] }) => ({ channel, active,
    owned: [...new Set([active, ...unlocked, ...options.filter((option) => !gated.has(`${channel}.${option}`))])] }));
};

// The "channel.variant" styles of a cosmetic that a variant token unlocks.
function tokenGatedVariants(cosmeticId) {
  if (!cosmeticId) return new Set();
  return new Set(Object.values(athenaVariantTokens()).filter((token) => String(token.cosmetic).toLowerCase() === cosmeticId.toLowerCase())
    .map((token) => `${token.channel}.${token.variant}`));
}

const cosmeticKey = (templateId) => Object.keys(athenaCosmetics()).find((id) => id.toLowerCase() === String(templateId).toLowerCase());
const findHeld = (profile, templateId) => Object.keys(profile.items)
  .find((itemId) => profile.items[itemId].templateId.toLowerCase() === String(templateId).toLowerCase());

// A style the way the data names it (Core-Backend #315): the soccer outfits' jersey colours are tags below the property
// prefix ("Color.Brazil" of Cosmetics.Variant.Property.Color.Brazil), which an earlier extraction cut to their last part
// ("Brazil"), so profiles may hold that; the client matches the whole name, so it is taken back to the data's.
const canonicalStyle = (channel, tag) => {
  if (typeof tag !== "string") return tag;
  const options = (athenaCosmetics()[channel.cosmetic]?.variants ?? []).find((entry) => entry.channel === channel.channel)?.options ?? [];
  return options.includes(tag) ? tag : options.find((option) => option.endsWith(`.${tag}`)) ?? tag;
};

// The item's variants with every channel the data names (a cosmetic granted before its build's data had styles has none).
function variantsOf(item) {
  const held = Array.isArray(item.attributes.variants) ? item.attributes.variants : [];
  const channels = defaultVariants(item.templateId);
  const cosmetic = cosmeticKey(item.templateId);
  const merged = channels.map((channel) => {
    const kept = held.find((entry) => entry?.channel === channel.channel);
    const named = (tag) => canonicalStyle({ cosmetic, channel: channel.channel }, tag);
    return kept ? { channel: channel.channel, active: typeof kept.active === "string" ? named(kept.active) : channel.active,
      owned: [...new Set([...channel.owned, ...(Array.isArray(kept.owned) ? kept.owned.map(named) : [])])] } : channel;
  });
  return [...merged, ...held.filter((entry) => !channels.some((channel) => channel.channel === entry?.channel))];
}

// A CosmeticVariantToken of the build's data by its template id (any case), or undefined.
const variantToken = (tokenId) => {
  const tokens = athenaVariantTokens() ?? {};
  return tokens[Object.keys(tokens).find((id) => id.toLowerCase() === String(tokenId).toLowerCase())];
};

// A CosmeticVariantToken reward: its style owned on its cosmetic's item. Returns whether the token is one the requesting
// build's data has. A token for a cosmetic the locker lacks is kept (profile.coreVariantTokens, Core's, never sent) and
// unlocks the style once the cosmetic comes (applyHeldVariantTokens).
export function grantVariantToken(session, tokenId) {
  const token = variantToken(tokenId);
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

// Of tokenIds (CosmeticVariantToken template ids), those whose style the locker lacks: the build's data has the token, it
// isn't kept for a cosmetic still to come (profile.coreVariantTokens), and the cosmetic's item doesn't own the style.
// Lower-cased ids.
export function missingVariantTokens(profile, tokenIds) {
  const kept = new Set(profile.coreVariantTokens ?? []);
  return [...new Set(tokenIds.map((tokenId) => String(tokenId).toLowerCase()))].filter((tokenId) => {
    const token = variantToken(tokenId);
    if (!token || kept.has(tokenId)) return false;
    const itemId = findHeld(profile, token.cosmetic);
    return !itemId || !variantsOf(profile.items[itemId]).some((entry) => entry.channel === token.channel && entry.owned.includes(token.variant));
  });
}

// Styles the season's rewards gave that the locker lacks (Core-Backend #332): until then a tier's CosmeticVariantToken
// (6.00's Bonesy and Scales styles) went nowhere, so tiers reached before then come with their styles now.
export function grantMissingVariantTokens(session, tokenIds) {
  for (const tokenId of missingVariantTokens(session.profile("athena").profile, tokenIds)) {
    log("Battle Royale", `${session.accountId}: ${tokenId}, a season reward already reached, gives its style`);
    grantVariantToken(session, tokenId);
  }
}

// A style token taken back (the admin panel's Battle Pass reset, battlepass/reset.js): no longer kept for a cosmetic to
// come, and its style no longer owned on the cosmetic's item, unless the cosmetic owns that style from the start; an item
// showing it goes back to the channel's default. Returns whether anything changed.
export function takeBackVariantToken(session, tokenId) {
  const token = variantToken(tokenId);
  if (!token) return false;
  const tracker = session.profile("athena");
  const { profile } = tracker;
  const id = String(tokenId).toLowerCase();
  const kept = profile.coreVariantTokens ?? [];
  const wasKept = kept.includes(id);
  if (wasKept) profile.coreVariantTokens = kept.filter((held) => held !== id);
  const itemId = findHeld(profile, token.cosmetic);
  const start = itemId && defaultVariants(profile.items[itemId].templateId).find((entry) => entry.channel === token.channel);
  if (!itemId || start?.owned.includes(token.variant)) return wasKept;
  const variants = variantsOf(profile.items[itemId]);
  const owning = variants.find((entry) => entry.channel === token.channel && entry.owned.includes(token.variant));
  if (!owning) return wasKept;
  const updated = variants.map((entry) => {
    if (entry !== owning) return entry;
    const owned = entry.owned.filter((tag) => tag !== token.variant);
    return { ...entry, active: entry.active === token.variant ? start?.active ?? owned[0] : entry.active, owned };
  }).filter((entry) => entry.owned.length);
  if (updated.length) tracker.setItemAttribute(itemId, "variants", updated);
  else tracker.removeItemAttribute(itemId, "variants");
  log("Battle Royale", `${session.accountId} no longer owns ${token.cosmetic}'s style ${token.variant}`);
  return true;
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

// Owned cosmetics whose item lacks styles it owns from the start (Core-Backend #259): a cosmetic granted before its build's
// data had styles (4.0's game data came with 6ec4ace), or by a build without them (the full locker gives every build's
// cosmetics, with the giving build's styles), has no variants, or a channel or option missing, and the locker's Edit
// Styles shows them locked. Item ids; [] on a build whose data has no styles.
export function itemsMissingVariants(profile) {
  if (!Object.values(athenaCosmetics()).some((cosmetic) => cosmetic.variants?.length)) return [];
  return Object.keys(profile.items).filter((itemId) => {
    const item = profile.items[itemId];
    const channels = defaultVariants(item.templateId);
    if (!channels.length) return false;
    const held = Array.isArray(item.attributes?.variants) ? item.attributes.variants : [];
    return channels.some((channel) => {
      const kept = held.find((entry) => entry?.channel === channel.channel);
      return !kept || typeof kept.active !== "string" || !Array.isArray(kept.owned) || channel.owned.some((option) => !kept.owned.includes(option))
        || [kept.active, ...kept.owned].some((tag) => canonicalStyle({ cosmetic: cosmeticKey(item.templateId), channel: channel.channel }, tag) !== tag);
    });
  });
}

// Those items' styles filled in, keeping the active style and what challenges unlocked.
export function grantDefaultVariants(session) {
  const tracker = session.profile("athena");
  for (const itemId of itemsMissingVariants(tracker.profile)) {
    tracker.setItemAttribute(itemId, "variants", variantsOf(tracker.profile.items[itemId]));
    log("Battle Royale", `${session.accountId}: ${tracker.profile.items[itemId].templateId} gets the styles it owns`);
  }
}

// Styles an admin adds by hand (Core-Backend #305): channels and the options owned in them, as the profile names them
// (the tags' last part: "Material" and "Mat2", "Progressive" and "Stage3"). A full tag (Cosmetics.Variant.Channel.Material,
// Cosmetics.Variant.Property.Mat2) is cut to its last part, as the client puts the prefixes back in front.
// A tag below the property prefix keeps its dots (Cosmetics.Variant.Property.Color.Brazil is Color.Brazil, the soccer
// outfits' jersey colours, Core-Backend #315); a tag typed without it is taken as it is.
export const styleTag = (value) => {
  const text = String(value ?? "").trim();
  const prefix = /^Cosmetics\.Variant\.(?:Property|Channel)\./i.exec(text);
  const tag = prefix ? text.slice(prefix[0].length) : text;
  return /^[A-Za-z0-9_-]{1,64}(\.[A-Za-z0-9_-]{1,64}){0,3}$/.test(tag) ? tag : null;
};

export const maxStyleChannels = 16;
export const maxStyleOptions = 64;

// The held item of a template id (any case; the id without its type, CID_115_..., names the cosmetic too), or undefined.
export const heldItemId = (profile, templateId) => findHeld(profile, templateId) ?? (String(templateId).includes(":") ? undefined
  : Object.keys(profile.items).find((itemId) => profile.items[itemId].templateId.toLowerCase().endsWith(`:${String(templateId).toLowerCase()}`)));

// The template ids (lower case) of the cosmetics the build's data gives styles, for the admin panel's Styles button.
export const styledCosmeticIds = () => new Set(Object.entries(athenaCosmetics()).filter(([, cosmetic]) => cosmetic.variants?.length).map(([id]) => id.toLowerCase()));

// The channels the build's data names for a cosmetic, [{channel, default, options}]; [] when it names none.
export const dataStyleChannels = (templateId) => (athenaCosmetics()[cosmeticKey(templateId)]?.variants ?? [])
  .map(({ channel, default: active, options = [] }) => ({ channel, default: active, options: [...options] }));

// styles [{channel, tags, active}] on an owned item. Adding owns each tag in its channel (a channel the item lacks is
// added, its active style the one asked for or its first tag); remove takes the tags out (a channel left with none goes),
// except the styles the cosmetic owns from the start (defaultVariants), which would come back at the next login. The
// active style moves to an owned one when its own goes. The styles of earnedTokens (the season's rewards reached,
// profiles/seasons.js givenVariantTokens) stay too, as they would also come back. Returns {changed, kept: ["channel.tag"]}.
export function editItemStyles(session, itemId, styles, { remove = false, earnedTokens = [] } = {}) {
  const tracker = session.profile("athena");
  const item = tracker.profile.items[itemId];
  let variants = variantsOf(item).map((entry) => ({ ...entry, owned: [...entry.owned] }));
  const earned = earnedTokens.map(variantToken).filter((token) => token && String(token.cosmetic).toLowerCase() === item.templateId.toLowerCase());
  const kept = [];
  for (const { channel, tags, active } of styles) {
    const entry = variants.find((candidate) => candidate.channel.toLowerCase() === channel.toLowerCase());
    if (remove) {
      if (!entry) continue;
      const fixed = new Set([...(defaultVariants(item.templateId).find((candidate) => candidate.channel === entry.channel)?.owned ?? []),
        ...earned.filter((token) => token.channel === entry.channel).map((token) => token.variant)]);
      for (const tag of tags) {
        const owned = entry.owned.find((option) => option.toLowerCase() === tag.toLowerCase());
        if (!owned) continue;
        if (fixed.has(owned)) kept.push(`${entry.channel}.${owned}`);
        else entry.owned = entry.owned.filter((option) => option !== owned);
      }
      if (!entry.owned.includes(entry.active)) entry.active = entry.owned[0];
      continue;
    }
    // A tag of another case than one held or the data's is that one.
    const data = dataStyleChannels(item.templateId).find((candidate) => candidate.channel.toLowerCase() === channel.toLowerCase());
    const known = [...(entry?.owned ?? []), ...(data?.options ?? [])];
    const named = (tag) => known.find((option) => option.toLowerCase() === tag.toLowerCase())
      ?? known.find((option) => option.toLowerCase().endsWith(`.${tag.toLowerCase()}`)) ?? tag;
    const added = [...new Set(tags.map(named))];
    if (!entry) {
      variants.push({ channel: data?.channel ?? channel, active: active && added.includes(named(active)) ? named(active) : added[0], owned: added });
      continue;
    }
    entry.owned = [...new Set([...entry.owned, ...added])];
    if (active && entry.owned.includes(named(active))) entry.active = named(active);
  }
  variants = variants.filter((entry) => entry.owned.length);
  const changed = JSON.stringify(variants) !== JSON.stringify(item.attributes.variants ?? []);
  if (changed) {
    if (variants.length) tracker.setItemAttribute(itemId, "variants", variants);
    else tracker.removeItemAttribute(itemId, "variants");
    log("Battle Royale", `${session.accountId}: ${remove ? "took styles off" : "gave styles to"} ${item.templateId} (admin panel)`);
  }
  return { changed, kept };
}

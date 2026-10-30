import { describeItem, knownTemplate } from "../admin/describe.js";
import { inBuild } from "../builds/context.js";
import { battleRoyaleBuilds } from "../builds/detect.js";
import { grantCosmetic, lockerCosmeticId } from "../profiles/athena.js";
import { campaignAccessToken, foundersEditions, setFoundersEdition } from "../profiles/founders.js";
import { findItem } from "../profiles/items.js";
import { grant } from "../profiles/progress.js";

// What a redeem code gives (Core-Backend #126): V-Bucks, a founder's pack edition, Save the World's access token and
// items, given the way the admin panel gives them (admin/routes.js), each with the data of a build that has it.

// The build whose founder's packs and campaign access token a code gives: 1.8 (CL-3724489), which has both.
const foundersBuild = "3724489";

// A code's item: a Battle Royale cosmetic as the newest build with Battle Royale whose locker has it spells it, anything
// else as some build's game data knows it; null when no build has it, so a code can't promise it.
export function rewardItem(templateId) {
  const id = String(templateId ?? "").trim();
  if (!id.includes(":")) return null;
  if (id.toLowerCase().startsWith("athena")) {
    for (const build of [...battleRoyaleBuilds].reverse()) {
      const cosmetic = inBuild(build, () => lockerCosmeticId(id));
      if (cosmetic) return { cosmetic: true, build, templateId: cosmetic };
    }
    return null;
  }
  const known = knownTemplate(id);
  return known ? { cosmetic: false, build: known.build, templateId: known.templateId } : null;
}

const itemName = (item) => {
  try {
    return inBuild(item.build, () => describeItem(item.templateId).name) || item.templateId;
  } catch {
    return item.templateId;
  }
};

// Gives a code's rewards to the open session; answers what was given, for the player to read.
export function grantCodeRewards(session, rewards) {
  const granted = [];
  if (rewards.vbucks > 0) {
    // As Battle Royale's match V-Bucks are given (services/fortnite/battleroyale.js).
    grant(session, "Currency:mtxgiveaway", rewards.vbucks);
    granted.push(`${rewards.vbucks.toLocaleString("en-US")} V-Bucks`);
  }
  if (rewards.foundersEdition > 0) {
    const { error } = inBuild(foundersBuild, () => setFoundersEdition(session, rewards.foundersEdition));
    // An account already on that edition or a higher one keeps what it has.
    if (!error) granted.push(`${foundersEditions[rewards.foundersEdition - 1]?.name ?? rewards.foundersEdition} Founder's Edition`);
  }
  if (rewards.campaignAccess && !findItem(session.profile("profile0").profile, campaignAccessToken)) {
    inBuild(foundersBuild, () => grant(session, campaignAccessToken, 1));
    granted.push("Save the World Campaign Access");
  }
  for (const entry of rewards.items ?? []) {
    const item = rewardItem(entry.templateId);
    if (!item) continue;
    const quantity = Number.isInteger(entry.quantity) && entry.quantity >= 1 ? entry.quantity : 1;
    if (item.cosmetic) {
      if (inBuild(item.build, () => grantCosmetic(session, item.templateId))) granted.push(itemName(item));
    } else {
      inBuild(item.build, () => grant(session, item.templateId, quantity));
      granted.push(quantity > 1 ? `${itemName(item)} (x${quantity})` : itemName(item));
    }
  }
  return granted;
}

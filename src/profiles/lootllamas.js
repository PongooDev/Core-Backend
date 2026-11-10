import { log } from "../log.js";
import { grant } from "./progress.js";
import { findQuestItem } from "./quests.js";

// "Loot Llamas" (HomebaseOnboardingAfterOutpost, granted by outpostquest_t1_l1, the first storm shield defense): its
// first objective, open_card_pack ("Redeem a Mini Llama from the Loot tab", OpenCardPack of CardPack_Basic), runs the
// StoreOnboard_OpenRewardLlama scripted action. That announcement locks the front end to the Loot tab and sends
// StoreShowOnlyRewardLlama, after which StoreRoot's ShouldShowOffer shows only an offer priced in Voucher_BasicPack,
// and only while the account holds that voucher (FortMcpContext GetAccountItemWithDefinition). The input stays locked
// until a pack is opened there (StoreCardPackOpened). Epic's voucher came with the defense's own rewards
// (Outpost_Select_Theater1: ZCP_Voucher_BasicPack, given by EndPrimaryMission as a "Mission" pack the rewards screen
// opens); a defense whose rewards never arrived left the player on an empty Loot tab with every other tab and button
// locked, through restarts (CoreV2 #156, 1.8.1).
//
// A defense whose rewards did arrive locks it too when nothing opens them: 1.1 (Cert) comes back from the storm shield
// to the front end without opening its Mission packs, so ZCP_Voucher_BasicPack waits in profile0 while the Loot tab,
// holding no voucher, shows nothing (Core-Launcher #16; the client opens pending Mission packs at its next login).
//
// So while the objective is open, an account with no voucher and no unopened Mini Reward Llama bought with one is given
// the voucher, when its profile next loads and by the claim that starts the step (ClaimQuestReward). A
// ZCP_Voucher_BasicPack[_Outpost_Theater<n>] still waiting is opened for it (its contents are that one voucher,
// cardpacks/contents.js), so the defense's voucher is not given twice.
const questId = "homebaseonboardingafteroutpost";
const objective = "completion_open_card_pack";
const voucher = "AccountResource:voucher_basicpack";
const ways = new Set([voucher, "CardPack:cardpack_basic"].map((id) => id.toLowerCase()));
const isVoucherPack = (item) => item.templateId.toLowerCase().startsWith("cardpack:zcp_voucher_basicpack") && item.quantity > 0;

export function lootLlamaVoucherMissing(profile) {
  const itemId = findQuestItem(profile, questId);
  const quest = itemId && profile.items[itemId];
  if (!quest || quest.attributes.quest_state !== "Active" || (quest.attributes[objective] ?? 0) >= 1) return false;
  return !Object.values(profile.items).some((item) => ways.has(item.templateId.toLowerCase()) && item.quantity > 0);
}

// Gives the Loot Llamas step its voucher when it has none: out of a waiting ZCP_Voucher_BasicPack if there is one.
export function giveLootLlamaVoucher(session) {
  const tracker = session.profile("profile0");
  if (!lootLlamaVoucherMissing(tracker.profile)) return;
  const [packId, pack] = Object.entries(tracker.profile.items).find(([, item]) => isVoucherPack(item)) ?? [];
  if (packId) {
    if (pack.quantity > 1) tracker.setQuantity(packId, pack.quantity - 1);
    else tracker.removeItem(packId);
  }
  grant(session, voucher, 1);
  log("Profiles", packId
    ? `${session.accountId}: on the Loot Llamas step with ${pack.templateId} unopened, opened it for its voucher`
    : `${session.accountId}: on the Loot Llamas step with no Mini Reward Llama to open, given one voucher`);
}

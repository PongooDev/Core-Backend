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
// So while the objective is open, an account with no way to finish it (no Voucher_BasicPack, no unopened Mini Reward
// Llama bought with one, and no unopened ZCP_Voucher_BasicPack still on its way to the rewards screen) is given the
// voucher when its profile next loads.
const questId = "homebaseonboardingafteroutpost";
const objective = "completion_open_card_pack";
const voucher = "AccountResource:voucher_basicpack";
const ways = new Set([voucher, "CardPack:cardpack_basic", "CardPack:zcp_voucher_basicpack"].map((id) => id.toLowerCase()));

export function lootLlamaVoucherMissing(profile) {
  const itemId = findQuestItem(profile, questId);
  const quest = itemId && profile.items[itemId];
  if (!quest || quest.attributes.quest_state !== "Active" || (quest.attributes[objective] ?? 0) >= 1) return false;
  return !Object.values(profile.items).some((item) => ways.has(item.templateId.toLowerCase()) && item.quantity > 0);
}

export const lootLlamaVoucher = voucher;

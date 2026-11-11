import { currentBuild } from "../../../builds/context.js";
import { getItem } from "../../../gamedata/items.js";
import { grant } from "../../../profiles/progress.js";

// ClaimMfaEnabled {bClaimForStw} (UFortMcpProfileCommonCore's, Core-Backend #328 and #330): the reward for turning on
// two-factor authentication. Update v6.00: "Enabling Multi-Factor Authentication on your Epic account will now grant the
// following rewards in Save the World: 50 Armory Slots, 10 Backpack Slots, 1 Legendary Troll Stash Llama".
//
// 6.00 (IDA 13340, CL-4395664's exe) asks for it itself. Its UFortAsyncAction_CheckForStwMfaReward (Activate,
// sub_2D51E90; the 21.40 PDB's UFortGameStateComponent_FrontEndFlowSTW::CheckForStWMfaReward), run as Save the World's
// front end loads, reads common_core's mfa_enabled (sub_10CFD70) and campaign's mfa_reward_claimed (sub_10CFB30) and,
// when the first is true and the second isn't, sends ClaimMfaEnabled (FName at qword_539F5E8) to common_core with
// bClaimForStw true (sub_14D80A0), then reports whether it succeeded. Core counts every account's 2FA as on (#310), so every 6.00
// player sends it on entering Save the World; Core didn't know the command, and the front end showed "Unknown command
// ClaimMfaEnabled" (errors.com.epicgames.fortnite.operation_not_found, #330) each time. 5.30's and 5.41's exes have the
// command without the parameter and read no campaign mfa_reward_claimed: the Save the World reward is 6.00's.
//
// The reward, given once per account into campaign (Core's profile0, profiles/common.js), with campaign's
// mfa_reward_claimed set so the client stops asking:
// - 50 Token:AccountInventoryBonus ("Armory Slot": "Increases the number of Heroes, Schematics, Survivors, and Defenders
//   that can be stored in your Armory"; DefaultGameData's AccountInventoryBonusToken) and 10 Token:WorldInventoryBonus
//   ("Backpack Slot", WorldInventoryBonusToken), FortTokenTypes with no stack limit whose quantity the client adds to
//   the vault's and the backpack's limits (UFortHomebaseManager GetNumAccountInventoryBonusTokens and
//   GetNumWorldInventoryBonusTokens in the PDB; Core's profiles/vault.js vaultLimit and backpackLimit count them too);
// - CardPack_Jackpot, the "Legendary Troll Stash Llama", unopened, for the llama store to open (pack_source Store).
//   🟡 GB_MfaReward, the 2FA gift box, is Battle Royale's (RestrictToSubgame Athena), so none comes with it.
//
// With bClaimForStw false (Battle Royale's claim: Boogie Down), nothing is given: athena's mfa_reward_claimed is always
// true (profiles/defaults.js, #310), so no client asks for it. A claim already made answers with nothing changed, so the
// front end's check passes either way.
export const stwMfaRewardBuild = 4395664;
export const stwMfaRewards = [
  { templateId: "Token:accountinventorybonus", quantity: 50 },
  { templateId: "Token:worldinventorybonus", quantity: 10 },
  { templateId: "CardPack:cardpack_jackpot", quantity: 1 }
];

export const stwMfaRewardOffered = () => Number(currentBuild()) >= stwMfaRewardBuild;

// Gives the Save the World reward, if the account hasn't had it. Returns what was granted.
export function claimStwMfaReward(session) {
  if (!stwMfaRewardOffered()) return [];
  const tracker = session.profile("profile0");
  if (tracker.profile.stats.attributes.mfa_reward_claimed === true) return [];
  const granted = stwMfaRewards.filter(({ templateId }) => getItem(templateId))
    .flatMap(({ templateId, quantity }) => grant(session, templateId, quantity));
  tracker.setStat("mfa_reward_claimed", true);
  return granted;
}

export function claimMfaEnabled({ req, session }) {
  if (req.body?.bClaimForStw === true) claimStwMfaReward(session);
}

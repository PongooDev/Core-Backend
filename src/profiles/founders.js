import { findItem } from "./items.js";
import { grant } from "./progress.js";

// The founder's pack (Core-Backend #31). Everyone who played this build bought one (it was paid early access), and
// Epic's services fulfilled it by granting the edition's founders quest: the Standard Edition's is
// FoundersQuest_GetRewards_0_1 ("Standard Edition Rewards!", "Thank you for being a Founder! Complete the Loot Llamas
// Store Tutorial to collect your rewards!"), done once HomebaseOnboardingAfterOutpost is. Its rewards are the Founders
// Banners: Standard pack and 7 FoundersPackDailyRewardToken, which open the founder's daily reward schedule
// (DailyFoundersRewards): an Upgrade Llama a day with the Founder's Llama (CardPack_Event_Founders) on every seventh,
// granted by ClaimLoginReward as a "Schedule" pack the llama store opens. The higher editions' quests
// (GetRewards_1_2 … 4_5, each needing the one before) and their hero bundles add to it; Core gives the Standard Edition.
// Token:FoundersPack_1 ("FOUNDERS PACK 1") records the edition (🟡 inferred: nothing in the client reads it).
// Without the token the daily rewards panel shows the Founder's Llama under "FOUNDERS PACK REWARDS" with
// "BUY A FOUNDERS PACK FOR MORE DAILY REWARDS" (DailyRewardsMissingFoundersPack), which nobody could then get.
export const foundersMigration = "foundersPack";
export const foundersEdition = { token: "Token:founderspack_1", quest: "Quest:foundersquest_getrewards_0_1" };

export const foundersNeedSetUp = (profile) => !(profile.coreMigrations ?? []).includes(foundersMigration);

// Once per profile0: new accounts with their starting quests, older ones when they next load.
export function setUpFounders(session) {
  const { profile } = session.profile("profile0");
  if (!foundersNeedSetUp(profile)) return;
  for (const templateId of [foundersEdition.token, foundersEdition.quest]) {
    if (!findItem(profile, templateId)) grant(session, templateId, 1);
  }
  profile.coreMigrations = [...(profile.coreMigrations ?? []), foundersMigration];
}

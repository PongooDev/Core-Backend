import { getItem } from "../gamedata/items.js";
import { findItem } from "./items.js";
import { grant } from "./progress.js";
import { findQuestItem } from "./quests.js";

// The founder's pack (Core-Backend #31). Everyone who played this build bought one (it was paid early access), and
// Epic's services fulfilled it by granting the edition's founders quest: the Standard Edition's is
// FoundersQuest_GetRewards_0_1 ("Standard Edition Rewards!", "Thank you for being a Founder! Complete the Loot Llamas
// Store Tutorial to collect your rewards!"), done once HomebaseOnboardingAfterOutpost is. Its rewards are the Founders
// Banners: Standard pack and 7 FoundersPackDailyRewardToken, which open the founder's daily reward schedule
// (DailyFoundersRewards): an Upgrade Llama a day with the Founder's Llama (CardPack_Event_Founders) on every seventh,
// granted by ClaimLoginReward as a "Schedule" pack the llama store opens. The higher editions' quests
// (GetRewards_1_2 … 4_5, each needing the one before) and their hero bundles add to it; Core gives the Standard Edition,
// and the admin panel can raise an account's edition (Core-Backend #32, setFoundersEdition below).
// Token:FoundersPack_1 ("FOUNDERS PACK 1") records the edition (🟡 inferred: nothing in the client reads it).
// Without the token the daily rewards panel shows the Founder's Llama under "FOUNDERS PACK REWARDS" with
// "BUY A FOUNDERS PACK FOR MORE DAILY REWARDS" (DailyRewardsMissingFoundersPack), which nobody could then get.
export const foundersMigration = "foundersPack";

// The editions in the game's order: Token:FoundersPack_<n> and the quest FoundersQuest_GetRewards_<n-1>_<n>
// ("<name> Edition Rewards!"; the DA_FoundersPack_<from>_<to> upgrade offers' T-Founders-Tile-<name> tiles). Each quest
// needs the one before (HasCompletedQuest), so an edition's quests all complete with the store tutorial, one after
// another, and each gives only what its edition adds (21 / 14 / 42 / 42 more founder's daily reward tokens …).
// Limited adds one hero bundle of the player's choice (DA_FoundersPack_3_4 / _1_4: "Exclusive Legendary Heroes 2",
// "Exclusive Epic Weapon 1" = FoundersQuest_ChooseHeroBundle, a bundle being "Two Legendary <class> Heroes and one
// upgradeable <weapon>"); Ultimate the other three (DA_FoundersPack_4_5: 6 heroes, 3 weapons =
// FoundersQuest_HeroBundle_No<chosen class>), or all four for an account that never chose
// (FoundersQuest_HeroBundle_NoChoice). 🟡 Which hero-bundle quest Epic granted on which purchase is inferred from these
// counts; the tokens are given one per edition (🟡 nothing reads them).
export const foundersEditions = [
  { edition: 1, name: "Standard", token: "Token:founderspack_1", quest: "foundersquest_getrewards_0_1" },
  { edition: 2, name: "Deluxe", token: "Token:founderspack_2", quest: "foundersquest_getrewards_1_2" },
  { edition: 3, name: "Super Deluxe", token: "Token:founderspack_3", quest: "foundersquest_getrewards_2_3" },
  { edition: 4, name: "Limited", token: "Token:founderspack_4", quest: "foundersquest_getrewards_3_4" },
  { edition: 5, name: "Ultimate", token: "Token:founderspack_5", quest: "foundersquest_getrewards_4_5" }
];
export const foundersEdition = { token: foundersEditions[0].token, quest: `Quest:${foundersEditions[0].quest}` };
const limited = 4;
const ultimate = 5;
export const chooseHeroBundle = "foundersquest_chooseherobundle";
// FoundersQuest_ChooseHeroBundle's SelectableRewards, in order: CardPack_Founders_<class>_Bundle.
export const heroBundleClasses = ["constructor", "ninja", "outlander", "soldier"];
const allHeroBundles = "foundersquest_herobundle_nochoice";
const otherHeroBundles = (chosen) => `foundersquest_herobundle_no${chosen}`;

// From 1.7.2 Save the World is behind an access token, which came with the founder's pack: DefaultGame.ini's
// SubGameAccess gives Campaign LimitedAccess and Athena OpenAccess, and DefaultGameData's SubGameInfo names
// Token:CampaignAccess as Campaign's AccessToken. Without it the front end only offers "The Save The World PvE campaign
// is in paid Early Access" and its Learn More. Builds before 1.7.2 have no such item, so it is given wherever the
// requesting build has one (a build without it hides it as a foreign template).
export const campaignAccessToken = "Token:campaignaccess";
const campaignAccessMissing = (profile) => Boolean(getItem(campaignAccessToken)) && !findItem(profile, campaignAccessToken);

export const foundersNeedSetUp = (profile) => !(profile.coreMigrations ?? []).includes(foundersMigration) || campaignAccessMissing(profile);

// Once per profile0: new accounts with their starting quests, older ones when they next load.
export function setUpFounders(session) {
  const { profile } = session.profile("profile0");
  if (campaignAccessMissing(profile)) grant(session, campaignAccessToken, 1);
  if ((profile.coreMigrations ?? []).includes(foundersMigration)) return;
  for (const templateId of [foundersEdition.token, foundersEdition.quest]) {
    if (!findItem(profile, templateId)) grant(session, templateId, 1);
  }
  profile.coreMigrations = [...(profile.coreMigrations ?? []), foundersMigration];
}

// The highest edition whose token the account holds (0 for none).
export function foundersEditionOf(profile) {
  return Math.max(0, ...foundersEditions.filter(({ token }) => findItem(profile, token)).map(({ edition }) => edition));
}

// ClaimQuestReward of the Limited hero bundle: the class chosen, which decides Ultimate's bundles. Kept on the saved
// profile only (coreFounders; the client is never sent it).
export function noteHeroBundleChoice(profile, selectedIndex) {
  const chosen = heroBundleClasses[selectedIndex];
  if (chosen) profile.coreFounders = { ...profile.coreFounders, heroBundle: chosen };
}

// The class chosen in a claimed FoundersQuest_ChooseHeroBundle: as noted at the claim, else the one bundle still
// unopened in the account.
function chosenHeroBundle(profile) {
  if (profile.coreFounders?.heroBundle) return profile.coreFounders.heroBundle;
  const unopened = heroBundleClasses.filter((chosen) => findItem(profile, `CardPack:cardpack_founders_${chosen}_bundle`));
  return unopened.length === 1 ? unopened[0] : null;
}

// Raises the account's edition to `edition` (1-5): every edition in between gets its token and its rewards quest, Limited
// its hero bundle choice and Ultimate the remaining bundles, all granted as the game's quests are (they complete with
// the store tutorial and the player claims them). Nothing the account has is taken away, so an edition can't be lowered.
// Returns { error } without changing anything, or { granted: [templateIds] }.
export function setFoundersEdition(session, edition) {
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  const target = foundersEditions.find((entry) => entry.edition === edition);
  if (!target) return { error: `The edition must be one of ${foundersEditions.map(({ edition: n, name }) => `${n} (${name})`).join(", ")}` };
  const current = foundersEditionOf(profile);
  if (edition < current) {
    return { error: `The account already has the ${foundersEditions[current - 1].name} Edition; an edition can't be lowered (what it gave stays)` };
  }

  // Ultimate's bundles follow the Limited choice: the other three once one was chosen, all four before.
  let bundles = null;
  let unclaimedChoice = null;
  if (edition === ultimate && current < ultimate) {
    const chooseId = findQuestItem(profile, chooseHeroBundle);
    if (chooseId && profile.items[chooseId].attributes.quest_state === "Claimed") {
      const chosen = chosenHeroBundle(profile);
      if (!chosen) {
        return { error: "The Limited Edition's hero bundle was claimed, but Core can't tell which class was chosen; open or remove its bundle first" };
      }
      bundles = otherHeroBundles(chosen);
    } else {
      // Not chosen yet: the four bundles replace the choice, which gave nothing so far.
      bundles = allHeroBundles;
      unclaimedChoice = chooseId ?? null;
    }
  }

  const granted = [];
  const give = (templateId) => {
    grant(session, templateId, 1);
    granted.push(templateId);
  };
  for (const step of foundersEditions.slice(current, edition)) {
    if (!findItem(profile, step.token)) give(step.token);
    if (!findQuestItem(profile, step.quest)) give(`Quest:${step.quest}`);
  }
  if (edition === limited && current < limited && !findQuestItem(profile, chooseHeroBundle)) give(`Quest:${chooseHeroBundle}`);
  if (unclaimedChoice) tracker.removeItem(unclaimedChoice);
  if (bundles && !findQuestItem(profile, bundles)) give(`Quest:${bundles}`);
  return { granted };
}

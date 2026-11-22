import { currentBuild } from "../builds/context.js";
import { McpError } from "../errors.js";
import { slotUnlockNode } from "../gamedata/homebase.js";
import { getItem } from "../gamedata/items.js";
import { getQuest } from "../gamedata/quests.js";
import { log } from "../log.js";
import { ownsNode } from "./homebase.js";
import { grant } from "./progress.js";
import { questIdOf } from "./quests.js";
import { inOverflow } from "./vault.js";

// 8.00's (CL-5203069, Content Update v8.00) Hero Loadout: Save the World's Command screen shows the active loadout's
// commander, and the hero the player takes into a mission is that loadout's (8.00 has no
// AFortPlayerController::TrySetHeroImplementation; its own loadout code applies heroes, CoreV2 0beacfbe). 7.30 and 7.40
// already have the commands and the item class but not the screen (UFortGlobals bEnableHeroLoadoutSystem, unset in
// their DefaultGame.ini), so the loadouts start on 8.00.
//
// What the 8.00 client reads (8.00 SDK, UFortMcpProfileCampaign / UFortCampaignHeroLoadoutItem):
// - the campaign stat selected_hero_loadout, the item id of the active loadout (GetCurrentHeroLoadoutItem; the stat's
//   name is in the exe beside the profile stat names, 0x4068462). Without it the Command screen's hero panel has no
//   loadout and shows its unfilled template ("{ItemName} {TagList}", Core-Backend #399);
// - CampaignHeroLoadout:defaultloadout items (Items/Loadouts/DefaultLoadout, a FortCampaignHeroLoadoutItemDefinition)
//   with loadout_name, loadout_index, crew_members (TMap<FString, FString>: a slot's name to the hero item id in it),
//   gadgets (TArray<FFilledGadgetSlot> {gadget, slot_index}) and team_perk (an item id).
// The slots are DefaultLoadout's CrewSlots: CommanderSlot (LoadoutSlot.Hero.Commander) and FollowerSlot1 to 5
// (LoadoutSlot.Hero.SupportHero, "Support Team"). Its SlotUnlockSquadName, Squad_Combat_NewHeroSquad, says which skill
// tree / quest reward node opens each: slot 0 StartNode_CommandCenter, slot N HomebaseNode QuestReward_NewFollowerN_Slot
// (8.00's homebasenodes squadSlots); its TeamPerkUnlockNode is QuestReward_TeamPerk_Slot1.
// 🟡 crew_members is written with the slots' names in lower case, as the client's FString keys compare without case.
export const heroLoadoutBuild = 5203069;
export const loadoutTemplateId = "CampaignHeroLoadout:defaultloadout";
const loadoutSquad = "Squad_Combat_NewHeroSquad";
const crewSlots = ["commanderslot", "followerslot1", "followerslot2", "followerslot3", "followerslot4", "followerslot5"];
const teamPerkNode = "QuestReward_TeamPerk_Slot1";
// 🟡 Two gadget slots, the Command screen's two (DefaultLoadout leaves GadgetSlotsAllowed at the class default).
const gadgetSlots = 2;
const migration = "heroLoadouts";

export const hasHeroLoadouts = () => Number(currentBuild()) >= heroLoadoutBuild;
const isLoadout = (item) => item?.templateId?.toLowerCase() === loadoutTemplateId.toLowerCase();
const loadouts = (profile) => Object.entries(profile.items).filter(([, item]) => isLoadout(item));
const isHeroItem = (item) => getItem(item?.templateId ?? "")?.class === "FortHeroType";
const refuse = (message) => { throw new McpError("errors.com.epicgames.fortnite.invalid_parameter", message); };

// A new loadout's attributes; index is its loadout_index (the order the loadout picker lists them in).
export function loadoutAttributes(index) {
  return {
    loadout_name: "",
    loadout_index: index,
    crew_members: Object.fromEntries(crewSlots.map((slot) => [slot, ""])),
    gadgets: Array.from({ length: gadgetSlots }, (_, slot) => ({ gadget: "", slot_index: slot })),
    team_perk: ""
  };
}

// The next loadout_index for a profile's loadouts (items/addItem gives a granted loadout this).
export const nextLoadoutIndex = (profile) => loadouts(profile).length;

// The loadouts 8.00's quests give (OutpostQuest_T2_L2, T2_L6, T3_L4 and StonewoodQuest_Filler_1_D3 reward one each) for
// the quests the account claimed before it played 8.00, which gave none then. Like the quest line's missed unlocks
// (profiles/questline.js, 6.30's Giftbox note), a quest the player is past gives its new unlocks.
function questLoadouts(profile) {
  let count = 0;
  for (const item of Object.values(profile.items)) {
    if (item.attributes?.quest_state !== "Claimed") continue;
    const quest = getQuest(questIdOf(item) ?? "");
    if (!quest) continue;
    count += [...(quest.rewards ?? []), ...(quest.hiddenRewards ?? [])]
      .filter(({ templateId }) => templateId.toLowerCase() === loadoutTemplateId.toLowerCase())
      .reduce((sum, { quantity }) => sum + (quantity ?? 1), 0);
  }
  return count;
}

// 🟡 Every account has one loadout to start with (the Command screen needs one, and nothing in 8.00's data grants a
// first one: the quests' four are "an extra loadout", DefaultLoadout's description), plus the ones its claimed quests name.
const wantedLoadouts = (profile) => 1 + questLoadouts(profile);
const selected = (profile) => profile.stats.attributes.selected_hero_loadout;

export function heroLoadoutsNeedSetUp(profile) {
  if (!hasHeroLoadouts()) return false;
  const held = loadouts(profile);
  return !(profile.coreMigrations ?? []).includes(migration) || held.length < wantedLoadouts(profile)
    || !held.some(([itemId]) => itemId === selected(profile));
}

// The hero the old squads screen led with (default_hero_squad_id's slot 0, Squad_Combat_AdventureSquadOne unless the
// account chose another), else any hero: the first loadout's commander.
function leadHero(profile) {
  const squad = (profile.stats.attributes.default_hero_squad_id || "Squad_Combat_AdventureSquadOne").toLowerCase();
  const heroes = Object.entries(profile.items).filter(([, item]) => isHeroItem(item) && !inOverflow(item));
  return (heroes.find(([, item]) => (item.attributes.squad_id ?? "").toLowerCase() === squad && item.attributes.squad_slot_idx === 0)
    ?? heroes[0])?.[0] ?? "";
}

export function setUpHeroLoadouts(session) {
  const tracker = session.profile("profile0");
  const { profile } = tracker;
  if (!hasHeroLoadouts()) return;
  const first = !(profile.coreMigrations ?? []).includes(migration) && !loadouts(profile).length;
  const missing = wantedLoadouts(profile) - loadouts(profile).length;
  if (missing > 0) grant(session, loadoutTemplateId, missing);
  const held = loadouts(profile);
  if (first && held.length) {
    const [firstId, item] = held.find(([, loadout]) => loadout.attributes.loadout_index === 0) ?? held[0];
    const commander = leadHero(profile);
    if (commander) tracker.setItemAttribute(firstId, "crew_members", { ...item.attributes.crew_members, commanderslot: commander });
  }
  if (!held.some(([itemId]) => itemId === selected(profile)) && held.length) {
    const [itemId] = held.reduce((low, entry) => (entry[1].attributes.loadout_index < low[1].attributes.loadout_index ? entry : low));
    tracker.setStat("selected_hero_loadout", itemId);
  }
  if (!(profile.coreMigrations ?? []).includes(migration)) {
    profile.coreMigrations = [...(profile.coreMigrations ?? []), migration];
    log("Profiles", `${session.accountId}: ${held.length} hero loadouts, ${selected(profile) ?? "none"} active`);
  }
}

// The commands' loadout: one of the account's CampaignHeroLoadout items.
function loadoutOf(tracker, loadoutId) {
  const item = tracker.profile.items[loadoutId];
  if (!isLoadout(item)) throw new McpError("errors.com.epicgames.fortnite.item_not_found", `No hero loadout ${loadoutId}`);
  return item;
}

function ownedNode(profile, nodeId, what) {
  if (!nodeId || !ownsNode(profile, nodeId)) refuse(`${what} is locked`);
}

// AssignHeroToLoadout {heroId, loadoutId, slotName}: heroId "" empties the slot. A hero sits in one slot of a loadout
// (moved from another), and may be in other loadouts too.
export function assignHeroToLoadout(tracker, { heroId = "", loadoutId, slotName }) {
  const loadout = loadoutOf(tracker, loadoutId);
  const slot = String(slotName ?? "").toLowerCase();
  const index = crewSlots.indexOf(slot);
  if (index < 0) refuse(`No loadout slot ${slotName}`);
  ownedNode(tracker.profile, slotUnlockNode(loadoutSquad, index), slotName);
  const crew = { ...Object.fromEntries(crewSlots.map((name) => [name, ""])), ...loadout.attributes.crew_members };
  if (heroId) {
    const hero = tracker.profile.items[heroId];
    if (!isHeroItem(hero)) throw new McpError("errors.com.epicgames.fortnite.item_not_found", `No hero ${heroId}`);
    if (inOverflow(hero)) refuse(`${hero.templateId} is in the vault overflow`);
    for (const name of crewSlots) if (crew[name] === heroId) crew[name] = "";
  }
  crew[slot] = heroId;
  tracker.setItemAttribute(loadoutId, "crew_members", crew);
}

// AssignGadgetToLoadout {gadgetId, loadoutId, slotIndex}: a gadget's template id ("Gadget:g_..."), "" to empty the slot.
export function assignGadgetToLoadout(tracker, { gadgetId = "", loadoutId, slotIndex }) {
  const loadout = loadoutOf(tracker, loadoutId);
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= gadgetSlots) refuse(`No gadget slot ${slotIndex}`);
  if (gadgetId && getItem(gadgetId)?.class !== "FortGadgetItemDefinition") refuse(`${gadgetId} isn't a gadget`);
  const gadgets = (Array.isArray(loadout.attributes.gadgets) ? loadout.attributes.gadgets : [])
    .filter((entry) => entry.slot_index !== slotIndex && (!gadgetId || entry.gadget.toLowerCase() !== gadgetId.toLowerCase()));
  for (let slot = 0; slot < gadgetSlots; slot++) {
    if (slot === slotIndex) gadgets.push({ gadget: gadgetId, slot_index: slot });
    else if (!gadgets.some((entry) => entry.slot_index === slot)) gadgets.push({ gadget: "", slot_index: slot });
  }
  tracker.setItemAttribute(loadoutId, "gadgets", gadgets.sort((a, b) => a.slot_index - b.slot_index));
}

// AssignTeamPerkToLoadout {teamPerkId, loadoutId}: a TeamPerk item of the account's, "" to empty the slot.
export function assignTeamPerkToLoadout(tracker, { teamPerkId = "", loadoutId }) {
  loadoutOf(tracker, loadoutId);
  ownedNode(tracker.profile, teamPerkNode, "The team perk slot");
  if (teamPerkId && !/^teamperk:/i.test(tracker.profile.items[teamPerkId]?.templateId ?? "")) {
    throw new McpError("errors.com.epicgames.fortnite.item_not_found", `No team perk ${teamPerkId}`);
  }
  tracker.setItemAttribute(loadoutId, "team_perk", teamPerkId);
}

export function setActiveHeroLoadout(tracker, { selectedLoadout }) {
  loadoutOf(tracker, selectedLoadout);
  if (selected(tracker.profile) !== selectedLoadout) tracker.setStat("selected_hero_loadout", selectedLoadout);
}

// ClearHeroLoadout {loadoutId}: its heroes, gadgets and team perk; its name and place stay.
export function clearHeroLoadout(tracker, { loadoutId }) {
  const { loadout_name: name, loadout_index: index } = loadoutOf(tracker, loadoutId).attributes;
  const empty = loadoutAttributes(index);
  for (const attribute of ["crew_members", "gadgets", "team_perk"]) tracker.setItemAttribute(loadoutId, attribute, empty[attribute]);
  if (name === undefined) tracker.setItemAttribute(loadoutId, "loadout_name", "");
}

// SetLoadoutName {loadoutName, loadoutId}. 🟡 No length rule is recorded; Core keeps 32 characters.
export function setLoadoutName(tracker, { loadoutName = "", loadoutId }) {
  loadoutOf(tracker, loadoutId);
  tracker.setItemAttribute(loadoutId, "loadout_name", String(loadoutName).slice(0, 32));
}

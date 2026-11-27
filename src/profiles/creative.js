import crypto from "node:crypto";
import { currentBuild } from "../builds/context.js";
import { releasedOn } from "../builds/detect.js";
import { McpError } from "../errors.js";
import { log } from "../log.js";
import { nextReplayOf, seasonMoment } from "../store/itemshop.js";
import { creativeProfileBuild } from "./ids.js";

// 7.00's (CL-4629139) Creative islands (PongooDev/CoreV2#471), UFortMcpProfileCreative's profile, creative.
//
// A player's islands are its CreativePlot items (EFortItemType::CreativePlot, UFortCreativeRealEstatePlotItem, whose MCP
// template's static profile type is "creative"): 7.00's paks have six FortCreativeRealEstatePlotItemDefinitions under
// /Game/Playgrounds/Items/Plots (the asset manager's "CreativePlot" primary asset type, DefaultGame.ini). Temperate_Medium is
// a player's island: "Island {islandIndex}", BasePlayset PID_Playset_60x60_Composed, 65 x 65, no InitialSaveFileName.
// Temperate_Small is a 30 x 30 test island (PID_Playset_30x30_1, InitialCreativeTestIsland30_2), and Featured_Temperate_Medium1
// to 4 ("Featured Island N", PID_Playset_60x60_Featured, InitialSaveFileName FeaturedIslandN.island, bNeverPersisted) the hub's
// featured islands, which are no player's item. The item's attributes are islandIndex (an int, the {islandIndex} of its
// name, so "Island 1" to "Island 4") and islandName (the client's item loader 0x1027140 reads both; 0x10135B0 formats the
// display name with islandIndex); its id is the island's file name on the DSS (services/dss/dss.js: 0xF475F0 formats
// "%s.island" from the item, 0xF476E0 "islands/personal/<owner>/<that>").
// Update v7.00: "Battle Pass owners will start with 4 islands to allow for different creations. On December 13, all players
// will receive 4 islands." and "Battle Pass owners will have early access to their own Creative island for one week, then
// all players will receive islands on December 13, 2018." So an account gets its four islands once it has Season 7's Battle
// Pass, or once Season 7's replay (store/itemshop.js seasonMoment, the item shop's clock: day 1 is 6 December 2018) has
// reached 13 December; they are never taken away (the replay starts the season over every 84 days, and a player keeps what
// they built). The same rule gates Creative's matchmaking (services/matchmaking/ticket.js).
//
// The profile's stats (names from 7.00's exe): creative_plot_permissions, FFortCreativePlotPermissionData {Permission
// (EFortCreativePlotPermission Private | Public), WhiteList (account ids)}, which UFortMcpProfileCreative reads from its
// stats into the struct (0x1132C70, JSON to UStruct, cached at +0x1D0 by the profile revision: 0x1144510, 0x11640D0), the
// island owner's choice of who may build on their island; and last_used_plot, the island the player last loaded (the
// string sits with the profile's other names; its reader was a server's, stripped from the client). Prefabs (Playset items,
// FortPlaysetItemDefinition, /Game/Playsets/PID_*) aren't the profile's: 7.00's Creative inventory lists them from its item
// list data table (UFortCreativeItemListPanelData's ItemListTable, FFortCreativeItemListData rows), so nobody needs them as
// items.
export const plotTemplateId = "CreativePlot:temperate_medium";
export const plotCount = 4;
export const allIslandsDay = Date.parse("2018-12-13T00:00:00Z");
const creativeSeason = 7;
const isPlot = (item) => String(item?.templateId ?? "").toLowerCase().startsWith("creativeplot:");

export const hasCreative = (build = currentBuild()) => Number(build) >= creativeProfileBuild;

// Whether the account has Season 7's Battle Pass: its athena profile's book_purchased in Season 7, or Season 7's record
// kept aside while it plays another season (profiles/seasons.js coreSeasons). Looked at without making an athena profile.
export function ownsCreativeBattlePass(session) {
  if (!session.hasProfile("athena")) return false;
  const { profile } = session.profile("athena");
  const { attributes } = profile.stats;
  if (attributes.season_num === creativeSeason && attributes.book_purchased === true) return true;
  return profile.coreSeasons?.[creativeSeason]?.book_purchased === true;
}

// Whether everyone has islands now: Season 7's replay is at or past 13 December 2018.
export const islandsForEveryone = (now = new Date()) => seasonMoment(now, null, creativeSeason).getTime() >= allIslandsDay;

// The admin panel's Creative early access switch (settings creativeEarlyAccess, Core-Backend #410): on (the default),
// a build Epic shipped during the early access week follows Epic's dates; off, it has no early access.
let earlyAccessSetting = () => true;
export function configureCreativeEarlyAccess(provider) {
  earlyAccessSetting = typeof provider === "function" ? provider : () => provider !== false;
}

// Whether the build had Update v7.00's early access (Core-Backend #410): only a build Epic released before 13 December
// 2018, which is 7.00 (6 December). 7.10 came out on 18 December, after everyone had islands, and Season 8 never had it,
// so their lobbies never show the notice (the client locks the tile by the calendar season's book_purchased, so a Season
// 8 player without Season 8's Battle Pass saw it while Season 7's replay was before 13 December).
const earlyAccessBuild = (build) => {
  const released = releasedOn(String(build));
  return hasCreative(build) && released !== null && released < allIslandsDay;
};

// Whether the build is in early access now: its own, the panel's switch on, and Season 7's replay before 13 December.
export const inCreativeEarlyAccess = (build = currentBuild(), now = new Date()) =>
  earlyAccessBuild(build) && earlyAccessSetting() !== false && !islandsForEveryone(now);

// Whether the account may have islands and play Creative now (Update v7.00's early access).
export const creativeEntitled = (session, now = new Date(), build = currentBuild()) =>
  ownsCreativeBattlePass(session) || !inCreativeEarlyAccess(build, now);

// The lobby's own early access notice (Core-Backend #379). 7.00's Creative server list (UFortCreativeServersView) shows its
// "Start a server" tile (CreativeServerOptionsTile, InitServerInfo) locked, its LimitedAccessServerContent ("Available on
// {Date}." and "Upgrade your Battle Pass to get early access now!") in place of CreateServerContent, while
// UFortGlobalUIContext::IsCreativeModeAccessLimited (exec 0x32784E0 -> 0x2F7BCE0) says so: UFortGlobals'
// bEnableCreativeModeLimitedAccess (+0x6E) is set, and the player's athena profile doesn't have book_purchased (0xC57AD0,
// the name from 0xD17B0) in the calendar's season (0xC59D60: its season_num against the calendar's SeasonNumber), nor, with
// bEnableCreativeModeLimitedAccessForFounders (+0x6F), their common_core Token:founderspack_1. The date is
// GetCreativeModeLimitedAccessEndTime (0x2F6BA10): UFortGlobals' CreativeModeLimitedAccessEndTime (+0x70), an FString read
// by FDateTime::ParseIso8601 (0x17B0080). All three are Config and none is set by 7.00's shipped DefaultGame.ini: Epic's
// hotfix turned them on. So the lobby hotfix (services/fortnite/cloudstorage.js) gives 7.00 on the three while Season 7's
// replay is before 13 December: limited access on, founders not let in (Update v7.00 names Battle Pass owners only), and the
// end time the moment the replay reaches 13 December on the host's clock (the replay's own date is 2018's; the tile shows
// when it opens here). From 13 December, on builds Epic shipped after it (7.10 and Season 8) and with the admin panel's
// switch off it turns limited access off (inCreativeEarlyAccess). The client asks for the hotfix at start-up and again on
// coming back to the lobby and before matchmaking, so the tile opens on the next of those. The matchmaking refusal stays
// behind it (services/matchmaking/ticket.js).
export function creativeAccessGlobals(build, now = new Date()) {
  if (!hasCreative(build)) return [];
  if (!inCreativeEarlyAccess(build, now)) return ["bEnableCreativeModeLimitedAccess=false"];
  const opens = nextReplayOf(allIslandsDay, now, null, creativeSeason);
  return ["bEnableCreativeModeLimitedAccess=true", "bEnableCreativeModeLimitedAccessForFounders=false",
    `CreativeModeLimitedAccessEndTime=${opens.toISOString()}`];
}

// Early access goes by the party's leader (Core-Backend #375). Update v7.00 gave Battle Pass owners "early access to their
// own Creative island", and Epic let players without the pass play on an owner's server: a party's Creative match is its
// leader's, so its other players may follow a leader who may play. 7.00's client asks for a ticket per player, its leader's
// first (the leader's client starts matchmaking and the others' follow it), each naming the whole party (partyPlayerIds);
// nothing in a ticket says who leads. So the first Creative ticket of a party is its leader's: when that player may play,
// the party's other players' tickets that come within `followMs` pass as their guests. A new round starts when the window
// has passed or the same leader asks again; a party whose first ticket was refused lets nobody in as a guest.
export function creativePartyHosts({ followMs = 60_000, now = () => Date.now() } = {}) {
  const rounds = new Map();
  const keyOf = (party) => [...new Set(party)].sort().join(",");
  return {
    // The leader a guest follows (their account id), or null; `entitled` is whether accountId may play themself.
    ticket(accountId, party, entitled) {
      const at = now();
      for (const [key, round] of rounds) if (at - round.at > followMs) rounds.delete(key);
      if (party.length < 2 || !party.includes(accountId)) return null;
      const key = keyOf(party);
      const round = rounds.get(key);
      // A refused first ticket gives way to a player who may play: should a member's ticket ever come before their
      // leader's, the leader's still opens the round. (A leader without the pass can't start Creative from 7.00's lobby:
      // its "Start a server" tile is locked for them, Core-Backend #379.)
      if (!round || round.leader === accountId || (entitled && !round.entitled)) {
        rounds.set(key, { leader: accountId, entitled, at });
        return null;
      }
      return round.entitled ? round.leader : null;
    }
  };
}

// Season 7's replay date now ("YYYY-MM-DD"), and how many days are left until 13 December 2018 on it (0 once there).
export const creativeReplayDay = (now = new Date()) => seasonMoment(now, null, creativeSeason).toISOString().slice(0, 10);
export const daysUntilIslandsForEveryone = (now = new Date()) =>
  Math.max(0, Math.ceil((allIslandsDay - seasonMoment(now, null, creativeSeason).getTime()) / 86_400_000));

// The early access refusal (Core-Backend #375): what the player was refused for and how they get in. 7.00's client has no
// text of its own for a refused ticket but its "Weird. We couldn't connect to the match.", so this is the backend console's
// and the error's message.
export function earlyAccessMessage(now = new Date()) {
  const days = daysUntilIslandsForEveryone(now);
  return `Creative is in early access for Season 7 Battle Pass owners until 13 December 2018 (Update v7.00), and Season 7's ` +
    `replay is on ${creativeReplayDay(now)}, ${days} day${days === 1 ? "" : "s"} before it. Buy the Season 7 Battle Pass in the ` +
    "lobby's Battle Pass tab, play in a party whose leader has it, or wait until the replay reaches 13 December; a host " +
    "can move it there with the admin panel's " +
    "Season 7 events page, Season start (day 1), set at least 7 days back, or turn off Creative early access on its Creative page";
}

export const plotsOf = (profile) => Object.entries(profile.items).filter(([, item]) => isPlot(item));

// 7.10's (CL-4667333) islands: Update v7.10's "A cold front brings in 4 new Winter themed Islands you can select from the
// player Rift on the starter island" and "Players now have 2 total 'The Block' Islands instead of 1" (Update v7.01's "The
// Block: New 5th Island to build on"). 7.10's paks add two plot definitions under /Game/Playgrounds/Items/Plots:
// Arctic_Medium ("Arctic Island {islandIndex}", BasePlayset PID_Playset_60x60_Composed_Arctic, 65 x 65) and
// TheBlock_Season7 ("The Block {islandIndex}", PID_Temp_Island_Flat_60x60_001, 65 x 65, SortIndex 3; Temperate_Medium's is
// 1). So a 7.10 request gives an entitled account four Arctic islands and two Blocks beside its four islands, numbered
// each from 1. 7.00's data has neither definition, so a 7.00 request gives only the four, and a 7.00 client isn't sent the
// six an account got on 7.10 (gamedata/templates.js, as any template its data lacks); they wait for a 7.10 client.
const arcticPlotTemplateId = "CreativePlot:arctic_medium";
const blockPlotTemplateId = "CreativePlot:theblock_season7";
const plotSetsBuild = 4667333;
// 7.20's (CL-4727874) Frosty Fortress: Update v7.20's "A brand new arctic island debuts in Creative ... A new selectable
// arctic island with structures already placed on it. This island is ready for games to be played right away!" 7.20's
// paks add Arctic_Competitive_Medium1 ("Frosty Fortress {islandIndex}", BasePlayset
// PID_Playset_60x60_Composed_Arctic_Competitive, 65 x 65). So a 7.20 request gives an entitled account one beside the
// others (🟡 how many Epic gave isn't in the notes: one, as the definition's own number says), and an earlier client isn't
// sent it.
const frostyFortressPlotTemplateId = "CreativePlot:arctic_competitive_medium1";
const frostyFortressBuild = 4727874;
// Season 8's islands (PongooDev/CoreV2#645), each a FortCreativeRealEstatePlotItemDefinition under
// /Game/Playgrounds/Items/Plots in 8.30's and 8.51's paks. Update v8.10's "New Islands: Sandbar Island ... Volcano Island":
// Sandbar_Large ("Sandbar Island {islandIndex}", PID_Playset_105x105_Composed_Sandbar, 105 x 105) and Volcano_Large
// ("Volcano Island {islandIndex}", PID_Playset_60x60_Composed_Volcano, 65 x 65); Content Update v8.11's "Black Glass Island":
// BlackGlass_Medium (PID_Playset_60x60_Composed_BlackGlass, 65 x 65). No 8.10 or 8.11 build is supported, so they come from
// 8.20 (CL-5625478), the first after 8.00 (whose notes add no island). Update v8.30's "Added new Tropical Island" and
// "Added new Rivers Edge Island ... using the new Military set": Tropical_Medium (PID_Playset_60x60_Composed_Tropical) and
// Military_Medium ("Rivers Edge Island {islandIndex}", PID_Playset_60x60_Composed_Military), from 8.30 (CL-5793395).
// Razor_Medium (PID_Playset_60x60_Composed_Razor) is in 8.30's paks too but was never released: no patch note adds it, its
// DisplayName is still Arctic Island's, and Update v10.10's list of the islands available doesn't name it; so no account
// gets one. 🟡 How many of each Epic gave isn't in the notes: one, as for the Frosty Fortress.
const sandbarPlotTemplateId = "CreativePlot:sandbar_large";
const volcanoPlotTemplateId = "CreativePlot:volcano_large";
const blackGlassPlotTemplateId = "CreativePlot:blackglass_medium";
const season8IslandsBuild = 5625478;
const tropicalPlotTemplateId = "CreativePlot:tropical_medium";
const riversEdgePlotTemplateId = "CreativePlot:military_medium";
const tropicalIslandsBuild = 5793395;
// Update v9.00's "Added Meadow Island - a 105x105 tiles flat, grass island": FlatGrass_Large ("Meadow Island {islandIndex}",
// PID_Playset_105x105_Composed_FlatGrass, 105 x 105), new in 9.00's (CL-6337466) paks; 9.01's and 9.10's add no other plot.
// One, as for Season 8's.
const meadowPlotTemplateId = "CreativePlot:flatgrass_large";
const meadowIslandBuild = 6337466;
// Update v9.20's "New Canyon Island: A desert themed canyon with a river cutting through": Desert_Large ("Canyon Island",
// PID_Playset_105x105_Composed_Desert, 105 x 105, bIsAvailableToUsers), new in 9.20's (CL-6822798) paks. One, as for
// Meadow. 9.20's paks also add Loki_Large ("Prop Hunt Farm"), which no update note names: not given.
const canyonPlotTemplateId = "CreativePlot:desert_large";
const canyonIslandBuild = 6822798;
// A player's island types: the plot definition, how many of it an account gets (the island limit of that type), the first
// build that has it, and its display name without the {islandIndex} (the definitions' own names, above).
export const playerPlotTypes = [
  { templateId: plotTemplateId, count: plotCount, firstBuild: creativeProfileBuild, name: "Island" },
  { templateId: arcticPlotTemplateId, count: 4, firstBuild: plotSetsBuild, name: "Arctic Island" },
  { templateId: blockPlotTemplateId, count: 2, firstBuild: plotSetsBuild, name: "The Block" },
  { templateId: frostyFortressPlotTemplateId, count: 1, firstBuild: frostyFortressBuild, name: "Frosty Fortress" },
  { templateId: sandbarPlotTemplateId, count: 1, firstBuild: season8IslandsBuild, name: "Sandbar Island" },
  { templateId: volcanoPlotTemplateId, count: 1, firstBuild: season8IslandsBuild, name: "Volcano Island" },
  { templateId: blackGlassPlotTemplateId, count: 1, firstBuild: season8IslandsBuild, name: "Black Glass Island" },
  { templateId: tropicalPlotTemplateId, count: 1, firstBuild: tropicalIslandsBuild, name: "Tropical Island" },
  { templateId: riversEdgePlotTemplateId, count: 1, firstBuild: tropicalIslandsBuild, name: "Rivers Edge Island" },
  { templateId: meadowPlotTemplateId, count: 1, firstBuild: meadowIslandBuild, name: "Meadow Island" },
  { templateId: canyonPlotTemplateId, count: 1, firstBuild: canyonIslandBuild, name: "Canyon Island" }
];
// The island type of a plot template id (any case), or null.
export const playerPlotType = (templateId) => playerPlotTypes.find((type) => type.templateId.toLowerCase() === String(templateId ?? "").toLowerCase()) ?? null;
const plotSets = (build = currentBuild()) => playerPlotTypes.filter((type) => type.templateId === plotTemplateId || Number(build) >= type.firstBuild);

// The account's islands, once it is entitled, on 7.00 and later: four, from 7.10 four Arctic islands and two Blocks, from
// 7.20 a Frosty Fortress, from 8.20 a Sandbar, a Volcano and a Black Glass island, from 8.30 a Tropical and a Rivers Edge
// island, from 9.00 a Meadow island, and from 9.20 a Canyon island.
// Returns how many were given.
export function settleCreativePlots(session, now = new Date()) {
  if (!hasCreative() || !creativeEntitled(session, now)) return 0;
  const tracker = session.profile("creative");
  let given = 0;
  for (const { templateId, count } of plotSets()) {
    const have = plotsOf(tracker.profile).filter(([, item]) => String(item.templateId).toLowerCase() === templateId.toLowerCase());
    const used = new Set(have.map(([, item]) => item.attributes?.islandIndex));
    let added = 0;
    for (let index = 1; have.length + added < count && index <= count * 2; index++) {
      if (used.has(index)) continue;
      tracker.addItem(crypto.randomUUID(), { templateId, attributes: { islandIndex: index, islandName: "", item_seen: false }, quantity: 1 });
      added++;
    }
    given += added;
  }
  if (given) log("Creative", `${session.accountId}: ${given} Creative island${given === 1 ? "" : "s"} given (${ownsCreativeBattlePass(session) ? "Season 7 Battle Pass" : "no early access now"})`);
  return given;
}

// The plot item of the account's creative profile with that id, or null.
export function plotItem(profile, plotItemId) {
  const item = profile.items[String(plotItemId ?? "")];
  return isPlot(item) ? item : null;
}

const plotNotFound = (plotItemId) => new McpError("errors.com.epicgames.fortnite.item_not_found", `Item ${plotItemId} not found`, [String(plotItemId)]);

// SetLastUsedCreativePlot {plotItemId} (dedicated server; 7.00's sender sub_C65E80 through its wrapper 0x15B6A40): the
// island the player last loaded.
export function setLastUsedPlot({ req, tracker }) {
  const plotItemId = String(req.body?.plotItemId ?? "");
  if (!plotItem(tracker.profile, plotItemId)) throw plotNotFound(plotItemId);
  if (tracker.profile.stats.attributes.last_used_plot !== plotItemId) tracker.setStat("last_used_plot", plotItemId);
}

// ModifyCreativePlotPermissions {permission, accountIds} (dedicated server; sub_C97DA0 through 0x15B5410): who may build on
// the owner's island. The request's EFortCreativePlotPermission comes as its name ("Private", "Public") or its value
// (0, 1); the stat keeps the struct's own field names, as JSON to UStruct reads them (case-insensitively).
const permissionNames = ["Private", "Public"];
const accountIdPattern = /^[0-9a-f]{32}$/i;
const maxWhiteList = 100;
export function permissionOf(value) {
  if (typeof value === "number") return permissionNames[value] ?? null;
  const name = String(value ?? "").replace(/^EFortCreativePlotPermission::/, "");
  return permissionNames.find((known) => known.toLowerCase() === name.toLowerCase()) ?? null;
}
export function modifyPlotPermissions({ req, tracker }) {
  const permission = permissionOf(req.body?.permission);
  if (!permission) {
    throw new McpError("errors.com.epicgames.validation.validation_failed", `Invalid permission ${JSON.stringify(req.body?.permission ?? null)}`);
  }
  const given = Array.isArray(req.body?.accountIds) ? req.body.accountIds : [];
  const whiteList = [...new Set(given.map(String).filter((id) => accountIdPattern.test(id)))].slice(0, maxWhiteList);
  tracker.setStat("creative_plot_permissions", { permission, whiteList });
}
// SetCreativePlotMetadata {plotItemId, locale, title, tagline, youtubeVideoId, introduction} (dedicated server; 7.40,
// CL-5046157: the island menu's Description tab, through AFortPlayerControllerAthena::UpdateCreativePlotData, whose body
// Core's gameserver restores; PongooDev/CoreV2#545): the island's description, in the plot item's attributes the client's
// item loader (0x118B0A0) reads into IslandInfoLocale, IslandTitle, IslandTagline, YoutubeVideoId and IslandIntroduction.
// The game's _Validate (0xDB4340) has checked the lengths the player sent (a title of 3 to 40, an introduction up to
// 1024, a locale up to 10), which are the limits here; the tagline and video are the plot's own, which the server sends
// back unchanged.
const metadataLimits = { locale: [0, 10], title: [3, 40], tagline: [0, 1024], youtubeVideoId: [0, 64], introduction: [0, 1024] };
const metadataAttributes = { locale: "locale", title: "title", tagline: "tagline", youtubeVideoId: "youtube_video_id", introduction: "introduction" };
export function setPlotMetadata({ req, tracker }) {
  const plotItemId = String(req.body?.plotItemId ?? "");
  const plot = plotItem(tracker.profile, plotItemId);
  if (!plot) throw plotNotFound(plotItemId);
  const values = {};
  for (const [field, [min, max]] of Object.entries(metadataLimits)) {
    const value = String(req.body?.[field] ?? "");
    if (value.length < min || value.length > max) {
      throw new McpError("errors.com.epicgames.validation.validation_failed", `${field} is ${min} to ${max} characters`, [field]);
    }
    values[metadataAttributes[field]] = value;
  }
  for (const [attribute, value] of Object.entries(values)) {
    if (plot.attributes?.[attribute] !== value) tracker.setItemAttribute(plotItemId, attribute, value);
  }
}
// The profile's third command, SetCreativePlotIslandName {plotItemId, islandName} (client), has no sender in 7.00 (only its
// FName's initialiser references it: services/mcp/commands/index.js), so it stays unknown and islandName stays "".

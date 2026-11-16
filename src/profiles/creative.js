import crypto from "node:crypto";
import { currentBuild } from "../builds/context.js";
import { McpError } from "../errors.js";
import { log } from "../log.js";
import { seasonMoment } from "../store/itemshop.js";
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

// Whether the account may have islands and play Creative now (Update v7.00's early access).
export const creativeEntitled = (session, now = new Date()) => ownsCreativeBattlePass(session) || islandsForEveryone(now);

export const plotsOf = (profile) => Object.entries(profile.items).filter(([, item]) => isPlot(item));

// The account's four islands, once it is entitled, on 7.00 and later. Returns how many were given.
export function settleCreativePlots(session, now = new Date()) {
  if (!hasCreative() || !creativeEntitled(session, now)) return 0;
  const tracker = session.profile("creative");
  const have = plotsOf(tracker.profile);
  const used = new Set(have.map(([, item]) => item.attributes?.islandIndex));
  let given = 0;
  for (let index = 1; have.length + given < plotCount && index <= plotCount * 2; index++) {
    if (used.has(index)) continue;
    tracker.addItem(crypto.randomUUID(), { templateId: plotTemplateId, attributes: { islandIndex: index, islandName: "", item_seen: false }, quantity: 1 });
    given++;
  }
  if (given) log("Creative", `${session.accountId}: ${given} Creative island${given === 1 ? "" : "s"} given (${ownsCreativeBattlePass(session) ? "Season 7 Battle Pass" : "13 December 2018 on Season 7's replay"})`);
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
// The profile's third command, SetCreativePlotIslandName {plotItemId, islandName} (client), has no sender in 7.00 (only its
// FName's initialiser references it: services/mcp/commands/index.js), so it stays unknown and islandName stays "".

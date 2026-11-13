import { inIpRanges, ipRanges } from "../network.js";

// Matchmaking regions (Core-Backend #121). Addresses are 1.9's (CL-3757339) unless another build is named.
//
// Both sides name their region with UQosRegionManager::GetRegionId (0x3C07430): its ForceRegionId when set, else the
// selected QoS region, else "NONE". It is the region field of Battle Royale's buckets (the player's bucketId, the
// server's bucket patterns) and the sessions' REGION_s, which the Save the World client's matchMakingRequest asks for.
//
// A gameserver forces its region with -McpRegion=: the constructor (0x3C03930; 1.8.2 0x3BD4840, 1.9.1 0x3C26220) reads
// it with FParse::Value as typed, so -McpRegion=eu registers "<netcl>:0:eu:*" and REGION_s "eu". The launcher passes
// -McpRegion=NA unless its Servers region says otherwise.
//
// A player picks theirs in the settings' Matchmaking Region (UFortGameOptions::GetRegionDisplayNames 0x2F49D30, from
// GetRegionOptions filtered at 0x2F4E460): the enabled, visible regions of [/Script/Qos.QosRegionManager] in the pak's
// DefaultEngine.ini, shown "{RegionDisplayName} ({RegionPing}ms)" only when the region's pings came back. Nothing in the
// list comes from the backend. The lists, from the paks (Core-Backend #123):
// - 1.8.2: NA, EU and OCE.
// - 1.9 to 2.5 (CL-3757339 to CL-3889387; 2.4.2's and 2.5's paks read, identical): Datacenters NA ("North America"), EU,
//   OCE, BR and ASIA, and the hidden (bVisible=false) Test01, Test02, OH and GB.
// - 3.0 to 5.21 (CL-3901517 to CL-4288479; 3.0's, 3.1's, 3.2's, 3.3's and 3.5's paks read, identical): NA is split into
//   NAE ("NA-East") and NAW ("NA-West"); Datacenters NAE, NAW, EU, OCE, BR and ASIA, and the hidden OH, GB, Testtj,
//   Testsa, Testou, Testpf and Testdi. 3.6 to 5.21 still have the Datacenters array (their executables), the region ids
//   of 3.5's and 5.30's lists.
// - 5.30 to 6.21 (CL-4305896 on; 6.02's, 6.20's and 6.21's paks read, identical): RegionDefinitions NAE, NAW, EU, OCE, BR
//   and ASIA, and the hidden UND (Undefined), with their DatacenterDefinitions (VA and OH for NAE, NCAL and OR for NAW,
//   DE, GB, IE and FR for EU, SYD, SAO, TOK and SEA, and Google's tg_* under UND) apart.
// RegionChanged (0x2F6B3B0) keeps the choice in FortClientSettingsRecord's SelectedRegionId (the saved ClientSettings),
// which the client applies with SetSelectedRegion (0x3C0AAC0, from 0x568380): that upper-cases it and takes any enabled,
// visible region, pinged or not. Until a player picks one, TrySetDefaultRegion (0x3C0B3D0; 1.8.2 0x3BDC3F0, 1.9.1
// 0x3C2DE10) takes the visible, non-beta region with the lowest average ping. From 2.5 the list ends with Auto
// (qos.js), which saves SelectedRegionId "NONE" and so keeps that lowest-ping region. Epic's ping servers (UDP 22222) no
// longer answer, so every region averages 9999 ("Region[NA]: qos unreachable" in the client's log) and the first in the
// list wins: an untouched client queues NA up to 2.5 and NAE from 3.0, unless the admin panel's ping servers answer for
// Core's regions (qos.js).
//
// North America (Core-Backend #123): NA is 1.1's to 2.5's region and the group of NAE and NAW, which 3.0's and later
// clients pick between. A server started with -McpRegion=NA (the launcher's default) takes NA's, NAE's and NAW's
// players; an NAE server takes NAE's and NA's (an old build's player, who can't pick East or West), never NAW's, and NAW
// the other way round. The admin panel's NA ticks keep the meaning they had when NAE and NAW were spellings of NA: NA as
// a server region is all of North America, NA's server limits count every North American server (NAE's and NAW's
// count against their own too), and NA's hosting IPs may host NAE and NAW as well.

// The admin panel's regions, in its order (the launcher's servers take the first ticked server region).
export const serverRegionCodes = ["NA", "NAE", "NAW", "EU", "OCE", "BR", "ASIA"];
export const regionLabels = {
  NA: "North America (NA)", NAE: "NA-East (NAE)", NAW: "NA-West (NAW)", EU: "Europe (EU)", OCE: "Oceania (OCE)", BR: "Brazil (BR)", ASIA: "Asia (ASIA)"
};

// Each region's other spellings. The hidden regions go where their ping servers are: OH (Ohio) is NAE's datacenter on
// 5.30, GB (London) EU's; Test01 and Test02 ping Seoul and Singapore (AWS ap-northeast-2, ap-southeast-1), 3.0's Testtj
// and Testsa Tokyo and Singapore, Testou Oregon (NAW's on 5.30), Testpf Paris and Testdi Dublin (EU's). NAC is 21.40's
// NA-Central, which none of Core's builds has: North America as a whole.
const aliases = {
  NA: ["NAC", "US", "NORTHAMERICA"],
  NAE: ["OH", "USE"],
  NAW: ["USW", "TESTOU"],
  EU: ["GB", "UK", "EUROPE", "TESTPF", "TESTDI"],
  OCE: ["OC", "AU", "OCEANIA"],
  BR: ["BRAZIL", "SA"],
  ASIA: ["AS", "TEST01", "TEST02", "TESTTJ", "TESTSA", "JP", "KR", "SG"]
};
const canonical = new Map(Object.entries(aliases).flatMap(([region, names]) => [[region, region], ...names.map((name) => [name, region])]));
// The regions a group is made of.
const groupParts = { NA: ["NAE", "NAW"] };
const groupOf = new Map(Object.entries(groupParts).flatMap(([group, parts]) => parts.map((part) => [part, group])));

// Every region code Core knows, each region's own and its other spellings.
export const regionCodes = () => [...canonical.keys()];

// "NONE" is what GetRegionId answers without a region (a server started without -McpRegion, or a client whose QoS
// found no region at all); 21.40 calls its hidden catch-all region UND (Undefined).
const noRegion = new Set(["", "NONE", "UND"]);

// A region's canonical code ("nae" -> "NAE", "oh" -> "NAE"), any code Core doesn't know upper-cased as it is, or null for
// no region.
export function regionOf(code) {
  const name = String(code ?? "").trim().toUpperCase();
  if (noRegion.has(name)) return null;
  return canonical.get(name) ?? name;
}

// For logs: "EU", or "no region".
export const regionName = (region) => region ?? "no region";

// The group a region is part of ("NAE" -> "NA"), or null.
export const regionGroup = (region) => groupOf.get(regionOf(region)) ?? null;

// A region and the regions it is made of: NA's are NA, NAE and NAW; any other region is only itself.
export function regionMembers(region) {
  const own = regionOf(region);
  return own === null ? [] : [own, ...(groupParts[own] ?? [])];
}

// Whether a player of one region plays on a server of the other: the same region, or a group and one of its parts
// (NA and NAE, NA and NAW), never two parts of a group (NAE and NAW).
export function regionsOverlap(a, b) {
  const first = regionOf(a);
  const second = regionOf(b);
  if (first === null || second === null) return first === second;
  return first === second || groupOf.get(first) === second || groupOf.get(second) === first;
}

// The regions whose players a server of the region takes by itself: NA's, NAE's and NAW's for NA, NAE's and NA's for NAE.
function overlapping(region) {
  const group = groupOf.get(region);
  return group ? [region, group] : [region, ...(groupParts[region] ?? [])];
}

// The admin panel's server regions (Core-Backend #142): the regions Core's servers host for, canonical and each once,
// from a list or one region's code (as the setting was first named), [] for none, or undefined for neither. Only the
// regions the admin panel offers count.
export function regionList(value) {
  if (typeof value !== "string" && !Array.isArray(value)) return undefined;
  const regions = (Array.isArray(value) ? value : [value]).map((code) => (typeof code === "string" ? regionOf(code) : null));
  return [...new Set(regions.filter((region) => Object.hasOwn(aliases, region ?? "")))];
}

// The regions a server takes players from (Core-Backend #142, #123): its own region's (with NA's group, above), and
// with its own region, or the group it is part of, among the server regions, every one of theirs too. A server still
// registers one region (its -McpRegion) and plays each match in it.
export function servedRegions(region, selected) {
  const own = regionOf(region);
  if (own === null) return new Set([null]);
  const regions = regionList(selected) ?? [];
  const among = regions.some((code) => code === own || code === groupOf.get(own));
  return new Set([...overlapping(own), ...(among ? regions.flatMap(overlapping) : [])]);
}

// Each region's hosting IPs (Core-Backend #227): the IPs and CIDR ranges a gameserver hosting for the region must come
// from, so an EU server can't run on an NA IP and the other way round. A region with none takes servers from any IP.
// The setting kept from a saved or sent one: { NA: ["203.0.113.0/24"], ... }, canonical regions only, each with its
// ranges (network.js ipRanges); undefined when it isn't an object.
export function regionHostingIps(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const kept = {};
  for (const [code, list] of Object.entries(value)) {
    const region = regionOf(code);
    const ranges = ipRanges(list);
    if (!Object.hasOwn(aliases, region ?? "") || !ranges?.length) continue;
    kept[region] = ipRanges([...(kept[region] ?? []), ...ranges]);
  }
  return kept;
}

// Whether a gameserver at this address may host for the region (any spelling): yes for a region with no hosting IPs
// listed, and for no region at all ("NONE"), else only from a listed IP or range. NAE's and NAW's servers may also come
// from NA's (North America's) IPs (Core-Backend #123): with NA's listed and NAE's not, NAE's servers come from NA's.
export function regionAllowsAddress(region, address, hostingIps = {}) {
  const own = regionOf(region);
  if (own === null) return true;
  const lists = [own, groupOf.get(own)].map((code) => (code ? hostingIps?.[code] : null)).filter((list) => Array.isArray(list) && list.length > 0);
  return lists.length === 0 || lists.some((list) => inIpRanges(address, list));
}

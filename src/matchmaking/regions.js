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
// GetRegionOptions filtered at 0x2F4E460): the enabled, visible entries of [/Script/Qos.QosRegionManager] Datacenters
// in the pak's DefaultEngine.ini, shown "{RegionDisplayName} ({RegionPing}ms)" only when the region's pings came back.
// 1.8.2 lists NA, EU and OCE; 1.9 and 1.9.1 add BR and ASIA, and hide Test01, Test02, OH and GB (bVisible=false). There
// is no Auto entry, and nothing in the list comes from the backend. RegionChanged (0x2F6B3B0) keeps the choice in
// FortClientSettingsRecord's SelectedRegionId (the saved ClientSettings), which the client applies with
// SetSelectedRegion (0x3C0AAC0, from 0x568380): that upper-cases it and takes any enabled, visible region, pinged or
// not. Until a player picks one, TrySetDefaultRegion (0x3C0B3D0; 1.8.2 0x3BDC3F0, 1.9.1 0x3C2DE10) takes the visible,
// non-beta region with the lowest average ping. Epic's ping servers (UDP 22222) no longer answer, so every region
// averages 9999 ("Region[NA]: qos unreachable" in the client's log), the first in the list wins, and an untouched
// client queues NA.
//
// Later builds split NA into NAE, NAC and NAW (21.40's RegionDefinitions) and a server may be started with any
// spelling, so both sides go through regionOf before they're compared.

// Each region's other spellings. OH (Ohio) is a hidden NA datacenter and GB (London) a hidden EU one in 1.9's list;
// Test01 and Test02 ping Seoul and Singapore addresses (AWS ap-northeast-2 and ap-southeast-1).
const aliases = {
  NA: ["NAE", "NAC", "NAW", "OH", "US", "USE", "USW", "NORTHAMERICA"],
  EU: ["GB", "UK", "EUROPE"],
  OCE: ["OC", "AU", "OCEANIA"],
  BR: ["BRAZIL", "SA"],
  ASIA: ["AS", "TEST01", "TEST02", "JP", "KR", "SG"]
};
const canonical = new Map(Object.entries(aliases).flatMap(([region, names]) => [[region, region], ...names.map((name) => [name, region])]));

// Every region code Core knows, each region's own and its other spellings.
export const regionCodes = () => [...canonical.keys()];

// "NONE" is what GetRegionId answers without a region (a server started without -McpRegion, or a client whose QoS
// found no region at all); 21.40 calls its hidden catch-all region UND (Undefined).
const noRegion = new Set(["", "NONE", "UND"]);

// A region's canonical code ("nae" → "NA"), any code Core doesn't know upper-cased as it is, or null for no region.
export function regionOf(code) {
  const name = String(code ?? "").trim().toUpperCase();
  if (noRegion.has(name)) return null;
  return canonical.get(name) ?? name;
}

// For logs: "EU", or "no region".
export const regionName = (region) => region ?? "no region";

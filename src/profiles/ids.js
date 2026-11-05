import { accountViews, usesCommonProfiles } from "./common.js";

// metadata holds the storm shields and deployable bases from 1.7.2 (profiles/outposts.js). athena is Battle Royale's from
// 1.8 (UFortMcpProfileAthena): its login queries it and gives up ("Profile Query Failed") when it isn't there. From 3.5
// the client has no profile0: it asks for campaign, common_core and common_public, Core's views of it
// (profiles/common.js), and an earlier build knows none of those.
const knownProfiles = ["metadata", "athena", "collection_book_*0", "theater*", "outpost*"];

function matches(pattern, value) {
  const [prefix, suffix] = pattern.split("*");
  if (suffix === undefined) return pattern === value;
  const middle = value.slice(prefix.length, value.length - suffix.length);
  return value.startsWith(prefix) && value.endsWith(suffix) && /^[a-z0-9_]+$/.test(middle);
}

export function isKnownProfile(profileId) {
  const accountProfiles = usesCommonProfiles() ? accountViews : ["profile0"];
  return accountProfiles.includes(profileId) || knownProfiles.some((pattern) => matches(pattern, profileId));
}

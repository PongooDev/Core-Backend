import { currentBuild } from "../builds/context.js";
import { accountViews, usesCommonProfiles } from "./common.js";

// metadata holds the storm shields and deployable bases from 1.7.2 (profiles/outposts.js). athena is Battle Royale's from
// 1.8 (UFortMcpProfileAthena): its login queries it and gives up ("Profile Query Failed") when it isn't there. From 3.5
// the client has no profile0: it asks for campaign, common_core and common_public, Core's views of it
// (profiles/common.js), and an earlier build knows none of those.
const knownProfiles = ["metadata", "athena", "collection_book_*0", "theater*", "outpost*"];
// 7.00 (CL-4629139) has Creative's profile, creative (UFortMcpProfileCreative, its three commands below; the profile id
// FortMcpProfile's sub_128A640 maps with athena, campaign, common_core, common_public and metadata). Its islands
// (FortCreativeRealEstatePlotItemDefinition) and prefabs (FortPlaysetItemDefinition) are its items (their MCP templates'
// static profile type "creative": the definitions' constructors, 0xFFE170 and 0xD78D10). Core keeps it empty: no island
// is anyone's yet (Creative's islands, their saves and their codes are a later step), so the Creative hub has none to
// show, and nothing else asks. 6.31 has the class too but its front end has no Creative, and an earlier build's request
// for it stays refused as before.
export const creativeProfileBuild = 4629139;
const hasCreativeProfile = () => Number(currentBuild()) >= creativeProfileBuild;

function matches(pattern, value) {
  const [prefix, suffix] = pattern.split("*");
  if (suffix === undefined) return pattern === value;
  const middle = value.slice(prefix.length, value.length - suffix.length);
  return value.startsWith(prefix) && value.endsWith(suffix) && /^[a-z0-9_]+$/.test(middle);
}

export function isKnownProfile(profileId) {
  const accountProfiles = usesCommonProfiles() ? accountViews : ["profile0"];
  return accountProfiles.includes(profileId) || knownProfiles.some((pattern) => matches(pattern, profileId))
    || (profileId === "creative" && hasCreativeProfile());
}

// metadata holds the storm shields and deployable bases from 1.7.2 (profiles/outposts.js). athena is Battle Royale's from
// 1.8 (UFortMcpProfileAthena): its login queries it and gives up ("Profile Query Failed") when it isn't there.
const knownProfiles = ["profile0", "metadata", "athena", "collection_book_*0", "theater*", "outpost*"];

function matches(pattern, value) {
  const [prefix, suffix] = pattern.split("*");
  if (suffix === undefined) return pattern === value;
  const middle = value.slice(prefix.length, value.length - suffix.length);
  return value.startsWith(prefix) && value.endsWith(suffix) && /^[a-z0-9_]+$/.test(middle);
}

export function isKnownProfile(profileId) {
  return knownProfiles.some((pattern) => matches(pattern, profileId));
}

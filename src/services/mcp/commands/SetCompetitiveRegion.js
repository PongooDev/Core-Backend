// 9.00's (CL-6337466) UFortMcpProfileAthena::SetCompetitiveRegion {newlySelectedRegionId} (the 9.00 SDK's
// FortMcpProfileAthena_SetCompetitiveRegion; the one MCP function 9.00 adds to 8.51's): the player's pick of the region
// their competitive play counts in (9.00's exe has EPlayerCompetitiveBanReasons::CircumventingRegionLock and the
// RegionLock_ texts beside it). 9.00's exe names no athena or common_core stat for it, so nothing in the profile changes:
// 🟡 the command is accepted on athena with no change, as Core serves no region-locked event (the Arena and the tournaments
// are Season 8's, 8.20 to 8.51, tournaments/arena.js), instead of operation_not_found.
export function setCompetitiveRegion() {}

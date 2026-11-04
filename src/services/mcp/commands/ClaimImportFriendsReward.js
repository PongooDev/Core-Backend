// ClaimImportFriendsReward: the reward for linking a social account (Facebook) and importing its friends. 3.2's client
// has the command (a client MCP command beside ClaimLoginReward, with an ImportFriendsRewardNotification and the profile's
// import_friends_claimed stat) and sends it from the link flow; this era has no common_core, so it is called on profile0.
// Core has no friend import, so there is nothing to claim: it answers with the profile as it is, no changes.
export function claimImportFriendsReward() {}
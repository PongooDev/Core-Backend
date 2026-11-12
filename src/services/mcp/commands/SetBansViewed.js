// SetBansViewed {} (UFortMcpProfileCommonCore's; first in 4.4.0, CL-4117433: 4.2's exe doesn't name it): the player has
// been shown their ban or warning. What the client does with it (6.02, CL-4461277):
// - common_core's stat ban_status is an FMcpBanInfo {bRequiresUserAck, banReasons, bBanHasStarted, banStartTimeUtc,
//   banDurationDays} (read at 0x106DD70). When it changes (0x10913E0) the player counts as banned while bRequiresUserAck
//   is set or the ban still has time left, and the frontend (UFortUIStateWidget_Frontend::CheckBanStatus, 0x301D2F0)
//   puts up the UI manager's PlayerBannedScreen, a UFortPlayerBanned, as the paks' one Blueprint of that class is:
//   UI/Foundation/Modals/PlayerReporting/PlayerBannedModal ("Behavior Warning" for a ban with no time left, "This
//   account has been banned." otherwise).
// - That modal sends SetBansViewed as it opens when bRequiresUserAck is set (UFortMcpContext::SetBansViewed 0x10A28B0,
//   the wrapper 0x14CCFD0 on the common_core profile), and keeps its Close button off until the answer. On a failure
//   Close sends it again, four times, and then closes anyway; with bRequiresUserAck still set the notice is back at the
//   next check.
// So the acknowledgement is bRequiresUserAck cleared, the one thing of ban_status a seen notice changes; the reasons,
// start and length stay, and a ban that still runs keeps the player banned (🟡 Epic's service isn't in the client: that
// it changed nothing else isn't shown). Core's own bans stop the login (services/account/oauth.js) and write no
// ban_status, so no Core player is shown the modal and the command comes only for a profile that was given one; before
// this the client was told "Unknown command SetBansViewed" (errors.com.epicgames.fortnite.operation_not_found). With
// nothing to acknowledge it changes nothing, on any build.
export function setBansViewed({ session }) {
  const tracker = session.profile("profile0");
  const status = tracker.profile.stats.attributes.ban_status;
  if (!status || typeof status !== "object" || status.bRequiresUserAck !== true) return;
  tracker.setStat("ban_status", { ...status, bRequiresUserAck: false });
}

import { McpError } from "../../../errors.js";

// EFortMtxPlatform, as the newest build Core knows has it: Epic, PSN and Live from the first builds, Shared by 3.3, and
// 3.5's EpicPC, EpicPCKorea, IOSAppStore and EpicAndroid (3.5.1's names, 0xC78900). 3.5.1 sets EpicPC at login and gave
// up on "Unknown platform EpicPC" (Core-Backend #247). A build never sends a value its own enum doesn't have.
const platforms = ["Epic", "PSN", "Live", "Shared", "EpicPC", "EpicPCKorea", "IOSAppStore", "EpicAndroid"];

export function setMtxPlatform({ req, session }) {
  const platform = req.body?.newPlatform;
  if (!platforms.includes(platform)) throw new McpError("errors.com.epicgames.common.invalid_parameter", `Unknown platform ${platform}`);
  const tracker = session.profile("profile0");
  if (tracker.profile.stats.attributes.current_mtx_platform !== platform) tracker.setStat("current_mtx_platform", platform);
}

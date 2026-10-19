import { McpError } from "../../../errors.js";

const platforms = ["Epic", "PSN", "Live"]; // EFortMtxPlatform

export function setMtxPlatform({ req, session }) {
  const platform = req.body?.newPlatform;
  if (!platforms.includes(platform)) throw new McpError("errors.com.epicgames.common.invalid_parameter", `Unknown platform ${platform}`);
  const tracker = session.profile("profile0");
  if (tracker.profile.stats.attributes.current_mtx_platform !== platform) tracker.setStat("current_mtx_platform", platform);
}

import express from "express";
import { requireAuth, requireDedicatedServer } from "../../accounts/auth.js";
import { sendError } from "../../errors.js";
import { tokenLifetimeSeconds, describeToken } from "../../vivox/tokens.js";

// Core's: the Vivox signing a Core gameserver shares with this backend (D:\CoreWork\vivox\contract.md). In a match the
// tokens come from the server: AFortGameModeZone's voice login and channel join (7.00 0xEE0690, 0xEE0480; the Athena
// overrides 0xC23370 and 0xC23250 call them for teams of more than one) look up the IModularFeature "VoiceChatToken", a
// server-only plugin missing from the client builds Core's servers run, and call it synchronously (slot 0: PlayerName,
// OutToken; slot 1: PlayerName, ChannelName, OutToken), then send the token down with ClientVoiceChatLogin and
// ClientVoiceChatChannelJoin. A synchronous call can't wait for HTTP, so the server signs itself with this key, fetched
// once. Only DedicatedServer client tokens get it (a trusted hosting PC's, network.js allowsHosting).
// - GET  /core/api/voice/vivox/signing: { enabled, issuer, domain, key, algorithm, tokenLifetimeSeconds }; enabled false
//   (no key) while the admin panel's Voice chat (Vivox) switch is off, when the server registers nothing.
// - POST /core/api/voice/vivox/token {action: "login" | "join", player, channel}: a token signed here, for debugging.
export function coreVivoxRoutes({ tokens, vivox }) {
  const router = express.Router();

  router.get("/core/api/voice/vivox/signing", requireAuth(tokens), requireDedicatedServer, (req, res) => {
    if (!vivox?.enabled()) return res.json({ enabled: false });
    vivox.say(`gameserver from ${req.clientAddress ?? req.socket?.remoteAddress} took the signing key`);
    res.json({ enabled: true, issuer: vivox.keys.issuer, domain: vivox.keys.domain, key: vivox.keys.key, algorithm: "HMAC-SHA256", tokenLifetimeSeconds });
  });

  router.post("/core/api/voice/vivox/token", requireAuth(tokens), requireDedicatedServer, (req, res) => {
    if (!vivox?.enabled()) return sendError(res, 409, "errors.com.epicgames.core.vivox_disabled", "Voice chat (Vivox) is off in the admin panel");
    const { action = "login", player, channel } = req.body ?? {};
    if (!["login", "join"].includes(action) || typeof player !== "string" || !player.trim() || (action === "join" && (typeof channel !== "string" || !channel.trim()))) {
      return sendError(res, 400, "errors.com.epicgames.common.json_mapping_error", "action must be login or join, with a player (and a channel to join)");
    }
    const token = vivox.keys.mint({ action, player: player.trim(), channel: action === "join" ? channel.trim() : undefined });
    vivox.say(`gameserver ${action} token for ${player}${action === "join" ? ` in ${channel}` : ""}: ${describeToken(token)}`);
    res.json({ token });
  });

  return router;
}

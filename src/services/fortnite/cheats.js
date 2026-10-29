import express from "express";
import { requireAuth } from "../../accounts/auth.js";

// Core's: who may use cheats on a Core gameserver (CoreV2 #138), the admin panel's Settings. Since CoreV2 #65 every
// player has a cheat manager, and AFortPlayerController::ServerCheat_Implementation runs whatever "cheat <command>" they
// send (the game's cheats and Core's own: corecheats, spawnactor, skin, disguise, "<command> /Name/" on another player).
// Before it runs one, CoreV2's gameserver asks here for the player who typed it, keeps the answer for that account and
// asks again every 30 seconds:
//   GET /fortnite/api/game/v2/cheats?accountId=<id>&displayName=<name>
//   -> {accountId, displayName, mode: "admins", allowed: true}
// mode "everyone" lets every player cheat, "off" none, and "admins" only the accounts in cheatAccounts, each named by
// its account id or display name (in any case). The account is found by its id, else its display name; one the backend
// doesn't know is matched by what the gameserver sent. A backend without this route answers 404, and the gameserver
// keeps letting everyone cheat.
export function cheatPermissionFor(settings, account, { accountId = "", displayName = "" } = {}) {
  const mode = settings?.cheats ?? "everyone";
  const names = (account ? [account.id, account.displayName] : [accountId, displayName])
    .filter(Boolean)
    .map((name) => String(name).toLowerCase());
  const listed = (settings?.cheatAccounts ?? []).some((entry) => names.includes(String(entry).toLowerCase()));
  return { mode, allowed: mode === "everyone" || (mode === "admins" && listed) };
}

export function cheatRoutes({ tokens, accounts, settings }) {
  const router = express.Router();

  router.get("/fortnite/api/game/v2/cheats", requireAuth(tokens), (req, res) => {
    const accountId = String(req.query.accountId ?? "").trim();
    const displayName = String(req.query.displayName ?? "").trim();
    const account = (accountId && accounts?.get?.(accountId)) || (displayName && accounts?.findByName?.(displayName)) || null;
    res.json({
      accountId: account?.id ?? accountId,
      displayName: account?.displayName ?? displayName,
      ...cheatPermissionFor(settings?.get?.(), account, { accountId, displayName })
    });
  });

  return router;
}

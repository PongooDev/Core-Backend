import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { dedicatedServerClient } from "../../accounts/clients.js";
import { isContactEmailLogin } from "../../accounts/email.js";
import { isServerAccountName, validatePassword, verifyPassword } from "../../accounts/password.js";
import { sendError } from "../../errors.js";
import { log } from "../../log.js";
import { allowsHosting, defaultHostingIps, normalizeAddress } from "../../network.js";
import { createFailureTracker } from "../portal/ratelimit.js";

function basicClient(req) {
  const [scheme, value] = (req.get("authorization") ?? "").split(" ");
  if (scheme?.toLowerCase() !== "basic" || !value) return null;
  const [clientId, ...secret] = Buffer.from(value, "base64").toString("utf8").split(":");
  return clientId ? { clientId, secret: secret.join(":") } : null;
}

// The admin panel's ban: the account can't log in (its tokens were revoked when it was banned).
function banned(res, account) {
  sendError(res, 403, "errors.com.epicgames.account.account_not_active",
    `This account is banned${account.banned.reason ? `: ${account.banned.reason}` : ""}`);
}

function invalidGrant(res, message) {
  sendError(res, 400, "errors.com.epicgames.account.oauth.invalid_grant", message);
}

// A server account (CoreServer{n}, Server{n}, CoreServer-<PC>-{n}) or the DedicatedServer client logs in without a password, and the
// DedicatedServer client's token acts for any player: only for this PC and the Trusted Hosting IPs (Core-Backend #125,
// network.js allowsHosting), by the connection's own address. The client's id and secret are no proof: they are in
// Core's source and every gameserver's command line.
const hostingAllowed = (req, settings) => allowsHosting(req.socket?.remoteAddress, settings?.get?.().allowedHostingIps ?? defaultHostingIps);

function notHostingIp(res, req, what) {
  log("Core", `Refused ${what} from ${normalizeAddress(req.socket?.remoteAddress)}: not this PC or a Trusted Hosting IP (admin panel, Settings)`);
  sendError(res, 403, "errors.com.epicgames.account.oauth.unauthorized_client",
    `This IP address is not authorized to ${what}. Add it to the admin panel's Trusted Hosting IPs to host from it.`);
}

export function oauthRoutes({ accounts, tokens, settings, resetTokens }) {
  const router = express.Router();
  const failureTracker = createFailureTracker({ windowMs: 5 * 60 * 1000, maxFailures: 10 });

  router.post("/account/api/oauth/token", async (req, res) => {
    const client = basicClient(req);
    // Any game client id is accepted; the dedicated server client, whose tokens can act for any player, needs its secret.
    if (!client || (client.clientId === dedicatedServerClient.id && client.secret !== dedicatedServerClient.secret)) {
      return sendError(res, 401, "errors.com.epicgames.account.oauth.invalid_client", "Missing or invalid client credentials");
    }
    const { clientId } = client;

    const body = req.body ?? {};
    switch (body.grant_type) {
      case "client_credentials":
        if (clientId === dedicatedServerClient.id && !hostingAllowed(req, settings)) return notHostingIp(res, req, "take a dedicated server token");
        return res.json(tokens.issueClient(clientId));

      case "password": {
        const login = String(body.username ?? "").trim();
        const displayName = login.split("@")[0].trim();
        if (!displayName) return invalidGrant(res, "A username is required");

        const config = settings?.get?.() ?? {};
        const requirePassword = config.requirePassword ?? true;
        const allowAutoRegistration = config.allowAutoRegistration ?? false;

        // A linked contact email (#120) signs in to its account. Any other name@domain is the name before the @, as before:
        // <name>@core.com is the address the game knows the account by.
        const emailLogin = isContactEmailLogin(login);
        const byEmail = emailLogin ? accounts.findByEmail(login) : null;
        let account = byEmail ?? accounts.findByName(displayName);
        const isServer = !byEmail && isServerAccountName(displayName);

        if (isServer) {
          // Dedicated servers: verify request comes from loopback, dedicatedServerClient, or whitelisted hosting IP
          if (!hostingAllowed(req, settings)) return notHostingIp(res, req, "log in as a dedicated server account");
          if (!account) {
            account = accounts.getOrCreate(displayName);
          }
          // Server accounts bypass password authentication
          if (account.banned) return banned(res, account);
          accounts.recordLogin(account);
          return res.json(tokens.issueUser(clientId, account, "password"));
        }

        // Regular player account: check IP failure tracker
        if (failureTracker.isBlocked(req)) {
          return sendError(res, 429, "errors.com.epicgames.common.throttled",
            "Too many failed password attempts. Please wait a few minutes before trying again.");
        }

        // An email sign-in always needs the account's own password, whatever requirePassword says: an account without one
        // (which a username and the launcher's "Core" reach when passwords aren't required) isn't reachable by its email.
        // Either failure answers the same, so a guess learns nothing about the account.
        if (byEmail && !(account.password && await verifyPassword(String(body.password ?? ""), account.password))) {
          failureTracker.recordFailure(req);
          return sendError(res, 400, "errors.com.epicgames.account.invalid_account_credentials",
            "Your e-mail and/or password are incorrect. Please check them and try again.");
        }

        // An address no account has linked never makes an account: it is more likely a mistyped email than a new player.
        if (!account && !emailLogin) {
          const plainPassword = String(body.password ?? "").trim();
          if (requirePassword) {
            const isValidPw = !validatePassword(plainPassword);
            if (allowAutoRegistration && plainPassword && isValidPw) {
              try {
                account = await accounts.createWithPassword(displayName, plainPassword);
              } catch {
                account = null;
              }
            }
          } else if (allowAutoRegistration) {
            account = accounts.getOrCreate(displayName);
          }
        }
        if (!account) {
          return sendError(res, 400, "errors.com.epicgames.account.invalid_account_credentials",
            "Your e-mail and/or password are incorrect, or the account does not exist. Please register on the web portal first.");
        }

        if (account.needsPasswordReset) {
          return sendError(res, 400, "errors.com.epicgames.account.invalid_account_credentials",
            "This account requires a password reset. Please request a Password Reset Link from your host.");
        }

        // Accounts that have a password must always be verified regardless of requirePassword setting (an email sign-in's was, above)
        if (account.password && !byEmail) {
          const plainPassword = String(body.password ?? "").trim();
          const matched = await verifyPassword(plainPassword, account.password);
          if (!matched) {
            failureTracker.recordFailure(req);
            return sendError(res, 400, "errors.com.epicgames.account.invalid_account_credentials",
              "Your e-mail and/or password are incorrect. Please check them and try again.");
          }
        } else if (!account.password && requirePassword) {
          // Passwordless accounts are only disallowed when requirePassword is on
          return sendError(res, 400, "errors.com.epicgames.account.invalid_account_credentials",
            "This account does not have a password configured and is admin-managed. Please request a Password Reset Link from your host.");
        }

        failureTracker.clear(req);
        if (account.banned) return banned(res, account);
        accounts.recordLogin(account);
        return res.json(tokens.issueUser(clientId, account, "password"));
      }

      case "refresh_token": {
        const entry = tokens.useRefreshToken(String(body.refresh_token ?? ""));
        const account = entry && accounts.get(entry.accountId);
        if (!account) return invalidGrant(res, "Invalid or expired refresh token");
        if (account.banned) return banned(res, account);
        return res.json(tokens.issueUser(clientId, account, "refresh_token"));
      }

      default:
        return sendError(res, 400, "errors.com.epicgames.account.oauth.unsupported_grant_type",
          `Unsupported grant type: ${body.grant_type}`);
    }
  });

  // The client checks its token here every minute; a 401 makes it refresh, and a refused refresh logs it out.
  router.get("/account/api/oauth/verify", requireAuth(tokens), (req, res) => {
    res.json(tokens.verify(req.session));
  });

  router.delete("/account/api/oauth/sessions/kill", requireAuth(tokens), (req, res) => {
    tokens.kill(req.session, String(req.query.killType ?? ""));
    res.status(204).end();
  });

  return router;
}

import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { dedicatedServerClient } from "../../accounts/clients.js";
import { isContactEmailLogin } from "../../accounts/email.js";
import { isServerAccountName, validatePassword, verifyPassword } from "../../accounts/password.js";
import { allowsBuild, buildName, buildNotAllowed } from "../../builds/allowed.js";
import { currentBuild } from "../../builds/context.js";
import { sendError } from "../../errors.js";
import { log } from "../../log.js";
import { allowsHosting, defaultHostingIps, requestAddress } from "../../network.js";
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
// network.js allowsHosting), by the request's address (requestAddress). The client's id and secret are no proof: they are in
// Core's source and every gameserver's command line.
const hostingAllowed = (req, settings) => allowsHosting(requestAddress(req), settings?.get?.().allowedHostingIps ?? defaultHostingIps);

function notHostingIp(res, req, what) {
  log("Core", `Refused ${what} from ${requestAddress(req)}: not this PC or a Trusted Hosting IP (admin panel, Settings)`);
  sendError(res, 403, "errors.com.epicgames.account.oauth.unauthorized_client",
    `This IP address is not authorized to ${what}. Add it to the admin panel's Trusted Hosting IPs to host from it.`);
}

// The admin panel's allowed builds (Core-Backend #164, builds/allowed.js): a player's login from another build is refused
// (and its refresh), for any build whose patch check (services/fortnite/version.js) let it get this far. The game shows
// "Unable to login to Fortnite servers. Please try again later." Its client token is still given, as the patch check
// needs one to be told HARD_UPDATE, and gameservers (their accounts, the DedicatedServer client) log in from any build.
function refusesBuild(res, settings, login) {
  const allowedBuilds = settings?.get?.().allowedBuilds ?? null;
  const changelist = currentBuild();
  if (allowsBuild(allowedBuilds, changelist)) return false;
  log("Core", `Refused ${login}'s login on Fortnite ${buildName(changelist)}: not an allowed build (admin panel, Settings)`);
  buildNotAllowed(res, allowedBuilds, changelist);
  return true;
}

export function oauthRoutes({ accounts, tokens, settings, resetTokens, exchangeCodes }) {
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

        if (refusesBuild(res, settings, displayName)) return;

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
        accounts.recordLogin(account, currentBuild());
        return res.json(tokens.issueUser(clientId, account, "password"));
      }

      case "refresh_token": {
        const entry = tokens.useRefreshToken(String(body.refresh_token ?? ""));
        const account = entry && accounts.get(entry.accountId);
        if (!account) return invalidGrant(res, "Invalid or expired refresh token");
        if (!isServerAccountName(account.displayName) && refusesBuild(res, settings, account.displayName)) return;
        if (account.banned) return banned(res, account);
        if (!isServerAccountName(account.displayName)) accounts.recordBuild(account, currentBuild());
        return res.json(tokens.issueUser(clientId, account, "refresh_token"));
      }

      // An exchange code (GET /account/api/oauth/exchange, below): once, within its five minutes, for its account.
      case "exchange_code": {
        const entry = exchangeCodes?.redeem(String(body.exchange_code ?? ""));
        const account = entry && accounts.get(entry.accountId);
        if (!account) {
          return sendError(res, 400, "errors.com.epicgames.account.oauth.exchange_code_not_found",
            "Sorry the exchange code you supplied was not found. It is possible that it was no longer valid");
        }
        if (!isServerAccountName(account.displayName) && refusesBuild(res, settings, account.displayName)) return;
        if (account.banned) return banned(res, account);
        if (!isServerAccountName(account.displayName)) accounts.recordBuild(account, currentBuild());
        return res.json(tokens.issueUser(clientId, account, "exchange_code"));
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

  // An exchange code for the token's account (FOnlineIdentityMcp's GenerateExchangeCode, 3.5.1 0x3AB800, which reads
  // code, expiresInSeconds, creatingClientId and consumingClientId, 0x4086B0). The purchase flow asks for one when it
  // can't set its cookie, and opens <Protocol>://<RedirectUrl>/exchange?exchangeCode=<code>&redirectUrl=<its page>
  // (services/fortnite/purchase.js). A client token names no account, so it gets none.
  router.get("/account/api/oauth/exchange", requireAuth(tokens), (req, res) => {
    const account = req.session.accountId && accounts.get(req.session.accountId);
    if (!account) {
      return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "An exchange code needs an account's token");
    }
    if (account.banned) return banned(res, account);
    res.set("Cache-Control", "no-store").json(exchangeCodes.issue(req.session));
  });

  // Every login sends killType=OTHERS_ACCOUNT_CLIENT_SERVICE, which logs a player's older logins out. A gameserver's
  // account is never a player's: several servers can log in to one (a launcher server login without {n}, two hosters
  // on one backend), and a server whose token is killed fails its next minute check and shuts down, kicking its
  // players with "host closed connection" (CoreV2 #280: 3.1 stops its session the moment the check fails). So a server
  // account's login leaves its other servers logged in.
  router.delete("/account/api/oauth/sessions/kill", requireAuth(tokens), (req, res) => {
    const account = req.session.accountId && accounts.get(req.session.accountId);
    if (!account || !isServerAccountName(account.displayName)) tokens.kill(req.session, String(req.query.killType ?? ""));
    res.status(204).end();
  });

  return router;
}

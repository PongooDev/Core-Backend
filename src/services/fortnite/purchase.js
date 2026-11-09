import crypto from "node:crypto";
import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { sendError } from "../../errors.js";
import { log } from "../../log.js";
import { httpsProxied, requestHost } from "../../network.js";
import { openSession } from "../../profiles/session.js";
import { catalogServiceOffer, grantRealMoneyOffer, hasCurrencyStore, offerBlocked, parseAppStoreId } from "../../store/currency.js";
import { codeProblems } from "../../store/purchasecodes.js";
import { notifyProfiles } from "../mcp/profile.js";

// The Store tab's simulated real-money purchases (Core-Backend #223, store/currency.js): the catalog service's prices
// for the V-Bucks packs, the purchase flow's page, and its one-click "Complete purchase".

// Where the purchase flow should open ([EpicPurchaseFlow] Prod= in the DefaultGame.ini hotfix, services/fortnite/cloudstorage.js,
// which the flow reads before the hotfix arrives and never again, so the launcher writes it to the build's
// NoRedist\DefaultGame.ini: Core-Backend #244): this backend as the client reached it, "<scheme>:///<host>/purchase".
//
// Before loading it the flow (3.5.1 0x6B2B50, 3.1 0x6A6880) tries to set the player's access token as a cookie
// (EPIC_BEARER_TOKEN, 0x6B0AE0) through CEF, for the domain it takes from this address by dropping "https://www",
// "http://www", "https://" and "http://" and cutting at the first "/". With the third slash the domain comes out empty, a
// cookie for the page's own host, and CEF reads "http:///127.0.0.1:5595/purchase" as http://127.0.0.1:5595/purchase.
// But the cookie is always Secure (FCookie bSecure = 1, 3.5.1 0x6B362B, 3.1 0x6A7352, 3.5.2 0x6B567B), which CEF refuses
// to set for an http:// page, so on a plain-http backend the cookie never sets: "Unable to use purchase flow auth,
// falling back to SSO" (0x6AD180). The single sign-on (0x6B4210 -> FOnlineIdentityMcp::GenerateAuthRedirectUrl,
// 0x3AAFD0) asks GET /account/api/oauth/exchange for an exchange code (services/account/oauth.js), then opens
// <Protocol>://<RedirectUrl>/exchange?exchangeCode=<code>&redirectUrl=<this address, URL-encoded> (0x3AB800, the
// template from 0x37ABC0), with Protocol and RedirectUrl from [OnlineSubsystemMcp.OnlineIdentityMcp] (0x4EEE00), which
// the launcher points at this backend too. Without the exchange code (Core-Backend #248, a 404 here) the flow failed:
// "Unable to generate SSO URL for user", and the Store showed "A PROBLEM OCCURRED". /exchange below signs the page in.
//
// The host is the one the game used for this config (the Host header, network.js requestHost): the purchase flow's
// browser is CEF, which goes straight to the address (neither CoreRedirect nor -httpproxy carries it, 3.3 has no CEF
// proxy switch), so it has to be one the player's PC reaches this backend at. The backend's own view (reachableAddress
// and the socket's local port) gave a remote player this PC's network address when no public address was set and the
// backend was entered by name, 127.0.0.1 behind a tunnel on this PC, and 5595 behind a forwarded or tunnelled port of
// another number: the browser never reached the page, and the Store sat on a black screen with a spinner
// (Core-Backend #244). Those stay for a request without a usable Host: one the -httpproxy carried, whose Host is the
// host the game asked for, an Epic one or another backend's (network.js viaHttpProxy, Core-Backend #261).
export function purchaseFlowUrl(req, network) {
  const proxied = httpsProxied(req);
  if (proxied) return `https:///${proxied.host}/purchase`;
  return `http:///${requestHost(req) ?? network.directHost(req)}/purchase`;
}

// The game config's [EpicPurchaseFlow] section, for builds with the Store tab while the packs are on.
export function purchaseFlowSection(req, network, { build, enabled }) {
  if (!enabled || !hasCurrencyStore(build)) return "";
  return ["[EpicPurchaseFlow]", `Prod=${purchaseFlowUrl(req, network)}`, ""].join("\r\n");
}

const pageMinutes = 15;

// The query of the purchase flow's page an /exchange redirectUrl names ("http:///127.0.0.1:5595/purchase?offers=...",
// any host: the page is always this backend's own), or null for any other URL.
export function purchaseQuery(redirectUrl) {
  const url = String(redirectUrl ?? "").split("#")[0];
  const queryAt = url.indexOf("?");
  const base = queryAt < 0 ? url : url.slice(0, queryAt);
  if (!/^https?:\/{2,3}[^/?#\\]+\/purchase\/?$/i.test(base)) return null;
  return new URLSearchParams(queryAt < 0 ? "" : url.slice(queryAt + 1));
}

// The page query an /exchange request carries (Core-Backend #250: on 3.5.2 a purchase reached "Unknown page", its
// redirectUrl not the purchase URL purchaseQuery takes). The redirect only ever goes to this backend's own /purchase,
// so any redirectUrl will do: its query, plus the page's parameters that came loose beside it (an unencoded redirectUrl
// splits at its first "&"). Null only without an offer to buy, and the redirectUrl is logged for that.
export function exchangeQuery(params) {
  const query = purchaseQuery(params.redirectUrl) ?? new URLSearchParams(String(params.redirectUrl ?? "").split("#")[0].split("?")[1] ?? "");
  for (const [name, value] of Object.entries(params)) {
    if (name !== "exchangeCode" && name !== "redirectUrl" && typeof value === "string" && !query.has(name)) query.append(name, value);
  }
  if (!query.get("offers")) {
    log("Purchase", `the purchase flow's sign-in names no offer to buy (redirectUrl ${JSON.stringify(String(params.redirectUrl ?? "").slice(0, 300))})`);
    return null;
  }
  return query;
}
const maxPending = 1000;

// A purchase code is tried against the account and the address that sent it: this many wrong codes in the window lock
// the account (or the address) out of trying more until it is over (Core-Backend #248). The address's limit is higher as
// a tunnelled or shared connection puts many players behind one.
const attemptWindowMs = 15 * 60_000;
const accountAttempts = 5;
const addressAttempts = 30;

function cookies(req) {
  return Object.fromEntries(String(req.get("cookie") ?? "").split(";").map((part) => part.trim().split("="))
    .filter(([name, value]) => name && value !== undefined).map(([name, ...value]) => [name, decodeURIComponent(value.join("="))]));
}

// The account the purchase flow's cookie (EPIC_BEARER_TOKEN, or its _GD, _STAGE and _CI kin, 0x6A47A0) or an
// Authorization header names, if any: undefined without one, null for one that isn't a valid access token.
function cookieAccount(req, tokens) {
  const jar = cookies(req);
  const [scheme, header] = (req.get("authorization") ?? "").split(" ");
  const token = Object.entries(jar).find(([name]) => /^EPIC_BEARER_TOKEN(_GD|_STAGE|_CI)?$/.test(name))?.[1]
    ?? (scheme?.toLowerCase() === "bearer" ? header : undefined);
  if (token === undefined) return undefined;
  return tokens.find(token)?.accountId ?? null;
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

function securityHeaders(res, nonce) {
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`
  });
}

function page(res, status, title, body, nonce = crypto.randomBytes(16).toString("base64")) {
  securityHeaders(res, nonce);
  res.status(status).type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style nonce="${nonce}">
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b1a33;color:#fff;font:16px/1.4 Arial,Helvetica,sans-serif}
main{width:min(440px,90vw);background:#13294d;border-radius:8px;padding:28px;text-align:center;box-shadow:0 8px 30px #0008}
h1{font-size:22px;margin:0 0 6px}p{margin:8px 0;color:#c9d6ea}.price{font-size:28px;font-weight:bold;color:#ffd84a;margin:14px 0}
input{box-sizing:border-box;width:100%;padding:12px;margin:0 0 10px;border:2px solid #2d4a7a;border-radius:6px;background:#0b1a33;color:#fff;font-size:18px;text-align:center;letter-spacing:1px;text-transform:uppercase}
button{width:100%;padding:14px;border:0;border-radius:6px;background:#ffd84a;color:#13294d;font-size:18px;font-weight:bold;cursor:pointer}
button[disabled]{opacity:.6;cursor:default}.note{font-size:13px;color:#8fa5c7}.error{color:#ff8a8a}
</style></head><body><main>${body}</main></body></html>`);
}

const dollars = (cents, code) => `${(cents / 100).toFixed(2)} ${code}`;

export function purchaseRoutes(context) {
  const { tokens, accounts, profiles, settings } = context;
  const router = express.Router();
  const pending = new Map();
  const enabled = () => settings?.get?.()?.vbuckPacks !== false;
  // Whether the admin panel has purchases need a code (purchaseMode "code", store/purchasecodes.js) rather than the free button.
  const needsCode = () => settings?.get?.()?.purchaseMode === "code";

  // Wrong codes tried, by account and by address: key -> { count, resetAt }.
  const wrongCodes = new Map();
  const attemptKeys = (req, accountId) => [[`account:${accountId}`, accountAttempts], [`address:${req.socket.remoteAddress}`, addressAttempts]];
  const lockedOut = (keys, now) => keys.map(([key, max]) => ({ record: wrongCodes.get(key), max }))
    .filter(({ record, max }) => record && record.resetAt > now && record.count >= max).map(({ record }) => record.resetAt).sort((a, b) => b - a)[0];
  function wrongCode(keys, now) {
    if (wrongCodes.size > 1000) for (const [key, record] of wrongCodes) if (record.resetAt <= now) wrongCodes.delete(key);
    for (const [key] of keys) {
      const record = wrongCodes.get(key);
      if (!record || record.resetAt <= now) wrongCodes.set(key, { count: 1, resetAt: now + attemptWindowMs });
      else record.count += 1;
    }
  }

  // Why the account can't buy the offer now (store/currency.js offerBlocked): an offer of one purchase per account (the
  // Starter Pack) it has bought, a founder's pack for another edition than its own.
  const alreadyBought = ({ offer, accountId }) => offerBlocked(offer, openSession(profiles, accountId).profile("profile0").profile);

  function prune(now) {
    for (const [id, entry] of pending) if (entry.expires <= now) pending.delete(id);
  }

  // The catalog service's prices for the Store tab's offers (QueryOffersById, store/currency.js): each id asked for that
  // this backend signed, by id. Epic's catalog service is <host>/catalog/api/...
  //
  // The catalog service is an MCP client service: its requests go out with the game's client_credentials token, not the
  // player's (FOnlineCatalogServiceMcp's ProcessRequest, 3.2 0x3B6270, queues them "for client=<client id>",
  // 0x4A1470), so the token names no account. The signed id is the proof of the account it was offered to. An id
  // left out of the answer gets no price: the catalog helper drops an offer's catalog RealMoney price and adds back only
  // the one the catalog service gave (3.2 0x7D9350), and the Store tab lists only offers with a RealMoney price
  // (UFortMcpContext::ListMtxPackages' 0xD53780), so without it the tab said "no offers available" (Core-Backend #239).
  const bulkOffers = (req, res) => {
    const ids = [req.query.id ?? []].flat().map(String).slice(0, 50);
    const offers = {};
    for (const id of ids) {
      const parsed = parseAppStoreId(id);
      if (parsed) offers[id] = catalogServiceOffer(id, parsed);
    }
    res.json(offers);
  };
  router.get("/catalog/api/shared/bulk/offers", requireAuth(tokens), bulkOffers);
  router.get("/api/shared/bulk/offers", requireAuth(tokens), bulkOffers);

  // The price engine's promotions for those offers (IOnlinePriceEngineService::QueryOfferPromotions, POST
  // <priceengine>/api/shared/offers/price, 3.3 0x4B60A0): {lineOffers: [{offerId, price, appliedRules}]}, each a sale on
  // one of the offers. Core runs no sales, so none. The catalog service's offer query only completes once the price
  // engine has answered, and passes on its success (3.3 0x3BC9F0 -> the query's delegate); the catalog helper counts a
  // failed price check as a failed catalog refresh ("Unable to complete price check", 0x80D6C0) and sets the next one 30
  // seconds on (0x80E220), and a 304 to that refresh never moves it again: once the packs had a price (#239), the 404
  // here left the catalog out of date for good, and the Event Store refreshed it every time its timer ticked
  // (Core-Backend #242).
  const offerPromotions = (req, res) => res.json({ lineOffers: [] });
  router.post("/priceengine/api/shared/offers/price", requireAuth(tokens), offerPromotions);
  router.post("/api/shared/offers/price", requireAuth(tokens), offerPromotions);

  // The purchase flow's page: ?showNavigation=true&namespace=fn&offers=<app store id>&analyticsSessionId=...
  router.get("/purchase", (req, res) => {
    const parsed = parseAppStoreId(req.query.offers);
    if (!enabled()) return page(res, 403, "Store closed", "<h1>V-Bucks packs are off</h1><p>This server's admin has turned the Store tab's V-Bucks packs off.</p>");
    if (!parsed || !accounts.get(parsed.accountId)) return page(res, 400, "Unknown offer", "<h1>Unknown offer</h1><p class=\"error\">Close this window and open the Store again.</p>");
    const viewer = cookieAccount(req, tokens);
    if (viewer !== undefined && viewer !== parsed.accountId) return page(res, 403, "Wrong account", "<h1>Wrong account</h1><p class=\"error\">This offer is another account's.</p>");
    const blocked = alreadyBought(parsed);
    if (blocked) return page(res, 409, "Already bought", `<h1>Already bought</h1><p class="error">${escapeHtml(blocked)}</p>`);
    const now = Date.now();
    prune(now);
    if (pending.size >= maxPending) return page(res, 503, "Busy", "<h1>Try again shortly</h1>");
    const purchaseId = crypto.randomBytes(24).toString("base64url");
    pending.set(purchaseId, { accountId: parsed.accountId, offerId: parsed.offer.offerId, appStoreId: req.query.offers, expires: now + pageMinutes * 60_000 });
    const nonce = crypto.randomBytes(16).toString("base64");
    const { offer } = parsed;
    // With purchases needing a code the page asks for one, and has no free button.
    const byCode = needsCode();
    const purchase = byCode
      ? `<div class="price">${escapeHtml(dollars(offer.price, offer.currencyCode))}</div>
<form id="buy" method="post" action="/purchase/complete"><input type="hidden" name="purchaseId" value="${purchaseId}"><input id="code" name="code" type="text" maxlength="64" autocomplete="off" spellcheck="false" placeholder="Enter your code" required><button id="go" type="submit">Redeem code</button></form>
<p class="note" id="status">Enter a promo code to get this offer.</p>`
      : `<div class="price"><s>${escapeHtml(dollars(offer.price, offer.currencyCode))}</s> FREE</div>
<form id="buy" method="post" action="/purchase/complete"><input type="hidden" name="purchaseId" value="${purchaseId}"><button id="go" type="submit">Complete purchase</button></form>
<p class="note" id="status">A simulated purchase: no money changes hands.</p>`;
    page(res, 200, byCode ? "Redeem code" : "Complete purchase", `<h1>${escapeHtml(offer.title)}</h1>
<p>${escapeHtml(accounts.get(parsed.accountId).displayName ?? "")}</p>
${purchase}
<script nonce="${nonce}">
(function () {
  var form = document.getElementById("buy"), go = document.getElementById("go"), status = document.getElementById("status"), code = document.getElementById("code");
  var bridge = window.ue && window.ue.purchaseflow;
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    go.disabled = true;
    status.className = "note";
    status.textContent = code ? "Checking your code..." : "Completing your purchase...";
    var request = new XMLHttpRequest();
    request.open("POST", "/purchase/complete");
    request.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    request.onload = function () {
      var answer = null;
      try { answer = JSON.parse(request.responseText); } catch (e) {}
      if (request.status !== 200 || !answer || !answer.receipt) {
        status.textContent = (answer && answer.errorMessage) || "The purchase failed.";
        status.className = "note error";
        if (code) go.disabled = false;
        return;
      }
      status.textContent = "Done! Your V-Bucks are in your account.";
      if (bridge) {
        try { bridge.receipt(answer.receipt); } catch (e) {}
        setTimeout(function () { try { bridge.requestclose(""); } catch (e) {} }, 1500);
      }
    };
    request.onerror = function () { status.textContent = "The purchase failed."; status.className = "note error"; go.disabled = false; };
    request.send("purchaseId=" + encodeURIComponent(form.purchaseId.value) + (code ? "&code=" + encodeURIComponent(code.value) : ""));
  });
})();
</script>`, nonce);
  });

  // The purchase flow's single sign-on (GenerateAuthRedirectUrl, above purchaseFlowUrl): the exchange code signs the page
  // in. The code is used up, a page-long access token for its account (no refresh token) goes in the cookie the page reads
  // (cookieAccount), and the browser goes on to this backend's own /purchase with the flow's query (its offers): never to
  // another site, whatever redirectUrl names.
  router.get("/exchange", (req, res) => {
    const query = exchangeQuery(req.query);
    const entry = context.exchangeCodes?.redeem(String(req.query.exchangeCode ?? ""));
    const account = entry && accounts.get(entry.accountId);
    if (!query) return page(res, 400, "Unknown page", "<h1>Unknown page</h1><p class=\"error\">Close this window and open the Store again.</p>");
    if (!account || account.banned) {
      return page(res, 400, "Sign-in expired", "<h1>Sign-in expired</h1><p class=\"error\">Close this window and open the Store again.</p>");
    }
    const { access_token: token } = tokens.issueAccess(entry.clientId, account, "exchange_code", pageMinutes * 60);
    const secure = httpsProxied(req) ? "; Secure" : "";
    securityHeaders(res, crypto.randomBytes(16).toString("base64"));
    res.set("Set-Cookie", `EPIC_BEARER_TOKEN=${token}; Path=/purchase; Max-Age=${pageMinutes * 60}; HttpOnly; SameSite=Lax${secure}`);
    const search = query.toString();
    res.redirect(302, `/purchase${search ? `?${search}` : ""}`);
  });

  // "Complete purchase": only for the page's own origin (no other site can post it: the browser's Origin, or its
  // Sec-Fetch-Site, must be this one), once per page (the purchase id is single-use and expires), for the account the
  // page's offer was made for.
  router.post("/purchase/complete", (req, res) => {
    const origin = req.get("origin");
    const site = req.get("sec-fetch-site");
    const hosts = [req.get("host"), httpsProxied(req)?.host].filter(Boolean);
    const sameOrigin = (origin === undefined || hosts.some((host) => origin === `http://${host}` || origin === `https://${host}`))
      && (site === undefined || site === "same-origin");
    if (!sameOrigin) {
      return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "Purchases are completed from the purchase page only");
    }
    const purchaseId = String(req.body?.purchaseId ?? "");
    const entry = pending.get(purchaseId);
    // A wrong code leaves the page to try again; anything else, and the free button, uses it up.
    const byCode = needsCode();
    if (!byCode) pending.delete(purchaseId);
    if (!entry || entry.expires <= Date.now()) {
      return sendError(res, 400, "errors.com.epicgames.purchase.expired", "This purchase page has expired. Close it and buy again from the Store.");
    }
    const parsed = parseAppStoreId(entry.appStoreId);
    if (!enabled() || !parsed || parsed.accountId !== entry.accountId || !accounts.get(entry.accountId)) {
      return sendError(res, 403, "errors.com.epicgames.purchase.not_available", "This offer isn't available");
    }
    const viewer = cookieAccount(req, tokens);
    if (viewer !== undefined && viewer !== entry.accountId) {
      return sendError(res, 403, "errors.com.epicgames.common.missing_permission", "This offer is another account's");
    }

    const blocked = alreadyBought(parsed);
    if (blocked) {
      return sendError(res, 409, "errors.com.epicgames.purchase.already_owned", blocked.replace(/\.$/, ""));
    }

    // Paid by a code (Core-Backend #248): rate limited per account and address, claimed (atomically, store/purchasecodes.js)
    // before the grant, and given back if the grant fails.
    let claimed = null;
    if (byCode) {
      const code = String(req.body?.code ?? "").trim().slice(0, 100);
      if (!code) return sendError(res, 400, "errors.com.epicgames.purchase.code_required", "Enter a code to get this offer.");
      const now = Date.now();
      const keys = attemptKeys(req, entry.accountId);
      const until = lockedOut(keys, now);
      if (until) {
        res.set("Retry-After", String(Math.ceil((until - now) / 1000)));
        return sendError(res, 429, "errors.com.epicgames.common.throttled", `Too many wrong codes. Try again in ${Math.ceil((until - now) / 60_000)} minutes.`);
      }
      const result = context.purchaseCodes.claim(code, { offerId: parsed.offer.offerId, accountId: entry.accountId, now });
      if (result.problem) {
        wrongCode(keys, now);
        return sendError(res, 400, "errors.com.epicgames.purchase.invalid_code", codeProblems[result.problem]);
      }
      claimed = result.id;
      pending.delete(purchaseId);
    }

    const transactionId = crypto.randomUUID().replaceAll("-", "").toUpperCase();
    const session = openSession(profiles, entry.accountId);
    let granted;
    try {
      granted = grantRealMoneyOffer(session, parsed.offer, transactionId);
      session.commit();
    } catch (error) {
      if (claimed) context.purchaseCodes.release(claimed, entry.accountId);
      throw error;
    }
    notifyProfiles(context, session);
    log("Store", `${entry.accountId} bought ${parsed.offer.offerId}${claimed ? ` with a code (${claimed})` : ""} (${granted.map(({ templateId, quantity }) => `${quantity} ${templateId}`).join(", ")}), transaction ${transactionId}`);
    // The purchase flow's receipt (FPurchaseFlowReceiptParam): the client checks it out and sends it to MCP
    // (VerifyRealMoneyPurchase), which has nothing left to give.
    res.set("Cache-Control", "no-store").json({
      receipt: {
        TransactionState: "Purchased",
        TransactionId: transactionId,
        Offers: [{ OfferNamespace: "fn", OfferId: entry.appStoreId, Quantity: 1,
          Items: [{ ItemId: parsed.offer.offerId, EntitlementId: transactionId, ValidationInfo: transactionId }] }]
      }
    });
  });

  return router;
}

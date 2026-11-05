import crypto from "node:crypto";
import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { sendError } from "../../errors.js";
import { log } from "../../log.js";
import { httpsProxied } from "../../network.js";
import { openSession } from "../../profiles/session.js";
import { catalogServiceOffer, grantRealMoneyOffer, hasCurrencyStore, parseAppStoreId } from "../../store/currency.js";
import { notifyProfiles } from "../mcp/profile.js";

// The Store tab's simulated real-money purchases (Core-Backend #223, store/currency.js): the catalog service's prices
// for the V-Bucks packs, the purchase flow's page, and its one-click "Complete purchase".

// Where the purchase flow opens ([EpicPurchaseFlow] Prod= in the DefaultGame.ini hotfix, services/fortnite/cloudstorage.js):
// this backend as the client reached it, "<scheme>:///<host>/purchase". Before loading it the flow sets the player's
// access token as a cookie on the page's domain, which it takes from this address by dropping "https://www",
// "http://www", "https://" and "http://" and cutting at the first "/" (3.1 0x6A6880); a domain with a port
// ("127.0.0.1:5595") is no cookie domain, and the flow gives up on the purchase when the cookie can't be set (it falls
// back to Epic's single sign-on, 0x6A7F10). With the third slash the domain comes out empty, a cookie for the page's own
// host, and the browser reads "http:///127.0.0.1:5595/purchase" as http://127.0.0.1:5595/purchase.
export function purchaseFlowUrl(req, network) {
  const proxied = httpsProxied(req);
  return proxied ? `https:///${proxied.host}/purchase` : `http:///${network.reachableAddress(req)}:${req.socket.localPort}/purchase`;
}

// The game config's [EpicPurchaseFlow] section, for builds with the Store tab while the packs are on.
export function purchaseFlowSection(req, network, { build, enabled }) {
  if (!enabled || !hasCurrencyStore(build)) return "";
  return ["[EpicPurchaseFlow]", `Prod=${purchaseFlowUrl(req, network)}`, ""].join("\r\n");
}

const pageMinutes = 15;
const maxPending = 1000;

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
    const now = Date.now();
    prune(now);
    if (pending.size >= maxPending) return page(res, 503, "Busy", "<h1>Try again shortly</h1>");
    const purchaseId = crypto.randomBytes(24).toString("base64url");
    pending.set(purchaseId, { accountId: parsed.accountId, offerId: parsed.offer.offerId, appStoreId: req.query.offers, expires: now + pageMinutes * 60_000 });
    const nonce = crypto.randomBytes(16).toString("base64");
    const { offer } = parsed;
    page(res, 200, "Complete purchase", `<h1>${escapeHtml(offer.title)}</h1>
<p>${escapeHtml(accounts.get(parsed.accountId).displayName ?? "")}</p>
<div class="price"><s>${escapeHtml(dollars(offer.price, offer.currencyCode))}</s> FREE</div>
<form id="buy" method="post" action="/purchase/complete"><input type="hidden" name="purchaseId" value="${purchaseId}"><button id="go" type="submit">Complete purchase</button></form>
<p class="note" id="status">A simulated purchase: no money changes hands.</p>
<script nonce="${nonce}">
(function () {
  var form = document.getElementById("buy"), go = document.getElementById("go"), status = document.getElementById("status");
  var bridge = window.ue && window.ue.purchaseflow;
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    go.disabled = true;
    status.textContent = "Completing your purchase...";
    var request = new XMLHttpRequest();
    request.open("POST", "/purchase/complete");
    request.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    request.onload = function () {
      var answer = null;
      try { answer = JSON.parse(request.responseText); } catch (e) {}
      if (request.status !== 200 || !answer || !answer.receipt) {
        status.textContent = (answer && answer.errorMessage) || "The purchase failed.";
        status.className = "note error";
        return;
      }
      status.textContent = "Done! Your V-Bucks are in your account.";
      if (bridge) {
        try { bridge.receipt(answer.receipt); } catch (e) {}
        setTimeout(function () { try { bridge.requestclose(""); } catch (e) {} }, 1500);
      }
    };
    request.onerror = function () { status.textContent = "The purchase failed."; status.className = "note error"; go.disabled = false; };
    request.send("purchaseId=" + encodeURIComponent(form.purchaseId.value));
  });
})();
</script>`, nonce);
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
    pending.delete(purchaseId);
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

    const transactionId = crypto.randomUUID().replaceAll("-", "").toUpperCase();
    const session = openSession(profiles, entry.accountId);
    const granted = grantRealMoneyOffer(session, parsed.offer, transactionId);
    session.commit();
    notifyProfiles(context, session);
    log("Store", `${entry.accountId} bought ${parsed.offer.offerId} (${granted.map(({ templateId, quantity }) => `${quantity} ${templateId}`).join(", ")}), transaction ${transactionId}`);
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

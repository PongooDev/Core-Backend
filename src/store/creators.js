import crypto from "node:crypto";
import express from "express";
import { sendError } from "../errors.js";
// Support-A-Creator, 6.02's (CL-4442095, CL-4461277): the item shop's "Support a Creator" button and its creator code.
// The Fortnite Wiki's Support-A-Creator: "Players declare their support for a Fortnite Creator in-game by entering the
// creator's code via the Support-A-Creator button in the Item Shop ... Once selected, that Creator Code will be set for
// 14 days, unless another Creator Code is entered." Update v6.02's notes don't name it; 6.02's exe (CL-4461277, built on
// 12 October 2018) is the first with it, by its strings against 6.01's (CL-4424678, 3 October): SetAffiliateName,
// GetAffiliateName, mtx_affiliate, mtx_affiliate_set_time, AffiliateNames, bDisableAffiliateFeature,
// bUseHotfixedAffiliateNamesArray, AffiliateExpirationSeconds and ListOfCreatorsURL are new, as is the AffiliateKeyModal
// widget in its paks (🟡 the day Epic turned it on isn't in the sources read).
//
// What 6.02's client does (CL-4461277, IDA and its paks):
// - UFortRuntimeOptions' constructor (0x137CB20) sets bDisableAffiliateFeature (+0x329) and
//   bUseHotfixedAffiliateNamesArray (+0x32A) to true, leaves AffiliateNames (+0x360) empty and gives ListOfCreatorsURL
//   "https://www.epicgames.com/FortniteCreators"; no shipped config changes them. So the feature is off as shipped, and
//   Epic turned it on with a hotfix (DefaultRuntimeOptions.ini) that also listed the creators.
// - The modal (Athena/UI/Frontend/AffiliateKeyModal, its Accept button) looks the typed text up in
//   UFortRuntimeOptions::GetValidAffiliateNames (0x156BE90: AffiliateNames as it is; Array_Find, so in any case), shows
//   its error and shakes when bUseHotfixedAffiliateNamesArray is set and the text isn't one of them, and otherwise sends
//   UFortMcpContext::SetAffiliateName with the list's own entry, AffiliateNames[found], never the typed text. With the
//   array switched off nothing is found and that entry is none, so 6.02 can only set a creator the hotfix lists. Whatever
//   the answer, the modal closes (OnSet ignores bSuccess).
// - SetAffiliateName {affiliateName} is UFortMcpProfileCommonCore's command (services/mcp/commands/SetAffiliateName.js),
//   and UFortMcpProfileCommonCore::GetAffiliateName (0x1082890) reads the stats back: mtx_affiliate_set_time (parsed as
//   ISO 8601) and, unless AffiliateExpirationSeconds (+0x314, config) is above 0 and that long has passed since, the name
//   in mtx_affiliate. The shop's "Supporting: <name>" is that.
// 6.10 (CL-4464155, CL-4476098, CL-4480234; IDA of CL-4480234) has the same: no CheckAffiliateName, the hotfixed array.
//
// 6.20 (CL-4497486) and 6.21 (CL-4526925) check a typed code with Epic's affiliate service instead (affiliateCheck below).
// Their AffiliateKeyModal (the same blueprint in both paks) on Accept: the code the profile already holds closes it
// (OnSet true); else, with bUseHotfixedAffiliateNamesArray set, it goes straight to OnCheckComplete(true, false, code),
// which looks the code up in GetValidAffiliateNames as 6.02 did; with it off, it disables Accept and asks
// UFortMcpContext::CheckAffiliateName(code), waiting up to 15 s (ConnectionTimeOut: the error shows, Accept comes back).
// Found either way, it sends SetAffiliateName with the typed code (no longer the list's entry); not found, it shows
// EntryError and shakes. OnSet(false) now leaves the modal open with its ConnectionError. Both builds' modals show the
// "View Approved Creators" button (LaunchWebsite) only while ListOfCreatorsURL isn't empty, and it calls
// KismetSystemLibrary::LaunchURL(ListOfCreatorsURL): the player's own web browser, which no Core redirect reaches. The
// error text below the box (ErrorPart2) is formatted with the same URL.
//
// On Core the creators are the admin panel's (Core-Backend #349): each an account with a code of its own, on or off. A
// player buying from the item shop with an enabled creator's code set pays that creator a share of the V-Bucks spent
// (store/creatorpayouts.js), and an enabled creator is given Twitch Prime Packs #1 and #2 (profiles/athena.js). While at
// least one code is enabled, 6.02 and later are served the hotfix that turns the button on: 6.02 and 6.10 with the codes
// in the hotfixed array, read at the game's start (a change shows once the game restarts); 6.20 and later with the array
// off, so the game asks this backend's affiliate service about each code as it is entered, and a code enabled or disabled
// in the panel counts at once. Every build is pointed at this backend's list of the enabled codes for "View Approved
// Creators" (/affiliate/creators). SetAffiliateName takes only an enabled code (or none, to clear it). With no code
// enabled nothing is served and the client stays as shipped, the feature off.
export const affiliateBuild = 4442095;
// The first changelist whose modal asks the affiliate service (UFortMcpContext::CheckAffiliateName).
export const affiliateCheckBuild = 4497486;

export const maxCreators = 200;
// A creator code as it goes into the hotfix's array, one "+AffiliateNames=<code>" line each, and into the affiliate
// service's address: letters, digits, spaces and the punctuation of an Epic display name, 3 to 32 characters, nothing an
// ini line could break on. Codes are told apart in any case, as the client's Array_Find and EqualEqual_StrStr compare them.
export const creatorCodePattern = /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,30}[A-Za-z0-9_.-]$/;
const sameCode = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

// The list as kept: trimmed names, without blanks, bad ones or the same one twice (in any case); undefined when it isn't
// a list. The settings before #349 (creatorNames) and config.json's creatorNames are such lists.
export function sanitizeCreatorNames(list) {
  if (!Array.isArray(list)) return undefined;
  const seen = new Set();
  const names = [];
  for (const entry of list) {
    const name = typeof entry === "string" ? entry.trim() : "";
    if (!creatorCodePattern.test(name) || seen.has(name.toLowerCase()) || names.length >= maxCreators) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names;
}

const accountIdPattern = /^[A-Za-z0-9-]{1,64}$/;
const newCreatorId = () => crypto.randomUUID();

// The creators as kept: {id, accountId (null for a code from before #349, which pays no one), code, enabled, added};
// without bad entries, a code twice (in any case) or an account twice. undefined when it isn't a list.
export function sanitizeCreators(list) {
  if (!Array.isArray(list)) return undefined;
  const codes = new Set();
  const accounts = new Set();
  const ids = new Set();
  const kept = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || kept.length >= maxCreators) continue;
    const code = typeof entry.code === "string" ? entry.code.trim() : "";
    const accountId = typeof entry.accountId === "string" && accountIdPattern.test(entry.accountId) ? entry.accountId : null;
    if (!creatorCodePattern.test(code) || codes.has(code.toLowerCase()) || (accountId && accounts.has(accountId))) continue;
    const id = typeof entry.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(entry.id) && !ids.has(entry.id) ? entry.id : newCreatorId();
    codes.add(code.toLowerCase());
    if (accountId) accounts.add(accountId);
    ids.add(id);
    kept.push({ id, accountId, code, enabled: entry.enabled !== false,
      added: typeof entry.added === "string" && !Number.isNaN(Date.parse(entry.added)) ? entry.added : new Date().toISOString() });
  }
  return kept;
}

// Names given the old way (settings creatorNames, config.json): they become the creators without an account, in place of
// the ones that list had made, beside the panel's creators of accounts (whose codes they can't take).
export function withLegacyNames(creatorsList, names) {
  const linked = (creatorsList ?? []).filter((creator) => creator.accountId);
  const kept = (creatorsList ?? []).filter((creator) => !creator.accountId);
  const added = names.filter((name) => !linked.some((creator) => sameCode(creator.code, name)))
    .map((name) => kept.find((creator) => sameCode(creator.code, name)) ?? { accountId: null, code: name, enabled: true });
  return sanitizeCreators([...linked, ...added]);
}

// What a creator payout is (Core-Backend #349): the percentage of the V-Bucks a supporter spends in the item shop that
// the creator is given, 0 to 100. 100 by default, as the issue asked: the creator gets what the player spent. Epic paid
// its creators 5%, in real money.
export const defaultPayoutPercent = 100;
export const payoutPercentValue = (value) => (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100 ? value : undefined);

// The settings store's value, for work that has none at hand (the MCP command).
let settingsProvider = () => undefined;
export function configureCreators(provider) {
  settingsProvider = typeof provider === "function" ? provider : () => provider;
}

// Every creator, on or off (a settings value of before #349 has only creatorNames).
export const creatorList = (settingsValue = settingsProvider()) => (Array.isArray(settingsValue?.creators)
  ? sanitizeCreators(settingsValue.creators)
  : withLegacyNames([], sanitizeCreatorNames(settingsValue?.creatorNames) ?? []));
export const enabledCreators = (settingsValue = settingsProvider()) => creatorList(settingsValue).filter((creator) => creator.enabled);

// The enabled codes, the ones players may enter.
export const creatorNames = (settingsValue = settingsProvider()) => enabledCreators(settingsValue).map((creator) => creator.code);

// The enabled creator a code is (in any case), or null.
export const creatorByCode = (code, settingsValue = settingsProvider()) =>
  enabledCreators(settingsValue).find((creator) => sameCode(creator.code, code)) ?? null;

// The enabled code a name is, as the panel spells it, or null.
export const creatorNamed = (name, settingsValue = settingsProvider()) => creatorByCode(name, settingsValue)?.code ?? null;

// Whether the account is an enabled creator.
export const isEnabledCreator = (accountId, settingsValue = settingsProvider()) =>
  Boolean(accountId) && enabledCreators(settingsValue).some((creator) => creator.accountId === accountId);

export const payoutPercent = (settingsValue = settingsProvider()) => payoutPercentValue(settingsValue?.creatorPayoutPercent) ?? defaultPayoutPercent;

// The V-Bucks a creator is paid for a purchase of `spent`: the panel's percentage of it, rounded down.
export const creatorPayout = (spent, settingsValue = settingsProvider()) =>
  Math.floor((Math.max(0, Number(spent) || 0) * payoutPercent(settingsValue)) / 100);

// Whether the build is offered the feature now: it has it, and a code is enabled.
export const affiliateOffered = (build, settingsValue = settingsProvider()) => Number(build) >= affiliateBuild && creatorNames(settingsValue).length > 0;

// The FortRuntimeOptions lines of the hotfix (services/fortnite/cloudstorage.js) for a build: the feature on; for 6.02
// and 6.10 the codes from the hotfixed array (the constructor's own setting, said again), for 6.20 on the array off so
// the modal asks the affiliate service; the array cleared and set either way; and "View Approved Creators" pointed at
// this backend's list (creatorsUrl, the address the game reached it at) when there is one.
export function affiliateRuntimeOptions(build, settingsValue = settingsProvider(), { creatorsUrl = null } = {}) {
  if (!affiliateOffered(build, settingsValue)) return [];
  return ["bDisableAffiliateFeature=false", `bUseHotfixedAffiliateNamesArray=${Number(build) >= affiliateCheckBuild ? "false" : "true"}`,
    "!AffiliateNames=ClearArray", ...creatorNames(settingsValue).map((name) => `+AffiliateNames=${name}`),
    ...(creatorsUrl ? [`ListOfCreatorsURL=${creatorsUrl}`] : [])];
}

// 6.20's (CL-4497486) check of a typed creator code, UFortMcpContext::CheckAffiliateName (FOnlineAccessMcp.CheckAffiliateName):
// a new service of its own, OnlineSubsystemMcp.OnlineAffiliateServiceMcp (DefaultEngine.ini: ServiceName "affiliate",
// Domain affiliate-public-service-prod.ol.epicgames.com), asked GET /affiliate/api/public/affiliates/slug/{affiliatename}
// (its CheckAffiliateNameUrl, 0x4766F3; config may override it). The answer (0x490FE0) is read into a struct of id,
// displayName, avatar, slug and status (0x4F46F0), and the name is valid only with status "ACTIVE" (in any case); the
// delegate then reports bWasValidAffiliateName and the name checked. 6.21 (CL-4526925) has the same strings and modal.
// An enabled code (any case) is ACTIVE, as the panel spells it, with an id of Core's (the code's hash) and no avatar; a
// disabled or unknown one is the service's 404.
const affiliateId = (name) => crypto.createHash("sha1").update(`Core:affiliate:${name.toLowerCase()}`).digest("hex").slice(0, 32);
export function affiliateCheck(slug, settingsValue = settingsProvider()) {
  const name = creatorNamed(slug, settingsValue);
  return name ? { id: affiliateId(name), slug: name, displayName: name, avatar: "", status: "ACTIVE", verified: false } : null;
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// The page "View Approved Creators" opens in the player's browser: the enabled codes, as Epic's FortniteCreators page
// listed its creators.
export function approvedCreatorsPage(settingsValue = settingsProvider()) {
  const codes = creatorNames(settingsValue).slice().sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  const items = codes.length ? codes.map((code) => `<li>${escapeHtml(code)}</li>`).join("") : "<li class=\"none\">No creators yet.</li>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>Approved Creators</title><style>body{font-family:system-ui,sans-serif;background:#10141c;color:#e8ecf3;margin:0;padding:32px 16px}`
    + `main{max-width:560px;margin:0 auto}h1{font-size:24px;margin:0 0 8px}p{color:#9aa4b5;margin:0 0 20px}`
    + `ul{list-style:none;padding:0;margin:0}li{background:#1a2030;border-radius:8px;padding:12px 16px;margin-bottom:8px;font-weight:600}`
    + `li.none{font-weight:400;color:#9aa4b5}</style></head><body><main><h1>Support-A-Creator</h1>`
    + `<p>Enter one of these creator codes with Support a Creator in the item shop.</p><ul>${items}</ul></main></body></html>`;
}

export function affiliateRoutes() {
  const router = express.Router();
  router.get("/affiliate/api/public/affiliates/slug/:slug", (req, res) => {
    const found = affiliateCheck(req.params.slug);
    if (!found) {
      return sendError(res, 404, "errors.com.epicgames.ecommerce.affiliate.not_found", `Affiliate ${req.params.slug} was not found`);
    }
    res.json(found);
  });
  router.get("/affiliate/creators", (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(approvedCreatorsPage());
  });
  return router;
}

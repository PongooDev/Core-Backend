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
//
// On Epic the creator earned a share of what the player spent. Core has no such programme, so here it is the choice
// alone, kept as Epic's profile kept it. The creators are the admin panel's list (settings creatorNames, none by
// default): while it has a name, 6.02 and later are served the hotfix that turns the button on with those names, and
// SetAffiliateName takes one of them (or none, to clear it). With no name listed nothing is served and the client stays
// as shipped, the feature off. The hotfix is read at the game's start, before the login, so a change to the list shows
// once the game restarts.
export const affiliateBuild = 4442095;

const maxCreators = 200;
// A creator's name as it goes into the hotfix's array, one "+AffiliateNames=<name>" line each: letters, digits, spaces
// and the punctuation of an Epic display name, 3 to 32 characters, nothing an ini line could break on.
const creatorName = /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,30}[A-Za-z0-9_.-]$/;

// The list as kept: trimmed names, without blanks, bad ones or the same one twice (in any case); undefined when it isn't
// a list.
export function sanitizeCreatorNames(list) {
  if (!Array.isArray(list)) return undefined;
  const seen = new Set();
  const names = [];
  for (const entry of list) {
    const name = typeof entry === "string" ? entry.trim() : "";
    if (!creatorName.test(name) || seen.has(name.toLowerCase()) || names.length >= maxCreators) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names;
}

// The settings store's value, for work that has none at hand (the MCP command).
let settingsProvider = () => undefined;
export function configureCreators(provider) {
  settingsProvider = typeof provider === "function" ? provider : () => provider;
}

export const creatorNames = (settingsValue = settingsProvider()) => sanitizeCreatorNames(settingsValue?.creatorNames) ?? [];

// The listed creator a name is, as the list spells it (the client compares in any case), or null.
export const creatorNamed = (name, settingsValue = settingsProvider()) =>
  creatorNames(settingsValue).find((listed) => listed.toLowerCase() === String(name ?? "").trim().toLowerCase()) ?? null;

// Whether the build is offered the feature now: it has it, and a creator is listed.
export const affiliateOffered = (build, settingsValue = settingsProvider()) => Number(build) >= affiliateBuild && creatorNames(settingsValue).length > 0;

// The FortRuntimeOptions lines of the hotfix (services/fortnite/cloudstorage.js) for a build: the feature on, the
// names from the hotfixed array (the constructor's own setting, said again), and the array cleared and set.
export function affiliateRuntimeOptions(build, settingsValue = settingsProvider()) {
  if (!affiliateOffered(build, settingsValue)) return [];
  return ["bDisableAffiliateFeature=false", "bUseHotfixedAffiliateNamesArray=true", "!AffiliateNames=ClearArray",
    ...creatorNames(settingsValue).map((name) => `+AffiliateNames=${name}`)];
}

// 6.20's (CL-4497486) check of a typed creator code, UFortMcpContext::CheckAffiliateName (FOnlineAccessMcp.CheckAffiliateName):
// a new service of its own, OnlineSubsystemMcp.OnlineAffiliateServiceMcp (DefaultEngine.ini: ServiceName "affiliate",
// Domain affiliate-public-service-prod.ol.epicgames.com), asked GET /affiliate/api/public/affiliates/slug/{affiliatename}
// (its CheckAffiliateNameUrl, 0x4766F3; config may override it). The answer (0x490FE0) is read into a struct of id,
// displayName, avatar, slug and status (0x4F46F0), and the name is valid only with status "ACTIVE" (in any case); the
// delegate then reports bWasValidAffiliateName and the name checked. The modal keeps 6.02's SetAffiliateName and the hotfixed
// array (AffiliateNames, bUseHotfixedAffiliateNamesArray, both still in UFortRuntimeOptions), so the list is the same
// one: a listed creator (the admin panel's, any case) is ACTIVE, as the list spells it, with an id of Core's (the name's
// hash) and no avatar; any other name is the service's 404. Nothing is paid to anyone.
const affiliateId = (name) => crypto.createHash("sha1").update(`Core:affiliate:${name.toLowerCase()}`).digest("hex").slice(0, 32);
export function affiliateCheck(slug, settingsValue = settingsProvider()) {
  const name = creatorNamed(slug, settingsValue);
  return name ? { id: affiliateId(name), slug: name, displayName: name, avatar: "", status: "ACTIVE", verified: false } : null;
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
  return router;
}

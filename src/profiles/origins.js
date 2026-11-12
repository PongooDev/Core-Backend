import { currentBuild, inBuild } from "../builds/context.js";
import { athenaSeason } from "../gamedata/athena.js";
import { findItem } from "./items.js";

// Where a locker cosmetic came from (Core-Backend #335). Epic's service knew when an account bought a cosmetic, and gave
// the Skull Trooper's first buyers of 2017 styles nobody else got (profiles/challenges.js originalOwnerStyles). A locker
// item says nothing about it: its attributes are level, item_seen, favorite and variants, its id is its template id, the
// item shop's purchases are only listed from 3.6 (mtx_purchase_history, store/refunds.js: the offer and a date, not the
// build), and the Season 1 builds' shop, where a Core player buys the Skull Trooper the first time round, lists none.
//
// So the athena profile notes, from this change on (both Core's, never sent to a client: profiles/changes.js sends a
// profile's stats and items only):
// - coreShopBuilds {<template id, lower case>: "<changelist>"}: the build whose item shop sold the cosmetic to the player
//   (PurchaseCatalogEntry's athena offers: the item shop's and 1.8.2's Season Shop's), every locker item the purchase
//   added. The build's season is its game data's (Season 1 without one, as store/itemshop.js seasonOfBuild).
// - coreOriginalOwner [<template id, lower case>]: the cosmetics an admin marked as bought at their first release (the
//   admin panel's styles window), for an account that bought one before purchases were noted.
// Both go when the item leaves the locker (a return, the panel's Remove): given again, it is a later copy.
// A cosmetic held without either was bought before this change, or given (the panel, the full locker, a friend code, a
// season's rewards): nothing in the profile says which, so it counts as a later owner's.
const idOf = (templateId) => String(templateId).toLowerCase();
const isChangelist = (build) => /^\d+$/.test(String(build ?? ""));

// An item shop purchase on the requesting build: the locker items it added.
export function noteShopPurchase(profile, templateIds, build = currentBuild()) {
  if (!isChangelist(build) || !templateIds.length) return;
  profile.coreShopBuilds = { ...(profile.coreShopBuilds ?? {}), ...Object.fromEntries(templateIds.map((templateId) => [idOf(templateId), String(build)])) };
}

// The item left the locker: what was noted of it goes.
export function forgetOrigin(profile, templateId) {
  const id = idOf(templateId);
  if (profile.coreShopBuilds && id in profile.coreShopBuilds) {
    const { [id]: gone, ...rest } = profile.coreShopBuilds;
    profile.coreShopBuilds = rest;
  }
  if (profile.coreOriginalOwner?.includes(id)) profile.coreOriginalOwner = profile.coreOriginalOwner.filter((held) => held !== id);
}

// The build whose shop sold the cosmetic (a changelist), or null when none is noted.
export const shopBuildOf = (profile, templateId) => profile.coreShopBuilds?.[idOf(templateId)] ?? null;
// The season of that build, or null.
export function shopSeasonOf(profile, templateId) {
  const build = shopBuildOf(profile, templateId);
  return isChangelist(build) ? inBuild(String(build), () => athenaSeason()?.seasonNumber ?? 1) : null;
}

export const markedOriginalOwner = (profile, templateId) => (profile.coreOriginalOwner ?? []).includes(idOf(templateId));
// The admin's mark, on or off. Returns whether it changed.
export function markOriginalOwner(profile, templateId, on) {
  const id = idOf(templateId);
  if (markedOriginalOwner(profile, id) === Boolean(on)) return false;
  profile.coreOriginalOwner = on ? [...(profile.coreOriginalOwner ?? []), id] : profile.coreOriginalOwner.filter((held) => held !== id);
  return true;
}

// Whether the account owns the cosmetic since its first release, in the season named: its locker holds it, and it was
// bought from the item shop of a build of that season, or an admin says so.
export const isOriginalOwner = (profile, templateId, season) => Boolean(findItem(profile, templateId))
  && (markedOriginalOwner(profile, templateId) || shopSeasonOf(profile, templateId) === season);

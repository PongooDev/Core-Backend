import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../../json-file.js";
import { log } from "../../log.js";

// Published Creative islands (PongooDev/CoreV2#488): the links service's links of type Creative:Island, each a copy of a
// player's island that anyone can visit by its code (the link's mnemonic), and the hub's featured islands.
//
// What 7.10 (CL-4667333, IDA 13338) reads of a link (FOnlineLinksServiceMcp; the link's serializer 0x507CA0): accountId,
// creatorName, mnemonic, linkType and metadata, a map of strings. Its server loads a link's island
// (UFortLevelSaveComponent's mnemonic load 0xF7EF90, its link answer 0xF82EC0) from the metadata's islandType, the
// primary asset id ("CreativePlot:<name>", split at ':' by 0xE7BA30) of the island's plot definition (its playset streams
// in first), and _filePath, the island's file on the DSS (LoadFromDssAsync 0xF7DF50 downloads it from the creative app);
// the rift shows title (0xF7B160) and tagline (0xF7B7D0) and the link's creatorName. The publish path the server's own
// (stripped) publish wrote to is "islands/public/%s/%s/%s.island" (its format string, 0x3D02448, no code reference left):
// Core fills it with the owner's account id, the code and the link's version.
//
// A code is twelve digits in three groups of four ("1234-5678-9012", Epic's island codes). Each publish of a code is a
// new version of its link; republishing an island keeps its code (one link per island of an owner, as Epic's links kept
// a mnemonic per published island) and moves to a new version. Only an enabled Support-A-Creator creator may publish
// (the links service's errors.com.epicgames.links.creator_name_required, which 7.10's CreateLink answer reads, 0x4A0390:
// Epic gave island codes to Support-A-Creator members first, Update v7.01), and the link's creatorName is their creator
// code.
export const islandLinkType = "Creative:Island";
export const linksNamespace = "fn";
export const maxFeatured = 4;
export const maxTitle = 40;
export const maxTagline = 150;
export const maxLocale = 10;
const mnemonicPattern = /^\d{4}-\d{4}-\d{4}$/;

// A code as typed (digits with or without dashes, or spaces), as the service keeps it, or null.
export function normalizeMnemonic(value) {
  const digits = String(value ?? "").replace(/[\s-]/g, "");
  if (!/^\d{12}$/.test(digits)) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`;
}
export const isMnemonic = (value) => mnemonicPattern.test(String(value ?? ""));

// The DSS path of a published island's version (the game's islands/public/%s/%s/%s.island).
export const publicIslandPath = (accountId, mnemonic, version) => `islands/public/${accountId}/${mnemonic}/${version}.island`;

const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

export function createIslandLinkStore(dataDir) {
  const file = path.join(dataDir, "creative", "links.json");
  let state = null;
  const load = () => {
    if (state) return state;
    try {
      state = readJson(file);
    } catch {
      state = {};
    }
    if (!state || typeof state !== "object" || !state.links || typeof state.links !== "object") state = { links: {} };
    state.featured = sanitizeFeatured(state.featured) ?? [];
    return state;
  };
  const save = () => writeJson(file, load());
  // Where a published island's file is kept: <data>/creative/public/<owner>/<code>/<version>.island.
  const publicFile = (accountId, mnemonic, version) => path.join(dataDir, "creative", "public", accountId, mnemonic, `${version}.island`);

  function newMnemonic() {
    const { links } = load();
    for (;;) {
      const digits = String(crypto.randomInt(0, 1e6)).padStart(6, "0") + String(crypto.randomInt(0, 1e6)).padStart(6, "0");
      const mnemonic = normalizeMnemonic(digits);
      if (!digits.startsWith("0000") && !links[mnemonic]) return mnemonic;
    }
  }

  const get = (mnemonic) => load().links[normalizeMnemonic(mnemonic) ?? ""] ?? null;
  const list = () => Object.values(load().links).sort((a, b) => String(b.published).localeCompare(String(a.published)));
  const byAuthor = (accountId) => list().filter((link) => link.accountId === accountId);
  const ofIsland = (accountId, plotItemId) => list().find((link) => link.accountId === accountId && link.plotItemId === plotItemId) ?? null;
  // The file of a link's current version, if it has one on disk.
  const fileOf = (link) => (link ? publicFile(link.accountId, link.mnemonic, link.version) : null);

  // Publishes an island: `contents` (the island's file as saved) becomes the new version of the island's link, made if the
  // island has none yet. {accountId, creatorName, plotItemId, islandType, title, tagline, locale, contents, by}.
  function publish({ accountId, creatorName, plotItemId, islandType, title, tagline = "", locale = "", contents, by = "player" }) {
    if (!Buffer.isBuffer(contents) || !contents.length) throw new Error("The island has no save to publish yet");
    const now = new Date().toISOString();
    const existing = plotItemId ? ofIsland(accountId, plotItemId) : null;
    const link = existing ?? { mnemonic: newMnemonic(), accountId, plotItemId: plotItemId ?? null, version: 0, created: now, active: true };
    link.version += 1;
    Object.assign(link, {
      creatorName: clean(creatorName, 64), islandType: clean(islandType, 128), title: clean(title, maxTitle) || "Untitled island",
      tagline: clean(tagline, maxTagline), locale: clean(locale, maxLocale), published: now, publishedBy: by, size: contents.length
    });
    const target = fileOf(link);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, contents);
    fs.renameSync(`${target}.tmp`, target);
    load().links[link.mnemonic] = link;
    save();
    log("Creative", `${accountId}'s island ${plotItemId ?? "(admin copy)"} published as ${link.mnemonic} version ${link.version} ("${link.title}", by ${by})`);
    return link;
  }

  // {title?, tagline?, active?}: an admin's change to a link.
  function update(mnemonic, changes) {
    const link = get(mnemonic);
    if (!link) return null;
    if (changes.title !== undefined) link.title = clean(changes.title, maxTitle) || link.title;
    if (changes.tagline !== undefined) link.tagline = clean(changes.tagline, maxTagline);
    if (changes.active !== undefined) link.active = changes.active === true;
    link.updated = new Date().toISOString();
    save();
    return link;
  }

  // The hub's featured codes, in rift order, as the admin panel set them; and the ones that are active links now.
  const featured = () => [...load().featured];
  const activeFeatured = () => load().featured.filter((code) => load().links[code] && load().links[code].active !== false);
  function setFeatured(list) {
    load().featured = sanitizeFeatured(list) ?? [];
    save();
    log("Creative", `Featured islands: ${load().featured.join(", ") || "none (the build's own)"}`);
    return featured();
  }

  // Unpublishes: the link and every version's file go.
  function remove(mnemonic) {
    const link = get(mnemonic);
    if (!link) return false;
    delete load().links[link.mnemonic];
    load().featured = load().featured.filter((code) => code !== link.mnemonic);
    save();
    fs.rmSync(path.join(dataDir, "creative", "public", link.accountId, link.mnemonic), { recursive: true, force: true });
    log("Creative", `Island ${link.mnemonic} ("${link.title}") unpublished`);
    return true;
  }

  return { get, list, byAuthor, ofIsland, fileOf, publish, update, remove, publicFile, featured, activeFeatured, setFeatured };
}

// A link as the links service answers it (the fields 7.10's serializer reads, with the rest of Epic's link answer).
export function linkJson(link) {
  return {
    namespace: linksNamespace,
    accountId: link.accountId,
    creatorName: link.creatorName,
    mnemonic: link.mnemonic,
    linkType: islandLinkType,
    metadata: {
      title: link.title,
      tagline: link.tagline ?? "",
      locale: link.locale || "en",
      islandType: link.islandType,
      _filePath: publicIslandPath(link.accountId, link.mnemonic, link.version)
    },
    version: link.version,
    active: link.active !== false,
    disabled: link.active === false,
    created: link.created,
    published: link.published,
    descriptionTags: [],
    moderationStatus: "Approved"
  };
}

// The hub's featured islands: the admin panel's codes, at most four (Update v7.01: "Four featured island Rifts"), in rift
// order (the first is the hotfix's CuratedLinkCodes[0]). A code that isn't an active link is left out of the hotfix.
export function sanitizeFeatured(list) {
  if (!Array.isArray(list)) return undefined;
  const codes = [];
  for (const entry of list) {
    const code = normalizeMnemonic(entry);
    if (code && !codes.includes(code) && codes.length < maxFeatured) codes.push(code);
  }
  return codes;
}

// The FortRuntimeOptions lines of the hotfix (services/fortnite/cloudstorage.js) for 7.10 (CL-4667333) and later, whose
// UFortRuntimeOptions has the Creative island switches (7.10's SDK; 7.00's has none of them):
// - CuratedLinkCodes: the hub's featured islands. Each featured rift's island space has a UFortLevelSaveComponent whose
//   LinkCodeNumberToAutoLoad (+0x234) picks its code from this array as it begins play (7.10 0xF5E610, the component's
//   BeginPlay: index in range, its mnemonic load 0xF7EF90; else, with bAutoLoadFromRestrictedPlotDefinition, the build's
//   own featured island, BeginRestrictedPlotLoad 0xF5E7B0). The server asks the links service for the code and loads its
//   island (0xF82EC0, 0xF7DF50), and the rift shows its title, tagline and creator. So the admin panel's featured codes
//   that are still published go in, in order; with none, the array is emptied and the rifts keep the build's islands. A
//   server reads the array as it starts, so a change reaches the servers started after it.
// - PublishingEnabledForWhitelistedAccounts (+0x5B0): the island menu's Publish Island row shows when it and the player's
//   AFortPlayerControllerAthena::bIsAllowedToPublish are set (UFortCreativePublishOptions, 0x308BA3B). The gameserver sets
//   the second for an enabled Support-A-Creator creator (links.js /core/api/creative/publishing).
// - bEnableIslandCheckpoints (+0x5F8): its Backup Island and Restore rows (0x308BA94).
// - bEnableIslandCodeEntryOnCuratedPortal (+0xE6): the featured rifts' Enter Code (Update v7.01: "Featured Island Rifts ...
//   also give access to 'Enter Code'"); a player's own rift keeps the build's setting.
export const creativeLinksBuild = 4667333;
export function creativeRuntimeOptions(build, islandLinks) {
  if (Number(build) < creativeLinksBuild) return [];
  const featured = islandLinks?.activeFeatured?.() ?? [];
  return ["PublishingEnabledForWhitelistedAccounts=true", "bEnableIslandCheckpoints=true", "bEnableIslandCodeEntryOnCuratedPortal=true",
    "!CuratedLinkCodes=ClearArray", ...featured.map((code) => `+CuratedLinkCodes=${code}`)];
}

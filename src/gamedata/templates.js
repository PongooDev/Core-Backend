import { certBuild } from "../builds/detect.js";
import { activeBuild, buildGameData, dataBuilds, overlay } from "./read.js";

// Creative's island templates a build's paks have (profiles/creative.js; the extractor writes no CreativePlot items):
// 7.00's (CL-4629139) Temperate_Medium, from 7.10 (CL-4667333) Arctic_Medium and TheBlock_Season7, and from 7.20
// (CL-4727874) Arctic_Competitive_Medium1 (Frosty Fortress), from 8.20 (CL-5625478) 8.10's Sandbar_Large and Volcano_Large
// and 8.11's BlackGlass_Medium, from 8.30 (CL-5793395) Tropical_Medium and Military_Medium (Rivers Edge), and from 9.00
// (CL-6337466) FlatGrass_Large (Meadow), so an earlier client isn't sent the islands an account was given on a later build.
const creativePlotTemplates = (build) => [...(Number(build) >= 4629139 ? ["CreativePlot:temperate_medium"] : []),
  ...(Number(build) >= 4667333 ? ["CreativePlot:arctic_medium", "CreativePlot:theblock_season7"] : []),
  ...(Number(build) >= 4727874 ? ["CreativePlot:arctic_competitive_medium1"] : []),
  ...(Number(build) >= 5625478 ? ["CreativePlot:sandbar_large", "CreativePlot:volcano_large", "CreativePlot:blackglass_medium"] : []),
  ...(Number(build) >= 5793395 ? ["CreativePlot:tropical_medium", "CreativePlot:military_medium"] : []),
  ...(Number(build) >= 6337466 ? ["CreativePlot:flatgrass_large"] : [])];

// Template ids a build's client still loads under an id of its own: its DefaultGame.ini's PrimaryAssetIdRedirects (the
// asset manager's Old to New, at load). 7.30 (CL-4834550) renames Jumpshot and Triple Threat (the basketball outfits of
// 4.4) to CID_136_Athena_Commando_M_StreetBasketball and CID_137_Athena_Commando_F_StreetBasketball and redirects their
// old ids, so an account's outfit bought on an earlier build is the same outfit there: it isn't hidden from 7.30 (its
// data has only the new ids) and the full locker doesn't give the new ids beside it (profiles/athena.js lockerCosmetics).
export const assetIdRedirects = [
  { firstBuild: 4834550, from: "AthenaCharacter:cid_136_athena_commando_m_basketball", to: "AthenaCharacter:cid_136_athena_commando_m_streetbasketball" },
  { firstBuild: 4834550, from: "AthenaCharacter:cid_137_athena_commando_f_basketball", to: "AthenaCharacter:cid_137_athena_commando_f_streetbasketball" }
];
const redirectsOf = (build) => assetIdRedirects.filter(({ firstBuild }) => Number(build) >= firstBuild);
// Whether an id is a redirect's new one, which the build's client also loads under the old id.
export const isRedirectTarget = (templateId, build = activeBuild()) =>
  redirectsOf(build).some(({ to }) => to.toLowerCase() === String(templateId).toLowerCase());

// The keys of the object at field (the file itself without one) in a build's data: Cert's, with the build's merge patch
// (gamedata/patch.js) applied to the keys alone, which is all templateIds needs and much less work than the whole file.
function keysOf(cert, build, name, field) {
  const at = (data) => (field && data != null ? data[field] : data);
  const keys = new Set(Object.keys(at(cert(name)) ?? {}));
  const patch = at(overlay(build, name));
  if (patch === null) return new Set();
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) keys.delete(key);
    else keys.add(key);
  }
  return keys;
}

// The template ids a build's data has: items, quests, skill tree nodes, banners and Battle Royale's cosmetics, lower-cased;
// and the old ids its client redirects. cert(name) is Cert's file, read once for every build.
function templateIds(build, cert) {
  const keys = (name, field) => [...keysOf(cert, build, name, field)];
  return new Set([
    ...keys("items"),
    ...keys("quests").map((id) => `Quest:${id}`),
    ...keys("homebasenodes", "nodes").map((id) => `HomebaseNode:${id}`),
    ...keys("banners", "icons").map((row) => `HomebaseBannerIcon:${row}`),
    ...keys("banners", "colors").map((row) => `HomebaseBannerColor:${row}`),
    ...keys("athena", "cosmetics"),
    ...creativePlotTemplates(build),
    ...redirectsOf(build).map(({ from }) => from)
  ].map((id) => id.toLowerCase()));
}

// Accounts are shared by every build, so a profile can hold an item granted on a build whose data has a template
// another build's lacks. That build's client would load it without a definition (the Cert client only logs "Failed to
// find ItemDefinition for AccountItem with Template %s!", FortAccountItem.cpp:573 in sub_5CA460, and keeps a null
// definition), so what is sent to it leaves such items out (src/profiles/changes.js) while the profile keeps them.
// Templates no build has (Core's own, tests') are never hidden. Nothing to do with one data build.
//
// idsByBuild: build -> its template ids. Returns build -> the ids other builds have and it hasn't: every build's ids but
// its own.
export function foreignTemplateIds(idsByBuild) {
  const every = new Set([...idsByBuild.values()].flatMap((ids) => [...ids]));
  return new Map([...idsByBuild].map(([build, own]) => [build, new Set([...every].filter((id) => !own.has(id)))]));
}

// Reading every data build's ids takes seconds (50 data builds by 8.30), and the first profile sent needs them. Made on
// first use, that held the backend's one thread for about 8 s on a tester's PC: the game gave up on its first
// QueryProfile, so its first login after the launcher started the backend failed with "Unable to connect to Fortnite
// servers" and the next one worked (Core-Backend #417). prepareForeignTemplates() reads them once the backend listens, a build per event loop turn;
// whatever is left when a profile is sent first is read then.
const idsByBuild = new Map();
let certFiles = new Map();
const certFile = (name) => {
  if (!certFiles.has(name)) certFiles.set(name, buildGameData(certBuild, name, {}));
  return certFiles.get(name);
};
let foreign;

function readTemplateIds(build) {
  if (!idsByBuild.has(build)) idsByBuild.set(build, templateIds(build, certFile));
}

function foreignTemplates(build) {
  if (!foreign) {
    if (dataBuilds.length > 1) for (const dataBuild of dataBuilds) readTemplateIds(dataBuild);
    foreign = foreignTemplateIds(idsByBuild);
    idsByBuild.clear();
    certFiles = new Map();
  }
  return foreign.get(build);
}

export async function prepareForeignTemplates() {
  if (dataBuilds.length <= 1) return;
  for (const dataBuild of dataBuilds) {
    if (foreign) return;
    readTemplateIds(dataBuild);
    await new Promise((resolve) => setImmediate(resolve));
  }
  foreignTemplates(certBuild);
}

// Whether the requesting build lacks a template another build has.
export function isForeignTemplate(templateId) {
  const hidden = foreignTemplates(activeBuild());
  return Boolean(hidden?.size) && hidden.has(String(templateId).toLowerCase());
}

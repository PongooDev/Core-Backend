import { activeBuild, buildGameData, dataBuilds } from "./read.js";

// Creative's island templates a build's paks have (profiles/creative.js; the extractor writes no CreativePlot items):
// 7.00's (CL-4629139) Temperate_Medium, from 7.10 (CL-4667333) Arctic_Medium and TheBlock_Season7, and from 7.20
// (CL-4727874) Arctic_Competitive_Medium1 (Frosty Fortress), so an earlier client isn't sent the islands an account was
// given on a later build.
const creativePlotTemplates = (build) => [...(Number(build) >= 4629139 ? ["CreativePlot:temperate_medium"] : []),
  ...(Number(build) >= 4667333 ? ["CreativePlot:arctic_medium", "CreativePlot:theblock_season7"] : []),
  ...(Number(build) >= 4727874 ? ["CreativePlot:arctic_competitive_medium1"] : [])];

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

// The template ids a build's data has: items, quests, skill tree nodes, banners and Battle Royale's cosmetics, lower-cased;
// and the old ids its client redirects.
function templateIds(build) {
  const read = (name) => buildGameData(build, name, {});
  const { nodes = {} } = read("homebasenodes");
  const { icons = {}, colors = {} } = read("banners");
  const { cosmetics = {} } = read("athena");
  return new Set([
    ...Object.keys(read("items")),
    ...Object.keys(read("quests")).map((id) => `Quest:${id}`),
    ...Object.keys(nodes).map((id) => `HomebaseNode:${id}`),
    ...Object.keys(icons).map((row) => `HomebaseBannerIcon:${row}`),
    ...Object.keys(colors).map((row) => `HomebaseBannerColor:${row}`),
    ...Object.keys(cosmetics),
    ...creativePlotTemplates(build),
    ...redirectsOf(build).map(({ from }) => from)
  ].map((id) => id.toLowerCase()));
}

// Accounts are shared by every build, so a profile can hold an item granted on a build whose data has a template
// another build's lacks. That build's client would load it without a definition (the Cert client only logs "Failed to
// find ItemDefinition for AccountItem with Template %s!", FortAccountItem.cpp:573 in sub_5CA460, and keeps a null
// definition), so what is sent to it leaves such items out (src/profiles/changes.js) while the profile keeps them.
// Templates no build has (Core's own, tests') are never hidden. Made on first use; nothing to do with one data build.
//
// idsByBuild: build -> its template ids. Returns build -> the ids other builds have and it hasn't.
export function foreignTemplateIds(idsByBuild) {
  return new Map([...idsByBuild].map(([build, own]) => [build, new Set([...idsByBuild]
    .filter(([other]) => other !== build)
    .flatMap(([, others]) => [...others].filter((id) => !own.has(id))))]));
}

let foreign;
function foreignTemplates(build) {
  foreign ??= foreignTemplateIds(new Map(dataBuilds.length > 1 ? dataBuilds.map((dataBuild) => [dataBuild, templateIds(dataBuild)]) : []));
  return foreign.get(build);
}

// Whether the requesting build lacks a template another build has.
export function isForeignTemplate(templateId) {
  const hidden = foreignTemplates(activeBuild());
  return Boolean(hidden?.size) && hidden.has(String(templateId).toLowerCase());
}

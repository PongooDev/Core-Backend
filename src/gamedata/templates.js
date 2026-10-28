import { activeBuild, buildGameData, dataBuilds } from "./read.js";

// The template ids a build's data has: items, quests, skill tree nodes, banners and Battle Royale's cosmetics, lower-cased.
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
    ...Object.keys(cosmetics)
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

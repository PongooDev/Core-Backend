import { getCharacter, getItem } from "../gamedata/items.js";

// What a hero item carries besides its level, item_seen and squad fields: the client's own MCP template exporter for
// UFortHero (sub_5D3480, on top of UFortWorker sub_5D3830 and UFortAccountItem sub_5D1630) writes xp 0, favorite,
// max_level_bonus 0, portrait (the definition's fixed one, none for heroes), hero_name "DefaultHeroName",
// equipped_cosmetics as 8 empty strings (TArray<FString>) and mode_loadouts [] (TArray<FFortSavedModeLoadout>).
// favorite stays an int like item_seen (UFortAccountItem int32; Core's SetItemFavoriteStatus writes 1/0).
// gender (UFortWorker int32) is the hero type's: AFortPlayerState::SetHeroType (sub_7B1BD0) puts HeroType->Gender in
// the player state and warns when the item's differs. The template's gender 0 (Invalid) left the lobby pad without
// a body (2026-10-20 bug report).
const genderNumber = { Male: 1, Female: 2 };

export const isHero = (templateId) => getItem(templateId)?.class === "FortHeroType";

export function heroAttributes(templateId) {
  return {
    xp: 0,
    favorite: 0,
    max_level_bonus: 0,
    gender: genderNumber[getCharacter(templateId)?.gender] ?? genderNumber.Female,
    portrait: "",
    hero_name: "DefaultHeroName",
    equipped_cosmetics: Array(8).fill(""),
    mode_loadouts: []
  };
}

// Heroes made before these existed get what they lack; a gender of 0 or anything but 1 / 2 is replaced.
export function fillHeroAttributes(item) {
  if (!isHero(item.templateId)) return false;
  const wanted = heroAttributes(item.templateId);
  const missing = Object.keys(wanted).filter((name) => item.attributes[name] === undefined
    || (name === "gender" && ![1, 2].includes(item.attributes.gender)));
  for (const name of missing) item.attributes[name] = wanted[name];
  return missing.length > 0;
}

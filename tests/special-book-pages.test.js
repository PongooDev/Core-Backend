import { test } from "node:test";
import assert from "node:assert/strict";
import { send, startBackend, userLogin } from "./helpers.js";

// The special collection book pages nothing grants: Hydraulic, Scavenger, the Storm Zone heroes, Vindertech and
// Lunar New Year's, each on every build whose data has it.
const builds = { "1.7.2": "3700114", "1.8": "3724489", "1.9": "3757339", "1.11": "3807424", "2.4.2": "3870737", "2.5": "3889387" };
const route = ({ accountId }, command, profileId) => `/fortnite/api/game/v2/profile/${accountId}/client/${command}?profileId=${profileId}&rvn=-1`;
function as(changelist, port, urlPath, token, body) {
  const text = JSON.stringify(body);
  const headers = { "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${changelist}`, Authorization: `bearer ${token}`,
    "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) };
  return send({ host: "127.0.0.1", port, method: "POST", path: urlPath, headers }, text);
}
const page = (id) => `CollectionBookPage:${id}`;
const stormZone = ["PageSpecial_Hydraulic", "PageSpecial_Hydraulic_Crystal", "PageSpecial_Scavenger", "PageSpecial_Scavenger_Crystal"];
const vindertech = ["PageSpecial_Weapons_Melee_StormZone2", "PageSpecial_Weapons_Melee_StormZone2_Crystal",
  "PageSpecial_Weapons_Ranged_StormZone2", "PageSpecial_Weapons_Ranged_StormZone2_Crystal"];
const lunarWeapons = ["PageSpecial_Weapons_ChineseNewYear2018", "PageSpecial_Weapons_Crystal_ChineseNewYear2018"];
const heroes = ["PageSpecial_Scavenger_Heroes", "PageSpecial_StormZone_Heroes"];
const expected = {
  "1.7.2": { schematics: stormZone, people: heroes },
  "1.8": { schematics: stormZone, people: heroes },
  "1.9": { schematics: [...stormZone, ...vindertech], people: heroes },
  "1.11": { schematics: [...stormZone, ...vindertech], people: heroes },
  "2.4.2": { schematics: [...stormZone, ...vindertech], people: heroes },
  "2.5": { schematics: [...stormZone, ...vindertech, ...lunarWeapons], people: ["PageSpecial_ChineseNewYear2018_Heroes", ...heroes] }
};

test("each build's book gets the special pages its data has and nothing grants, once", async () => {
  const backend = await startBackend();
  try {
    const query = async (changelist, player, profileId) =>
      (await as(changelist, backend.port, route(player, "QueryProfile", profileId), player.token, {})).body.profileChanges[0].profile;
    // The special pages besides the event ones (Fortnitemares', Survive the Holidays').
    const pages = (profile) => Object.values(profile.items).map((item) => item.templateId)
      .filter((templateId) => templateId.startsWith("CollectionBookPage:PageSpecial_") && !/Halloween2017|Winter2017/.test(templateId)).sort();

    for (const [build, { schematics, people }] of Object.entries(expected)) {
      const player = await userLogin(backend.port, `SpecialPages${build}`);
      assert.deepEqual(pages(await query(builds[build], player, "collection_book_schematics0")), schematics.map(page).sort(), build);
      assert.deepEqual(pages(await query(builds[build], player, "collection_book_people0")), people.map(page).sort(), build);
      // Loading the book again adds nothing.
      assert.deepEqual(pages(await query(builds[build], player, "collection_book_schematics0")), schematics.map(page).sort(), build);
    }
  } finally {
    backend.close();
  }
});

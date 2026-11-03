import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { send, startBackend, userLogin } from "./helpers.js";

// Survive the Holidays' collection book pages, the Vacuum Tube weapons' and the holiday heroes' (#187).
const builds = { "1.10": "3790078", "1.11": "3807424", "2.4": "3858292", "2.5": "3889387" };
const route = ({ accountId }, command, profileId) => `/fortnite/api/game/v2/profile/${accountId}/client/${command}?profileId=${profileId}&rvn=-1`;
function as(changelist, port, urlPath, token, body) {
  const text = JSON.stringify(body);
  const headers = { "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${changelist}`, Authorization: `bearer ${token}`,
    "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) };
  return send({ host: "127.0.0.1", port, method: "POST", path: urlPath, headers }, text);
}
const winterWeapons = ["PageSpecial_Weapons_Melee_Winter2017", "PageSpecial_Weapons_Melee_Winter2017_Crystal",
  "PageSpecial_Weapons_Ranged_Winter2017", "PageSpecial_Weapons_Ranged_Winter2017_Crystal"].map((id) => `CollectionBookPage:${id}`);

test("1.11 and later books have the Vacuum Tube weapons' and holiday heroes' pages, and the weapons slot; 1.10's doesn't", async () => {
  const backend = await startBackend();
  try {
    const query = async (changelist, player, profileId) =>
      (await as(changelist, backend.port, route(player, "QueryProfile", profileId), player.token, {})).body.profileChanges[0].profile;
    const pages = (profile) => Object.values(profile.items).filter((item) => item.templateId.includes("Winter2017"))
      .map((item) => item.templateId).sort();

    for (const build of ["1.11", "2.4", "2.5"]) {
      const player = await userLogin(backend.port, `WinterBook${build}`);
      assert.deepEqual(pages(await query(builds[build], player, "collection_book_schematics0")), winterWeapons, build);
      assert.deepEqual(pages(await query(builds[build], player, "collection_book_people0")), ["CollectionBookPage:PageSpecial_Winter2017_Heroes"], build);
      // Loading the book again adds nothing.
      assert.deepEqual(pages(await query(builds[build], player, "collection_book_schematics0")), winterWeapons, build);
    }

    // A Vacuum Tube assault rifle goes in its page's slot.
    const player = await userLogin(backend.port, "WinterBookSlot");
    await query(builds["1.11"], player, "collection_book_schematics0");
    const file = path.join(backend.dataDir, "accounts", player.accountId, "profiles", "profile0.json");
    const profile = JSON.parse(fs.readFileSync(file, "utf8"));
    profile.items.vacuumtube = { templateId: "Schematic:sid_assault_vacuumtube_sr_ore_t01", attributes: { level: 1 }, quantity: 1 };
    fs.writeFileSync(file, JSON.stringify(profile));
    const slotted = await as(builds["1.11"], backend.port, route(player, "SlotItemInCollectionBook", "profile0"), player.token, { itemId: "vacuumtube" });
    assert.equal(slotted.status, 200, JSON.stringify(slotted.body));
    const book = await query(builds["1.11"], player, "collection_book_schematics0");
    assert.equal(book.items.vacuumtube.templateId, "Schematic:sid_assault_vacuumtube_sr_ore_t01");

    // 1.10's data has no such pages.
    const other = await userLogin(backend.port, "WinterBook110");
    assert.deepEqual(pages(await query(builds["1.10"], other, "collection_book_schematics0")), []);
  } finally {
    backend.close();
  }
});

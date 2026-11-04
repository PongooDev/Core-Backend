import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { springBookPages } from "../src/events/spring2018.js";
import { send, startBackend, userLogin } from "./helpers.js";

// 3.3's (CL-3942182) Luck of the Storm: the Spring It On! category's People page (St. Patrick's heroes and the Leprechaun
// survivor) is in the book from the chapter's start, next to the Lunar New Year pages (#241).
const v33 = "3942182";
const v32 = "3935073";
const luckPage = "CollectionBookPage:PageSpecial_SpringItOn2018_People";
const route = ({ accountId }, command, profileId) => `/fortnite/api/game/v2/profile/${accountId}/client/${command}?profileId=${profileId}&rvn=-1`;
function as(changelist, port, urlPath, token, body) {
  const text = JSON.stringify(body);
  const headers = { "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${changelist}`, Authorization: `bearer ${token}`,
    "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) };
  return send({ host: "127.0.0.1", port, method: "POST", path: urlPath, headers }, text);
}

test("Luck of the Storm's page is a 3.3 book page and nothing before it", () => {
  assert.deepEqual(inBuild(v33, () => springBookPages()), ["PageSpecial_SpringItOn2018_People"]);
  assert.deepEqual(inBuild(v32, () => springBookPages()), []);
});

test("3.3's people book lists the Spring It On! page with the St. Patrick's section, once; 3.2's does not", async () => {
  const backend = await startBackend();
  try {
    const query = async (changelist, player) =>
      (await as(changelist, backend.port, route(player, "QueryProfile", "collection_book_people0"), player.token, {})).body.profileChanges[0].profile;
    const player = await userLogin(backend.port, "LuckOfTheStormBook");
    const before = Object.values((await query(v32, player)).items).filter((item) => item.templateId === luckPage);
    assert.equal(before.length, 0, "3.2 has no Luck of the Storm page");
    const profile = await query(v33, player);
    const pages = Object.values(profile.items).filter((item) => item.templateId === luckPage);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].attributes.state, "Active");
    // Loading the book again adds nothing.
    assert.equal(Object.values((await query(v33, player)).items).filter((item) => item.templateId === luckPage).length, 1);
  } finally {
    backend.close();
  }
});

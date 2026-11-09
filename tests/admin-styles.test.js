import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { setUpAthena, grantCosmetic } from "../src/profiles/athena.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { editItemStyles, styleTag } from "../src/profiles/variants.js";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #305: a cosmetic's styles added by hand in the admin panel (Locker items > Styles).
const v40 = "4039451";
const v111 = "3807424";
const agent40 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-4.0-CL-4039451";
const carbide = "AthenaCharacter:cid_115_athena_commando_m_carbideblue";

function queryAthena(port, { accountId, token }) {
  const text = "{}";
  return send({
    host: "127.0.0.1", port, method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=athena&rvn=-1`,
    headers: { "User-Agent": agent40, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }
  }, text).then(({ body }) => [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === "athena"))
    .then((update) => ({ ...update.profileChanges[0].profile, revision: update.profileRevision }));
}

test("style tags: a full gameplay tag is cut to its last part, anything else is refused", () => {
  assert.equal(styleTag("Cosmetics.Variant.Property.Mat2"), "Mat2");
  assert.equal(styleTag(" Material "), "Material");
  assert.equal(styleTag("bad tag"), null);
  assert.equal(styleTag(""), null);
});

test("editItemStyles adds channels and options, moves the active style, and keeps the cosmetic's own", () => inBuild(v40, () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-admin-styles-"));
  try {
    const session = openSession(createProfileStore(dataDir), "styles");
    setUpAthena(session);
    grantCosmetic(session, carbide);
    const { profile } = session.profile("athena");
    const itemId = Object.keys(profile.items).find((id) => profile.items[id].templateId.toLowerCase() === carbide.toLowerCase());

    assert.equal(editItemStyles(session, itemId, [{ channel: "Progressive", tags: ["Stage1", "stage2"], active: "Stage2" }]).changed, true);
    assert.equal(editItemStyles(session, itemId, [{ channel: "Material", tags: ["Mat1", "Mat2", "Mat3"] }]).changed, true);
    assert.deepEqual(profile.items[itemId].attributes.variants, [
      { channel: "Progressive", active: "Stage2", owned: ["Stage0", "Stage1", "Stage2"] },
      { channel: "Material", active: "Mat1", owned: ["Mat1", "Mat2", "Mat3"] }]);
    assert.equal(editItemStyles(session, itemId, [{ channel: "Material", tags: ["Mat2"] }]).changed, false, "owned already");

    // Taking styles off: the active one moves to an owned one, Stage0 (owned with the cosmetic) stays, an empty channel goes.
    const removed = editItemStyles(session, itemId, [{ channel: "Progressive", tags: ["Stage0", "Stage2"] }, { channel: "Material", tags: ["Mat1", "Mat2", "Mat3"] }], { remove: true });
    assert.deepEqual(removed, { changed: true, kept: ["Progressive.Stage0"] });
    assert.deepEqual(profile.items[itemId].attributes.variants, [{ channel: "Progressive", active: "Stage0", owned: ["Stage0", "Stage1"] }]);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}));

test("the admin panel adds styles to an owned cosmetic, and the client sees them at its next QueryProfile", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "StylesPlayer");
    const stylesPath = `/admin/api/accounts/${player.accountId}/cosmetics/styles`;
    const save = (body) => post(backend.port, stylesPath, undefined, body);
    const read = (build, templateId) => get(backend.port, `${stylesPath}?${new URLSearchParams({ build, templateId })}`);

    // No profile, not owned: nothing to style.
    assert.match((await save({ build: v40, templateId: carbide, styles: [{ channel: "Progressive", tags: ["Stage1"] }] })).body.errorMessage, /no Battle Royale profile/);
    assert.equal((await post(backend.port, `/admin/api/accounts/${player.accountId}/cosmetics/grant`, undefined, { build: v40, templateIds: [carbide] })).status, 200);

    // The build's data names Carbide's channel and options; another build's data is used when the chosen one has none.
    let styles = (await read(v40, carbide)).body;
    assert.equal(styles.owned, true);
    assert.deepEqual(styles.data.channels, [{ channel: "Progressive", default: "Stage0", options: ["Stage0", "Stage1", "Stage2", "Stage3", "Stage4", "Stage5"] }]);
    assert.deepEqual(styles.variants, [{ channel: "Progressive", active: "Stage0", owned: ["Stage0"] }]);
    assert.equal((await read(v111, carbide)).body.data.build !== v111, true);
    assert.equal((await read(v40, "CID_115_Athena_Commando_M_CarbideBlue")).body.templateId, carbide, "the id without its type");
    const notOwned = (await read(v40, "AthenaCharacter:cid_116_athena_commando_m_carbideblack")).body;
    assert.equal(notOwned.owned, false);

    const before = await queryAthena(backend.port, player);
    const saved = await save({ build: v40, templateId: carbide, styles: [
      { channel: "Progressive", tags: ["Stage1", "Stage2", "Stage3", "Stage4"], active: "Stage4" },
      { channel: "Cosmetics.Variant.Channel.Material", tags: "Mat1, Mat2 Mat3" }] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.styleChange.changed, true);
    const expected = [
      { channel: "Progressive", active: "Stage4", owned: ["Stage0", "Stage1", "Stage2", "Stage3", "Stage4"] },
      { channel: "Material", active: "Mat1", owned: ["Mat1", "Mat2", "Mat3"] }];
    assert.deepEqual(saved.body.styleChange.variants, expected);

    const after = await queryAthena(backend.port, player);
    assert.ok(after.revision > before.revision, `the profile revision moved: ${before.revision} to ${after.revision}`);
    const item = Object.values(after.items).find((entry) => entry.templateId.toLowerCase() === carbide.toLowerCase());
    assert.deepEqual(item.attributes.variants, expected);

    // Refused: a bad channel or tag, nothing asked, a cosmetic not owned, another build.
    assert.equal((await save({ build: v40, templateId: carbide, styles: [{ channel: "no good", tags: ["Mat1"] }] })).status, 400);
    assert.equal((await save({ build: v40, templateId: carbide, styles: [{ channel: "Material", tags: ["Mat 1!"] }] })).status, 400);
    assert.equal((await save({ build: v40, templateId: carbide, styles: [] })).status, 400);
    assert.match((await save({ build: v40, templateId: "AthenaCharacter:cid_116_athena_commando_m_carbideblack", styles: [{ channel: "Progressive", tags: ["Stage1"] }] })).body.errorMessage, /give it first/);
    assert.equal((await save({ build: "123", templateId: carbide, styles: [{ channel: "Progressive", tags: ["Stage1"] }] })).status, 400);

    // Taking one off.
    const off = await save({ build: v40, templateId: carbide, remove: true, styles: [{ channel: "Material", tags: ["Mat3"] }] });
    assert.deepEqual(off.body.styleChange.variants[1], { channel: "Material", active: "Mat1", owned: ["Mat1", "Mat2"] });
  } finally {
    await backend.close();
  }
});

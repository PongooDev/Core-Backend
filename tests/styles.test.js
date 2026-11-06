import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inBuild } from "../src/builds/context.js";
import { athenaCosmetics } from "../src/gamedata/athena.js";
import { athenaNeedsSetUp, grantCosmetic, setUpAthena } from "../src/profiles/athena.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { defaultVariants, itemsMissingVariants } from "../src/profiles/variants.js";

// Core-Backend #259: the styles an owned cosmetic comes with (profiles/variants.js). Epic gave every style no challenge or
// token gates; Carbide's and Omega's armour stages stay locked until the progressive challenges give their tokens.
const v40 = "4039451";
const v36 = "4019403";
const carbide = "AthenaCharacter:cid_115_athena_commando_m_carbideblue";
const omega = "AthenaCharacter:cid_116_athena_commando_m_carbideblack";

function withSession(build, name, run) {
  return inBuild(build, () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-styles-"));
    try {
      return run(openSession(createProfileStore(dataDir), name));
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
}

// An item as a profile from before 4.0's styles (or a build without them) holds it: no variants.
const plainItem = (templateId) => ({ templateId, attributes: { level: 1, item_seen: 1, favorite: 0 }, quantity: 1 });

test("a cosmetic comes with its ungated styles: Carbide's and Omega's Stage0, their stages left to the tokens", () => inBuild(v40, () => {
  for (const id of [carbide, omega]) assert.deepEqual(defaultVariants(id), [{ channel: "Progressive", active: "Stage0", owned: ["Stage0"] }]);
  assert.deepEqual(defaultVariants("AthenaCharacter:cid_001_athena_commando_f_default"), []);
}));

test("a style no token gates is owned with the cosmetic", () => inBuild(v40, () => {
  const cosmetics = athenaCosmetics();
  const fake = "AthenaCharacter:cid_core_test_styles";
  cosmetics[fake] = { name: "Test", variants: [{ channel: "Material", default: "Mat1", options: ["Mat1", "Mat2", "Mat3"], unlocked: [] }] };
  try {
    assert.deepEqual(defaultVariants(fake), [{ channel: "Material", active: "Mat1", owned: ["Mat1", "Mat2", "Mat3"] }]);
  } finally {
    delete cosmetics[fake];
  }
}));

test("granting Carbide gives its default style", () => withSession(v40, "grant", (session) => {
  setUpAthena(session);
  grantCosmetic(session, carbide);
  assert.deepEqual(session.profile("athena").profile.items[carbide].attributes.variants, [{ channel: "Progressive", active: "Stage0", owned: ["Stage0"] }]);
}));

test("profile load: an owned Carbide without styles gets them, an earned stage and the active style are kept", () => withSession(v40, "migrate", (session) => {
  setUpAthena(session);
  const tracker = session.profile("athena");
  const { profile } = tracker;
  profile.items[carbide] = plainItem(carbide);
  profile.items[omega] = { ...plainItem(omega), attributes: { ...plainItem(omega).attributes,
    variants: [{ channel: "Progressive", active: "Stage3", owned: ["Stage1", "Stage2", "Stage3"] }] } };
  assert.deepEqual(itemsMissingVariants(profile).sort(), [carbide, omega]);
  assert.equal(athenaNeedsSetUp(profile, session.settings ?? {}), true);
  setUpAthena(session);
  assert.deepEqual(profile.items[carbide].attributes.variants, [{ channel: "Progressive", active: "Stage0", owned: ["Stage0"] }]);
  assert.deepEqual(profile.items[omega].attributes.variants, [{ channel: "Progressive", active: "Stage3", owned: ["Stage0", "Stage1", "Stage2", "Stage3"] }]);
  assert.deepEqual(itemsMissingVariants(profile), []);
  assert.equal(athenaNeedsSetUp(profile, session.settings ?? {}), false, "settled once");
}));

test("a build without styles leaves items as they are", () => withSession(v36, "nostyles", (session) => {
  setUpAthena(session);
  const { profile } = session.profile("athena");
  const itemId = Object.keys(athenaCosmetics()).find((id) => /^athenacharacter:cid_0[1-9]\d_athena_commando_/.test(id.toLowerCase()));
  profile.items[itemId] = plainItem(itemId);
  const before = structuredClone(profile.items[itemId]);
  assert.deepEqual(itemsMissingVariants(profile), []);
  setUpAthena(session);
  assert.deepEqual(profile.items[itemId], before);
  assert.equal(profile.items[itemId].attributes.variants, undefined);
}));

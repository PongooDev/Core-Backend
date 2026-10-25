import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { singleGrantCap, singleGrantConfirm } from "../src/admin/routes.js";
import { grant } from "../src/profiles/progress.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { get, post, startBackend, userLogin } from "./helpers.js";

// Issue #34: a big grant of single items (one profile item per unit) froze the backend and made the panel unusable.
const command = (accountId, name) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=-1`;
const survivor = "Worker:workerbasic_sr_t01";
const hero = "Hero:hid_constructor_007_r_t01";

test("the panel caps a grant of single items at singleGrantCap, and only single items", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "LimitPlayer");
    const grantPath = `/admin/api/accounts/${player.accountId}/grant`;

    const catalog = (await get(backend.port, "/admin/api/catalog?search=workerbasic_sr_t01")).body;
    assert.deepEqual([catalog.singleGrantCap, catalog.singleGrantConfirm], [singleGrantCap, singleGrantConfirm]);
    assert.equal(catalog.items.find((item) => item.templateId === survivor).single, true);
    const stackable = (await get(backend.port, "/admin/api/catalog?search=mtxgiveaway")).body.items.find((item) => item.templateId === "Currency:mtxgiveaway");
    assert.equal(stackable.single, false);

    const refused = await post(backend.port, grantPath, undefined, { templateId: survivor, quantity: singleGrantCap + 1 });
    assert.equal(refused.status, 400);
    assert.match(refused.body.errorMessage, new RegExp(`at most ${singleGrantCap}`));
    assert.equal(Object.values((await post(backend.port, command(player.accountId, "QueryProfile"), player.token, {})).body.profileChanges[0].profile.items)
      .filter((item) => item.templateId === survivor).length, 0, "a refused grant gives nothing");

    const given = await post(backend.port, grantPath, undefined, { templateId: survivor, quantity: singleGrantCap });
    assert.equal(given.status, 200);
    assert.equal(given.body.granted, singleGrantCap);
    assert.equal(given.body.items.filter((item) => item.templateId === survivor).length, singleGrantCap);

    // Stacking items are one stack whatever the quantity; skill tree nodes and quests are owned once.
    assert.equal((await post(backend.port, grantPath, undefined, { templateId: "Currency:mtxgiveaway", quantity: 100000 })).status, 200);
    assert.equal((await post(backend.port, grantPath, undefined, { templateId: "AccountResource:heroxp", quantity: singleGrantCap * 10 })).status, 200);
  } finally {
    backend.close();
  }
});

test("a grant of thousands of single items takes time in proportion to its size", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-"));
  try {
    const profiles = createProfileStore(dataDir);
    const accountId = "0".repeat(32);
    const setup = openSession(profiles, accountId);
    setup.profile("profile0");
    setup.commit();
    // Before #34 each item scanned every quest of the profile again: 5,000 survivors took 6.5 s, 10,000 21 s.
    const session = openSession(profiles, accountId);
    const started = performance.now();
    assert.equal(grant(session, survivor, 5000).length, 5000);
    session.commit();
    assert.ok(performance.now() - started < 3000, `5,000 survivors took ${Math.round(performance.now() - started)} ms`);
    assert.equal(Object.values(profiles.load(accountId, "profile0").items).filter((item) => item.templateId === survivor).length, 5000);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("the panel removes the extra copies of a template, keeping squad members and favourites", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "CopiesPlayer");
    await post(backend.port, command(player.accountId, "SkipTutorial"), player.token, {});
    const admin = (route, body) => post(backend.port, `/admin/api/accounts/${player.accountId}/${route}`, undefined, body);
    const run = (name, body) => post(backend.port, command(player.accountId, name), player.token, body);
    const copies = async () => Object.entries((await run("QueryProfile", {})).body.profileChanges[0].profile.items).filter(([, item]) => item.templateId === hero);

    assert.equal((await admin("grant", { templateId: hero, quantity: 30 })).status, 200);
    const [[slotted], [favourite]] = await copies();
    assert.equal((await run("AssignWorkerToSquad", { characterId: slotted, squadId: "Squad_Combat_AdventureSquadOne", slotIndex: 0 })).status, 200);
    await run("SetItemFavoriteStatus", { targetItemId: favourite, bFavorite: true });

    assert.equal((await admin("items/remove-template", { profileId: "profile0", templateId: "Hero:nope" })).status, 400);
    assert.equal((await admin("items/remove-template", { profileId: "profile0", templateId: hero, keep: -1 })).status, 400);
    assert.equal((await admin("items/remove-template", { profileId: "nope0", templateId: hero })).status, 400);

    let details = (await admin("items/remove-template", { profileId: "profile0", templateId: hero, keep: 2 })).body;
    assert.deepEqual([details.removed, details.kept], [28, 2]);
    assert.deepEqual((await copies()).map(([itemId]) => itemId).sort(), [slotted, favourite].sort());
    assert.equal(details.items.filter((item) => item.templateId === hero).length, 2);

    // Nothing kept on purpose: the squad member still stays.
    details = (await admin("items/remove-template", { profileId: "profile0", templateId: hero, keep: 0 })).body;
    assert.deepEqual([details.removed, details.kept], [1, 1]);
    assert.deepEqual((await copies()).map(([itemId]) => itemId), [slotted]);
  } finally {
    backend.close();
  }
});

test("removing copies frees the vault: the items that overflowed go first and the rest come back", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "VaultPlayer");
    await post(backend.port, command(player.accountId, "SkipTutorial"), player.token, {});
    const admin = (route, body) => post(backend.port, `/admin/api/accounts/${player.accountId}/${route}`, undefined, body);
    let details;
    for (let given = 0; given < 600; given += 300) details = (await admin("grant", { templateId: survivor, quantity: 300 })).body;
    assert.ok(details.vault.count > details.vault.limit);
    assert.equal(details.vault.overflow, details.vault.count - details.vault.limit);
    const overflowing = details.vault.overflow;
    const inVault = details.items.filter((item) => item.templateId === survivor && !item.overflow).map((item) => item.itemId).sort();

    details = (await admin("items/remove-template", { profileId: "profile0", templateId: survivor, keep: 600 - overflowing })).body;
    assert.equal(details.removed, overflowing);
    assert.equal(details.vault.overflow, 0);
    assert.deepEqual(details.items.filter((item) => item.templateId === survivor).map((item) => item.itemId).sort(), inVault);
  } finally {
    backend.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { get, post, startBackend, userLogin } from "./helpers.js";

// CoreV2 #494: the panel gave one quest at a time. grant-quests gives a picked or filtered list in one request, each the
// way /grant gives one.
const admin = (backend, path, body) => (body === undefined ? get(backend.port, `/admin/api${path}`) : post(backend.port, `/admin/api${path}`, undefined, body));

test("the panel gives several quests in one request, and lists the ids of a filtered list", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "QuestsPlayer");
    const ids = (await admin(backend, "/catalog/ids?search=outpostquest_t1&category=quests")).body;
    assert.ok(ids.total >= 3 && ids.templateIds.length === ids.total);
    assert.ok(ids.templateIds.every((id) => id.startsWith("Quest:")));
    const picked = ids.templateIds.slice(0, 3);

    // One already held is left as it is, a repeated id counts once.
    assert.equal((await admin(backend, `/accounts/${player.accountId}/grant`, { templateId: picked[0], quantity: 1 })).status, 200);
    const given = await admin(backend, `/accounts/${player.accountId}/grant-quests`, { templateIds: [...picked, picked[1]] });
    assert.equal(given.status, 200);
    assert.deepEqual(given.body.questGrant, { requested: 3, granted: 2, alreadyHeld: 1, notGiven: 0 });
    for (const id of picked) {
      const quest = given.body.quests.find((entry) => `quest:${entry.questId}` === id.toLowerCase());
      assert.equal(quest?.state, "Active", id);
    }
    assert.equal(given.body.quests.filter((entry) => picked.some((id) => id.toLowerCase() === `quest:${entry.questId}`)).length, 3);

    // The whole filtered list, in one request.
    const all = await admin(backend, `/accounts/${player.accountId}/grant-quests`, { templateIds: ids.templateIds });
    assert.equal(all.status, 200);
    assert.equal(all.body.questGrant.granted + all.body.questGrant.alreadyHeld + all.body.questGrant.notGiven, ids.total);
    assert.equal(all.body.questGrant.alreadyHeld, 3);
  } finally {
    backend.close();
  }
});

test("a request with something that isn't a known quest gives nothing", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "QuestsRefused");
    const base = `/accounts/${player.accountId}/grant-quests`;
    const quest = (await admin(backend, "/catalog/ids?search=outpostquest_t1&category=quests")).body.templateIds[0];
    for (const templateIds of [[], undefined, [quest, "Hero:hid_constructor_007_r_t01"], [quest, "Quest:no_such_quest_494"], [quest, "nonsense"]]) {
      const refused = await admin(backend, base, { templateIds });
      assert.equal(refused.status, 400, JSON.stringify(templateIds));
    }
    const details = (await admin(backend, `/accounts/${player.accountId}`)).body;
    assert.equal(details.quests.some((entry) => `quest:${entry.questId}` === quest.toLowerCase()), false, "a refused request gives nothing");
  } finally {
    backend.close();
  }
});

test("the panel's Give section picks several quests", async () => {
  const backend = await startBackend();
  try {
    const html = (await get(backend.port, "/admin")).body;
    const page = typeof html === "string" ? html : String(html);
    assert.match(page, /Pick several quests/);
    assert.match(page, /grant-quests/);
    assert.match(page, /catalog\/ids/);
  } finally {
    backend.close();
  }
});

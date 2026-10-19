import { test } from "node:test";
import assert from "node:assert/strict";
import { getQuest } from "../src/gamedata/quests.js";
import { readGameData } from "../src/gamedata/read.js";
import { post, startBackend, userLogin } from "./helpers.js";

const command = (accountId, name, rvn = -1) => `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=profile0&rvn=${rvn}`;
const heroes = (profile) => Object.entries(profile.items).filter(([, item]) => item.templateId.startsWith("Hero:"));

test("the default hero is the one DefaultGameData names", () => {
  assert.deepEqual(readGameData("newaccount"), { defaultHero: "Hero:hid_commando_grenadegun_uc_t01" });
});

test("a new account's first login changes nothing after its first QueryProfile", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "FirstLogin");
    const first = await post(backend.port, command(accountId, "QueryProfile"), token, {});
    const rvn = first.body.profileRevision;
    const { profile } = first.body.profileChanges[0];
    const quest = Object.values(profile.items).find((item) => item.templateId === "Quest:homebaseonboarding");
    assert.equal(quest.attributes.quest_state, "Active");
    for (const objective of getQuest("homebaseonboarding").objectives) assert.equal(quest.attributes[`completion_${objective.name}`], 0);

    // What the client sends next, with the revision it holds (2026-10-19 crash: these came back as full profile updates).
    for (const name of ["ClientQuestLogin", "RefreshExpeditions", "QueryProfile"]) {
      const reply = await post(backend.port, command(accountId, name, rvn), token, {});
      assert.equal(reply.status, 200, name);
      assert.equal(reply.body.profileRevision, rvn, name);
      assert.deepEqual(reply.body.profileChanges, [], name);
    }
  } finally {
    backend.close();
  }
});

test("a new account starts with Ramirez as the lead hero of the default hero squad", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "NewHero");
    const { profile } = (await post(backend.port, command(accountId, "QueryProfile"), token, {})).body.profileChanges[0];
    const [[heroId, hero], ...others] = heroes(profile);
    assert.equal(others.length, 0);
    assert.equal(hero.templateId, "Hero:hid_commando_grenadegun_uc_t01");
    assert.equal(hero.attributes.level, 1);
    assert.equal(hero.attributes.squad_id, profile.stats.attributes.default_hero_squad_id);
    assert.equal(hero.attributes.squad_id, "Squad_Combat_AdventureSquadOne");
    assert.equal(hero.attributes.squad_slot_idx, 0);
    assert.match(heroId, /^[0-9a-f-]{36}$/);
  } finally {
    backend.close();
  }
});

test("a profile left with no hero gets the default one back when it next loads", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "NoHero");
    const { profile } = (await post(backend.port, command(accountId, "QueryProfile"), token, {})).body.profileChanges[0];
    const [[heroId]] = heroes(profile);
    assert.equal((await post(backend.port, `/admin/api/accounts/${accountId}/items/remove`, undefined, { itemId: heroId })).status, 200);

    const after = (await post(backend.port, command(accountId, "QueryProfile"), token, {})).body.profileChanges[0].profile;
    const [[newId, hero], ...others] = heroes(after);
    assert.equal(others.length, 0);
    assert.notEqual(newId, heroId);
    assert.equal(hero.attributes.squad_slot_idx, 0);
  } finally {
    backend.close();
  }
});

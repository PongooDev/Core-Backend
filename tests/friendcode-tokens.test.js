import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { codePattern } from "../src/friendcodes/store.js";
import { get, post, startBackend, userLogin } from "./helpers.js";

// Core-Backend #35: founder's friend codes.
const friendCode = "ConsumableAccountItem:foundersfriendcode";
const codeToken = "CodeToken:founderfriendinvite";

async function account(backend, username) {
  const login = await userLogin(backend.port, username);
  const run = (name, body = {}) => post(backend.port, `/fortnite/api/game/v2/profile/${login.accountId}/client/${name}?profileId=profile0&rvn=-1`, login.token, body);
  const items = async () => Object.values((await run("QueryProfile")).body.profileChanges[0].profile.items);
  const quantity = async (templateId) => (await items()).filter((item) => item.templateId === templateId).reduce((sum, item) => sum + item.quantity, 0);
  const codes = async () => (await get(backend.port, `/fortnite/api/game/v2/friendcodes/${login.accountId}/epic`, login.token)).body;
  const give = (templateId, amount) => post(backend.port, `/admin/api/accounts/${login.accountId}/grant`, undefined, { templateId, quantity: amount });
  return { ...login, run, items, quantity, codes, give };
}

test("a founder's friend code is consumed as it is granted into a Founder's Pack Code token", async () => {
  const backend = await startBackend();
  try {
    const player = await account(backend, "FriendCodeGrant");
    assert.equal((await player.give(friendCode, 2)).status, 200);
    assert.equal(await player.quantity(friendCode), 0);
    assert.equal(await player.quantity(codeToken), 2);
  } finally {
    backend.close();
  }
});

test("a friend code already in a saved profile becomes its token when the profile next loads", async () => {
  const backend = await startBackend();
  try {
    const player = await account(backend, "FriendCodeHeld");
    await player.run("QueryProfile");
    const file = path.join(backend.dataDir, "accounts", player.accountId, "profiles", "profile0.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    saved.items[crypto.randomUUID()] = { templateId: friendCode, attributes: { item_seen: false }, quantity: 1 };
    fs.writeFileSync(file, JSON.stringify(saved));

    assert.equal(await player.quantity(friendCode), 0);
    assert.equal(await player.quantity(codeToken), 1);
  } finally {
    backend.close();
  }
});

test("IssueFriendCode turns a code token into a unique code the friend codes list shows", async () => {
  const backend = await startBackend();
  try {
    const player = await account(backend, "FriendCodeIssuer");
    const other = await account(backend, "FriendCodeOther");
    assert.deepEqual(await player.codes(), []);
    await player.give(friendCode, 2);

    const issued = [];
    for (let i = 0; i < 2; i++) {
      const reply = await player.run("IssueFriendCode", { codeTokenType: codeToken });
      assert.equal(reply.status, 200);
      const [notification] = reply.body.notifications;
      assert.deepEqual(Object.keys(notification), ["type", "primary", "code", "codeType"]);
      assert.equal(notification.type, "friendCodeIssued");
      assert.equal(notification.primary, true);
      assert.match(notification.code, codePattern);
      assert.equal(notification.codeType, codeToken);
      issued.push(notification.code);
    }
    assert.notEqual(issued[0], issued[1]);
    assert.equal(await player.quantity(codeToken), 0);

    const refused = await player.run("IssueFriendCode", { codeTokenType: codeToken });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.errorCode, "errors.com.epicgames.fortnite.item_not_found");
    assert.equal((await player.run("IssueFriendCode", {})).status, 400);

    const listed = await player.codes();
    assert.deepEqual(listed.map(({ codeId, codeType }) => [codeId, codeType]), issued.map((code) => [code, codeToken]));
    listed.forEach(({ dateCreated }) => assert.ok(Date.parse(dateCreated)));
    assert.deepEqual(await other.codes(), []);
    assert.deepEqual((await get(backend.port, `/fortnite/api/game/v2/friendcodes/${player.accountId}/xbl`, player.token)).body, []);

    // Kept server side with who issued it.
    const saved = JSON.parse(fs.readFileSync(path.join(backend.dataDir, "friendcodes.json"), "utf8"));
    for (const code of issued) {
      assert.equal(saved.codes[code].accountId, player.accountId);
      assert.equal(saved.codes[code].codeType, codeToken);
    }
  } finally {
    backend.close();
  }
});

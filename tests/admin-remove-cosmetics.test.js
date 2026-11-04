import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { athenaCosmetics } from "../src/gamedata/athena.js";
import { isForeignTemplate } from "../src/gamedata/templates.js";
import { createFrameParser, encodeFrame } from "../src/stomp/service.js";
import { get, post, send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #159: the admin panel's Remove selected, next to Give selected: owned cosmetics out of the locker, the
// slots showing them back to their default, starters and earned cosmetics kept.
const v111 = "3807424";
const agent111 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3807424";

function command(port, { accountId, token }, name, body = {}) {
  const text = JSON.stringify(body);
  return send({
    host: "127.0.0.1", port, method: "POST",
    path: `/fortnite/api/game/v2/profile/${accountId}/client/${name}?profileId=athena&rvn=-1`,
    headers: { "User-Agent": agent111, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) }
  }, text);
}
const athena = async (port, player) => {
  const { body } = await command(port, player, "QueryProfile");
  return [body, ...(body.multiUpdate ?? [])].find((update) => update.profileId === "athena").profileChanges[0].profile;
};

async function stompClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/stomp`, ["v10.stomp", "v11.stomp", "v12.stomp"]);
  ws.binaryType = "arraybuffer";
  const frames = [];
  const waiters = [];
  const parse = createFrameParser((frame) => {
    const waiter = waiters.shift();
    if (waiter) waiter(frame);
    else frames.push(frame);
  });
  ws.addEventListener("message", (event) => parse(Buffer.from(typeof event.data === "string" ? event.data : new Uint8Array(event.data))));
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return {
    ws,
    send: (name, headers, body) => ws.send(encodeFrame(name, headers, body)),
    next: () => (frames.length ? Promise.resolve(frames.shift()) : new Promise((resolve) => waiters.push(resolve)))
  };
}

test("the admin panel removes single cosmetics, resets the slots showing them, and keeps starters", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "RemoveCosmetic");
    const give = (templateIds) => post(backend.port, `/admin/api/accounts/${player.accountId}/cosmetics/grant`, undefined, { build: v111, templateIds });
    const remove = (body) => post(backend.port, `/admin/api/accounts/${player.accountId}/cosmetics/remove`, undefined, body);

    // No Battle Royale profile yet: nothing to remove, and none is made.
    const none = await remove({ build: v111, templateIds: ["AthenaGlider:glider_prismatic"] });
    assert.equal(none.status, 400);
    assert.match(none.body.errorMessage, /no Battle Royale profile/);

    const ids = Object.keys(inBuild(v111, athenaCosmetics));
    const pick = (type, not) => ids.find((id) => id.toLowerCase().startsWith(`${type.toLowerCase()}:`) && !not.test(id));
    const outfit = pick("AthenaCharacter", /cid_00\d_/i);
    const emote = pick("AthenaDance", /eid_dancemoves/i);
    const glider = "AthenaGlider:glider_prismatic";
    const pickaxe = "AthenaPickaxe:halloweenscythe";
    assert.equal((await give([outfit, emote, glider, pickaxe])).status, 200);

    // Equipped: 1.11's six emote slots hold the emote twice and the starter emote once.
    let profile = await athena(backend.port, player);
    const starterEmote = Object.keys(profile.items).find((id) => id.toLowerCase() === "athenadance:eid_dancemoves");
    for (const [slotName, itemToSlot, indexWithinSlot] of [["Character", outfit], ["Glider", glider], ["Pickaxe", pickaxe],
      ["Dance", emote, 0], ["Dance", starterEmote, 2], ["Dance", emote, 4]]) {
      const equipped = await command(backend.port, player, "EquipBattleRoyaleCustomization", { slotName, itemToSlot, indexWithinSlot });
      assert.equal(equipped.status, 200, JSON.stringify(equipped.body));
    }
    profile = await athena(backend.port, player);
    assert.deepEqual(profile.stats.attributes.favorite_dance, [emote, "", starterEmote, "", emote, ""]);

    // Refused as a whole: another build, a template the build hasn't, nothing picked.
    for (const body of [{ build: "3700114", templateIds: [glider] }, { build: v111, templateIds: [glider, "AthenaGlider:not_real"] }, { build: v111, templateIds: [] }]) {
      assert.equal((await remove(body)).status, 400, JSON.stringify(body));
    }
    assert.ok((await athena(backend.port, player)).items[glider]);

    // The player is online: the removal reaches their client as an athena notification.
    const client = await stompClient(backend.port);
    try {
      client.send("CONNECT", { "accept-version": "1.2", login: player.accountId, passcode: player.token });
      await client.next();
      client.send("SUBSCRIBE", { id: "mcp-0-nil", destination: `/topic/fn/profile/${player.accountId}/fortnite`, receipt: "r" });
      await client.next();

      const removed = await remove({ build: v111, templateIds: [outfit, emote, glider, pickaxe.toUpperCase(), "AthenaGlider:defaultglider",
        "AthenaDance:eid_dancemoves", "AthenaCharacter:cid_029_athena_commando_f_halloween"] });
      assert.equal(removed.status, 200, JSON.stringify(removed.body));
      assert.deepEqual(removed.body.cosmeticRemoval, {
        build: v111, version: "1.11", removed: [outfit, emote, glider, pickaxe],
        notOwned: ["AthenaCharacter:cid_029_athena_commando_f_halloween"],
        kept: [{ templateId: "AthenaGlider:DefaultGlider", reason: "a starter cosmetic every account is given back" },
          { templateId: "AthenaDance:EID_DanceMoves", reason: "a starter cosmetic every account is given back" }]
          .map(({ templateId, reason }) => ({ templateId: ids.find((id) => id.toLowerCase() === templateId.toLowerCase()), reason }))
      });
      // The changes made while nobody was subscribed (the gives and equips above) reach the subscription first (#236).
      let notification = JSON.parse((await client.next()).body);
      while (!notification.changes.some((change) => change.changeType === "itemRemoved")) notification = JSON.parse((await client.next()).body);
      assert.equal(notification.type, "profile/athena/update");
      // As with give, the notification leaves out templates foreign to the build it's made for (gamedata/templates.js).
      assert.deepEqual(notification.changes.filter((change) => change.changeType === "itemRemoved").map((change) => change.itemId).sort(),
        [outfit, emote, glider, pickaxe].filter((id) => !isForeignTemplate(id)).sort());
      assert.ok(notification.changes.some((change) => change.changeType === "statModified" && change.name === "favorite_glider"));
    } finally {
      client.ws.close();
    }

    // Gone, with the slots back to the build's defaults: "" for the outfit and emotes, the default glider and pickaxe.
    profile = await athena(backend.port, player);
    for (const id of [outfit, emote, glider, pickaxe]) assert.ok(!profile.items[id], id);
    const { attributes } = profile.stats;
    assert.equal(attributes.favorite_character, "");
    assert.equal(attributes.favorite_glider.toLowerCase(), "athenaglider:defaultglider");
    assert.equal(attributes.favorite_pickaxe.toLowerCase(), "athenapickaxe:defaultpickaxe");
    assert.deepEqual(attributes.favorite_dance, ["", "", starterEmote, "", "", ""]);
    assert.ok(profile.items[starterEmote] && Object.keys(profile.items).some((id) => id.toLowerCase() === "athenaglider:defaultglider"));

    // A cosmetic the full locker gave is no longer its to take back once removed.
    await post(backend.port, `/admin/api/accounts/${player.accountId}/locker/grant-all`, undefined, {});
    const before = (await get(backend.port, `/admin/api/accounts/${player.accountId}`)).body.locker.granted;
    const again = await remove({ build: v111, templateIds: [glider] });
    assert.deepEqual(again.body.cosmeticRemoval.removed, [glider]);
    assert.equal(again.body.locker.granted, before - 1);
  } finally {
    backend.close();
  }
});

test("Remove selected refuses when giveAllCosmetics gives every cosmetic back", async () => {
  const backend = await startBackend({ giveAllCosmetics: true });
  try {
    const player = await userLogin(backend.port, "GiveAllRemove");
    await athena(backend.port, player);
    const refused = await post(backend.port, `/admin/api/accounts/${player.accountId}/cosmetics/remove`, undefined,
      { build: v111, templateIds: ["AthenaGlider:glider_prismatic"] });
    assert.equal(refused.status, 400);
    assert.match(refused.body.errorMessage, /giveAllCosmetics/);
    assert.ok((await athena(backend.port, player)).items["AthenaGlider:glider_prismatic"]);
  } finally {
    backend.close();
  }
});

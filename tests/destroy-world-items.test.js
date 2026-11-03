import { test } from "node:test";
import assert from "node:assert/strict";
import { dedicatedServerToken, post, send, startBackend, userLogin } from "./helpers.js";

// The Save the World backpack's Destroy, DestroyWorldItems {itemIds} on theater0 (1.10 to 2.5).
const v111 = "3807424";
const v25 = "3889387";
const route = (accountId, side, name, profileId) => `/fortnite/api/game/v2/profile/${accountId}/${side}/${name}?profileId=${profileId}&rvn=-1`;
function as(changelist, port, urlPath, token, body) {
  const text = JSON.stringify(body);
  const headers = { "User-Agent": `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${changelist}`, Authorization: `bearer ${token}`,
    "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) };
  return send({ host: "127.0.0.1", port, method: "POST", path: urlPath, headers }, text);
}

test("DestroyWorldItems throws whole backpack stacks away and empties their quickbar slots", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "DestroyPlayer");
    const dedicated = await dedicatedServerToken(backend.port);
    await post(backend.port, route(player.accountId, "dedicated_server", "BatchUpdatePlayer", "theater0"), dedicated, {
      theaterItemUpdate: { addRequests: [
        { itemId: "bbbbbbbb-0000-0000-0000-000000000001", templateId: "WorldItem:wooditemdata", quantity: 300, attributes: {} },
        { itemId: "bbbbbbbb-0000-0000-0000-000000000002", templateId: "Trap:tid_floor_spikes_r_t01", quantity: 5, attributes: {} },
        { itemId: "bbbbbbbb-0000-0000-0000-000000000003", templateId: "Ingredient:ingredient_blastpowder", quantity: 2, attributes: {} }
      ] }, outpostItemUpdate: {}, questObjectiveUpdates: []
    });
    await as(v111, backend.port, route(player.accountId, "client", "ModifyQuickbar", "theater0"), player.token,
      { primaryQuickbarChoices: [], secondaryQuickbarChoice: "bbbbbbbb-0000-0000-0000-000000000002" });
    const destroy = (itemIds, changelist = v111, profileId = "theater0") =>
      as(changelist, backend.port, route(player.accountId, "client", "DestroyWorldItems", profileId), player.token, { itemIds });

    // Nothing goes when any id is unknown, or there are none.
    for (const [itemIds, code] of [
      [["bbbbbbbb-0000-0000-0000-000000000001", "bbbbbbbb-0000-0000-0000-00000000dead"], "errors.com.epicgames.fortnite.item_not_found"],
      [[], "errors.com.epicgames.validation.validation_failed"]
    ]) {
      const refused = await destroy(itemIds);
      assert.equal(refused.status, 400, JSON.stringify(itemIds));
      assert.equal(refused.body.errorCode, code);
    }

    // The client's FGuid text, without dashes and in capitals, finds the item; the whole stack goes.
    const response = await destroy(["BBBBBBBB000000000000000000000001", "bbbbbbbb-0000-0000-0000-000000000002"]);
    assert.equal(response.status, 200);
    assert.equal(response.body.profileId, "theater0");
    const items = response.body.profileChanges[0].profile.items;
    assert.equal(items["bbbbbbbb-0000-0000-0000-000000000001"], undefined);
    assert.equal(items["bbbbbbbb-0000-0000-0000-000000000002"], undefined);
    assert.equal(items["bbbbbbbb-0000-0000-0000-000000000003"].quantity, 2);
    assert.deepEqual(response.body.profileChanges[0].profile.stats.attributes.player_loadout.secondaryQuickBarRecord.slots[4].items, []);

    // 2.5 has it too.
    const later = await destroy(["bbbbbbbb-0000-0000-0000-000000000003"], v25);
    assert.equal(later.status, 200);
    assert.equal(later.body.profileChanges[0].profile.items["bbbbbbbb-0000-0000-0000-000000000003"], undefined);

    // It is a world profile command.
    const wrong = await destroy(["bbbbbbbb-0000-0000-0000-000000000003"], v111, "profile0");
    assert.equal(wrong.body.errorCode, "errors.com.epicgames.modules.profiles.invalid_command");
  } finally {
    backend.close();
  }
});

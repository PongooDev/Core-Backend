import { test } from "node:test";
import assert from "node:assert/strict";
import { dedicatedServerToken, post, startBackend, userLogin } from "./helpers.js";

const route = (accountId, side, name, profileId, rvn = -1) => `/fortnite/api/game/v2/profile/${accountId}/${side}/${name}?profileId=${profileId}&rvn=${rvn}`;
const rifle = "aaaaaaaa-0000-0000-0000-000000000001";
const sword = "AAAAAAAA-0000-0000-0000-000000000002";
const trap = "aaaaaaaa-0000-0000-0000-000000000003";

test("1.11's ModifyQuickbar keeps the backpack's weapon and trap slots as theater0's FQuickBar records", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "QuickbarPlayer");
    const dedicated = await dedicatedServerToken(backend.port);
    await post(backend.port, route(player.accountId, "dedicated_server", "BatchUpdatePlayer", "theater0"), dedicated, {
      theaterItemUpdate: { addRequests: [
        { itemId: rifle, templateId: "Weapon:wid_assault_auto_sr_ore_t01", quantity: 1, attributes: {} },
        { itemId: sword, templateId: "Weapon:wid_edged_sword_medium_sr_ore_t01", quantity: 1, attributes: {} },
        { itemId: trap, templateId: "Trap:tid_floor_spikes_r_t01", quantity: 1, attributes: {} }
      ] }, outpostItemUpdate: {}, questObjectiveUpdates: []
    });
    const modify = (body, profileId = "theater0", rvn = -1) => post(backend.port, route(player.accountId, "client", "ModifyQuickbar", profileId, rvn), player.token, body);
    const loadoutOf = (response) => response.body.profileChanges[0].profile.stats.attributes.player_loadout;

    // Equip: the client sends weapon slots 1-3 and trap slot 4, "" for an empty one.
    const equipped = await modify({ primaryQuickbarChoices: ["", rifle.toUpperCase(), sword], secondaryQuickbarChoice: trap });
    assert.equal(equipped.status, 200);
    let loadout = loadoutOf(equipped);
    assert.equal(loadout.bPlayerIsNew, true);
    assert.equal(loadout.primaryQuickBarRecord.slots.length, 9);
    assert.equal(loadout.secondaryQuickBarRecord.slots.length, 7);
    assert.ok([...loadout.primaryQuickBarRecord.slots, ...loadout.secondaryQuickBarRecord.slots].every((slot) => slot.bEnabled === true));
    assert.deepEqual(loadout.primaryQuickBarRecord.slots.map((slot) => slot.items), [
      [], [], ["AAAAAAAA000000000000000000000001"], ["AAAAAAAA000000000000000000000002"], [], [], [], [], []
    ]);
    assert.deepEqual(loadout.secondaryQuickBarRecord.slots[4].items, ["AAAAAAAA000000000000000000000003"]);

    // Unequip: the item's slot comes back "". The client, at its revision, gets the stat change that re-reads it.
    const unequipped = await modify({ primaryQuickbarChoices: ["", "", sword], secondaryQuickbarChoice: "" }, "theater0", equipped.body.profileRevision);
    assert.equal(unequipped.status, 200);
    assert.deepEqual(changed(unequipped), ["player_loadout"]);
    loadout = unequipped.body.profileChanges[0].value;
    assert.deepEqual(loadout.primaryQuickBarRecord.slots.slice(1, 4).map((slot) => slot.items), [[], [], ["AAAAAAAA000000000000000000000002"]]);
    assert.deepEqual(loadout.secondaryQuickBarRecord.slots[4].items, []);

    // Items not in the backpack, one item in two slots, too many slots or another profile are refused.
    assert.equal((await modify({ primaryQuickbarChoices: ["missing", "", ""], secondaryQuickbarChoice: "" })).status, 400);
    assert.equal((await modify({ primaryQuickbarChoices: [rifle, rifle, ""], secondaryQuickbarChoice: "" })).status, 400);
    assert.equal((await modify({ primaryQuickbarChoices: ["", "", "", rifle], secondaryQuickbarChoice: "" })).status, 400);
    assert.equal((await modify({ primaryQuickbarChoices: [rifle, "", ""], secondaryQuickbarChoice: "" }, "profile0")).status, 400);
  } finally {
    backend.close();
  }
});

function changed(response) {
  return response.body.profileChanges.filter((change) => change.changeType === "statModified").map((change) => change.name);
}

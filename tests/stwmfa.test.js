import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { getItem } from "../src/gamedata/items.js";
import { stwMfaRewardOffered, stwMfaRewards } from "../src/services/mcp/commands/ClaimMfaEnabled.js";
import { send, startBackend, userLogin } from "./helpers.js";

// Core-Backend #328 ("You should get these rewards on STW for having 2FA": Update v6.00's 50 Armory Slots, 10 Backpack
// Slots and a Legendary Troll Stash Llama) and #330 (on 6.00, entering Save the World showed "Unknown command
// ClaimMfaEnabled", errors.com.epicgames.fortnite.operation_not_found). 6.00's front end sends ClaimMfaEnabled
// {bClaimForStw: true} to common_core while campaign's mfa_reward_claimed isn't true.
const agentOf = (cl, version) => `Fortnite/++Fortnite+Release-${version}-CL-${cl} Windows/10.0.19045.1.256.64bit`;
const client = (port, agent, token) => async (accountId, command, profileId, body = {}) => {
  const text = JSON.stringify(body);
  return send({ host: "127.0.0.1", port, method: "POST", path: `/fortnite/api/game/v2/profile/${accountId}/client/${command}?profileId=${profileId}&rvn=-1`,
    headers: { "User-Agent": agent, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) } }, text);
};
const campaignOf = (result) => (result.profileId === "campaign" ? result : result.multiUpdate?.find(({ profileId }) => profileId === "campaign"));
const itemsOf = (profile) => Object.values(profile.items).map(({ templateId, quantity }) => [templateId.toLowerCase(), quantity]);

test("the Save the World 2FA reward is 6.00's: Armory Slot and Backpack Slot tokens and the Troll Stash Llama, all in the build's data", () => {
  // 6.01's, 6.02's and 6.10's builds keep it.
  for (const cl of ["4395664", "4402180", "4417689", "4424678", "4442095", "4461277", "4464155", "4476098", "4480234"]) {
    inBuild(cl, () => {
      assert.equal(stwMfaRewardOffered(), true, cl);
      assert.deepEqual(stwMfaRewards.map(({ templateId }) => getItem(templateId)?.name),
        ["Armory Slot", "Backpack Slot", "Legendary Troll Stash Llama"]);
    });
  }
  assert.equal(inBuild("4363240", stwMfaRewardOffered), false, "5.41 has no Save the World reward");
  assert.deepEqual(stwMfaRewards.map(({ quantity }) => quantity), [50, 10, 1]);
});

test("6.00's ClaimMfaEnabled gives the Save the World reward once and marks campaign's mfa_reward_claimed (#328, #330)", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreMfa");
    const mcp = client(backend.port, agentOf("4395664", "6.00"), token);
    const before = (await mcp(accountId, "QueryProfile", "campaign")).body.profileChanges[0].profile;
    assert.notEqual(before.stats.attributes.mfa_reward_claimed, true, "the front end asks while it isn't claimed");
    const common = (await mcp(accountId, "QueryProfile", "common_core")).body.profileChanges[0].profile;
    assert.equal(common.stats.attributes.mfa_enabled, true);

    const claim = await mcp(accountId, "ClaimMfaEnabled", "common_core", { bClaimForStw: true });
    assert.equal(claim.status, 200, JSON.stringify(claim.body));
    assert.equal(claim.body.profileId, "common_core");
    const campaign = campaignOf(claim.body);
    assert.ok(campaign, "campaign's changes come along");
    const added = campaign.profileChanges.filter(({ changeType }) => changeType === "itemAdded")
      .map(({ item }) => [item.templateId.toLowerCase(), item.quantity]);
    assert.deepEqual(added, [["token:accountinventorybonus", 50], ["token:worldinventorybonus", 10], ["cardpack:cardpack_jackpot", 1]]);
    assert.deepEqual(campaign.profileChanges.filter(({ changeType }) => changeType === "statModified"),
      [{ changeType: "statModified", name: "mfa_reward_claimed", value: true }]);
    const llama = campaign.profileChanges.find(({ item }) => item?.templateId.toLowerCase() === "cardpack:cardpack_jackpot");
    assert.equal(llama.item.attributes.pack_source, "Store", "the llama store opens it");

    // Asked again (a second front end, or a retry), nothing more is given.
    const again = await mcp(accountId, "ClaimMfaEnabled", "common_core", { bClaimForStw: true });
    assert.equal(again.status, 200);
    assert.equal(campaignOf(again.body), undefined);
    const after = (await mcp(accountId, "QueryProfile", "campaign")).body.profileChanges[0].profile;
    assert.equal(after.stats.attributes.mfa_reward_claimed, true);
    const held = itemsOf(after);
    assert.deepEqual(held.filter(([id]) => id === "token:accountinventorybonus"), [["token:accountinventorybonus", 50]]);
    assert.deepEqual(held.filter(([id]) => id === "token:worldinventorybonus"), [["token:worldinventorybonus", 10]]);
    assert.equal(held.filter(([id]) => id === "cardpack:cardpack_jackpot").length, 1);
    // The tokens are campaign's, not common_core's.
    const commonAfter = (await mcp(accountId, "QueryProfile", "common_core")).body.profileChanges[0].profile;
    assert.ok(!itemsOf(commonAfter).some(([id]) => id.startsWith("token:") && id.endsWith("inventorybonus")));
  } finally {
    backend.close();
  }
});

test("ClaimMfaEnabled without bClaimForStw, or from 5.41, succeeds and gives nothing", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreMfaOld");
    const v600 = client(backend.port, agentOf("4402180", "6.00"), token);
    const battleRoyale = await v600(accountId, "ClaimMfaEnabled", "common_core", { bClaimForStw: false });
    assert.equal(battleRoyale.status, 200);
    assert.equal(campaignOf(battleRoyale.body), undefined);

    const v541 = client(backend.port, agentOf("4363240", "5.41"), token);
    const old = await v541(accountId, "ClaimMfaEnabled", "common_core", { bClaimForStw: true });
    assert.equal(old.status, 200);
    assert.equal(campaignOf(old.body), undefined);
    const campaign = (await v541(accountId, "QueryProfile", "campaign")).body.profileChanges[0].profile;
    assert.notEqual(campaign.stats.attributes.mfa_reward_claimed, true, "still there to claim on 6.00");
  } finally {
    backend.close();
  }
});

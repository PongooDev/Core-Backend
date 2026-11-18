import { test } from "node:test";
import assert from "node:assert/strict";
import { post, send, startBackend, userLogin } from "./helpers.js";

const agent42 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-4.2-CL-4072250";
const agent700 = "Fortnite/++Fortnite+Release-7.00-CL-4629139 Windows/10.0.19045.1.256.64bit";

// CoreV2 #322: 4.2's lobby reads a party member's profiles with public/QueryPublicProfile; a 400 there left the member
// loading forever.
test("4.2's public/QueryPublicProfile returns another player's common_public and campaign", async () => {
  const backend = await startBackend();
  try {
    const owner = await userLogin(backend.port, "Owner42");
    const viewer = await userLogin(backend.port, "Viewer42");
    for (const profileId of ["common_public", "campaign"]) {
      const res = await send({
        host: "127.0.0.1",
        port: backend.port,
        method: "POST",
        path: `/fortnite/api/game/v2/profile/${owner.accountId}/public/QueryPublicProfile?profileId=${profileId}&rvn=-1`,
        headers: { "User-Agent": agent42, Authorization: `bearer ${viewer.token}`, "Content-Type": "application/json", "Content-Length": 2 }
      }, "{}");
      assert.equal(res.status, 200, `${profileId}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.profileId, profileId);
      assert.equal(res.body.profileChanges?.[0]?.changeType, "fullProfileUpdate");
      assert.ok(res.body.profileChanges[0].profile.stats?.attributes);
    }
  } finally {
    backend.close();
  }
});

// Core-Backend #384: 7.00 (CL-4629139) shows a party member's power with UHomeBaseContext::GetTotalHomebaseRating
// (exec 0x156CDA0 -> 0xF510A0) for the member's registered player info, the lobby's party bar (FullPartyMemberConnected)
// and a mission's player tracker (UFortPlayerTrackerBase::GetHomebaseRating, 0x30662E0) alike. It sums the member's
// Fortitude, Offense, Resistance and Tech (0xF4E2C0) on the actor their homebase effects are on: in a mission the
// member's player state, with the stats the server gave it; in the lobby a proxy, with the effects the viewer's own game
// applies from the campaign it read with public/QueryPublicProfile (AFortGameState::ApplyPersonalHomebaseData 0xEC3E60:
// HomebaseNode items, Stat: items by quantity, squad-slotted Workers and Heroes). So that campaign is the member's
// whole campaign, as the member's own QueryProfile has it.
test("7.00's public/QueryPublicProfile gives a party member's whole campaign, as their own QueryProfile has it", async () => {
  const backend = await startBackend();
  try {
    const owner = await userLogin(backend.port, "Member700");
    const viewer = await userLogin(backend.port, "Viewer700");
    const query = async (token, route, command) => {
      const res = await send({
        host: "127.0.0.1",
        port: backend.port,
        method: "POST",
        path: `/fortnite/api/game/v2/profile/${owner.accountId}/${route}/${command}?profileId=campaign&rvn=-1`,
        headers: { "User-Agent": agent700, Authorization: `bearer ${token}`, "Content-Type": "application/json", "Content-Length": 2 }
      }, "{}");
      assert.equal(res.status, 200, `${route}/${command}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.profileId, "campaign");
      assert.equal(res.body.profileChanges?.[0]?.changeType, "fullProfileUpdate");
      return res.body.profileChanges[0].profile;
    };

    await query(owner.token, "client", "QueryProfile");
    // Level-up and research Stat: items, what 7.00's stat step reads by quantity (0xF34270).
    for (const [templateId, quantity] of [["Stat:fortitude", 400], ["Stat:technology_team", 200]]) {
      assert.equal((await post(backend.port, `/admin/api/accounts/${owner.accountId}/grant`, undefined, { templateId, quantity })).status, 200);
    }

    const shared = await query(viewer.token, "public", "QueryPublicProfile");
    const own = await query(owner.token, "client", "QueryProfile");
    assert.deepEqual(shared.items, own.items);
    assert.deepEqual(shared.stats.attributes, own.stats.attributes);
    const held = (templateId) => Object.values(shared.items).filter((item) => item.templateId === templateId).reduce((sum, item) => sum + item.quantity, 0);
    assert.equal(held("Stat:fortitude"), 400);
    assert.equal(held("Stat:technology_team"), 200);
    assert.ok(Object.values(shared.items).some((item) => item.attributes?.squad_id), "the squad-slotted heroes and workers");
  } finally {
    backend.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { send, startBackend, userLogin } from "./helpers.js";

const agent42 = "game=Fortnite, engine=UE4, build=++Fortnite+Release-4.2-CL-4072250";

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

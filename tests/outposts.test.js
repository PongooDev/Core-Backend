import { test } from "node:test";
import assert from "node:assert/strict";
import { get, post, startBackend, userLogin } from "./helpers.js";

const route = (kind, accountId, name, profileId = "profile0") =>
  `/fortnite/api/game/v2/profile/${accountId}/${kind}/${name}?profileId=${profileId}&rvn=-1`;
const outposts = (profile) => Object.entries(profile.items).filter(([, item]) => item.templateId.startsWith("Outpost:"));

test("entering a storm shield makes its core, the gameserver saves it, and a won defense raises its level", async () => {
  const backend = await startBackend();
  try {
    const server = await userLogin(backend.port, "CoreServer1");
    const player = await userLogin(backend.port, "OutpostPlayer");
    const client = (name, body) => post(backend.port, route("client", player.accountId, name), player.token, body);
    const gameserver = (name, body, profileId) => post(backend.port, route("dedicated_server", player.accountId, name, profileId), server.token, body);
    const profile = async () => (await client("QueryProfile", {})).body.profileChanges[0].profile;

    assert.equal((await client("CreateOrUpgradeOutpostItem", { templateId: "Hero:hid_commando_007_r_t01" })).status, 400);
    const created = await client("CreateOrUpgradeOutpostItem", { templateId: "Outpost:OutpostCore_PvE_01" });
    assert.equal(created.status, 200);
    await client("CreateOrUpgradeOutpostItem", { templateId: "Outpost:outpostcore_pve_01" });
    const [[coreId, core]] = outposts(await profile());
    assert.equal(core.templateId, "Outpost:outpostcore_pve_01");
    assert.equal(core.attributes.level, 0);
    assert.deepEqual(core.attributes.outpost_core_info, { placedBuildings: [], accountsWithEditPermission: [player.accountId] });
    assert.deepEqual(core.attributes.cloud_save_info, { saveCount: 0, savedRecords: [] });

    const coreInfo = { placedBuildings: [{ buildingTag: "Outpost.Building.Core", placedTag: "Outpost.Placement.Center" }], accountsWithEditPermission: [player.accountId] };
    assert.equal((await gameserver("UpdateOutpostCore", { coreId, coreInfo })).status, 200);
    assert.deepEqual((await profile()).items[coreId].attributes.outpost_core_info, coreInfo);

    const saves = { saveCount: 1, savedRecords: [{ recordIndex: 0, archiveNumber: 1, recordFilename: "outpost_01.sav" }] };
    const batch = await gameserver("BatchUpdatePlayerOutpost", {
      theaterItemUpdate: { addRequests: [{ itemId: "", templateId: "WorldItem:wooditemdata", quantity: 30, attributes: {} }] },
      outpostItemUpdate: {}, questObjectiveUpdates: [], outpostId: coreId, outpostInfo: coreInfo, cloudSaveInfo: saves
    }, "theater0");
    assert.equal(batch.status, 200);
    assert.deepEqual((await profile()).items[coreId].attributes.cloud_save_info, saves);

    // Stonewood's storm shield mission, won through the server's game session.
    const info = (await get(backend.port, "/fortnite/api/game/v2/world/info", player.token)).body;
    const stonewood = info.missions.find(({ availableMissions }) => availableMissions.some(({ missionGenerator }) => /TheOutpost_PvE_01/.test(missionGenerator)));
    const mission = stonewood.availableMissions.find(({ missionGenerator }) => /TheOutpost_PvE_01/.test(missionGenerator));
    const zone = { worldId: "", theaterId: stonewood.theaterId, theaterMissionId: mission.missionGuid, theaterMissionAlertId: "", zoneThemeClass: "" };
    const registered = await post(backend.port, "/fortnite/api/matchmaking/session", server.token, {
      ownerId: server.accountId, ownerName: "CoreServer1", serverName: "Core-1", serverAddress: "127.0.0.1", serverPort: 7777,
      maxPublicPlayers: 4, maxPrivatePlayers: 0, buildUniqueId: "595160781",
      attributes: { ZONEINSTANCEID_s: JSON.stringify(zone), GAMEMODE_s: "FORTPVE" }
    });
    const end = (missionStatus) => gameserver("EndPrimaryMission", { matchmakingSessionId: registered.body.id, missionName: "m", missionStatus, advance: [] });
    await end("Failed");
    assert.equal((await profile()).items[coreId].attributes.level, 0);
    await end("Succeeded");
    assert.equal((await profile()).items[coreId].attributes.level, 1);

    // The next visit plays the second defense: the player asked for the session key, so they own this storm shield.
    const validate = () => post(backend.port, `/fortnite/api/game/v2/world/validate?sessionId=${registered.body.id}`, server.token, zone);
    assert.equal((await validate()).body.zoneDifficultyInfo.rowName, "Theater_Start_Outpost1");
    await get(backend.port, `/fortnite/api/game/v2/matchmaking/account/${player.accountId}/session/${registered.body.id}`, player.token);
    assert.equal((await validate()).body.zoneDifficultyInfo.rowName, "Theater_Start_Outpost2");
  } finally {
    backend.close();
  }
});

test("the gameserver makes, saves and records tiers on a deployable base, and can abort a disintegration", async () => {
  const backend = await startBackend();
  try {
    const server = await userLogin(backend.port, "CoreServer1");
    const player = await userLogin(backend.port, "BasePlayer");
    const gameserver = (name, body, profileId) => post(backend.port, route("dedicated_server", player.accountId, name, profileId), server.token, body);
    assert.equal((await gameserver("AbortDisintegration", {}, "theater0")).status, 200);
    assert.equal((await gameserver("CreateDeployableBaseItem", { templateId: "Outpost:outpostcore_pve_01" })).status, 400);
    assert.equal((await gameserver("CreateDeployableBaseItem", { templateId: "DeployableBaseCloudSave:testdeployablebaseitemdef" })).status, 200);
    const items = async () => (await gameserver("QueryProfile", {})).body.profileChanges[0].profile.items;
    const [baseId] = Object.entries(await items()).find(([, item]) => item.templateId.startsWith("DeployableBaseCloudSave:"));

    await gameserver("UpdateDeployableBaseTierProgression", { deployableBaseItemId: baseId, progressionLayoutGuid: "layout", tierDefeated: 2 });
    await gameserver("UpdateDeployableBaseTierProgression", { deployableBaseItemId: baseId, progressionLayoutGuid: "layout", tierDefeated: 1 });
    const saves = { saveCount: 1, savedRecords: [{ recordIndex: 0, archiveNumber: 0, recordFilename: "base.sav" }] };
    assert.equal((await gameserver("BatchUpdatePlayerDeployableBase", { theaterItemUpdate: {}, outpostItemUpdate: {}, questObjectiveUpdates: [],
      deployableBaseItemId: baseId, cloudSaveInfo: saves }, "theater0")).status, 200);
    const { attributes } = (await items())[baseId];
    assert.deepEqual(attributes.tier_progression, { progressionInfo: [{ progressionLayoutGuid: "layout", highestDefeatedTier: 2 }] });
    assert.deepEqual(attributes.cloud_save_info, saves);
  } finally {
    backend.close();
  }
});

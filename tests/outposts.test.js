import { test } from "node:test";
import assert from "node:assert/strict";
import { dedicatedServerToken, get, post, startBackend, userLogin } from "./helpers.js";

const route = (kind, accountId, name, profileId = "profile0") =>
  `/fortnite/api/game/v2/profile/${accountId}/${kind}/${name}?profileId=${profileId}&rvn=-1`;
const outposts = (profile) => Object.entries(profile.items).filter(([, item]) => item.templateId.startsWith("Outpost:"));
const stats = (...names) => names.map((statName) => ({ statName, count: 1 }));
// The homebase onboarding quest's objectives: done, it grants OutpostQuest_T1_L1.
const onboarding = stats("hbonboarding_completezone", "hbonboarding_watchsatellitecine", "hbonboarding_namehomebase");
const firstLeg = stats("custom_supplydropreceived", "custom_deployoutpost", "complete_outpost_1_1");

test("entering a storm shield makes its core, the gameserver saves it, and its quest done raises its level", async () => {
  const backend = await startBackend();
  try {
    const server = await userLogin(backend.port, "CoreServer1");
    const player = await userLogin(backend.port, "OutpostPlayer");
    const client = (name, body) => post(backend.port, route("client", player.accountId, name), player.token, body);
    const dedicated = await dedicatedServerToken(backend.port);
    const gameserver = (name, body, profileId) => post(backend.port, route("dedicated_server", player.accountId, name, profileId), dedicated, body);
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

    // An unknown core doesn't lose the player's inventory changes.
    const unknownCore = await gameserver("BatchUpdatePlayerOutpost", {
      theaterItemUpdate: { addRequests: [{ itemId: "stone-1", templateId: "WorldItem:stoneitemdata", quantity: 12, attributes: {} }] },
      outpostItemUpdate: {}, questObjectiveUpdates: [], outpostId: "nope", outpostInfo: coreInfo, cloudSaveInfo: saves
    }, "theater0");
    assert.equal(unknownCore.status, 200);
    const theater = (await gameserver("QueryProfile", {}, "theater0")).body.profileChanges[0].profile;
    assert.equal(theater.items["stone-1"]?.quantity, 12);

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
    const end = (missionStatus, advance = []) => gameserver("EndPrimaryMission", { matchmakingSessionId: registered.body.id, missionName: "m", missionStatus, advance });
    await end("Failed");
    await end("Succeeded");
    assert.equal((await profile()).items[coreId].attributes.level, 0);
    // The storm shield follows the outpost quests: OutpostQuest_T1_L1 done is the first leg played.
    await gameserver("UpdateQuests", { advance: onboarding });
    await end("Succeeded", firstLeg);
    assert.equal((await profile()).items[coreId].attributes.level, 1);

    // The next visit plays the second defense: the player asked for the session key, so they own this storm shield.
    const validate = () => post(backend.port, `/fortnite/api/game/v2/world/validate?sessionId=${registered.body.id}`, dedicated, zone);
    assert.equal((await validate()).body.zoneDifficultyInfo.rowName, "Theater_Start_Outpost1");
    await get(backend.port, `/fortnite/api/game/v2/matchmaking/account/${player.accountId}/session/${registered.body.id}`, player.token);
    assert.equal((await validate()).body.zoneDifficultyInfo.rowName, "Theater_Start_Outpost2");
  } finally {
    backend.close();
  }
});

test("an outpost quest done raises its theater's storm shield to its leg, making the core if needed, and never lowers it", async () => {
  const backend = await startBackend();
  try {
    const dedicated = await dedicatedServerToken(backend.port);
    const play = async (name, setUp = async () => {}) => {
      const player = await userLogin(backend.port, name);
      await setUp(player);
      const gameserver = (command, body) => post(backend.port, route("dedicated_server", player.accountId, command), dedicated, body);
      await gameserver("UpdateQuests", { advance: onboarding });
      await gameserver("EndPrimaryMission", { matchmakingSessionId: "", missionName: "m", missionStatus: "Failed", advance: firstLeg });
      const items = (await gameserver("QueryProfile", {})).body.profileChanges[0].profile.items;
      const [quest] = Object.values(items).filter((item) => item.templateId === "Quest:outpostquest_t1_l1");
      return { player, quest, cores: outposts({ items }) };
    };

    const fresh = await play("FirstLegPlayer");
    assert.equal(fresh.quest.attributes.quest_state, "Completed");
    const [[, core], ...others] = fresh.cores;
    assert.equal(others.length, 0);
    assert.equal(core.templateId, "Outpost:outpostcore_pve_01");
    assert.equal(core.attributes.level, 1);
    assert.deepEqual(core.attributes.outpost_core_info, { placedBuildings: [], accountsWithEditPermission: [fresh.player.accountId] });

    const ahead = await play("ThirdLegPlayer", ({ accountId }) =>
      post(backend.port, `/admin/api/accounts/${accountId}/storm-shield`, undefined, { templateId: "Outpost:outpostcore_pve_01", level: 3 }));
    assert.equal(ahead.quest.attributes.quest_state, "Completed");
    assert.deepEqual(ahead.cores.map(([, item]) => item.attributes.level), [3]);
  } finally {
    backend.close();
  }
});

// The gameserver sends ClientOnBuildingLevelChanged once its copy of profile0 shows the core above the level it recorded
// at the won defense, so the new level has to come back in this response.
test("the EndPrimaryMission that completes a storm shield quest returns the core's new level to the gameserver", async () => {
  const backend = await startBackend();
  try {
    const player = await userLogin(backend.port, "UpgradePlayer");
    const dedicated = await dedicatedServerToken(backend.port);
    const at = (name, body, rvn) => post(backend.port,
      `/fortnite/api/game/v2/profile/${player.accountId}/dedicated_server/${name}?profileId=profile0&rvn=${rvn}`, dedicated, body);
    await post(backend.port, route("client", player.accountId, "CreateOrUpgradeOutpostItem"), player.token, { templateId: "Outpost:outpostcore_pve_01" });
    await at("UpdateQuests", { advance: onboarding }, -1);
    const known = (await at("QueryProfile", {}, -1)).body;
    const [[coreId]] = outposts(known.profileChanges[0].profile);

    const response = (await at("EndPrimaryMission", { matchmakingSessionId: "", missionName: "m", missionStatus: "Succeeded", advance: firstLeg }, known.profileRevision)).body;
    assert.equal(response.profileChangesBaseRevision, known.profileRevision);
    assert.deepEqual(response.profileChanges.filter(({ itemId, attributeName }) => itemId === coreId && attributeName === "level"),
      [{ changeType: "itemAttrChanged", itemId: coreId, attributeName: "level", attributeValue: 1 }]);
  } finally {
    backend.close();
  }
});

test("the gameserver makes, saves and records tiers on a deployable base, and can abort a disintegration", async () => {
  const backend = await startBackend();
  try {
    const server = await userLogin(backend.port, "CoreServer1");
    const player = await userLogin(backend.port, "BasePlayer");
    const dedicated = await dedicatedServerToken(backend.port);
    const gameserver = (name, body, profileId) => post(backend.port, route("dedicated_server", player.accountId, name, profileId), dedicated, body);
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

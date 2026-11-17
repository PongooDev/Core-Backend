import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { certUserAgent, clientToken, dedicatedServerToken, del, get, openTunnel, post, request, send, startBackend, userLogin } from "./helpers.js";

// Battle Royale's global chat (Core-Backend #238), in every build's DefaultGame.ini; 6.20 keeps it in UFortChatManager (#344).
const athenaGlobalChat = ["[/Script/FortniteGame.FortOnlineAccount]", "bIsAthenaGlobalChatEnabled=true", "",
  "[/Script/FortniteGame.FortChatManager]", "bIsAthenaGlobalChatEnabled=true"];

function raw(port, method, path, token, body, userAgent = certUserAgent) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      method,
      path,
      headers: { "User-Agent": userAgent, Authorization: `bearer ${token}`, "Content-Type": "application/octet-stream" }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("user files can be written, listed with their SHA-1, read back and deleted", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "CoreTest");
    const base = `/fortnite/api/cloudstorage/user/${accountId}`;

    assert.deepEqual((await get(backend.port, base, token)).body, []);

    const settings = crypto.randomBytes(3000);
    assert.equal((await raw(backend.port, "PUT", `${base}/ClientSettings.Sav`, token, settings)).status, 204);

    const listed = await get(backend.port, base, token);
    assert.equal(listed.body.length, 1);
    assert.equal(listed.body[0].filename, "ClientSettings.Sav");
    assert.equal(listed.body[0].hash, crypto.createHash("sha1").update(settings).digest("hex"));
    assert.equal(listed.body[0].length, settings.length);

    const read = await raw(backend.port, "GET", `${base}/ClientSettings.Sav`, token);
    assert.equal(read.status, 200);
    assert.ok(read.body.equals(settings));

    assert.equal((await del(backend.port, `${base}/ClientSettings.Sav`, token)).status, 204);
    assert.deepEqual((await get(backend.port, base, token)).body, []);
  } finally {
    backend.close();
  }
});

// A ClientSettings.Sav as the game writes it (UFortClientSettingsRecord, Core-Backend #228): the record header (magic
// 0xF057217E, UE4 version, engine version and changelist, branch), then tagged properties, among them the HUD's net
// stats element, the controller platform and the Battle Royale input preset, then key bindings to tens of KB.
const agentOf = (version, changelist) => `game=Fortnite, engine=UE4, build=++Fortnite+Release-${version}-CL-${changelist}`;
const build31 = agentOf("3.1", 3915963);
const listAs = async (port, path, token, userAgent) => JSON.parse((await raw(port, "GET", path, token, undefined, userAgent)).body.toString("utf8"));

function clientSettingsSav() {
  const parts = [];
  const int = (value) => { const b = Buffer.alloc(4); b.writeInt32LE(value); parts.push(b); };
  const str = (value) => { int(value.length + 1); parts.push(Buffer.from(`${value}\0`, "latin1")); };
  int(-262725250); int(516); parts.push(Buffer.from([4, 0, 20, 0, 0, 0])); int(3915963); str("++Fortnite+Release-3.1"); int(15);
  str("UserHUDVisibiltyMappings"); str("MapProperty"); int(83); int(0); str("StructProperty"); str("BoolProperty"); parts.push(Buffer.from([0]));
  int(0); int(1); str("TagName"); str("NameProperty"); int(27); int(0); parts.push(Buffer.from([0])); str("HUD.TopLeft.NetDebugUI"); str("None"); parts.push(Buffer.from([1]));
  str("ControllerPlatform"); str("StrProperty"); int(8); int(0); parts.push(Buffer.from([0])); str("PS4");
  str("InputPresetNameForAthena"); str("StrProperty"); int(15); int(0); parts.push(Buffer.from([0])); str("BuilderPro");
  for (let i = 0; parts.reduce((n, b) => n + b.length, 0) < 30000; i++) {
    str("UserActionBindings"); parts.push(crypto.createHash("sha256").update(String(i)).digest()); parts.push(Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x0d, 0x0a]));
  }
  str("None"); int(0);
  return Buffer.concat(parts);
}

test("a ClientSettings.Sav round-trips byte for byte, listed so the game downloads it again (Core-Backend #228)", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "SettingsPlayer");
    const base = `/fortnite/api/cloudstorage/user/${accountId}`;
    const sha1 = (data) => crypto.createHash("sha1").update(data).digest("hex");

    const first = clientSettingsSav();
    assert.ok(first.length > 30000);
    assert.equal((await raw(backend.port, "PUT", `${base}/ClientSettings.Sav`, token, first, build31)).status, 204);

    // Changed again: the net stats turned off. The listing's hash follows the new file, so the game's cached copy no
    // longer matches it and it downloads this one.
    const second = Buffer.from(first);
    const flag = Buffer.from("HUD.TopLeft.NetDebugUI\0\x05\0\0\0None\0", "latin1");
    second[second.indexOf(flag) + flag.length] = 0;
    assert.notEqual(sha1(second), sha1(first));
    assert.equal((await raw(backend.port, "PUT", `${base}/ClientSettings.Sav`, token, second, build31)).status, 204);

    // A 3.1 file, as 3.1 uploads and reads it (CoreV2 #468: a build is never given a newer build's file).
    const listed = await raw(backend.port, "GET", base, token, undefined, build31);
    assert.equal(listed.status, 200);
    const listing = JSON.parse(listed.body.toString("utf8"));
    assert.equal(listing.length, 1, "the temporary file of a write is never listed");
    const [file] = listing;
    assert.equal(file.filename, "ClientSettings.Sav");
    assert.equal(file.uniqueFilename, "ClientSettings.Sav");
    assert.equal(file.hash, sha1(second));
    assert.equal(file.hash256, crypto.createHash("sha256").update(second).digest("hex"));
    assert.equal(file.length, second.length);
    assert.equal(file.contentType, "application/octet-stream");
    assert.equal(file.accountId, accountId);
    assert.ok(!Number.isNaN(Date.parse(file.uploaded)));

    const read = await raw(backend.port, "GET", `${base}/${file.uniqueFilename}`, token, undefined, build31);
    assert.equal(read.status, 200);
    assert.ok(read.body.equals(second), "read back byte for byte");
    assert.equal(sha1(read.body), file.hash);

    // The same file, uploaded with no content type, is stored as it came too.
    const plain = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: backend.port, method: "PUT", path: `${base}/ClientSettings.Sav`,
        headers: { "User-Agent": build31, Authorization: `bearer ${token}` } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      req.on("error", reject);
      req.end(first);
    });
    assert.equal(plain, 204);
    assert.ok((await raw(backend.port, "GET", `${base}/ClientSettings.Sav`, token, undefined, build31)).body.equals(first));
    assert.equal((await listAs(backend.port, base, token, build31))[0].hash, sha1(first));

    // Kept per account: another player's settings are their own.
    const other = await userLogin(backend.port, "OtherSettingsPlayer");
    assert.deepEqual((await get(backend.port, `/fortnite/api/cloudstorage/user/${other.accountId}`, other.token)).body, []);
  } finally {
    backend.close();
  }
});

// A ClientSettings.Sav's record header as each build writes it (3.3 0xC53880: the magic, the UE4 version, the engine version
// with its changelist and branch, record version 15), then something of the build's own.
function settingsOf(changelist, branch, marker) {
  const head = Buffer.alloc(18);
  head.writeUInt32LE(0xF057217E, 0);
  head.writeInt32LE(516, 4);
  head.writeUInt16LE(4, 8);
  head.writeUInt16LE(20, 10);
  head.writeUInt16LE(0, 12);
  head.writeUInt32LE(changelist, 14);
  const str = (value) => {
    const length = Buffer.alloc(4);
    length.writeInt32LE(value.length + 1);
    return Buffer.concat([length, Buffer.from(`${value}\0`, "latin1")]);
  };
  const version = Buffer.alloc(4);
  version.writeInt32LE(15);
  return Buffer.concat([head, str(branch), version, str("UserActionBindings"), str(marker), str("None")]);
}

test("an older build is never given a newer build's ClientSettings.Sav, and a build keeps its own (CoreV2 #468)", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "SwitchingPlayer");
    const base = `/fortnite/api/cloudstorage/user/${accountId}`;
    const sha1 = (data) => crypto.createHash("sha1").update(data).digest("hex");
    const build32 = agentOf("3.2", 3935073);
    const build33 = agentOf("3.3", 3942182);
    const build41 = agentOf("4.1", 4053532);
    const build50 = agentOf("5.00", 4214610);
    const settingsListed = async (agent) => (await listAs(backend.port, base, token, agent)).filter((file) => file.filename === "ClientSettings.Sav");
    const read = (agent) => raw(backend.port, "GET", `${base}/ClientSettings.Sav`, token, undefined, agent);
    async function served(agent, data) {
      const listed = await settingsListed(agent);
      if (!data) {
        assert.deepEqual(listed, [], "nothing listed");
        assert.equal((await read(agent)).status, 404);
        return;
      }
      assert.equal(listed.length, 1);
      assert.equal(listed[0].hash, sha1(data));
      assert.equal(listed[0].length, data.length);
      assert.ok((await read(agent)).body.equals(data), "read back as listed");
    }

    // The reporter's account: the file 4.1 saved last, from before the backend kept a copy per build. Its record is
    // version 15, as 3.3's is, and its key bindings hold actions 3.3's Input tab doesn't list.
    const of41 = settingsOf(4053532, "++Fortnite+Release-4.1", "EmotePicker");
    const stored = path.join(backend.dataDir, "accounts", accountId, "cloudstorage", "ClientSettings.Sav");
    fs.mkdirSync(path.dirname(stored), { recursive: true });
    fs.writeFileSync(stored, of41);
    const earlier = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(stored, earlier, earlier);
    // Another user file (a storm shield's save) is every build's.
    const shield = crypto.randomBytes(500);
    assert.equal((await raw(backend.port, "PUT", `${base}/fd40e9fb-be63-463b-9910-357308ea4cb4_r0_a0.sav`, token, shield, build41)).status, 204);

    // 4.1 and newer builds get it, as before. 3.3 and 3.2 get none: their defaults, as a new account's.
    await served(build41, of41);
    await served(build50, of41);
    await served(build33, null);
    await served(build32, null);
    for (const agent of [build32, build33, build41, build50]) {
      assert.ok((await listAs(backend.port, base, token, agent)).some((file) => file.hash === sha1(shield)), "other files are listed for every build");
    }

    // 3.3 saves its own. 4.1 keeps the one it saved, with its upload time; 5.0, which never saved one, gets the last
    // older build's: 3.3's. 3.2 still gets none.
    const of33 = settingsOf(3942182, "++Fortnite+Release-3.3", "TrapPicker");
    assert.equal((await raw(backend.port, "PUT", `${base}/ClientSettings.Sav`, token, of33, build33)).status, 204);
    await served(build33, of33);
    await served(build41, of41);
    assert.ok(Math.abs(Date.parse((await settingsListed(build41))[0].uploaded) - earlier.getTime()) < 2000, "4.1's file keeps its upload time");
    await served(build50, of33);
    await served(build32, null);

    // 4.1 saves again: its new file, which 5.0 now gets too; 3.3 keeps its own.
    const of41b = settingsOf(4053532, "++Fortnite+Release-4.1", "LockerEmote1");
    assert.equal((await raw(backend.port, "PUT", `${base}/ClientSettings.Sav`, token, of41b, build41)).status, 204);
    await served(build41, of41b);
    await served(build50, of41b);
    await served(build33, of33);

    // A file without the record header names no build, so every build gets it, as before.
    const unknown = crypto.randomBytes(300);
    assert.equal((await raw(backend.port, "PUT", `${base}/ClientSettings.Sav`, token, unknown, build50)).status, 204);
    await served(build50, unknown);
    await served(build32, unknown);

    // Deleting the file deletes it for every build.
    assert.equal((await raw(backend.port, "DELETE", `${base}/ClientSettings.Sav`, token, undefined, build50)).status, 204);
    for (const agent of [build32, build33, build41, build50]) await served(agent, null);
  } finally {
    backend.close();
  }
});

test("user files stay private and file names cannot leave the folder", async () => {
  const backend = await startBackend();
  try {
    const me = await userLogin(backend.port, "CoreTest");
    const other = await userLogin(backend.port, "Other");

    assert.equal((await get(backend.port, `/fortnite/api/cloudstorage/user/${other.accountId}`, me.token)).status, 403);

    const escape = await raw(backend.port, "PUT", `/fortnite/api/cloudstorage/user/${me.accountId}/..%2Faccount.json`, me.token, Buffer.from("x"));
    assert.equal(escape.status, 400);
  } finally {
    backend.close();
  }
});

test("a gameserver's own account lists, reads and writes the storm shield saves of the players on its session, and is refused with a 404", async () => {
  const backend = await startBackend();
  try {
    const server = await userLogin(backend.port, "CoreServer1");
    const owner = await userLogin(backend.port, "StormShieldOwner");
    const stranger = await userLogin(backend.port, "Stranger");
    const ownerFiles = `/fortnite/api/cloudstorage/user/${owner.accountId}`;
    const save = `${ownerFiles}/5c6eb5b4-57ea-4e91-89aa-8ded5db40785_r0_a0.sav`;

    // Not yet hosting: a server account is a plain player.
    assert.equal((await get(backend.port, ownerFiles, server.token)).status, 403);

    // The Cert server's create body leaves ownerId empty; the session is the server account's all the same.
    const { body: session } = await post(backend.port, "/fortnite/api/matchmaking/session", server.token,
      { ownerId: "", ownerName: "CoreServer1", serverName: "CoreServer1", maxPublicPlayers: 4, buildUniqueId: "595160781" });
    assert.equal(session.hostAccountId, undefined);
    const refused = await raw(backend.port, "PUT", save, server.token, Buffer.from("x"));
    assert.equal(refused.status, 404, "a refused gameserver gets no 403, which the Cert OSS answers by shutting down");
    assert.equal(JSON.parse(refused.body).errorCode, "errors.com.epicgames.cloudstorage.user_not_found");

    // The owner joins: the server fetches the connection key for them and registers them.
    await get(backend.port, `/fortnite/api/game/v2/matchmaking/account/${owner.accountId}/session/${session.id}`, server.token);
    await post(backend.port, `/fortnite/api/matchmaking/session/${session.id}/players`, server.token, { publicPlayers: [owner.accountId] });

    const build = crypto.randomBytes(25656);
    assert.equal((await raw(backend.port, "PUT", save, server.token, build)).status, 204);
    assert.deepEqual((await get(backend.port, ownerFiles, server.token)).body.map(({ filename, hash, length }) => ({ filename, hash, length })),
      [{ filename: "5c6eb5b4-57ea-4e91-89aa-8ded5db40785_r0_a0.sav", hash: crypto.createHash("sha1").update(build).digest("hex"), length: build.length }]);
    assert.ok((await raw(backend.port, "GET", save, server.token)).body.equals(build));
    assert.ok((await raw(backend.port, "GET", save, owner.token)).body.equals(build));

    // A save after they unregister still reaches their files.
    await request(backend.port, "DELETE", `/fortnite/api/matchmaking/session/${session.id}/players`, server.token, [owner.accountId]);
    assert.equal((await raw(backend.port, "PUT", save, server.token, build)).status, 204);

    // Only for the players on its sessions, never deleting, and only its own tokens.
    assert.equal((await get(backend.port, `/fortnite/api/cloudstorage/user/${stranger.accountId}`, server.token)).status, 404);
    assert.equal((await get(backend.port, `/fortnite/api/cloudstorage/user/${"0".repeat(32)}`, server.token)).status, 404);
    assert.equal((await raw(backend.port, "PUT", `/fortnite/api/cloudstorage/user/..%2F../x.sav`, server.token, Buffer.from("x"))).status, 404);
    assert.equal((await del(backend.port, save, server.token)).status, 403);
    assert.equal((await get(backend.port, ownerFiles, stranger.token)).status, 403);
    assert.equal((await get(backend.port, ownerFiles, await clientToken(backend.port))).status, 403);

    // The DedicatedServer client's token reaches any existing player's files.
    const dedicated = await dedicatedServerToken(backend.port);
    assert.equal((await get(backend.port, `/fortnite/api/cloudstorage/user/${stranger.accountId}`, dedicated)).status, 200);
    assert.equal((await get(backend.port, `/fortnite/api/cloudstorage/user/${"0".repeat(32)}`, dedicated)).status, 404);
  } finally {
    backend.close();
  }
});

test("the system hotfix turns off the client's cache of Battle Royale stats answers (Core #112)", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    const list = await get(backend.port, "/fortnite/api/cloudstorage/system", token);
    const file = list.body.find(({ filename }) => filename === "DefaultGame.ini");
    assert.ok(file);
    const download = await raw(backend.port, "GET", `/fortnite/api/cloudstorage/system/${file.uniqueFilename}`, token);
    assert.equal(download.status, 200);
    assert.equal(crypto.createHash("sha1").update(download.body).digest("hex"), file.hash);
    assert.deepEqual(download.body.toString("utf8").split("\r\n"),
      ["[/Script/FortniteGame.FortGlobals]", "TimeBetweenLeaderboardRequestsMinutes=0", ...athenaGlobalChat, ""]);
  } finally {
    backend.close();
  }
});

// 1.8.1 (CL-3729133) checks an answer's age with a clock that has moved on by the time it checks, so 0 minutes fails every
// stats and leaderboard answer there (Core-Backend #101); up to 1.8 the check's clock counts whole milliseconds and 0
// still lets each answer through.
test("the system hotfix keeps stats answers for a minute from 1.8.1 on, and for none before (Core-Backend #101)", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    const builds = {
      "++Fortnite+Release-Cert-CL-3532353": 0,
      "++Fortnite+Release-Cert-CL-3700114": 0,
      "++Fortnite+Release-Live-CL-3724489": 0,
      "++Fortnite+Release-Cert-CL-3729133": 1,
      "++Fortnite+Release-Cert-CL-3741772": 1
    };
    for (const [build, minutes] of Object.entries(builds)) {
      const agent = `game=Fortnite, engine=UE4, build=${build}`;
      const list = JSON.parse((await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system", token, undefined, agent)).body);
      const file = list.find(({ filename }) => filename === "DefaultGame.ini");
      const download = await raw(backend.port, "GET", `/fortnite/api/cloudstorage/system/${file.uniqueFilename}`, token, undefined, agent);
      assert.equal(download.status, 200);
      assert.equal(crypto.createHash("sha1").update(download.body).digest("hex"), file.hash, build);
      // From 1.8 the Store tab's purchase flow page follows (Core-Backend #223, services/fortnite/purchase.js).
      const purchaseFlow = Number(build.split("-CL-")[1]) >= 3724489 ? ["[EpicPurchaseFlow]", `Prod="http:///127.0.0.1:${backend.port}/purchase"`, "!ProdAltDomains=ClearArray"] : [];
      assert.deepEqual(download.body.toString("utf8").split("\r\n"),
        ["[/Script/FortniteGame.FortGlobals]", `TimeBetweenLeaderboardRequestsMinutes=${minutes}`, ...athenaGlobalChat, ...purchaseFlow, ""], build);
    }
  } finally {
    backend.close();
  }
});

// Core-Backend #314: from 5.0 the lobby lists FrontEndPlaylistData, whose shipped list enables 50v50 and Playground. The
// hotfix sets the list again from the matchmaking modes, so the lobby offers only what the ticket takes.
test("the system hotfix sets Season 5's lobby playlists (FrontEndPlaylistData) from the matchmaking modes (#314)", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    const frontEnd = async (build) => {
      const agent = `game=Fortnite, engine=UE4, build=${build}`;
      const download = await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultGame.ini", token, undefined, agent);
      return download.body.toString("utf8").split("\r\n").filter((line) => line.includes("FrontEndPlaylistData"));
    };
    const playground = (lines) => lines.find((line) => line.includes("PlaylistName=Playlist_Playground,"));
    const v530 = await frontEnd("++Fortnite+Release-5.30-CL-4305896");
    assert.equal(v530[0], "!FrontEndPlaylistData=ClearArray");
    assert.ok(v530.includes("+FrontEndPlaylistData=(PlaylistName=Playlist_DefaultSolo, PlaylistAccess=(bEnabled=true, bIsDefaultPlaylist=true, " +
      "bVisibleWhenDisabled=true, AdvertiseType=None, bDisplayAsLimitedTime=false, DisplayPriority=0))"));
    assert.equal(playground(v530), "+FrontEndPlaylistData=(PlaylistName=Playlist_Playground, PlaylistAccess=(bEnabled=true, bIsDefaultPlaylist=false, " +
      "bVisibleWhenDisabled=false, AdvertiseType=Updated, bDisplayAsLimitedTime=true, DisplayPriority=15))");
    // 5.0's Playground (Season 4's) is off by default; its PlaylistAccess has bDisplayAsNew, not AdvertiseType.
    assert.match(playground(await frontEnd("++Fortnite+Release-5.0-CL-4214610")), /bEnabled=false, .*bDisplayAsNew=false,/);
    assert.deepEqual(await frontEnd("++Fortnite+Release-4.5-CL-4166199"), [], "4.5 has no FrontEndPlaylistData");
    // Switched off, the lobby hides it.
    await post(backend.port, "/admin/api/matchmaking/config", undefined, { modes: { playgroundV2: false } });
    assert.match(playground(await frontEnd("++Fortnite+Release-5.30-CL-4305896")), /PlaylistAccess=\(bEnabled=false,/);
  } finally {
    backend.close();
  }
});

// Core-Backend #186: from 2.4 (CL-3858292) the lobby's Custom Matchmaking Key shows, and the ticket carries the key, only
// with UFortMatchmakingV2's bCustomKeyEnabled.
test("the system hotfix turns on the custom matchmaking key from 2.4 on (#186)", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    for (const [build, enabled] of Object.entries({ "++Fortnite+Release-Cert-CL-3847564": false, "++Fortnite+Release-Cert-CL-3858292": true,
      "++Fortnite+Release-Next-CL-3870737": true })) {
      const agent = `game=Fortnite, engine=UE4, build=${build}`;
      const download = await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultGame.ini", token, undefined, agent);
      const lines = download.body.toString("utf8").split("\r\n");
      const section = lines.indexOf("[/Script/FortniteGame.FortMatchmakingV2]");
      assert.equal(section >= 0 && lines[section + 1] === "bCustomKeyEnabled=true", enabled, build);
    }
  } finally {
    backend.close();
  }
});

// 3.0's lobby queues past AthenaEvent8 have no event flag (GetStringNameOfEventPlaylist, 0x2719BE0): UFortGlobals'
// bEvent<N>ForceEnabled turns each on (IsEvent_X_ForceEnabled, 0xBBBE60).
test("the system hotfix forces on 3.0's LTM queues past AthenaEvent8 that are on, and no others", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    await post(backend.port, "/admin/api/matchmaking/config", undefined, { modes: { solidGold: true, shotguns: true, sneakySilencers: true } });
    const lines = async (build) => (await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultGame.ini", token, undefined,
      `game=Fortnite, engine=UE4, build=${build}`)).body.toString("utf8").split("\r\n");
    const v30 = await lines("++Fortnite+Release-3.0.0-CL-3901517");
    const globals = v30.indexOf("[/Script/FortniteGame.FortGlobals]");
    assert.deepEqual(v30.slice(globals + 2, globals + 4), ["bEvent27ForceEnabled=true", "bEvent31ForceEnabled=true"]);
    const instance = v30.indexOf("[/Script/FortniteGame.FortGameInstance]");
    assert.deepEqual(v30.slice(instance + 1, instance + 3),
      ["!RegionsWithBattleRoyaleEvent27QueueDisabled=ClearArray", "!RegionsWithBattleRoyaleEvent31QueueDisabled=ClearArray"]);
    // Sneaky Silencers' queue is AthenaEvent5, forced on by the calendar's region state; 2.5 has none of 3.0's queues.
    assert.ok(!v30.some((line) => /bEvent5ForceEnabled/.test(line)));
    const v25 = await lines("++Fortnite+Release-2.5-CL-3889387");
    assert.ok(!v25.some((line) => /ForceEnabled|FortGameInstance/.test(line)));
  } finally {
    backend.close();
  }
});

// 3.5.1 (CL-4000805): its modes are FortPlaylistAthena assets, turned on by UFortGameInstance's PlaylistOverrides, and its
// lobby opens on 50v50 v2, its new mode, by the playlist's name (events/ltms.js; back since CoreV2 #260).
test("the system hotfix turns 3.5.1's playlists on by name and opens its lobby on 50v50 v2", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    const agent = "Fortnite/4.20.0-4000805+++Fortnite+Release-3.5 Windows/10.0.17134.1.256.64bit";
    const settings = await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultGameUserSettings.ini", token, undefined, agent);
    assert.equal(settings.body.toString("utf8"), "[/Script/FortniteGame.FortGameUserSettings]\r\nLastSelectedPlaylist=Playlist_50v50\r\n");
    const game = (await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultGame.ini", token, undefined, agent))
      .body.toString("utf8").split("\r\n");
    assert.ok(game.includes("+PlaylistOverrides=(PlaylistName=Playlist_50v50,bEnabled=true)"));
    assert.ok(!game.some((line) => /ForceEnabled|RegionsWithBattleRoyaleEvent/.test(line)));
  } finally {
    backend.close();
  }
});

// Core-Backend #251: 3.5's replays. The client records each match to its own Saved/Demos folder, and records it only while
// UFortRuntimeOptions' replay switches are on, so 3.5.1 and later get DefaultRuntimeOptions.ini turning all three on; no
// earlier build has them, nor gets the file.
test("the system hotfix turns on 3.5's replay browser and recording, and no earlier build's (#251)", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    const agent = (build) => `game=Fortnite, engine=UE4, build=${build}`;
    const files = async (build) => JSON.parse((await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system", token, undefined, agent(build))).body)
      .map(({ filename }) => filename);
    for (const build of ["++Fortnite+Release-3.5-CL-4000805", "++Fortnite+Release-3.5-CL-4008490"]) {
      assert.ok((await files(build)).includes("DefaultRuntimeOptions.ini"), build);
      const download = await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini", token, undefined, agent(build));
      assert.equal(download.status, 200, build);
      assert.deepEqual(download.body.toString("utf8").split("\r\n"), ["[/Script/FortniteGame.FortRuntimeOptions]",
        "bEnableReplayBrowser=true", "bEnableReplayRecording=true", "bEnableLargeTeamReplayRecording=true", ""], build);
    }
    for (const build of ["++Fortnite+Release-3.3-CL-3942182", "++Fortnite+Release-3.2-CL-3935073", "++Fortnite+Release-1.8-CL-3724489"]) {
      assert.ok(!(await files(build)).includes("DefaultRuntimeOptions.ini"), build);
      const missing = await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini", token, undefined, agent(build));
      assert.equal(missing.status, 404, build);
    }
  } finally {
    backend.close();
  }
});

// Core-Backend #237: 3.2's lobby opens on UFortGameUserSettings' LastSelectedPlaylist (0x279E970), so its new mode, Teams of
// 20 (AthenaEvent22, 14), is set there by DefaultGameUserSettings.ini; no other build gets the file.
test("the system hotfix opens 3.2's lobby on Teams of 20, its new mode, and no other build's (#237)", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    const agent = (build) => `game=Fortnite, engine=UE4, build=${build}`;
    const v32 = "++Fortnite+Release-3.2-CL-3935073";
    const files = async (build) => JSON.parse((await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system", token, undefined, agent(build))).body)
      .map(({ filename }) => filename);
    assert.deepEqual(await files(v32), ["DefaultEngine.ini", "DefaultGame.ini", "DefaultGameUserSettings.ini"]);
    const download = await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultGameUserSettings.ini", token, undefined, agent(v32));
    assert.equal(download.body.toString("utf8"), "[/Script/FortniteGame.FortGameUserSettings]\r\nLastSelectedPlaylist=14\r\n");
    // Its queue is forced on too, which shows the lobby's "New Mode Available!" banner.
    const game = (await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultGame.ini", token, undefined, agent(v32)))
      .body.toString("utf8").split("\r\n");
    assert.ok(game.includes("bEvent22ForceEnabled=true"));
    for (const build of ["++Fortnite+Release-3.1-CL-3915963", "++Fortnite+Release-3.0.0-CL-3901517", "++Fortnite+Release-2.5-CL-3889387"]) {
      assert.deepEqual(await files(build), ["DefaultEngine.ini", "DefaultGame.ini"], build);
      const missing = await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultGameUserSettings.ini", token, undefined, agent(build));
      assert.equal(missing.status, 404, build);
    }
  } finally {
    backend.close();
  }
});

test("the system hotfix points the client's XMPP at the address and port it reached the backend on", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    const list = await get(backend.port, "/fortnite/api/cloudstorage/system", token);
    assert.equal(list.status, 200);
    const [file] = list.body;
    assert.deepEqual(Object.keys(file).sort(), ["filename", "hash", "hash256", "length", "uniqueFilename"]);
    assert.equal(file.filename, "DefaultEngine.ini");

    const download = await raw(backend.port, "GET", `/fortnite/api/cloudstorage/system/${file.uniqueFilename}`, token);
    assert.equal(download.status, 200);
    assert.equal(download.body.length, file.length);
    assert.equal(crypto.createHash("sha1").update(download.body).digest("hex"), file.hash);
    assert.equal(crypto.createHash("sha256").update(download.body).digest("hex"), file.hash256);
    assert.deepEqual(download.body.toString("utf8").split("\r\n"),
      ["[OnlineSubsystemMcp.XMPP]", "ServerAddr=127.0.0.1", `ServerPort=${backend.port}`, "bUseSSL=false", "",
        "[OnlineSubsystemMcp.StompServiceMcp]", "Protocol=ws", `Domain=127.0.0.1:${backend.port}`, ""]);

    // The same through the HTTPS proxy tunnel the Cert client uses with -httpproxy.
    const host = "fortnite-public-service-prod11.ol.epicgames.com";
    const tunnel = await openTunnel(backend.port, host);
    const tunnelled = await send({ createConnection: () => tunnel, path: "/fortnite/api/cloudstorage/system",
      headers: { Host: host, "User-Agent": certUserAgent, Authorization: `bearer ${token}` } });
    assert.deepEqual(tunnelled.body, list.body);

    // Through a TLS-terminating reverse proxy on https://core.example.com (Core #197): STOMP on wss:// there, XMPP on
    // the backend's own port at that host.
    const proxied = await send({ host: "127.0.0.1", port: backend.port, path: `/fortnite/api/cloudstorage/system/${file.uniqueFilename}`,
      headers: { "User-Agent": certUserAgent, Authorization: `bearer ${token}`, "X-Forwarded-Proto": "https", "X-Forwarded-Host": "core.example.com" } });
    assert.deepEqual(proxied.body.toString("utf8").split("\r\n"),
      ["[OnlineSubsystemMcp.XMPP]", "ServerAddr=core.example.com", `ServerPort=${backend.port}`, "bUseSSL=false", "",
        "[OnlineSubsystemMcp.StompServiceMcp]", "Protocol=wss", "Domain=core.example.com", ""]);

    const missing = await get(backend.port, "/fortnite/api/cloudstorage/system/DefaultInput.ini", token);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.errorCode, "errors.com.epicgames.cloudstorage.file_not_found");
  } finally {
    backend.close();
  }
});

// Core-Backend #238: entering Battle Royale, the client asks for global chat rooms only with UFortOnlineAccount's
// bIsAthenaGlobalChatEnabled (3.2 0xD4C450), false in the shipped DefaultGame.ini of 2.5 to 3.2. Builds without it ignore it.
// PongooDev/CoreV2#483: 7.10 (CL-4667333) quits (FPlatformMisc::RequestExit) when an MCP service's Domain isn't pinned or
// its Protocol isn't https/wss, so from 7.10 the file leaves STOMP at its shipped Epic host for CoreRedirect to send
// here, and the sidecar service an Epic host for CoreRedirect to send here; 7.00 (CL-4629139) still gets both sections.
test("the system hotfix gives 7.10 and later no STOMP section and an Epic sidecar host, 7.00 its own", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    const engine = async (userAgent, headers = {}) => {
      const [file] = await listAs(backend.port, "/fortnite/api/cloudstorage/system", token, userAgent);
      const download = await send({ host: "127.0.0.1", port: backend.port, path: `/fortnite/api/cloudstorage/system/${file.uniqueFilename}`,
        headers: { "User-Agent": userAgent, Authorization: `bearer ${token}`, ...headers } });
      assert.equal(download.status, 200);
      return download.body.toString("utf8");
    };
    const xmpp = `[OnlineSubsystemMcp.XMPP]\r\nServerAddr=127.0.0.1\r\nServerPort=${backend.port}\r\nbUseSSL=false\r\n`;
    for (const changelist of [4667333, 4727874]) {
      const ini = await engine(agentOf(changelist === 4667333 ? "7.10" : "7.20", changelist));
      assert.ok(ini.startsWith(xmpp), ini);
      assert.equal(ini.includes("StompServiceMcp"), false, ini);
      const proxied = await engine(agentOf("7.10", changelist), { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "core.example.com" });
      assert.equal(proxied.includes("StompServiceMcp"), false, proxied);
      // The sidecar service goes through the same check (island saves): https and an Epic host under .ol.epicgames.com.
      const sidecar = "[OnlineSubsystemMcp.OnlineSidecarServiceMcp]\r\nProtocol=https\r\nDomain=mcpsidecar-public-service-prod.ol.epicgames.com\r\n";
      assert.ok(ini.includes(sidecar), ini);
      assert.ok(proxied.includes(sidecar), proxied);
    }
    const ini700 = await engine(agentOf("7.00", 4629139));
    assert.ok(ini700.includes(`[OnlineSubsystemMcp.StompServiceMcp]\r\nProtocol=ws\r\nDomain=127.0.0.1:${backend.port}\r\n`), ini700);
    assert.ok(ini700.includes(`[OnlineSubsystemMcp.OnlineSidecarServiceMcp]\r\nProtocol=http\r\nDomain=127.0.0.1:${backend.port}\r\n`), ini700);
  } finally {
    backend.close();
  }
});

test("the system hotfix turns on Battle Royale's global chat", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    for (const build of ["++Fortnite+Release-Cert-CL-3532353", "++Fortnite+Release-1.7.2-CL-3700114", "++Fortnite+Release-3.0.0-CL-3901517",
      "++Fortnite+Release-3.1-CL-3915963", "++Fortnite+Release-3.2-CL-3935073"]) {
      const lines = (await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultGame.ini", token, undefined,
        `game=Fortnite, engine=UE4, build=${build}`)).body.toString("utf8").split("\r\n");
      const section = lines.indexOf("[/Script/FortniteGame.FortOnlineAccount]");
      assert.equal(lines[section + 1], "bIsAthenaGlobalChatEnabled=true", build);
    }
  } finally {
    backend.close();
  }
});

// Core-Backend #344: 6.20 moved the setting to UFortChatManager (+0x1F3, read by AttemptJoinRecommendedChatRooms,
// 0x10D2C80), so its hotfix sets it there; UFortOnlineAccount's stays for the builds before.
test("the system hotfix turns on Battle Royale's general chat in UFortChatManager too, for 6.20 and later", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    for (const build of ["++Fortnite+Release-3.2-CL-3935073", "++Fortnite+Release-6.10-CL-4480234",
      "++Fortnite+Release-6.20-CL-4497486", "++Fortnite+Release-6.21-CL-4526925"]) {
      const lines = (await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultGame.ini", token, undefined,
        `game=Fortnite, engine=UE4, build=${build}`)).body.toString("utf8").split("\r\n");
      for (const name of ["[/Script/FortniteGame.FortOnlineAccount]", "[/Script/FortniteGame.FortChatManager]"]) {
        const section = lines.indexOf(name);
        assert.notEqual(section, -1, `${build}: ${name}`);
        assert.equal(lines[section + 1], "bIsAthenaGlobalChatEnabled=true", `${build}: ${name}`);
      }
    }
  } finally {
    backend.close();
  }
});

// Core-Backend #378: 7.00 ships general chat off (bShouldRequestGeneralChatRooms, bShouldJoinGlobalChat and
// bShouldJoinFounderChat false), so no tab joined a room; its hotfix turns them on. 6.31's section is as it was.
test("#378: the system hotfix turns on 7.00's general chat rooms in UFortChatManager; 6.31's section is unchanged", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    const chatManagerOf = async (build) => {
      const lines = (await raw(backend.port, "GET", "/fortnite/api/cloudstorage/system/DefaultGame.ini", token, undefined,
        `game=Fortnite, engine=UE4, build=${build}`)).body.toString("utf8").split("\r\n");
      const section = lines.indexOf("[/Script/FortniteGame.FortChatManager]");
      assert.notEqual(section, -1, build);
      const next = lines.findIndex((line, index) => index > section && (line === "" || line.startsWith("[")));
      return lines.slice(section + 1, next);
    };
    assert.deepEqual(await chatManagerOf("++Fortnite+Release-7.00-CL-4629139"), ["bIsAthenaGlobalChatEnabled=true",
      "bShouldRequestGeneralChatRooms=true", "bShouldJoinGlobalChat=true", "bShouldJoinFounderChat=true"]);
    assert.deepEqual(await chatManagerOf("++Fortnite+Release-6.31-CL-4573279"), ["bIsAthenaGlobalChatEnabled=true"]);
  } finally {
    backend.close();
  }
});

test("a large ClientSettings.Sav, sent chunked or sized, is stored whole and listed with its own hashes (#264)", async () => {
  const backend = await startBackend();
  try {
    const { token, accountId } = await userLogin(backend.port, "BigSettingsPlayer");
    const base = `/fortnite/api/cloudstorage/user/${accountId}`;
    const sha1 = (data) => crypto.createHash("sha1").update(data).digest("hex");
    const put = (body, headers, chunked) => new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: backend.port, method: "PUT", path: `${base}/ClientSettings.Sav`,
        headers: { "User-Agent": certUserAgent, Authorization: `bearer ${token}`, ...headers } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      req.on("error", reject);
      if (chunked) { for (let i = 0; i < body.length; i += 8192) req.write(body.subarray(i, i + 8192)); req.end(); } else req.end(body);
    });
    for (const [size, headers, chunked] of [[64 * 1024, { "Content-Type": "application/octet-stream" }, false],
      [200 * 1024, { "Content-Type": "application/json" }, false], [200 * 1024, { "Content-Type": "text/plain" }, true],
      [150 * 1024, { "Content-Type": "application/x-www-form-urlencoded" }, true]]) {
      const data = crypto.randomBytes(size);
      assert.equal(await put(data, headers, chunked), 204);
      const [file] = (await get(backend.port, base, token)).body;
      assert.equal(file.length, size);
      assert.equal(file.hash, sha1(data));
      assert.equal(file.hash256, crypto.createHash("sha256").update(data).digest("hex"));
      assert.ok((await raw(backend.port, "GET", `${base}/ClientSettings.Sav`, token)).body.equals(data));
    }
  } finally {
    backend.close();
  }
});

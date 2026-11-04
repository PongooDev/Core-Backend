import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { certUserAgent, clientToken, dedicatedServerToken, del, get, openTunnel, post, request, send, startBackend, userLogin } from "./helpers.js";

// Battle Royale's global chat (Core-Backend #238), in every build's DefaultGame.ini.
const athenaGlobalChat = ["[/Script/FortniteGame.FortOnlineAccount]", "bIsAthenaGlobalChatEnabled=true"];

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
    assert.equal((await raw(backend.port, "PUT", `${base}/ClientSettings.Sav`, token, first)).status, 204);

    // Changed again: the net stats turned off. The listing's hash follows the new file, so the game's cached copy no
    // longer matches it and it downloads this one.
    const second = Buffer.from(first);
    const flag = Buffer.from("HUD.TopLeft.NetDebugUI\0\x05\0\0\0None\0", "latin1");
    second[second.indexOf(flag) + flag.length] = 0;
    assert.notEqual(sha1(second), sha1(first));
    assert.equal((await raw(backend.port, "PUT", `${base}/ClientSettings.Sav`, token, second)).status, 204);

    const listed = await get(backend.port, base, token);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 1, "the temporary file of a write is never listed");
    const [file] = listed.body;
    assert.equal(file.filename, "ClientSettings.Sav");
    assert.equal(file.uniqueFilename, "ClientSettings.Sav");
    assert.equal(file.hash, sha1(second));
    assert.equal(file.hash256, crypto.createHash("sha256").update(second).digest("hex"));
    assert.equal(file.length, second.length);
    assert.equal(file.contentType, "application/octet-stream");
    assert.equal(file.accountId, accountId);
    assert.ok(!Number.isNaN(Date.parse(file.uploaded)));

    const read = await raw(backend.port, "GET", `${base}/${file.uniqueFilename}`, token);
    assert.equal(read.status, 200);
    assert.ok(read.body.equals(second), "read back byte for byte");
    assert.equal(sha1(read.body), file.hash);

    // The same file, uploaded with no content type, is stored as it came too.
    const plain = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: backend.port, method: "PUT", path: `${base}/ClientSettings.Sav`,
        headers: { "User-Agent": certUserAgent, Authorization: `bearer ${token}` } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      req.on("error", reject);
      req.end(first);
    });
    assert.equal(plain, 204);
    assert.ok((await raw(backend.port, "GET", `${base}/ClientSettings.Sav`, token)).body.equals(first));
    assert.equal((await get(backend.port, base, token)).body[0].hash, sha1(first));

    // Kept per account: another player's settings are their own.
    const other = await userLogin(backend.port, "OtherSettingsPlayer");
    assert.deepEqual((await get(backend.port, `/fortnite/api/cloudstorage/user/${other.accountId}`, other.token)).body, []);
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
      const purchaseFlow = Number(build.split("-CL-")[1]) >= 3724489 ? ["[EpicPurchaseFlow]", `Prod=http:///127.0.0.1:${backend.port}/purchase`] : [];
      assert.deepEqual(download.body.toString("utf8").split("\r\n"),
        ["[/Script/FortniteGame.FortGlobals]", `TimeBetweenLeaderboardRequestsMinutes=${minutes}`, ...athenaGlobalChat, ...purchaseFlow, ""], build);
    }
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

import { test } from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isQosPing, pingServer, pingServersFor, qosEngineLines, regionPingServers, startQosPingServer } from "../src/matchmaking/qos.js";
import { regionLabels, serverRegionCodes } from "../src/matchmaking/regions.js";
import { clientToken, get, post, send, startBackend } from "./helpers.js";

// Core-Backend #123: the regions later builds' clients offer (NA-East and NA-West from 3.0) in the admin panel, and the
// Auto region's ping (matchmaking/qos.js).

const agentOf = (changelist) => `game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-${changelist}`;
const engineIni = async (port, token, changelist) => (await send({ host: "127.0.0.1", port, method: "GET", path: "/fortnite/api/cloudstorage/system/DefaultEngine.ini",
  headers: { "User-Agent": agentOf(changelist), Authorization: `bearer ${token}` } })).body.split("\r\n");
const qosSection = (lines) => {
  const start = lines.indexOf("[/Script/Qos.QosRegionManager]");
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && line.startsWith("["));
  return lines.slice(start + 1, end < 0 ? undefined : end).filter(Boolean);
};

// The client's ping (6.20 0x2D2AF50, the same since 1.2): id, sequence, checksum, a timestamp, 0xAAAAAAAA, 0xBBBBBBBB.
function qosPing() {
  const packet = Buffer.alloc(22);
  packet.writeUInt16BE(1234, 0);
  packet.writeUInt16BE(7, 2);
  packet.writeBigUInt64LE(123456789n, 6);
  packet.writeUInt32BE(0xAAAAAAAA, 14);
  packet.writeUInt32BE(0xBBBBBBBB, 18);
  return packet;
}

test("the panel's regions: North America, NA-East and NA-West, Europe, Oceania, Brazil and Asia", () => {
  assert.deepEqual(serverRegionCodes, ["NA", "NAE", "NAW", "EU", "OCE", "BR", "ASIA"]);
  assert.deepEqual(serverRegionCodes.map((code) => regionLabels[code]),
    ["North America (NA)", "NA-East (NAE)", "NA-West (NAW)", "Europe (EU)", "Oceania (OCE)", "Brazil (BR)", "Asia (ASIA)"]);
});

test("ping servers: IPv4 addresses or host names, with a port when it isn't Epic's 22222", () => {
  assert.deepEqual(pingServer("203.0.113.5"), { address: "203.0.113.5", port: 22222 });
  assert.deepEqual(pingServer(" Ping.Example.org:5000 "), { address: "ping.example.org", port: 5000 });
  for (const bad of ["", "2001:db8::1", "[2001:db8::1]:22222", "203.0.113.300", "1.2.3", "host:0", "host:70000", "a b", "-bad.example", null]) {
    assert.equal(pingServer(bad), null, String(bad));
  }
  // Canonical regions of the panel, valid entries, each once, at most 8; Epic's port left off.
  assert.deepEqual(regionPingServers({ eu: ["203.0.113.5", "bad entry", "203.0.113.5:22222"], nae: ["ping.example.org:5000"], gb: ["198.51.100.1"],
    XX: ["192.0.2.1"], OCE: [], BR: "203.0.113.9", ASIA: Array.from({ length: 10 }, (_, index) => `192.0.2.${index + 1}`) }),
  { EU: ["203.0.113.5", "198.51.100.1"], NAE: ["ping.example.org:5000"], ASIA: Array.from({ length: 8 }, (_, index) => `192.0.2.${index + 1}`) });
  assert.equal(regionPingServers([]), undefined);
  // A region without its own: NAE and NAW take North America's, NA (up to 2.5) NAE's and NAW's.
  const servers = { NA: ["198.51.100.1"], NAE: ["203.0.113.5"], NAW: ["203.0.113.6:5000"] };
  assert.deepEqual(pingServersFor("NAE", servers), [{ address: "203.0.113.5", port: 22222 }]);
  assert.deepEqual(pingServersFor("NAW", { NA: ["198.51.100.1"] }), [{ address: "198.51.100.1", port: 22222 }]);
  assert.deepEqual(pingServersFor("NA", { NAE: ["203.0.113.5"], NAW: ["203.0.113.6:5000"] }),
    [{ address: "203.0.113.5", port: 22222 }, { address: "203.0.113.6", port: 5000 }]);
  assert.deepEqual(pingServersFor("EU", servers), []);
});

test("the QoS hotfix: 5.30 on adds a Core datacenter to each pinged region, 1.9 to 5.21 rewrite the pak's Datacenters", () => {
  const servers = { NA: ["198.51.100.1"], EU: ["203.0.113.5", "ping.example.org:5000"] };
  // Nothing to change: no ping servers, or a build before 1.9 (1.8.2) or not known.
  assert.deepEqual(qosEngineLines(4497486, {}), []);
  assert.deepEqual(qosEngineLines(3741772, servers), []);
  assert.deepEqual(qosEngineLines(null, servers), []);
  // 6.20: Epic's datacenters stay, Core's join the region; NAE and NAW are pinged at North America's.
  assert.deepEqual(qosEngineLines(4497486, servers), ["[/Script/Qos.QosRegionManager]",
    '+DatacenterDefinitions=(Id="CoreNAE", RegionId="NAE", bEnabled=true, Servers[0]=(Address="198.51.100.1", Port=22222))',
    '+DatacenterDefinitions=(Id="CoreNAW", RegionId="NAW", bEnabled=true, Servers[0]=(Address="198.51.100.1", Port=22222))',
    '+DatacenterDefinitions=(Id="CoreEU", RegionId="EU", bEnabled=true, Servers[0]=(Address="203.0.113.5", Port=22222), Servers[1]=(Address="ping.example.org", Port=5000))']);
  // 3.5: the pak's thirteen entries (3.0's to 5.21's list) again, the pinged regions' servers Core's.
  const lines35 = qosEngineLines(4008490, servers);
  assert.deepEqual(lines35.slice(0, 2), ["[/Script/Qos.QosRegionManager]", "!Datacenters=ClearArray"]);
  assert.deepEqual(lines35.slice(2).map((line) => /RegionId="([^"]+)"/.exec(line)[1]),
    ["NAE", "NAW", "EU", "OCE", "BR", "ASIA", "OH", "GB", "Testtj", "Testsa", "Testou", "Testpf", "Testdi"]);
  assert.equal(lines35[2], '+Datacenters=(DisplayName=NSLOCTEXT("MMRegion", "NA-East", "NA-East"), RegionId="NAE", bEnabled=true, bVisible=true, bBeta=false, ' +
    'Servers[0]=(Address="198.51.100.1", Port=22222))');
  // A region Core doesn't ping keeps the pak's line as it is (3.5's OCE), and so does a hidden one.
  assert.equal(lines35[5], '+Datacenters=(DisplayName=NSLOCTEXT("MMRegion", "Oceania", "Oceania"), RegionId="OCE", Servers[0]=(Address="13.210.122.252", Port=22222), ' +
    'Servers[1]=(Address="13.210.30.168", Port=22222), Servers[2]=(Address="13.210.108.126", Port=22222), Servers[3]=(Address="13.210.58.172", Port=22222))');
  assert.equal(lines35[8], '+Datacenters=(DisplayName=NSLOCTEXT("MMRegion", "Ohio", "Ohio"), RegionId="OH", bEnabled=true, bVisible=false, bBeta=true, ' +
    'Servers[0]=(Address="13.59.18.131", Port=22222), Servers[1]=(Address="18.216.47.148", Port=22222), Servers[2]=(Address="18.221.198.242", Port=22222), ' +
    'Servers[3]=(Address="52.15.144.157", Port=22222))');
  // 2.5: 1.9's to 2.5's nine, North America one region.
  const lines25 = qosEngineLines(3889387, servers);
  assert.deepEqual(lines25.slice(2).map((line) => /RegionId="([^"]+)"/.exec(line)[1]), ["NA", "EU", "OCE", "BR", "ASIA", "Test01", "Test02", "OH", "GB"]);
  assert.equal(lines25[2], '+Datacenters=(DisplayName=NSLOCTEXT("MMRegion", "North America", "North America"), RegionId="NA", Servers[0]=(Address="198.51.100.1", Port=22222))');
  // Only NA-East listed: 2.5's North America pings it too, 3.5's NA-West keeps Epic's.
  assert.match(qosEngineLines(3889387, { NAE: ["203.0.113.7"] })[2], /RegionId="NA", Servers\[0\]=\(Address="203\.0\.113\.7", Port=22222\)\)$/);
  assert.match(qosEngineLines(4008490, { NAE: ["203.0.113.7"] })[3], /RegionId="NAW", .*Address="13\.57\.85\.73"/);
});

test("the QoS ping server sends the client's pings back, and nothing else", async () => {
  const pinger = dgram.createSocket("udp4");
  await new Promise((resolve) => pinger.bind(0, "127.0.0.1", resolve));
  let allowed = true;
  const changes = new Set();
  const network = { bindAddress: () => "127.0.0.1", allows: () => allowed, onChange: (listener) => (changes.add(listener), () => changes.delete(listener)) };
  const said = [];
  const server = await startQosPingServer(network, 0, (text) => said.push(text));
  try {
    assert.ok(server.port > 0);
    assert.ok(isQosPing(qosPing()) && !isQosPing(Buffer.alloc(22)) && !isQosPing(Buffer.concat([qosPing(), Buffer.alloc(1)])));
    const answers = [];
    pinger.on("message", (packet) => answers.push(packet));
    pinger.send(Buffer.from("not a ping"), server.port, "127.0.0.1");
    pinger.send(qosPing(), server.port, "127.0.0.1");
    const [answer] = await once(pinger, "message");
    assert.ok(answer.equals(qosPing()));
    // An address the network settings don't let in hears nothing.
    allowed = false;
    pinger.send(qosPing(), server.port, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(answers.length, 1);
    // A port in use is said, not thrown.
    const taken = await startQosPingServer(network, server.port, (text) => said.push(text));
    assert.equal(taken.port, null);
    assert.match(said.at(-1), /couldn't use UDP port/);
    taken.close();
  } finally {
    server.close();
    pinger.close();
  }
  assert.equal(changes.size, 0);
});

test("the admin panel's regions, allocation limits and ping servers, and the hotfix that sends the pings there", async () => {
  const backend = await startBackend();
  try {
    const overview = (await get(backend.port, "/admin/api/matchmaking/overview")).body;
    assert.deepEqual(overview.regions.map(({ code }) => code), ["NA", "NAE", "NAW", "EU", "OCE", "BR", "ASIA"]);
    assert.equal(overview.regions[1].label, "NA-East (NAE)");
    // Every region has its limits and server counts, NA-East and NA-West too.
    assert.deepEqual(Object.keys(overview.serverLimits), ["NA", "NAE", "NAW", "EU", "OCE", "BR", "ASIA"]);
    assert.deepEqual(Object.keys(overview.serverCounts), ["NA", "NAE", "NAW", "EU", "OCE", "BR", "ASIA"]);
    assert.deepEqual([overview.regionPingServers, overview.qosPingPort], [{}, null]);

    const saved = await post(backend.port, "/admin/api/matchmaking/config", undefined, {
      serverRegions: ["NAE", "eu"], serverLimits: { NAE: { duo: 2 }, NAW: { solo: 1 } }, regionHostingIps: { naw: ["203.0.113.0/24"] },
      regionPingServers: { NAE: ["203.0.113.5"], eu: ["ping.example.org:5000"] }
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.serverRegions, ["NAE", "EU"]);
    assert.deepEqual([saved.body.serverLimits.NAE.duo, saved.body.serverLimits.NAW.solo, saved.body.serverLimits.NA.duo], [2, 1, 0]);
    assert.deepEqual(saved.body.regionHostingIps, { NAW: ["203.0.113.0/24"] });
    assert.deepEqual(saved.body.regionPingServers, { NAE: ["203.0.113.5"], EU: ["ping.example.org:5000"] });
    // Refused whole: an unknown region, a list that isn't one, an IPv6 address.
    for (const bad of [{ XX: ["203.0.113.5"] }, { EU: "203.0.113.5" }, { EU: ["2001:db8::1"] }, ["203.0.113.5"]]) {
      const refused = await post(backend.port, "/admin/api/matchmaking/config", undefined, { regionPingServers: bad });
      assert.equal(refused.status, 400, JSON.stringify(bad));
    }
    assert.deepEqual((await get(backend.port, "/admin/api/matchmaking/overview")).body.regionPingServers, { NAE: ["203.0.113.5"], EU: ["ping.example.org:5000"] });

    // The game's DefaultEngine.ini hotfix pings them: 6.20 at a Core datacenter, 3.5 in its Datacenters, 1.8.2 not at all.
    const token = await clientToken(backend.port);
    assert.deepEqual(qosSection(await engineIni(backend.port, token, 4497486)), [
      '+DatacenterDefinitions=(Id="CoreNAE", RegionId="NAE", bEnabled=true, Servers[0]=(Address="203.0.113.5", Port=22222))',
      '+DatacenterDefinitions=(Id="CoreEU", RegionId="EU", bEnabled=true, Servers[0]=(Address="ping.example.org", Port=5000))']);
    const section35 = qosSection(await engineIni(backend.port, token, 4008490));
    assert.equal(section35[0], "!Datacenters=ClearArray");
    assert.match(section35[1], /RegionId="NAE", bEnabled=true, bVisible=true, bBeta=false, Servers\[0\]=\(Address="203\.0\.113\.5", Port=22222\)\)$/);
    // The XMPP section still comes first.
    const lines18 = await engineIni(backend.port, token, 3741772);
    assert.equal(qosSection(lines18), null);
    assert.equal(lines18[0], "[OnlineSubsystemMcp.XMPP]");

    // The launcher (Core-Launcher #8) knows NA, EU, OCE, BR and ASIA: the status route names NA-East and NA-West as NA.
    await post(backend.port, "/admin/api/matchmaking/config", undefined, { serverRegions: ["NAW", "EU", "NAE"] });
    assert.deepEqual((await get(backend.port, "/core/api/status")).body.serverRegions, ["NA", "EU"]);

    // The defaults clear the limits; the regions and ping servers stay, as the hosting IPs do.
    const reset = (await post(backend.port, "/admin/api/matchmaking/actions/reset-defaults", undefined, {})).body;
    assert.equal(reset.serverLimits.NAE.duo, 0);
    assert.deepEqual(reset.regionPingServers, { NAE: ["203.0.113.5"], EU: ["ping.example.org:5000"] });
  } finally {
    backend.close();
  }
});

test("saved settings from before NA-East and NA-West keep their meaning", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-na-"));
  fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ serverRegions: ["NA", "EU"], serverLimits: { NA: { solo: 3 }, EU: { duo: 1 } },
    regionHostingIps: { NA: ["198.51.100.0/24"] } }));
  const backend = await startBackend({ dataDir });
  try {
    const overview = (await get(backend.port, "/admin/api/matchmaking/overview")).body;
    // NA is still ticked, still NA's limits and IPs (all of North America's); NA-East and NA-West start unlimited.
    assert.deepEqual(overview.serverRegions, ["NA", "EU"]);
    assert.deepEqual([overview.serverLimits.NA.solo, overview.serverLimits.EU.duo, overview.serverLimits.NAE.solo, overview.serverLimits.NAW.solo], [3, 1, 0, 0]);
    assert.deepEqual(overview.regionHostingIps, { NA: ["198.51.100.0/24"] });
    assert.deepEqual(overview.regionPingServers, {});
  } finally {
    backend.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

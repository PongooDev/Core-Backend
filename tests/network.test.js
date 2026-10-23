import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { listen } from "../src/listen.js";
import { createSessionStore, sessionJson } from "../src/matchmaking/sessions.js";
import { createNetwork, isPrivate, lanAddresses, validPublicAddress } from "../src/network.js";
import { createServer } from "../src/server.js";
import { get, post, startBackend } from "./helpers.js";

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "core-network-"));
const viewer = (remoteAddress, localAddress, host) => ({ socket: { remoteAddress, localAddress }, headers: host ? { host } : {} });
const waitFor = async (condition, what) => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const certCreate = {
  ownerId: "", ownerName: "CoreServer1", serverName: "Core-1", serverPort: 7777, maxPublicPlayers: 4, buildUniqueId: "595160781",
  attributes: { GAMEMODE_s: "FORTEMPTY", REGION_s: "NA", BEACONPORT_i: 15000 }
};

test("private, link-local, CGNAT, VPN and unique-local addresses are this network's; public ones aren't", () => {
  for (const address of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.20", "::ffff:192.168.1.20", "169.254.3.4", "100.101.102.103", "25.1.2.3", "26.103.131.196", "fd12::1", "fe80::1"]) {
    assert.equal(isPrivate(address), true, address);
  }
  for (const address of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "127.0.0.1", "2001:db8::1", "81.2.69.160"]) {
    assert.equal(isPrivate(address), false, address);
  }
  assert.equal(validPublicAddress(""), true);
  assert.equal(validPublicAddress("81.2.69.160"), true);
  assert.equal(validPublicAddress("my-house.duckdns.org"), true);
  assert.equal(validPublicAddress("127.0.0.1"), false, "a friend can't reach loopback");
  assert.equal(validPublicAddress("0.0.0.0"), false);
  assert.equal(validPublicAddress("http://1.2.3.4:5595"), false, "an address, not a URL");
});

test("each player is handed a gameserver address it can reach", () => {
  const local = createSessionStore().create(certCreate, "::ffff:127.0.0.1");
  const lanServer = createSessionStore().create(certCreate, "::ffff:192.168.1.40");
  const elsewhere = createSessionStore().create(certCreate, "::ffff:81.2.69.160");
  const plain = createNetwork();
  const withPublic = createNetwork({ publicAddress: "203.0.113.7" });

  // On this PC: the server's own address.
  assert.equal(sessionJson(local, viewer("::ffff:127.0.0.1", "::ffff:127.0.0.1"), withPublic).serverAddress, "127.0.0.1");
  // On the LAN or a VPN: the address it reached the backend on, never the public one (that needs NAT loopback).
  assert.equal(sessionJson(local, viewer("::ffff:192.168.1.30", "::ffff:192.168.1.10"), withPublic).serverAddress, "192.168.1.10");
  assert.equal(sessionJson(local, viewer("::ffff:100.70.1.2", "::ffff:100.64.9.9"), withPublic).serverAddress, "100.64.9.9");
  assert.equal(sessionJson(lanServer, viewer("::ffff:192.168.1.30", "::ffff:192.168.1.10"), withPublic).serverAddress, "192.168.1.40");
  // On the internet: the public address, else the IP the player typed (the redirect's Host header), else the local one.
  const friend = (host) => viewer("::ffff:198.51.100.20", "::ffff:192.168.1.10", host);
  assert.equal(sessionJson(local, friend("203.0.113.99:5595"), withPublic).serverAddress, "203.0.113.7");
  assert.equal(sessionJson(lanServer, friend(), withPublic).serverAddress, "203.0.113.7");
  assert.equal(sessionJson(local, friend("203.0.113.99:5595"), plain).serverAddress, "203.0.113.99");
  assert.equal(sessionJson(local, friend("fortnite-public-service-prod11.ol.epicgames.com"), plain).serverAddress, "192.168.1.10");
  assert.equal(sessionJson(lanServer, friend(), plain).serverAddress, "192.168.1.40");
  // A server somewhere else keeps its own address.
  assert.equal(sessionJson(elsewhere, friend(), withPublic).serverAddress, "81.2.69.160");
  assert.equal(local.serverAddress, "127.0.0.1", "the stored address stays the server's own");
});

test("XMPP is pointed at the address each player can reach this machine at", () => {
  const network = createNetwork({ publicAddress: "203.0.113.7" });
  assert.equal(network.reachableAddress(viewer("::ffff:127.0.0.1", "::ffff:127.0.0.1")), "127.0.0.1");
  assert.equal(network.reachableAddress(viewer("::ffff:192.168.1.30", "::ffff:192.168.1.10")), "192.168.1.10");
  assert.equal(network.reachableAddress(viewer("198.51.100.20", "192.168.1.10", "203.0.113.99:5595")), "203.0.113.7");
  assert.equal(createNetwork().reachableAddress(viewer("198.51.100.20", "192.168.1.10", "203.0.113.99:5595")), "203.0.113.99");
  assert.equal(createNetwork().reachableAddress(viewer("198.51.100.20", "192.168.1.10")), "192.168.1.10");
});

test("a public host name is looked up, as the client wants an IP", async () => {
  const network = createNetwork({ publicAddress: "localhost" });
  try {
    await waitFor(() => network.publicIp() !== null, "the lookup");
    assert.equal(network.publicIp(), "127.0.0.1");
    assert.equal(network.reachableAddress(viewer("198.51.100.20", "192.168.1.10")), "127.0.0.1");
  } finally {
    network.close();
  }
});

test("remote access is off by default; the panel's choice is saved in the data folder and the command line wins", () => {
  const dataDir = tempDir();
  try {
    const network = createNetwork({ dataDir });
    assert.deepEqual(network.settings(), { remoteAccess: false, listenAddress: "", publicAddress: "" });
    assert.equal(network.bindAddress(), "127.0.0.1");
    assert.equal(network.allows("::ffff:127.0.0.1"), true);
    assert.equal(network.allows("::ffff:192.168.1.30"), false);

    let changes = 0;
    network.onChange(() => ++changes);
    network.update({ remoteAccess: true, publicAddress: " 203.0.113.7 " });
    assert.equal(changes, 1);
    assert.equal(network.bindAddress(), undefined, "every interface");
    assert.equal(network.allows("::ffff:192.168.1.30"), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, "network.json"), "utf8")), { remoteAccess: true, publicAddress: "203.0.113.7" });
    assert.throws(() => network.update({ remoteAccess: "yes" }), /true or false/);
    assert.throws(() => network.update({ publicAddress: "http://x/" }), /IP address or a host name/);

    // The saved file beats config.json, and the command line beats both.
    assert.deepEqual(createNetwork({ dataDir, remoteAccess: false }).settings().remoteAccess, true);
    const fixed = createNetwork({ dataDir, remoteAccess: false, listenAddress: "192.168.1.10", fromCommandLine: ["remoteAccess"] });
    assert.deepEqual(fixed.settings(), { remoteAccess: false, listenAddress: "192.168.1.10", publicAddress: "203.0.113.7" });
    assert.throws(() => fixed.update({ remoteAccess: true }), /command line/);
    assert.equal(createNetwork({ dataDir, remoteAccess: true, listenAddress: "192.168.1.10" }).bindAddress(), "192.168.1.10");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("the config file and command line take the network options", () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, "core.json");
    fs.writeFileSync(file, JSON.stringify({ remoteAccess: true, publicAddress: "my-house.duckdns.org" }));
    assert.deepEqual(loadConfig(["--config", file]), { port: 5595, dataDir: "data", remoteAccess: true, publicAddress: "my-house.duckdns.org" });
    assert.deepEqual(loadConfig(["--config", file, "--local-only", "--listen", "192.168.1.10", "--public-address", "203.0.113.7"]),
      { port: 5595, dataDir: "data", remoteAccess: false, listenAddress: "192.168.1.10", publicAddress: "203.0.113.7", fromCommandLine: ["remoteAccess", "listenAddress", "publicAddress"] });
    assert.equal(loadConfig(["--remote-access"]).remoteAccess, true);
    assert.throws(() => loadConfig(["--remote-access", "--local-only"]), /both/);
    assert.throws(() => loadConfig(["--listen", "my-pc"]), /listenAddress/);
    fs.writeFileSync(file, JSON.stringify({ remoteAccess: "on" }));
    assert.throws(() => loadConfig(["--config", file]), /remoteAccess must be true or false/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the backend listens on 127.0.0.1 until remote access is turned on, and moves at once on the same port", async () => {
  const dataDir = tempDir();
  const server = await createServer({ dataDir, requestLog: false });
  try {
    const port = await listen(server, server.network, 0);
    assert.equal(server.address().address, "127.0.0.1");
    assert.deepEqual(server.network.listening, { host: "127.0.0.1", port });

    server.network.update({ remoteAccess: true });
    await waitFor(() => server.address()?.address !== "127.0.0.1", "listening on every interface");
    assert.ok(["::", "0.0.0.0"].includes(server.address().address), server.address().address);
    assert.equal(server.address().port, port);
    assert.equal((await fetch(`http://127.0.0.1:${port}/core/api/status`)).status, 200);

    server.network.update({ remoteAccess: false });
    await waitFor(() => server.address()?.address === "127.0.0.1", "back on 127.0.0.1");
    assert.equal(server.address().port, port);
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// Needs an address of this PC other than loopback to connect from; machines without a network skip it.
test("other machines are let in only while remote access is on, and dropped when it goes off", { skip: lanAddresses().length === 0 && "no LAN address" }, async () => {
  const [lan] = lanAddresses();
  const dataDir = tempDir();
  const server = await createServer({ dataDir, requestLog: false, remoteAccess: true });
  try {
    const port = await listen(server, server.network, 0);
    const status = await fetch(`http://${lan}:${port}/core/api/status`);
    assert.deepEqual(await status.json(), { name: "Core-Backend", version: JSON.parse(fs.readFileSync("package.json", "utf8")).version });
    // The admin panel and the launcher's API stay on this PC.
    assert.equal((await fetch(`http://${lan}:${port}/admin/api/network`)).status, 403);
    assert.equal((await fetch(`http://${lan}:${port}/core/api/sessions`)).status, 403);

    const socket = net.connect(port, lan);
    await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));
    const closed = new Promise((resolve) => socket.once("close", resolve));
    socket.on("error", () => {});
    server.network.update({ remoteAccess: false });
    await closed;
    await waitFor(() => server.address()?.address === "127.0.0.1", "back on 127.0.0.1");
    await assert.rejects(fetch(`http://${lan}:${port}/core/api/status`));
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("the admin panel reads and changes the network settings; the status route needs no login", async () => {
  const backend = await startBackend();
  try {
    const status = await get(backend.port, "/core/api/status");
    assert.equal(status.status, 200);
    assert.equal(status.body.name, "Core-Backend");

    let network = (await get(backend.port, "/admin/api/network")).body;
    assert.equal(network.remoteAccess, false);
    assert.deepEqual(network.fixed, []);
    assert.ok(Array.isArray(network.lanAddresses));
    assert.deepEqual(network.servers, []);

    network = (await post(backend.port, "/admin/api/network", undefined, { remoteAccess: true, publicAddress: "203.0.113.7" })).body;
    assert.equal(network.remoteAccess, true);
    assert.equal(network.publicAddress, "203.0.113.7");
    assert.equal(network.publicIp, "203.0.113.7");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(backend.dataDir, "network.json"), "utf8")), { remoteAccess: true, publicAddress: "203.0.113.7" });

    const refused = await post(backend.port, "/admin/api/network", undefined, { publicAddress: "not a host" });
    assert.equal(refused.status, 400);
    assert.match(refused.body.errorMessage, /IP address or a host name/);
  } finally {
    backend.close();
  }
});

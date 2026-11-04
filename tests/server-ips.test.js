import { test } from "node:test";
import assert from "node:assert/strict";
import { customMatchServers, customServerProblem, hasCustomServers, serverTakes } from "../src/matchmaking/custom-servers.js";
import { regionAllowsAddress, regionHostingIps } from "../src/matchmaking/regions.js";
import { clientAddress, inIpRanges, invalidIpRanges, ipRange, ipRanges } from "../src/network.js";
import { createSettingsStore } from "../src/settings/store.js";

// Core-Backend #227: each region's hosting IPs, the custom matchmaking servers, and whose IP a request is.

test("IP ranges: addresses and CIDR ranges are kept, anything else is refused", () => {
  assert.equal(ipRange("203.0.113.7"), "203.0.113.7");
  assert.equal(ipRange(" 203.0.113.0/24 "), "203.0.113.0/24");
  assert.equal(ipRange("203.0.113.7/32"), "203.0.113.7");
  assert.equal(ipRange("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(ipRange("2001:DB8::/32"), "2001:db8::/32");
  assert.equal(ipRange("0.0.0.0/0"), "0.0.0.0/0");
  for (const bad of ["", "0.0.0.0", "example.com", "203.0.113.0/33", "203.0.113.0/-1", "1.2.3.4/24/1", "203.0.113.256", 7, null]) {
    assert.equal(ipRange(bad), null, String(bad));
  }
  assert.deepEqual(ipRanges(["1.2.3.4", "1.2.3.4", "nope", "10.0.0.0/8"]), ["1.2.3.4", "10.0.0.0/8"]);
  assert.equal(ipRanges("1.2.3.4"), undefined);
  assert.deepEqual(invalidIpRanges(["1.2.3.4", "nope"]), ["nope"]);

  assert.equal(inIpRanges("203.0.113.99", ["203.0.113.0/24"]), true);
  assert.equal(inIpRanges("::ffff:203.0.113.99", ["203.0.113.0/24"]), true);
  assert.equal(inIpRanges("203.0.114.1", ["203.0.113.0/24"]), false);
  assert.equal(inIpRanges("2001:db8::5", ["2001:db8::/32"]), true);
  assert.equal(inIpRanges("::1", ["127.0.0.1"]), true);
  assert.equal(inIpRanges("", ["0.0.0.0/0"]), false);
});

test("a request's IP: X-Forwarded-For only in proxy mode, only from the proxy, and only the proxy's own entry", () => {
  const req = (remoteAddress, forwarded) => ({ socket: { remoteAddress }, headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded } });
  // Proxy mode off: the header is the client's to write, and never read.
  assert.equal(clientAddress(req("::ffff:127.0.0.1", "203.0.113.7"), false), "127.0.0.1");
  assert.equal(clientAddress(req("198.51.100.4", "127.0.0.1"), false), "198.51.100.4");
  // On, from the proxy (this PC or its network): the last entry, the one the proxy added.
  assert.equal(clientAddress(req("127.0.0.1", "203.0.113.7"), true), "203.0.113.7");
  assert.equal(clientAddress(req("192.168.1.2", "127.0.0.1, 203.0.113.7"), true), "203.0.113.7");
  assert.equal(clientAddress(req("127.0.0.1", "[2001:db8::5]:1234"), true), "2001:db8::5");
  assert.equal(clientAddress(req("127.0.0.1", "203.0.113.7:5000"), true), "203.0.113.7");
  // From anyone else, or with no usable header: the connection's own.
  assert.equal(clientAddress(req("198.51.100.4", "127.0.0.1"), true), "198.51.100.4");
  assert.equal(clientAddress(req("127.0.0.1", "garbage"), true), "127.0.0.1");
  assert.equal(clientAddress(req("127.0.0.1"), true), "127.0.0.1");
});

test("each region's hosting IPs: canonical regions, any IP when a region lists none", () => {
  const ips = regionHostingIps({ eu: ["203.0.113.0/24", "bad"], gb: ["198.51.100.1"], nae: ["192.0.2.1"], XX: ["1.1.1.1"], OCE: [] });
  assert.deepEqual(ips, { EU: ["203.0.113.0/24", "198.51.100.1"], NA: ["192.0.2.1"] });
  assert.equal(regionHostingIps([]), undefined);
  assert.equal(regionAllowsAddress("EU", "203.0.113.9", ips), true);
  assert.equal(regionAllowsAddress("uk", "198.51.100.1", ips), true);
  assert.equal(regionAllowsAddress("EU", "192.0.2.1", ips), false);
  assert.equal(regionAllowsAddress("NAW", "203.0.113.9", ips), false);
  assert.equal(regionAllowsAddress("OCE", "203.0.113.9", ips), true);
  assert.equal(regionAllowsAddress("NONE", "203.0.113.9", ips), true);
  assert.equal(regionAllowsAddress("EU", "203.0.113.9", {}), true);
});

test("custom matchmaking servers: kept for custom matches, by key, by player or for any", () => {
  const list = customMatchServers([
    { address: "203.0.113.5", keys: ["CoreKey1", "abc"], accounts: [] },
    { address: "198.51.100.0/24", keys: [], accounts: ["host1"] },
    "192.0.2.1",
    { address: "not an ip" }
  ]);
  assert.deepEqual(list, [
    { address: "203.0.113.5", keys: ["CoreKey1"], accounts: [] },
    { address: "198.51.100.0/24", keys: [], accounts: ["host1"] },
    { address: "192.0.2.1", keys: [], accounts: [] }
  ]);
  assert.match(customServerProblem({ address: "nope" }), /Not an IP address/);
  assert.match(customServerProblem({ address: "1.2.3.4", keys: ["abc"] }), /between 4 and 16/);
  assert.equal(customServerProblem({ address: "1.2.3.4", keys: ["abcd"] }), null);

  // A public match never plays on a kept server; a public server takes any match.
  assert.equal(serverTakes("203.0.113.5", {}, list), false);
  assert.equal(serverTakes("10.0.0.1", {}, list), true);
  assert.equal(serverTakes("10.0.0.1", { customKey: "CoreKey1", players: [] }, list), true);
  // A kept server takes the keys listed with it, or those its players open, or any when it lists neither.
  assert.equal(serverTakes("203.0.113.5", { customKey: "CoreKey1", players: [] }, list), true);
  assert.equal(serverTakes("203.0.113.5", { customKey: "OtherKey", players: ["host1"] }, list), false);
  assert.equal(serverTakes("198.51.100.7", { customKey: "OtherKey", players: ["host1"] }, list), true);
  assert.equal(serverTakes("198.51.100.7", { customKey: "OtherKey", players: ["guest"] }, list), false);
  assert.equal(serverTakes("192.0.2.1", { customKey: "Whatever", players: [] }, list), true);
  // Whether a custom match has servers of its own.
  assert.equal(hasCustomServers("Whatever", [], list), true);
  assert.equal(hasCustomServers("Whatever", [], list.slice(0, 2)), false);
  assert.equal(hasCustomServers(null, [], list), false);
});

test("the settings keep valid hosting IPs and custom servers only", () => {
  const settings = createSettingsStore(null);
  assert.deepEqual([settings.get().regionHostingIps, settings.get().customMatchServers, settings.get().customMatchFallback], [{}, [], false]);
  const updated = settings.update({ regionHostingIps: { eu: ["203.0.113.0/24", "x"] }, customMatchServers: [{ address: "203.0.113.5", keys: ["CoreKey1"] }, { address: "x" }],
    customMatchFallback: true });
  assert.deepEqual(updated.regionHostingIps, { EU: ["203.0.113.0/24"] });
  assert.deepEqual(updated.customMatchServers, [{ address: "203.0.113.5", keys: ["CoreKey1"], accounts: [] }]);
  assert.equal(updated.customMatchFallback, true);
  // Not a map or a list: unchanged.
  assert.deepEqual(settings.update({ regionHostingIps: "203.0.113.5", customMatchServers: "x" }).regionHostingIps, { EU: ["203.0.113.0/24"] });
});

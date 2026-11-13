import dgram from "node:dgram";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { log } from "../log.js";
import { regionGroup, regionOf, serverRegionCodes } from "./regions.js";

// Auto and the lowest ping (Core-Backend #123): the client's QoS, its ping servers, and Core's stand-ins for them.
// Addresses are 6.20's (CL-4497486) unless another build is named.
//
// The client measures each region itself. Login's QoS step (UOnlineAccountCommon, 0x2DF17D0: the step whose completion
// logs "LoginStep_OnQosPingTestsComplete detected best region %s", 0x2DF8EC0) starts UQosRegionManager's evaluation
// (BeginQosEvaluation 0x3A7540) unless the game's [QoS] ForceRegionId is set. The evaluator pings every server of every
// enabled datacenter NumTestsPerRegion (5) times, PingTimeout (3 s) each, with Epic's UDP ping (0x2D2AF50; the same code
// in 1.2 and 1.9): a 22-byte packet (id, sequence, checksum, the sender's QueryPerformanceCounter, 0xAAAAAAAA,
// 0xBBBBBBBB) to "Address:Port" (a host name is looked up), taken back only when the same 22 bytes come from the address
// it pinged. Epic's ping servers on UDP 22222 just sent the packet back. The addresses are the pak's DefaultEngine.ini
// [/Script/Qos.QosRegionManager]: each Datacenters entry's Servers up to 5.21, each DatacenterDefinitions entry's from
// 5.30 (regions.js has the lists); no backend endpoint is asked for them. A region's ping is its best datacenter's
// average (the datacenters sorted by AvgPingMs, 0x3A5A10), 9999 without an answer.
//
// The region the client then sends (its buckets' region, the sessions' REGION_s) is UQosRegionManager::GetRegionId: the
// player's pick, else the one TrySetDefaultRegion (0x3ADBF0) took after the evaluation, GetBestRegion (0x3A9BC0): the
// enabled, visible, auto-assignable region with the lowest ping, the first in the list on a tie. From 2.5 (CL-3889387)
// the Matchmaking Region setting ends with "Auto" (NSLOCTEXT("MMRegion", "AutoRegion", "Auto"), RegionId AUTO,
// UFortGameOptions 0x2EDB340, shown with the lowest auto-assignable ping); picking it saves SelectedRegionId "NONE"
// (0x2EE9B70), which leaves GetBestRegion's region in place. Before 2.5 a player who never picked a region gets the same.
// With Epic's ping servers gone every region is 9999, so Auto is the list's first region: NA up to 2.5, NAE from 3.0.
//
// Core changes neither the client nor its choice, only the addresses, Epic's way: DefaultEngine.ini is a hotfix
// (services/fortnite/cloudstorage.js) the client takes at start-up, before login (its system files come with the client
// token, the account's only after), and the hotfix reloads UQosRegionManager's config (its PostReloadConfig 0x3AC070
// rebuilds the region list from it). So each region whose ping servers the admin panel lists is pinged there:
// - 5.30 on: one more DatacenterDefinitions entry for the region, Id "Core<region>", with the panel's servers. Epic's
//   stay, unanswered; the region's ping is the best datacenter's, Core's.
// - 1.9 to 5.21: the Datacenters array again, as the build's pak has it, with the region's Servers the panel's.
// Builds before 1.9 (whose lists weren't read) and regions with no ping servers keep the pak's. The client measures once
// per login, so a change in the panel reaches a player when the game is started again.
//
// Something has to answer those pings: this backend does, on UDP 22222 (config qosPingPort, 0 for none), as Epic's ping
// servers did, where the backend listens (only this PC while remote access is off). For servers on another machine, that
// machine runs the same answer: `npm run qos-ping-server` (this file) from Core-Backend, or anything that sends UDP
// packets back to where they came from. The ping measures the way to that address, so it belongs next to the region's
// gameservers. Within the region the matchmaking still takes any free server.

export const qosPingPort = 22222;
const pingLength = 22;

// Whether a packet is the client's QoS ping: 22 bytes with 0xAAAAAAAA and 0xBBBBBBBB at 14 and 18. Nothing else is sent
// back, so the port can't be used to bounce other traffic.
export const isQosPing = (packet) => packet.length === pingLength && packet.readUInt32BE(14) === 0xAAAAAAAA && packet.readUInt32BE(18) === 0xBBBBBBBB;

// Answers the client's QoS pings on the port, where the network settings listen (network.js bindAddress: this PC unless
// remote access is on) and from whom they let in (allows), following their changes. Resolves with { port (null when it
// couldn't bind), close() }.
export async function startQosPingServer(network, port = qosPingPort, say = (text) => log("Matchmaking", text)) {
  let socket = null;
  let host;
  async function bind() {
    host = network.bindAddress();
    const next = dgram.createSocket(host && net.isIPv6(host) ? "udp6" : "udp4");
    next.on("message", (packet, from) => {
      if (isQosPing(packet) && network.allows(from.address)) next.send(packet, from.port, from.address);
    });
    try {
      await new Promise((resolve, reject) => {
        next.once("error", reject);
        next.bind(port, host, () => {
          next.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      next.close();
      say(`QoS ping server: couldn't use UDP port ${port} (${error.code ?? error.message}): the admin panel's ping servers on this PC don't answer`);
      return null;
    }
    next.on("error", (error) => say(`QoS ping server: ${error.message}`));
    socket = next;
    return next.address().port;
  }
  const bound = await bind();
  let moving = Promise.resolve();
  const stop = network.onChange?.(() => {
    moving = moving.then(async () => {
      if (network.bindAddress() === host) return;
      socket?.close();
      socket = null;
      await bind();
    });
  });
  return {
    port: bound,
    close() {
      stop?.();
      socket?.close();
      socket = null;
    }
  };
}

// The admin panel's ping servers (settings regionPingServers): { EU: ["203.0.113.5", "ping.example.org:22222"] }, each
// region's QoS ping servers as an IPv4 address or host name with an optional UDP port (22222). The client can't ping IPv6
// ("Address:Port" is split on ":"). The setting kept from a saved or sent one, canonical regions of the panel only, each
// with at most maxPingServers valid entries; undefined when it isn't an object.
export const maxPingServers = 8;
const hostName = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
export function pingServer(entry) {
  const match = /^([^:\s]+)(?::(\d{1,5}))?$/.exec(String(entry ?? "").trim());
  if (!match) return null;
  const [, address, portText] = match;
  const port = portText === undefined ? qosPingPort : Number(portText);
  if (!(port >= 1 && port <= 65535)) return null;
  if (/^[\d.]+$/.test(address) ? !net.isIPv4(address) : !hostName.test(address)) return null;
  return { address: address.toLowerCase(), port };
}
export function regionPingServers(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const kept = {};
  for (const [code, list] of Object.entries(value)) {
    const region = regionOf(code);
    if (!serverRegionCodes.includes(region) || !Array.isArray(list)) continue;
    const servers = [...new Set([...(kept[region] ?? []), ...list.map(pingServer).filter(Boolean)
      .map(({ address, port }) => (port === qosPingPort ? address : `${address}:${port}`))])].slice(0, maxPingServers);
    if (servers.length) kept[region] = servers;
  }
  return kept;
}
export const invalidPingServers = (list) => (Array.isArray(list) ? list.filter((entry) => pingServer(entry) === null) : []);

// The ping servers a build's region gets: its own, else North America's for NAE and NAW, else NAE's and NAW's for NA
// (1.9's to 2.5's North America).
export function pingServersFor(region, servers = {}) {
  const own = regionOf(region);
  const listed = (code) => (Array.isArray(servers?.[code]) ? servers[code] : []);
  const list = listed(own).length ? listed(own) : listed(regionGroup(own)).length ? listed(regionGroup(own))
    : own === "NA" ? [...listed("NAE"), ...listed("NAW")] : [];
  return list.map(pingServer).filter(Boolean).slice(0, maxPingServers);
}

// Epic's ping servers by datacenter, as the paks list them (UDP 22222; 5.30's datacenter ids, SEOUL is 3.0's ASIA).
const epicServers = {
  VA: ["34.193.154.39", "52.203.3.55", "54.82.195.216", "34.194.116.183"],
  OH: ["13.59.18.131", "18.216.47.148", "18.221.198.242", "52.15.144.157"],
  NCAL: ["13.57.85.73", "13.56.62.131", "13.56.40.30", "52.53.85.226"],
  OR: ["34.215.225.150", "34.215.53.191", "35.166.120.237", "52.34.35.6"],
  DE: ["18.194.220.44", "18.194.228.16", "35.156.234.249", "35.158.209.186"],
  GB: ["35.176.251.200", "35.176.71.245", "52.56.149.83", "52.56.183.213"],
  IE: ["34.243.155.72", "34.243.61.206", "52.18.254.19", "52.48.115.87"],
  FR: ["52.47.107.154", "52.47.140.95", "52.47.178.167", "52.47.193.251"],
  SYD: ["13.210.122.252", "13.210.30.168", "13.210.108.126", "13.210.58.172"],
  SAO: ["18.231.38.143", "18.231.52.12", "52.67.68.145", "54.207.41.123"],
  TOK: ["13.115.140.167", "13.115.206.205", "52.196.239.119", "52.69.44.52"],
  SEA: ["13.228.51.104", "52.220.191.249", "52.221.166.208", "52.74.234.192"],
  SEOUL: ["52.78.81.204", "13.125.18.11", "13.125.33.160", "13.124.108.227"]
};
// The Datacenters arrays (regions.js): [RegionId, DisplayName, the flags as the entry has them, its ping servers].
const shown = "bEnabled=true, bVisible=true, bBeta=false, ";
const hidden = "bEnabled=true, bVisible=false, bBeta=true, ";
const datacenters19 = [["NA", "North America", "", "VA"], ["EU", "Europe", "", "DE"], ["OCE", "Oceania", "", "SYD"], ["BR", "Brazil", shown, "SAO"],
  ["ASIA", "Asia", shown, "TOK"], ["Test01", "Test01", hidden, "SEOUL"], ["Test02", "Test02", hidden, "SEA"], ["OH", "Ohio", hidden, "OH"], ["GB", "London", hidden, "GB"]];
const datacenters30 = [["NAE", "NA-East", shown, "VA"], ["NAW", "NA-West", shown, "NCAL"], ["EU", "Europe", "", "DE"], ["OCE", "Oceania", "", "SYD"],
  ["BR", "Brazil", shown, "SAO"], ["ASIA", "Asia", shown, "SEOUL"], ["OH", "Ohio", hidden, "OH"], ["GB", "London", hidden, "GB"],
  ["Testtj", "Testtj", hidden, "TOK"], ["Testsa", "Testsa", hidden, "SEA"], ["Testou", "Testou", hidden, "OR"], ["Testpf", "Testpf", hidden, "FR"],
  ["Testdi", "Testdi", hidden, "IE"]];
const regionDefinitions = ["NAE", "NAW", "EU", "OCE", "BR", "ASIA"];
const datacentersBuild = 3757339;
const splitBuild = 3901517;
const definitionsBuild = 4305896;

const serversText = (servers) => servers.map(({ address, port }, index) => `Servers[${index}]=(Address="${address}", Port=${port})`).join(", ");

// The [/Script/Qos.QosRegionManager] lines of the hotfix for a build (its changelist) and the panel's ping servers, or []
// when nothing changes: no ping servers, a build before 1.9 or one not known.
export function qosEngineLines(changelist, servers = {}) {
  const build = Number(changelist);
  if (!(build >= datacentersBuild)) return [];
  if (build >= definitionsBuild) {
    const entries = regionDefinitions.map((region) => [region, pingServersFor(region, servers)]).filter(([, list]) => list.length);
    return entries.length ? ["[/Script/Qos.QosRegionManager]",
      ...entries.map(([region, list]) => `+DatacenterDefinitions=(Id="Core${region}", RegionId="${region}", bEnabled=true, ${serversText(list)})`)] : [];
  }
  const list = build >= splitBuild ? datacenters30 : datacenters19;
  // The hidden regions (OH, GB, the tests) keep Epic's: a player can't pick them.
  const ours = new Map(list.map(([region]) => [region, serverRegionCodes.includes(region) ? pingServersFor(region, servers) : []]));
  if (![...ours.values()].some((entries) => entries.length)) return [];
  return ["[/Script/Qos.QosRegionManager]", "!Datacenters=ClearArray", ...list.map(([region, name, flags, epic]) => {
    const own = ours.get(region);
    const pinged = own.length ? own : epicServers[epic].map((address) => ({ address, port: qosPingPort }));
    return `+Datacenters=(DisplayName=NSLOCTEXT("MMRegion", "${name}", "${name}"), RegionId="${region}", ${flags}${serversText(pinged)})`;
  })];
}

// `npm run qos-ping-server [port]`: only the ping answer, for a machine whose gameservers this backend doesn't run on.
// It answers anyone, on every interface.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.argv[2] ?? qosPingPort);
  const server = await startQosPingServer({ bindAddress: () => undefined, allows: () => true }, port);
  if (server.port === null) process.exit(1);
  log("Matchmaking", `QoS ping server: answering the game's region pings on UDP port ${server.port}`);
}

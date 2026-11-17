import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { creativeRuntimeOptions, isMnemonic, linkJson, normalizeMnemonic, publicIslandPath, sanitizeFeatured, sanitizeSchedule,
  suggestionPeriodStart } from "../src/services/links/islands.js";
import { parseIslandPath, parsePublicIslandPath } from "../src/services/dss/dss.js";
import { approvedCreatorsPage } from "../src/store/creators.js";
import { dedicatedServerToken, get, post, send, startBackend, userLogin } from "./helpers.js";

// Creative's published islands, featured rifts, island codes and backups (PongooDev/CoreV2#488), 7.10 (CL-4667333) on.
const v710 = "4667333";
const v700 = "4629139";
const agentOf = (build, version) => `Fortnite/++Fortnite+Release-${version}-CL-${build} Windows/10.0.19045.1.256.64bit`;
const agent710 = agentOf(v710, "7.10");
const dayMs = 86_400_000;
const startForDay = (day) => {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - (day - 1) * dayMs).toISOString().slice(0, 10);
};
const as = (port, token, method, url, { agent = agent710, body, headers = {} } = {}) => send({ host: "127.0.0.1", port, method, path: url,
  headers: { "User-Agent": agent, ...(token ? { Authorization: `bearer ${token}` } : {}), ...headers } }, body);
const json = (port, token, method, url, body) => as(port, token, method, url, { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const plotsOf = async (port, player) => {
  const answer = await json(port, player.token, "POST", `/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=creative&rvn=-1`, {});
  return Object.entries(answer.body.profileChanges[0].profile.items);
};
const admin = (backend, url, body, method) => (body === undefined && !method ? get(backend.port, `/admin/api${url}`)
  : method ? as(backend.port, undefined, method, `/admin/api${url}`, { body: body === undefined ? undefined : JSON.stringify(body), headers: { "Content-Type": "application/json" } })
    : post(backend.port, `/admin/api${url}`, undefined, body));

// A player with islands, one of them saved through the DSS as the server saves it.
async function savedIsland(backend, name, contents = "island record") {
  const player = await userLogin(backend.port, name);
  const plots = await plotsOf(backend.port, player);
  const [plotItemId, plot] = plots.find(([, item]) => item.templateId === "CreativePlot:temperate_medium");
  const server = await dedicatedServerToken(backend.port);
  const file = `/api/dss/v1/creative/islands/personal/${player.accountId}/${plotItemId}.island`;
  const raw = (method, url, body) => as(backend.port, server, method, url, { body, headers: { "Content-Type": "application/octet-stream" } });
  assert.equal((await raw("POST", `${file}/checkout?pid=server-488&dl=true`)).status, 204);
  assert.equal((await raw("PUT", `${file}?autolock=false`, contents)).status, 204);
  return { player, plotItemId, plot, server, file, raw };
}

test("codes, paths and the link's shape", () => {
  assert.equal(normalizeMnemonic("123456789012"), "1234-5678-9012");
  assert.equal(normalizeMnemonic(" 1234 5678-9012 "), "1234-5678-9012");
  assert.equal(normalizeMnemonic("1234-5678-901"), null);
  assert.ok(isMnemonic("1234-5678-9012"));
  assert.deepEqual(sanitizeFeatured(["1234-5678-9012", "123456789012", "x", "2222-2222-2222", "3333-3333-3333", "4444-4444-4444", "5555-5555-5555"]),
    ["1234-5678-9012", "2222-2222-2222", "3333-3333-3333", "4444-4444-4444"]);
  const owner = "0123456789abcdef0123456789abcdef";
  assert.equal(publicIslandPath(owner, "1234-5678-9012", 3), `islands/public/${owner}/1234-5678-9012/3.island`);
  assert.deepEqual(parsePublicIslandPath(`islands/public/${owner}/1234-5678-9012/3.island`), { owner, mnemonic: "1234-5678-9012", version: 3 });
  assert.deepEqual(parseIslandPath(`islands/personal/${owner}/abc-1.checkpoint.island`), { owner, plotItemId: "abc-1", checkpoint: true });
  assert.deepEqual(parseIslandPath(`islands/personal/${owner}/abc-1.island`), { owner, plotItemId: "abc-1" });
  const link = linkJson({ accountId: owner, creatorName: "Ninja", mnemonic: "1234-5678-9012", version: 2, title: "Box Fights", tagline: "1v1",
    islandType: "CreativePlot:temperate_medium", active: true, created: "2018-12-11T00:00:00.000Z", published: "2018-12-12T00:00:00.000Z" });
  // What 7.10's serializer (0x507CA0) and its server's link load (0xF82EC0, 0xF7DF50, 0xF7B160, 0xF7B7D0) read.
  assert.deepEqual([link.accountId, link.creatorName, link.mnemonic, link.linkType], [owner, "Ninja", "1234-5678-9012", "Creative:Island"]);
  assert.deepEqual(link.metadata, { title: "Box Fights", tagline: "1v1", locale: "en", islandType: "CreativePlot:temperate_medium",
    _filePath: `islands/public/${owner}/1234-5678-9012/2.island` });
  // Only 7.10 and later get the Creative runtime options; with no featured codes the array is emptied.
  assert.deepEqual(creativeRuntimeOptions(v700, null), []);
  assert.deepEqual(creativeRuntimeOptions(v710, { activeFeatured: () => ["1234-5678-9012"] }), ["PublishingEnabledForWhitelistedAccounts=true",
    "bEnableIslandCheckpoints=true", "bEnableIslandCodeEntryOnCuratedPortal=true", "!CuratedLinkCodes=ClearArray", "+CuratedLinkCodes=1234-5678-9012"]);
});

test("a creator's server publishes their island; its code, its file, its author's list, favorites and the featured rifts follow", async () => {
  const backend = await startBackend({ events: { seasonStarts: { 7: startForDay(20) } } });
  try {
    const { player, plotItemId, server } = await savedIsland(backend, "IslandCreator", "the creator's island");
    const create = (token, metadata) => json(backend.port, token, "POST", `/links/api/fn/author/${player.accountId}`,
      { linkType: "Creative:Island", metadata: { title: "Edit Course", tagline: "Practice edits", locale: "en", islandType: "CreativePlot:temperate_medium",
        _sourcePath: `islands/personal/${player.accountId}/${plotItemId}.island`, ...metadata } });
    // No Support-A-Creator code: Epic's creator_name_required.
    const refused = await create(server);
    assert.deepEqual([refused.status, refused.body.errorCode], [403, "errors.com.epicgames.links.creator_name_required"]);
    assert.deepEqual((await get(backend.port, `/core/api/creative/publishing/${player.accountId}`, server)).body,
      { accountId: player.accountId, allowed: false, creatorName: null });
    assert.equal((await admin(backend, "/creators", { account: "IslandCreator", code: "EditKing" })).status, 200);
    assert.deepEqual((await get(backend.port, `/core/api/creative/publishing/${player.accountId}`, server)).body,
      { accountId: player.accountId, allowed: true, creatorName: "EditKing" });

    const other = await userLogin(backend.port, "SomeoneElse488");
    assert.equal((await create(other.token)).status, 403, "another account can't publish for them");
    assert.equal((await create(server, { title: "x" })).status, 400, "a title is 3 to 40 characters");
    assert.equal((await create(server, { _sourcePath: `islands/personal/${other.accountId}/${plotItemId}.island` })).status, 400, "not their island");

    const made = await create(server);
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const code = made.body.mnemonic;
    assert.ok(isMnemonic(code));
    assert.deepEqual([made.body.creatorName, made.body.version, made.body.metadata.title, made.body.metadata.islandType],
      ["EditKing", 1, "Edit Course", "CreativePlot:temperate_medium"]);
    // The island code, as anyone's client or server asks for it.
    const byCode = await as(backend.port, other.token, "GET", `/links/api/fn/mnemonic/${code}`);
    assert.deepEqual([byCode.status, byCode.body.metadata._filePath], [200, `islands/public/${player.accountId}/${code}/1.island`]);
    assert.equal((await as(backend.port, server, "GET", `/api/dss/v1/creative/${byCode.body.metadata._filePath}`)).body, "the creator's island");
    assert.equal((await as(backend.port, server, "PUT", `/api/dss/v1/creative/${byCode.body.metadata._filePath}`, { body: "x" })).status, 404, "read-only");
    assert.deepEqual((await as(backend.port, other.token, "GET", `/links/api/fn/author/${player.accountId}`)).body.map((link) => link.mnemonic), [code]);

    // Publishing the island again: the same code, a new version.
    const again = await create(server, { title: "Edit Course 2" });
    assert.deepEqual([again.body.mnemonic, again.body.version], [code, 2]);

    // Favorites (7.10's island code screen).
    const favorites = `/fortnite/api/game/v2/creative/favorites/${other.accountId}`;
    assert.equal((await as(backend.port, other.token, "PUT", `${favorites}/${code}`)).status, 204);
    const listed = await as(backend.port, other.token, "GET", `${favorites}?limit=10`);
    assert.deepEqual([listed.body.results.length, listed.body.results[0].linkData.mnemonic, listed.body.hasMore], [1, code, false]);

    // The featured rifts: the hotfix's CuratedLinkCodes for 7.10, nothing for 7.00.
    assert.equal((await admin(backend, "/creative/featured", { codes: ["9999-9999-9999"] })).status, 400, "not published");
    const featured = await admin(backend, "/creative/featured", { codes: [code] });
    assert.deepEqual(featured.body.featured.map((entry) => entry.mnemonic), [code]);
    const hotfix = await as(backend.port, player.token, "GET", "/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini");
    assert.match(hotfix.body, new RegExp(`\\+CuratedLinkCodes=${code}`));
    assert.match(hotfix.body, /PublishingEnabledForWhitelistedAccounts=true/);
    assert.deepEqual((await get(backend.port, "/core/api/creative/featured", server)).body, { codes: [code] });
    const hotfix700 = await as(backend.port, player.token, "GET", "/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini", { agent: agentOf(v700, "7.00") });
    assert.doesNotMatch(hotfix700.body, /CuratedLinkCodes|PublishingEnabled/);

    // The creators page lists the creator's islands with their codes.
    const page = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/affiliate/creators" });
    assert.match(page.body, /Creative islands/);
    assert.match(page.body, new RegExp(`Edit Course 2.*${code}`));

    // The admin turns it off: the code, its file and the hotfix drop it; on again, then unpublished.
    assert.equal((await admin(backend, `/creative/links/${code}`, { active: false })).status, 200);
    assert.equal((await as(backend.port, other.token, "GET", `/links/api/fn/mnemonic/${code}`)).status, 404);
    assert.doesNotMatch((await as(backend.port, player.token, "GET", "/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini")).body, /\+CuratedLinkCodes/);
    assert.equal((await admin(backend, `/creative/links/${code}`, { active: true })).status, 200);
    const overview = (await admin(backend, "/creative")).body;
    assert.deepEqual([overview.links.length, overview.links[0].featuredSlot, overview.publishers[0].code], [1, 0, "EditKing"]);
    assert.equal((await admin(backend, `/creative/links/${code}`, undefined, "DELETE")).status, 200);
    assert.equal((await as(backend.port, other.token, "GET", `/links/api/fn/mnemonic/${code}`)).status, 404);
    assert.deepEqual((await admin(backend, "/creative")).body.featured, []);
    assert.equal(fs.existsSync(path.join(backend.dataDir, "creative", "public", player.accountId, code)), false);
  } finally {
    await backend.close();
  }
});

test("the island menu's backup and restore go through the island's checkpoint; the admin backs up, restores and publishes", async () => {
  const backend = await startBackend({ events: { seasonStarts: { 7: startForDay(20) } } });
  try {
    const { player, plotItemId, file, raw } = await savedIsland(backend, "IslandBackups", "version one");
    const checkpoint = `/api/dss/v1/creative/islands/personal/${player.accountId}/${plotItemId}.checkpoint.island`;
    assert.equal((await raw("GET", `${checkpoint}?info=true`)).status, 404, "no backup yet");
    // Backup Island: the island copied to its checkpoint (no checkout needed for it).
    assert.equal((await raw("POST", `${checkpoint}/restore?from=islands/personal/${player.accountId}/${plotItemId}.island`)).status, 204);
    const info = await raw("GET", `${checkpoint}?info=true`);
    assert.deepEqual([info.status, info.body.size], [200, "version one".length]);
    assert.equal((await raw("POST", `${checkpoint}/checkout?pid=x&dl=true`)).status, 400, "a checkpoint isn't checked out");
    assert.equal((await raw("PUT", `${file}?autolock=false`, "version two")).status, 204);
    // Restore: the checkpoint copied back over the island the server holds.
    assert.equal((await raw("POST", `${file}/restore?from=islands/personal/${player.accountId}/${plotItemId}.checkpoint.island`)).status, 204);
    assert.equal((await raw("GET", file)).body, "version one");

    // The admin: the player's islands, a backup, a restore refused while a server uses the island, then allowed.
    let view = (await admin(backend, `/accounts/${player.accountId}/creative`)).body;
    const island = view.islands.find((entry) => entry.plotItemId === plotItemId);
    assert.deepEqual([island.save.size, island.checkpoint.size, island.inUse, island.backups.length], ["version one".length, "version one".length, true, 0]);
    view = (await admin(backend, `/accounts/${player.accountId}/creative/${plotItemId}/backups`, { note: "before the event" })).body;
    const backup = view.islands.find((entry) => entry.plotItemId === plotItemId).backups[0];
    assert.equal(backup.note, "before the event");
    assert.equal((await admin(backend, `/accounts/${player.accountId}/creative/${plotItemId}/restore`, { from: backup.id })).status, 409, "the server has it loaded");
    assert.equal((await raw("POST", `${file}/checkin`)).status, 204);
    assert.equal((await raw("PUT", `${file}?autolock=true`, "version three")).status, 204);
    assert.equal((await admin(backend, `/accounts/${player.accountId}/creative/${plotItemId}/restore`, { from: backup.id })).status, 200);
    assert.equal((await raw("GET", file)).body, "version one");
    assert.equal((await admin(backend, `/accounts/${player.accountId}/creative/${plotItemId}/restore`, { from: "previous" })).status, 200);
    assert.equal((await raw("GET", file)).body, "version three");
    const downloaded = await get(backend.port, `/admin/api/accounts/${player.accountId}/creative/${plotItemId}/file/${backup.id}`);
    assert.equal(downloaded.body, "version one");
    const uploaded = await admin(backend, `/accounts/${player.accountId}/creative/${plotItemId}/upload`, { data: Buffer.from("from elsewhere").toString("base64"), note: "moved" });
    assert.equal(uploaded.body.islands.find((entry) => entry.plotItemId === plotItemId).backups.length, 2);

    // The admin publishes a player's island, who has no creator code.
    const published = await admin(backend, "/creative/publish", { accountId: player.accountId, plotItemId, title: "Admin Pick" });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.deepEqual([published.body.published.creatorName, published.body.published.publishedBy], ["IslandBackups", "admin"]);
    assert.equal((await admin(backend, `/accounts/${player.accountId}/creative`)).body.islands.find((entry) => entry.plotItemId === plotItemId).published.mnemonic,
      published.body.published.mnemonic);

    // Reset: the save goes, kept as a backup.
    view = (await admin(backend, `/accounts/${player.accountId}/creative/${plotItemId}/reset`, {})).body;
    const reset = view.islands.find((entry) => entry.plotItemId === plotItemId);
    assert.deepEqual([reset.save, reset.backups.length], [null, 3]);
  } finally {
    await backend.close();
  }
});

test("the suggested islands' period starts on the schedule's day and hour (UTC)", () => {
  // Friday 00:00 UTC by default: 2026-11-17 is a Tuesday.
  assert.equal(suggestionPeriodStart(new Date("2026-11-17T12:00:00Z"), undefined).toISOString(), "2026-11-13T00:00:00.000Z");
  assert.equal(suggestionPeriodStart(new Date("2026-11-13T00:00:00Z"), { weekday: 5 }).toISOString(), "2026-11-13T00:00:00.000Z");
  assert.equal(suggestionPeriodStart(new Date("2026-11-12T23:59:59Z"), { weekday: 5 }).toISOString(), "2026-11-06T00:00:00.000Z");
  // Saturday to Saturday at 18:00.
  assert.equal(suggestionPeriodStart(new Date("2026-11-14T17:00:00Z"), { weekday: 6, hour: 18 }).toISOString(), "2026-11-07T18:00:00.000Z");
  assert.equal(suggestionPeriodStart(new Date("2026-11-14T18:30:00Z"), { weekday: 6, hour: 18 }).toISOString(), "2026-11-14T18:00:00.000Z");
  assert.deepEqual(sanitizeSchedule({ weekday: 9, hour: -1 }), { weekday: 5, hour: 0 });
});

test("the week's suggested island leads the island code screen, and the featured rifts load the suggestions while none is set", async () => {
  const backend = await startBackend({ events: { seasonStarts: { 7: startForDay(20) } } });
  try {
    const first = await savedIsland(backend, "Suggested1", "island one");
    const second = await savedIsland(backend, "Suggested2", "island two");
    const codes = [];
    for (const { player, plotItemId } of [first, second]) {
      const published = await admin(backend, "/creative/publish", { accountId: player.accountId, plotItemId, title: `Pick ${player.accountId.slice(0, 4)}` });
      assert.equal(published.status, 200, JSON.stringify(published.body));
      codes.push(published.body.published.mnemonic);
    }
    let overview = (await admin(backend, "/creative")).body;
    const week = overview.suggestion;
    assert.deepEqual(week.schedule, { weekday: 5, hour: 0 }, "Friday to Friday by default");
    assert.deepEqual([...week.picks].sort(), [...codes].sort(), "both published islands are picked");
    assert.ok(codes.includes(week.suggested));
    assert.equal(week.featuredInRifts, true);
    // The same picks for the rest of the week.
    assert.deepEqual((await admin(backend, "/creative")).body.suggestion.picks, week.picks);

    // The island code screen: the suggestion first, then the player's favorites, once each.
    const viewer = await userLogin(backend.port, "SuggestionViewer");
    const favorites = `/fortnite/api/game/v2/creative/favorites/${viewer.accountId}`;
    let listed = await as(backend.port, viewer.token, "GET", `${favorites}?limit=30`);
    assert.deepEqual(listed.body.results.map((entry) => entry.linkData.mnemonic), [week.suggested]);
    const other = codes.find((code) => code !== week.suggested);
    assert.equal((await as(backend.port, viewer.token, "PUT", `${favorites}/${other}`)).status, 204);
    assert.equal((await as(backend.port, viewer.token, "PUT", `${favorites}/${week.suggested}`)).status, 204);
    listed = await as(backend.port, viewer.token, "GET", `${favorites}?limit=30`);
    assert.deepEqual(listed.body.results.map((entry) => entry.linkData.mnemonic), [week.suggested, other]);

    // No featured codes: the featured rifts load the suggestions; the admin's codes take over once set.
    const server = await dedicatedServerToken(backend.port);
    assert.deepEqual((await get(backend.port, "/core/api/creative/featured", server)).body.codes, week.picks);
    const hotfix = await as(backend.port, viewer.token, "GET", "/fortnite/api/cloudstorage/system/DefaultRuntimeOptions.ini");
    for (const code of week.picks) assert.match(hotfix.body, new RegExp(`\\+CuratedLinkCodes=${code}`));
    await admin(backend, "/creative/featured", { codes: [other] });
    assert.deepEqual((await get(backend.port, "/core/api/creative/featured", server)).body.codes, [other]);
    overview = (await admin(backend, "/creative")).body;
    assert.equal(overview.suggestion.featuredInRifts, false);

    // The schedule: Saturday to Saturday at 18:00 UTC picks again at once.
    assert.equal((await admin(backend, "/creative/suggestion", { weekday: 7 })).status, 400);
    overview = (await admin(backend, "/creative/suggestion", { weekday: 6, hour: 18 })).body;
    assert.deepEqual(overview.suggestion.schedule, { weekday: 6, hour: 18 });
    assert.equal(new Date(overview.suggestion.periodStart).getUTCDay(), 6);
    assert.equal(new Date(overview.suggestion.nextRefresh) - new Date(overview.suggestion.periodStart), 7 * dayMs);
    assert.equal((await admin(backend, "/creative/suggestion/repick", {})).status, 200);

    // An island switched off leaves the picks.
    await admin(backend, `/creative/links/${week.suggested}`, { active: false });
    overview = (await admin(backend, "/creative")).body;
    assert.deepEqual(overview.suggestion.picks, [other]);
  } finally {
    await backend.close();
  }
});

test("the creators page has no islands section entries without published islands", () => {
  const page = approvedCreatorsPage({ creators: [{ id: "a", accountId: "acc", code: "Ninja", enabled: true }] }, () => []);
  assert.match(page, /No published islands yet/);
  const withIslands = approvedCreatorsPage({ creators: [{ id: "a", accountId: "acc", code: "Ninja", enabled: true }] },
    () => [{ title: "<b>Box</b>", mnemonic: "1234-5678-9012" }]);
  assert.match(withIslands, /&lt;b&gt;Box&lt;\/b&gt;<\/span><span class="code">1234-5678-9012/);
});

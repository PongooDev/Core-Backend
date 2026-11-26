import { test } from "node:test";
import assert from "node:assert/strict";
import { configureEvents } from "../src/events/events.js";
import { eventLeadMs } from "../src/events/eventplaylists.js";
import { ltmEventLock, ltmFrontEndPlaylists, ltmModes, ltmOn } from "../src/events/ltms.js";
import { clientToken, post, send, startBackend, userLogin } from "./helpers.js";

// Live events with their own playlist (Core-Backend #436): the event's playlist alone in the lobby from shortly before the
// event to its end, every other mode back afterwards.
const minute = 60000;
const hour = 60 * minute;
const v730 = 4834550;
const v850 = 6058028;
const v851 = 6165369;
const at = Date.parse("2026-11-25T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const unvaulting = (eventAt) => ({ unvaulting: { mode: "custom", schedule: [
  { step: "countdown", startAt: iso(eventAt - 24 * hour), endAt: iso(eventAt) },
  { step: "level", startAt: iso(eventAt - 30 * minute), endAt: iso(eventAt + 15 * minute) },
  { step: "event", startAt: iso(eventAt), endAt: iso(eventAt + 10 * minute) },
  { step: "after", startAt: iso(eventAt + 10 * minute), endAt: null }
] } });
const showtime = (showAt, encoreAt) => ({ festivus: { mode: "custom", schedule: [
  { step: "stage", startAt: iso(showAt - 24 * hour), endAt: iso(encoreAt + 10 * minute) },
  { step: "show", startAt: iso(showAt), endAt: iso(showAt + 10 * minute) },
  { step: "encore", startAt: iso(encoreAt), endAt: iso(encoreAt + 10 * minute) }
] } });
const withConfig = (datedFlags, run) => {
  configureEvents({ mode: "auto", datedFlags });
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const enabled = (build, settings, ms) => ltmFrontEndPlaylists(build, settings, new Date(ms)).filter((entry) => entry.enabled).map(({ name }) => name);

test("the Unvaulting on 8.51 offers only Playlist_Music_Highest from its level step to the event's end", () => withConfig(unvaulting(at), () => {
  const settings = { matchmakingModes: {} };
  const before = enabled(v851, settings, at - 31 * minute);
  assert.ok(before.length > 1 && before.includes("Playlist_Music_Highest"), "the normal list before");
  assert.notEqual(ltmModes(v851, settings, new Date(at - 31 * minute))?.solo, false);
  for (const ms of [at - 30 * minute, at, at + 9 * minute]) {
    assert.deepEqual(enabled(v851, settings, ms), ["Playlist_Music_Highest"], iso(ms));
    const modes = ltmModes(v851, settings, new Date(ms));
    assert.deepEqual([modes.solo, modes.duo, modes.squad, modes.unvaulting, modes.endgame], [false, false, false, true, false]);
    assert.equal(ltmOn("unvaulting", v851, settings, new Date(ms)), true);
  }
  assert.deepEqual(ltmEventLock(v851, settings, new Date(at)), { event: "unvaulting", ltm: "unvaulting", since: at - 30 * minute, until: at + 10 * minute });
  assert.deepEqual(enabled(v851, settings, at + 10 * minute), before, "the normal list after the event");
  // All game modes on doesn't open the others; the admin's switch off leaves the lobby as it was.
  assert.deepEqual(enabled(v851, { allGameModes: true }, at), ["Playlist_Music_Highest"]);
  assert.equal(ltmModes(v851, { allGameModes: true }, new Date(at)).solo, false);
  assert.deepEqual(enabled(v851, { ...settings, lockEventPlaylists: false }, at), before);
  // 8.50 has no Unvaulting: its lobby is unchanged.
  assert.equal(ltmEventLock(v850, settings, new Date(at)), null);
  assert.deepEqual(enabled(v850, settings, at), enabled(v850, settings, at - 2 * hour));
}));

test("Showtime on 7.30 offers only Party at Pleasant Park around each show, the normal list between them", () => withConfig(showtime(at, at + 12 * hour), () => {
  const settings = { matchmakingModes: {} };
  for (const ms of [at - eventLeadMs, at + 5 * minute, at + 12 * hour - 10 * minute]) assert.deepEqual(enabled(v730, settings, ms), ["Playlist_Music_Highest"], iso(ms));
  for (const ms of [at - eventLeadMs - minute, at + 10 * minute, at + 12 * hour + 10 * minute]) {
    assert.equal(ltmEventLock(v730, settings, new Date(ms)), null, iso(ms));
    assert.notEqual(ltmModes(v730, settings, new Date(ms))?.solo, false);
  }
}));

test("Start now on the Unvaulting: 8.51's lobby lists the event's playlist alone and its matchmaking takes only it", async () => {
  const agent = `Fortnite/++Fortnite+Release-8.51-CL-${v851} Windows/10.0.19045.1.256.64bit`;
  const backend = await startBackend();
  try {
    const lines = async () => {
      const token = await clientToken(backend.port);
      const ini = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/fortnite/api/cloudstorage/system/DefaultGame.ini",
        headers: { "User-Agent": agent, Authorization: `bearer ${token}` } });
      return String(ini.body ?? "").split("\r\n").filter((line) => line.startsWith("+FrontEndPlaylistData="));
    };
    const on = async () => (await lines()).filter((line) => line.includes("bEnabled=true")).map((line) => line.match(/PlaylistName=(\w+)/)[1]);
    const before = await on();
    assert.ok(before.includes("Playlist_DefaultSolo") && before.includes("Playlist_Music_Highest"));
    const player = await userLogin(backend.port, "Unvaulting851");
    const ticket = (playlist) => send({ host: "127.0.0.1", port: backend.port, method: "GET",
      path: `/fortnite/api/game/v2/matchmakingservice/ticket/player/${player.accountId}?partyPlayerIds=${player.accountId}` +
        `&bucketId=${v851}:0:NAE:${playlist}&player.platform=Windows`,
      headers: { "User-Agent": agent, Authorization: `bearer ${player.token}` } });

    assert.equal((await post(backend.port, "/admin/api/events/schedule", null, { event: "unvaulting", mode: "now" })).status, 200);
    assert.deepEqual(await on(), ["Playlist_Music_Highest"]);
    assert.match((await lines()).find((line) => line.includes("Playlist_Music_Highest")), /bIsDefaultPlaylist=true, bVisibleWhenDisabled=true/);
    assert.match((await lines()).find((line) => line.includes("Playlist_DefaultSolo")), /bEnabled=false, bIsDefaultPlaylist=true, bVisibleWhenDisabled=false/);
    assert.equal((await ticket("playlist_defaultsolo")).status, 400);
    assert.equal((await ticket("playlist_music_highest")).status, 200);

    await post(backend.port, "/admin/api/matchmaking/config", null, { lockEventPlaylists: false });
    assert.deepEqual(await on(), before);
    assert.equal((await ticket("playlist_defaultsolo")).status, 200);
  } finally {
    backend.close();
  }
});

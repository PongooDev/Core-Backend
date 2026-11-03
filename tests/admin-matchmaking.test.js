import { test } from "node:test";
import assert from "node:assert/strict";
import { get, post, startBackend, userLogin } from "./helpers.js";

const admin = (backend, urlPath, body) => (body === undefined
  ? get(backend.port, `/admin/api${urlPath}`)
  : post(backend.port, `/admin/api${urlPath}`, undefined, body));

test("admin matchmaking tab: navigation, overview, gamemode toggles, server limits, timings, and rewards", async () => {
  const backend = await startBackend();

  try {
    // 1. GET /admin serves HTML with Matchmaking replacing Sessions in the sidebar
    const panelHtml = await get(backend.port, "/admin");
    assert.equal(panelHtml.status, 200);
    assert.ok(panelHtml.body.includes('href="#/matchmaking"'));
    assert.ok(panelHtml.body.includes('data-view="matchmaking"'));
    assert.ok(panelHtml.body.includes("Matchmaking"));
    // Old sessions nav link replaced
    assert.ok(!panelHtml.body.includes('data-view="sessions"><svg'));
    // Dashboard links to matchmaking
    assert.ok(panelHtml.body.includes('href: "#/matchmaking", class: "muted", text: "Manage →"'));

    // 2. GET /admin/api/matchmaking/overview returns default modes, limits, timing, and playlists
    const overviewRes = await admin(backend, "/matchmaking/overview");
    assert.equal(overviewRes.status, 200);
    const ov = overviewRes.body;

    // Modes default to all true
    assert.deepEqual(ov.modes, { solo: true, duo: true, squad: true, fiftyFifty: true, shootingTest: false });

    // 5 Battle Royale playlists: the 4 canonical ones and Shooting Test #1
    assert.equal(ov.playlists.length, 5);
    const soloPl = ov.playlists.find((p) => p.id === "solo");
    assert.ok(soloPl);
    assert.equal(soloPl.playlistId, 2);
    assert.equal(soloPl.code, "Playlist_DefaultSolo");
    assert.equal(soloPl.enabled, true);

    const duoPl = ov.playlists.find((p) => p.id === "duo");
    assert.ok(duoPl);
    assert.equal(duoPl.playlistId, 10);
    assert.equal(duoPl.code, "Playlist_DefaultDuo");

    const squadPl = ov.playlists.find((p) => p.id === "squad");
    assert.ok(squadPl);
    assert.equal(squadPl.playlistId, 9);
    assert.equal(squadPl.code, "Playlist_DefaultSquad");

    const fiftyPl = ov.playlists.find((p) => p.id === "fiftyFifty");
    assert.ok(fiftyPl);
    assert.equal(fiftyPl.playlistId, 11);
    assert.equal(fiftyPl.code, "Playlist_50v50");

    // Timing defaults
    assert.equal(ov.timing.gatherSeconds, 10);
    assert.equal(ov.timing.warmupSeconds, null);
    assert.equal(ov.timing.lateJoin, false);
    assert.equal(ov.timing.regionFallback, true);
    assert.equal(ov.timing.matchStartCountdown, true);
    assert.equal(ov.timing.matchStartBufferSeconds, 25);

    // Regional server limits default to 0 (unlimited)
    assert.ok(ov.serverLimits);
    for (const r of ["NA", "EU", "OCE", "BR", "ASIA"]) {
      assert.deepEqual(ov.serverLimits[r], { solo: 0, duo: 0, squad: 0, fiftyFifty: 0, shootingTest: 0 });
    }

    // Sessions array is returned
    assert.ok(Array.isArray(ov.sessions));

    // 3. User login to test player ticket route
    const { accountId, token } = await userLogin(backend.port, "MatchmakingTester");

    // Initially Solo (playlist 2) is enabled, ticket succeeds
    const soloTicketRes = await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${accountId}?bucketId=858118782:0:NA:2`, token);
    assert.equal(soloTicketRes.status, 200);

    // 4. POST /admin/api/matchmaking/config: Toggle Solo OFF, configure server limit, update timing
    const updateRes = await admin(backend, "/matchmaking/config", {
      modes: { solo: false, duo: true, squad: true, fiftyFifty: true },
      serverLimits: {
        NA: { solo: 2, duo: 5, squad: 5, fiftyFifty: 1 }
      },
      timing: {
        gatherSeconds: 25,
        warmupSeconds: 60,
        lateJoin: true,
        regionFallback: false,
        matchStartCountdown: false,
        matchStartBufferSeconds: 30
      },
      rewards: {
        enabled: true,
        modes: {
          solo: { perKill: 50, perWin: 300, placements: [{ top: 10, vbucks: 200 }] }
        }
      }
    });

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.success, true);
    assert.equal(updateRes.body.modes.solo, false);
    assert.equal(updateRes.body.serverLimits.NA.solo, 2);
    assert.equal(updateRes.body.timing.gatherSeconds, 25);
    assert.equal(updateRes.body.timing.warmupSeconds, 60);
    assert.equal(updateRes.body.timing.lateJoin, true);
    assert.equal(updateRes.body.timing.regionFallback, false);
    assert.equal(updateRes.body.timing.matchStartCountdown, false);
    assert.equal(updateRes.body.timing.matchStartBufferSeconds, 30);
    // Out of range (0 to 120) leaves it as it was.
    const badBuffer = await admin(backend, "/matchmaking/config", { timing: { matchStartBufferSeconds: 500 } });
    assert.equal(badBuffer.body.timing.matchStartBufferSeconds, 30);
    assert.equal(updateRes.body.rewards.enabled, true);

    // 5. Player ticket for disabled Solo mode is rejected with error 400
    const soloDisabledRes = await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${accountId}?bucketId=858118782:0:NA:2`, token);
    assert.equal(soloDisabledRes.status, 400);
    assert.equal(soloDisabledRes.body.errorCode, "errors.com.epicgames.fortnite.matchmaking_disabled");

    // Duos (playlist 10) is still enabled and succeeds
    const duoEnabledRes = await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${accountId}?bucketId=858118782:0:NA:10`, token);
    assert.equal(duoEnabledRes.status, 200);

    // 6. Calendar timeline reflects disabled Duos in client-matchmaking
    await admin(backend, "/matchmaking/config", {
      modes: { solo: true, duo: false, squad: true, fiftyFifty: false }
    });

    const timelineRes = await get(backend.port, "/fortnite/api/calendar/v1/timeline", token);
    assert.equal(timelineRes.status, 200);
    const mmChannel = timelineRes.body.channels["client-matchmaking"];
    assert.ok(mmChannel, "client-matchmaking channel should be present when duos/50v50 customized");
    const naState = mmChannel.states[0].state.region["NA"];
    assert.equal(naState.bDuosEnabled, false);
    assert.equal(naState.bFiftyFiftyEnabled, false);

    // 7. POST /admin/api/matchmaking/actions/reset-defaults restores all defaults
    const resetRes = await admin(backend, "/matchmaking/actions/reset-defaults", {});
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.body.success, true);
    assert.deepEqual(resetRes.body.modes, { solo: true, duo: true, squad: true, fiftyFifty: true, shootingTest: false });
    assert.equal(resetRes.body.timing.gatherSeconds, 10);
    assert.equal(resetRes.body.timing.warmupSeconds, null);
    assert.equal(resetRes.body.timing.lateJoin, false);
    assert.equal(resetRes.body.timing.regionFallback, true);
    assert.equal(resetRes.body.timing.matchStartCountdown, true);
    assert.equal(resetRes.body.timing.matchStartBufferSeconds, 25);
    assert.equal(resetRes.body.serverLimits.NA.solo, 0);

    // Re-verify Solo ticket succeeds after reset
    const soloRestoredRes = await get(backend.port, `/fortnite/api/game/v2/matchmakingservice/ticket/player/${accountId}?bucketId=858118782:0:NA:2`, token);
    assert.equal(soloRestoredRes.status, 200);
  } finally {
    backend.close();
  }
});

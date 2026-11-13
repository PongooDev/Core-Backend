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
    assert.deepEqual(ov.modes, { solo: true, duo: true, squad: true, fiftyFifty: true, shootingTest: false, highExplosives: false, sneakySilencers: false, sniperShootout: false,
      speedyStorm: false, takeToTheSkies: false, lotsaLoot: false, blitz: false, fiveByTwenty: false, highJump: false, useItOrLoseIt: false, steadyStorm: false,
      solidGold: false, skySupply: false, shotguns: false, blitzSolo: false, blitzDuo: false, fiftyFiftyV2: false, highExplosivesSolo: false,
      highExplosivesSquads: false, sniperShootoutSolo: false, sniperShootoutDuos: false, sniperShootoutSquads: false, skySupplyDuos: false,
      skySupplySquads: false, solidGoldSolo: false, impactSolo: false, impactDuos: false, impactSquads: false, infinityGauntlet: false,
      soloShowdown: false, closeEncounters: false, closeEncountersSolo: false, closeEncountersDuos: false, solidGoldDuos: false, blitzV2: false, sniperShootoutV3: false, teamsOf20V2: false, playground: false, fiftyFiftyV3: false, sniperShootoutV3Solo: false, sniperShootoutV3Duos: false, finalFight: false, finalFightTeams12: false, fiftyFiftySeason5: true,
      playgroundV2: true, flyExplosives: false, flyExplosivesSolo: false, flyExplosivesDuos: false, steadyStormSolo: false, steadyStormDuos: false,
      steadyStormSquads: false, soaring50s: false, sniperShootoutV4: false, sniperShootoutV4Solo: false, sniperShootoutV4Duos: false,
      scoreRoyaleSolo: false, scoreRoyaleDuos: false, scoreRoyaleSquads: false, solidGoldSeason5: false, solidGoldSeason5Solo: false,
      solidGoldSeason5Duos: false, fiftyFiftySolidGold: false, getaway: true, getawayDuos: true, getawaySolo: false, closeEncountersSeason5: false,
      closeEncountersSeason5Solo: false, closeEncountersSeason5Duos: false, soaringSolos: true, soaringDuos: false, soaringSquads: false,
      fiftyFiftySeason6: true, discoDomination: false, discoDomination602: true, discoDomination32: false, highExplosivesSeason6Solo: false,
      highExplosivesSeason6Squads: false, steadyStormSeason6Solo: false, steadyStormSeason6Duos: false, steadyStormSeason6Squads: false,
      discoDomination40: false, discoDominationAlt: false, blitzSeason6Solo: false, blitzSeason6Duos: false, blitzSeason6Squads: false,
      gliderRedeploySolo: false, gliderRedeployDuos: false, gliderRedeploySquads: false,
      fortnitemares2018Solo: true, fortnitemares2018Duos: true, fortnitemares2018Squads: true, discoDomination40Alt: false, discoDomination32Alt: false });

    // 21 Battle Royale playlists: the 4 canonical ones, Shooting Test #1, the other event queues (#190), 3.0's new ones
    // and 3.1's Blitz Solo and Duo, 3.5.1's own twelve, 4.1's Infinity Gauntlet and the nine of 4.2 on (#258: 4.2's Close Encounters in three, its Solid
    // Gold v2 Duos) and 4.4's 50v50 v3 (PongooDev/CoreV2#328) and Sniper Shootout v3's Solo and Duos (#327) and
    // 4.4.2's Final Fight (#325), 4.5's Final Fight: Teams of 12, 5.0's 50v50, 5.10's Playground and Fly Explosives and
    // 5.21's Steady Storm, Soaring 50's and Sniper Shootout v4, and 5.30's Score Royale, Solid Gold and 50v50 Solid Gold,
    // and 5.40's Getaway and Close Encounters, and 5.41's Soaring Solos (Solo, Duos, Squads), and 6.00's 50v50, and 6.01's
    // Disco Domination, and 6.02's seven (Disco Domination, its 32 a side one, High Explosives and Steady Storm), and
    // 6.10's eight (two more Disco Dominations, Blitz! v2 and the defaults with glider redeploy; its three tournament
    // playlists are the Tournaments tab's, not modes), and 6.20's five (Fortnitemares' three and two more Disco Dominations;
    // its three tournament playlists the Tournaments tab's too)
    assert.equal(ov.playlists.length, 98);
    assert.equal(ov.ltms.originalDates, false);
    assert.deepEqual(ov.ltms.list.map((ltm) => ltm.id), ["fiftyFifty", "highExplosives", "sneakySilencers", "sniperShootout", "shootingTest",
      "speedyStorm", "takeToTheSkies", "lotsaLoot", "blitz", "fiveByTwenty", "highJump", "useItOrLoseIt", "steadyStorm", "solidGold", "skySupply", "shotguns", "blitzSolo", "blitzDuo",
      "fiftyFiftyV2", "highExplosivesSolo", "highExplosivesSquads", "sniperShootoutSolo", "sniperShootoutDuos", "sniperShootoutSquads", "skySupplyDuos",
      "skySupplySquads", "solidGoldSolo", "impactSolo", "impactDuos", "impactSquads", "infinityGauntlet", "soloShowdown", "closeEncounters",
      "closeEncountersSolo", "closeEncountersDuos", "solidGoldDuos", "blitzV2", "sniperShootoutV3", "teamsOf20V2", "playground", "fiftyFiftyV3", "sniperShootoutV3Solo", "sniperShootoutV3Duos", "finalFight", "finalFightTeams12", "fiftyFiftySeason5",
      "playgroundV2", "flyExplosives", "flyExplosivesSolo", "flyExplosivesDuos", "steadyStormSolo", "steadyStormDuos", "steadyStormSquads",
      "soaring50s", "sniperShootoutV4", "sniperShootoutV4Solo", "sniperShootoutV4Duos", "scoreRoyaleSolo", "scoreRoyaleDuos", "scoreRoyaleSquads",
      "solidGoldSeason5", "solidGoldSeason5Solo", "solidGoldSeason5Duos", "fiftyFiftySolidGold", "getaway", "getawayDuos", "getawaySolo",
      "closeEncountersSeason5", "closeEncountersSeason5Solo", "closeEncountersSeason5Duos", "soaringSolos", "soaringDuos", "soaringSquads",
      "fiftyFiftySeason6", "discoDomination", "discoDomination602", "discoDomination32", "highExplosivesSeason6Solo", "highExplosivesSeason6Squads",
      "steadyStormSeason6Solo", "steadyStormSeason6Duos", "steadyStormSeason6Squads", "discoDomination40", "discoDominationAlt",
      "blitzSeason6Solo", "blitzSeason6Duos", "blitzSeason6Squads", "gliderRedeploySolo", "gliderRedeployDuos", "gliderRedeploySquads",
      "fortnitemares2018Solo", "fortnitemares2018Duos", "fortnitemares2018Squads", "discoDomination40Alt", "discoDomination32Alt"]);
    assert.equal(ov.playlists.find((p) => p.id === "fiftyFiftyV2").code, "Playlist_50v50");
    // #257: each LTM's playlist asset and teams, and the 3.5.1 lobby's name for the ones kept from 3.0 and 3.1.
    const pl = (id) => ov.playlists.find((p) => p.id === id);
    assert.equal(pl("sniperShootoutDuos").code, "Playlist_Snipers_Duos");
    assert.deepEqual([pl("sniperShootoutDuos").teamCount, pl("sniperShootoutDuos").teamSize], [100, 2]);
    assert.deepEqual([pl("highExplosivesSolo").teamSize, pl("solidGoldSolo").teamSize], [1, 1]);
    assert.deepEqual([pl("fiftyFiftyV2").teamCount, pl("fiftyFiftyV2").teamSize, pl("fiftyFiftyV2").squadSize], [2, 50, 4]);
    assert.equal(pl("solidGold").code, "AthenaEvent27 / Playlist_SolidGold_Squads");
    assert.equal(pl("solidGold").name, "Solid Gold / Solid Gold v2 (Squads)");
    assert.equal(pl("blitz").code, "AthenaEvent8 / Playlist_Blitz_Squad");
    assert.equal(pl("blitzDuo").name, "Blitz (Duo) / Blitz! (Duos)");
    assert.deepEqual([pl("blitzDuo").teamSize, pl("blitzSolo").teamSize], [2, 1]);
    assert.deepEqual([pl("fiveByTwenty").teamCount, pl("fiveByTwenty").teamSize], [5, 20]);
    assert.equal(ov.ltms.list.find((ltm) => ltm.id === "fiveByTwenty").name351, "Teams of 20");
    assert.ok(panelHtml.body.includes("l.name351 ? `${l.name} / ${l.name351}` : l.name"));
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
    assert.equal(ov.timing.warmupSeconds, 120);
    assert.equal(ov.timing.lateJoin, false);
    assert.equal(ov.timing.regionFallback, true);
    assert.equal(ov.timing.matchStartCountdown, true);
    assert.equal(ov.timing.matchStartBufferSeconds, 25);

    // Regional server limits default to 0 (unlimited)
    assert.ok(ov.serverLimits);
    for (const r of ["NA", "EU", "OCE", "BR", "ASIA"]) {
      assert.deepEqual(ov.serverLimits[r], { solo: 0, duo: 0, squad: 0, fiftyFifty: 0, shootingTest: 0, highExplosives: 0, sneakySilencers: 0, sniperShootout: 0,
        speedyStorm: 0, takeToTheSkies: 0, lotsaLoot: 0, blitz: 0, fiveByTwenty: 0, highJump: 0, useItOrLoseIt: 0, steadyStorm: 0, solidGold: 0, skySupply: 0, shotguns: 0, blitzSolo: 0, blitzDuo: 0 });
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
    assert.deepEqual(resetRes.body.modes, { solo: true, duo: true, squad: true, fiftyFifty: true, shootingTest: false, highExplosives: false, sneakySilencers: false, sniperShootout: false,
      speedyStorm: false, takeToTheSkies: false, lotsaLoot: false, blitz: false, fiveByTwenty: false, highJump: false, useItOrLoseIt: false, steadyStorm: false,
      solidGold: false, skySupply: false, shotguns: false, blitzSolo: false, blitzDuo: false, fiftyFiftyV2: false, highExplosivesSolo: false,
      highExplosivesSquads: false, sniperShootoutSolo: false, sniperShootoutDuos: false, sniperShootoutSquads: false, skySupplyDuos: false,
      skySupplySquads: false, solidGoldSolo: false, impactSolo: false, impactDuos: false, impactSquads: false, infinityGauntlet: false,
      soloShowdown: false, closeEncounters: false, closeEncountersSolo: false, closeEncountersDuos: false, solidGoldDuos: false, blitzV2: false, sniperShootoutV3: false, teamsOf20V2: false, playground: false, fiftyFiftyV3: false, sniperShootoutV3Solo: false, sniperShootoutV3Duos: false, finalFight: false, finalFightTeams12: false, fiftyFiftySeason5: true,
      playgroundV2: true, flyExplosives: false, flyExplosivesSolo: false, flyExplosivesDuos: false, steadyStormSolo: false, steadyStormDuos: false,
      steadyStormSquads: false, soaring50s: false, sniperShootoutV4: false, sniperShootoutV4Solo: false, sniperShootoutV4Duos: false,
      scoreRoyaleSolo: false, scoreRoyaleDuos: false, scoreRoyaleSquads: false, solidGoldSeason5: false, solidGoldSeason5Solo: false,
      solidGoldSeason5Duos: false, fiftyFiftySolidGold: false, getaway: true, getawayDuos: true, getawaySolo: false, closeEncountersSeason5: false,
      closeEncountersSeason5Solo: false, closeEncountersSeason5Duos: false, soaringSolos: true, soaringDuos: false, soaringSquads: false,
      fiftyFiftySeason6: true, discoDomination: false, discoDomination602: true, discoDomination32: false, highExplosivesSeason6Solo: false,
      highExplosivesSeason6Squads: false, steadyStormSeason6Solo: false, steadyStormSeason6Duos: false, steadyStormSeason6Squads: false,
      discoDomination40: false, discoDominationAlt: false, blitzSeason6Solo: false, blitzSeason6Duos: false, blitzSeason6Squads: false,
      gliderRedeploySolo: false, gliderRedeployDuos: false, gliderRedeploySquads: false,
      fortnitemares2018Solo: true, fortnitemares2018Duos: true, fortnitemares2018Squads: true, discoDomination40Alt: false, discoDomination32Alt: false });
    assert.equal(resetRes.body.timing.gatherSeconds, 10);
    assert.equal(resetRes.body.timing.warmupSeconds, 120);
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

test("the player bots settings: defaults, sanitizing, the config round-trip and reset (CoreV2 #233)", async () => {
  const backend = await startBackend();
  try {
    const defaults = { forcePlayerAIs: false, count: 0, level: 5, startingHealth: 100, startingShield: 0, eliminationsCountForQuests: true, botFightChance: 30, fillPlayerTeams: false };
    assert.deepEqual((await admin(backend, "/matchmaking/overview")).body.bots, defaults);

    let res = await admin(backend, "/matchmaking/config", { bots: { forcePlayerAIs: true, count: 40, level: 8, startingHealth: 50, startingShield: 25, eliminationsCountForQuests: false, botFightChance: 45, fillPlayerTeams: true } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.bots, { forcePlayerAIs: true, count: 40, level: 8, startingHealth: 50, startingShield: 25, eliminationsCountForQuests: false, botFightChance: 45, fillPlayerTeams: true });
    assert.deepEqual((await admin(backend, "/matchmaking/overview")).body.bots, res.body.bots);

    // Invalid fields keep their value; a partial update merges.
    res = await admin(backend, "/matchmaking/config", { bots: { count: 101, level: 0, startingHealth: 0, startingShield: -1, forcePlayerAIs: "yes", eliminationsCountForQuests: 1, botFightChance: 101, fillPlayerTeams: "yes" } });
    assert.deepEqual(res.body.bots, { forcePlayerAIs: true, count: 40, level: 8, startingHealth: 50, startingShield: 25, eliminationsCountForQuests: false, botFightChance: 45, fillPlayerTeams: true });
    res = await admin(backend, "/matchmaking/config", { bots: { count: 12, level: 1.5 } });
    assert.deepEqual(res.body.bots, { forcePlayerAIs: true, count: 12, level: 8, startingHealth: 50, startingShield: 25, eliminationsCountForQuests: false, botFightChance: 45, fillPlayerTeams: true });
    // The bounds are inclusive.
    res = await admin(backend, "/matchmaking/config", { bots: { count: 100, level: 10, startingHealth: 1, startingShield: 100, botFightChance: 100 } });
    assert.deepEqual([res.body.bots.count, res.body.bots.level, res.body.bots.startingHealth, res.body.bots.startingShield, res.body.bots.botFightChance], [100, 10, 1, 100, 100]);
    res = await admin(backend, "/matchmaking/config", { bots: { botFightChance: 0 } });
    assert.equal(res.body.bots.botFightChance, 0);
    // Fill players' teams is its own switch: off, Force player AIs stays on.
    res = await admin(backend, "/matchmaking/config", { bots: { fillPlayerTeams: false } });
    assert.deepEqual([res.body.bots.fillPlayerTeams, res.body.bots.forcePlayerAIs], [false, true]);

    res = await admin(backend, "/matchmaking/actions/reset-defaults", {});
    assert.deepEqual(res.body.bots, defaults);
  } finally {
    backend.close();
  }
});

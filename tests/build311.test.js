import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedBuildList, buildChoices } from "../src/builds/allowed.js";
import { inBuild } from "../src/builds/context.js";
import { battleRoyaleBuilds, getBuild, seasonName, versionOf } from "../src/builds/detect.js";
import { activeEventFlags } from "../src/events/events.js";
import { hasLtm, ltmForcedQueues } from "../src/events/ltms.js";
import { athenaCosmetics, athenaSeason } from "../src/gamedata/athena.js";
import { dataBuild } from "../src/gamedata/read.js";
import { assignmentBucket, showsMatchStart } from "../src/matchmaking/service.js";
import { buildOfSeason } from "../src/profiles/seasons.js";
import { eventStoreOffers } from "../src/store/eventstore.js";
import { itemShopOffers } from "../src/store/itemshop.js";
import { worldInfo } from "../src/world/theaters.js";

// Fortnite 3.1.1 (++Fortnite+Release-3.1-CL-3917250, UE 4.20): crash fixes on top of 3.1, so it has no game data of its
// own and plays on 3.1's (gamedata/3915963), the closest earlier build with a folder (src/gamedata/read.js).
const v31 = "3915963";
const v311 = "3917250";
const now = new Date("2026-11-05T12:00:00Z");

test("3.1.1 is known by its version, Season 3, and plays on 3.1's game data", () => {
  assert.equal(versionOf(v311), "3.1.1");
  assert.equal(dataBuild(v311), v31);
  assert.ok(battleRoyaleBuilds.includes(v311));
  assert.ok(buildChoices().includes(v311));
  assert.equal(allowedBuildList(["3.1.1"]).join(), v311);
  assert.equal(allowedBuildList(["3.1"]).join(), v31);
  assert.deepEqual(inBuild(v311, athenaSeason), inBuild(v31, athenaSeason));
  assert.deepEqual(inBuild(v311, athenaCosmetics), inBuild(v31, athenaCosmetics));
  assert.equal(buildOfSeason(3), "3942182");
  assert.match(seasonName(3), /3\.0/);
});

test("the User-Agent of 3.1.1 names its changelist", () => {
  const agent = "Fortnite/4.20.0-3917250+++Fortnite+Release-3.1 Windows/10.0.17134.1.256.64bit";
  assert.equal(getBuild({ get: () => agent }), v311);
  assert.equal(versionOf(getBuild({ get: () => agent })), "3.1.1");
});

test("3.1.1 runs 3.1's events, LTMs, storefronts and world", () => {
  assert.deepEqual(activeEventFlags(v311), activeEventFlags(v31));
  assert.ok(activeEventFlags(v311).length > 0);
  for (const id of ["sneakySilencers", "blitz", "blitzSolo", "blitzDuo", "fiveByTwenty"]) assert.ok(hasLtm(id, v311), id);
  const settings = { matchmakingModes: { blitzSolo: true, highJump: true } };
  assert.deepEqual(ltmForcedQueues(v311, settings), ltmForcedQueues(v31, settings));
  assert.deepEqual(inBuild(v311, () => itemShopOffers(now)), inBuild(v31, () => itemShopOffers(now)));
  assert.deepEqual(inBuild(v311, () => eventStoreOffers(now)), inBuild(v31, () => eventStoreOffers(now)));
  assert.deepEqual(inBuild(v311, () => worldInfo(now)), inBuild(v31, () => worldInfo(now)));
});

test("3.1.1 takes 3.1's AssignMatch: six fields and no match start countdown", () => {
  assert.equal(assignmentBucket(`${v311}:0:NA:2`, v311), `Fortnite:Fortnite:${v311}:0:NA:2`);
  assert.ok(!showsMatchStart(v311));
});
